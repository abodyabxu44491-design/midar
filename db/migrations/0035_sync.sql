-- =====================================================================
-- مِدار | MIDAR — الترحيل 0035: أساس المزامنة (Local-First / Sync-First)
--
--   version        : إصدار لكل سجل حضور ودرجة (تزامن متفائل: لا كتابة صامتة فوق قيمة أحدث)
--   sync_changes   : سجل تغييرات متسلسل يُملأ بمشغّلات قاعدة البيانات نفسها
--                    (أي مسار يغيّر البيانات يُسجَّل تلقائيًا: الواجهة، المزامنة، الاستيراد…)
--                    والجهاز يطلب «التغييرات منذ آخر نقطة» فقط (Delta Sync)
--   sync_operations: كل عملية أُرسلت من جهاز: هويتها الفريدة تمنع تكرار الأثر (Idempotency)،
--                    ونتيجتها محفوظة (طُبّقت / تعارض / رُفضت / حُلّت) — وهي أيضًا سجل من عدّل ومن أي جهاز
--   sync_devices   : الأجهزة المسجلة لكل مستخدم مع إمكانية إيقاف جهاز
-- =====================================================================

/* ---------- الإصدارات ---------- */
ALTER TABLE attendance ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE scores ADD COLUMN version integer NOT NULL DEFAULT 1;

CREATE FUNCTION sync_bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  IF TG_TABLE_NAME = 'attendance' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_version BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION sync_bump_version();
CREATE TRIGGER scores_version BEFORE UPDATE ON scores FOR EACH ROW EXECUTE FUNCTION sync_bump_version();

/* ---------- سجل التغييرات ---------- */
CREATE TABLE sync_changes (
  seq         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity      text NOT NULL CHECK (entity IN ('attendance', 'score', 'student', 'exam')),
  entity_key  text NOT NULL,              -- attendance: طالب|يوم — score: اختبار|طالب — student/exam: المعرّف
  class_id    bigint,                     -- نطاق المعلم: كل تغيير مربوط بفصله
  op          text NOT NULL CHECK (op IN ('upsert', 'delete')),
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_changes_tenant_seq ON sync_changes (tenant_id, seq);

CREATE FUNCTION sync_log_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; k text; cls bigint; ent text;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_TABLE_NAME = 'attendance' THEN
    ent := 'attendance'; k := r.student_id || '|' || r.day;
    SELECT class_id INTO cls FROM students WHERE id = r.student_id;
  ELSIF TG_TABLE_NAME = 'scores' THEN
    ent := 'score'; k := r.exam_id || '|' || r.student_id;
    SELECT class_id INTO cls FROM exams WHERE id = r.exam_id;
  ELSIF TG_TABLE_NAME = 'students' THEN
    ent := 'student'; k := r.id::text; cls := r.class_id;
    -- نقل طالب لفصل آخر: الفصل القديم يُبلَّغ أيضًا ليُحذف من أجهزة معلميه
    IF TG_OP = 'UPDATE' AND OLD.class_id IS DISTINCT FROM NEW.class_id AND OLD.class_id IS NOT NULL THEN
      INSERT INTO sync_changes (tenant_id, entity, entity_key, class_id, op) VALUES (r.tenant_id, ent, k, OLD.class_id, 'delete');
    END IF;
  ELSE
    ent := 'exam'; k := r.id::text; cls := r.class_id;
  END IF;
  INSERT INTO sync_changes (tenant_id, entity, entity_key, class_id, op)
  VALUES (r.tenant_id, ent, k, cls, CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END);
  RETURN NULL;
END $$;
CREATE TRIGGER attendance_sync AFTER INSERT OR UPDATE OR DELETE ON attendance FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER scores_sync AFTER INSERT OR UPDATE OR DELETE ON scores FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER students_sync AFTER INSERT OR UPDATE OR DELETE ON students FOR EACH ROW EXECUTE FUNCTION sync_log_change();
CREATE TRIGGER exams_sync AFTER INSERT OR UPDATE OR DELETE ON exams FOR EACH ROW EXECUTE FUNCTION sync_log_change();

/* ---------- الأجهزة ---------- */
CREATE TABLE sync_devices (
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id   uuid NOT NULL,
  user_id     bigint NOT NULL,
  user_agent  text CHECK (char_length(user_agent) <= 200),
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  last_ip     inet,
  revoked_at  timestamptz,
  revoked_by  text,
  PRIMARY KEY (tenant_id, device_id)
);

/* ---------- العمليات ---------- */
CREATE TABLE sync_operations (
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operation_id  uuid NOT NULL,
  device_id     uuid NOT NULL,
  user_id       bigint NOT NULL,
  actor         text NOT NULL,
  op_type       text NOT NULL CHECK (op_type IN ('attendance.mark', 'score.set')),
  entity_key    text NOT NULL,
  class_id      bigint,
  payload       jsonb NOT NULL CHECK (octet_length(payload::text) <= 4000),
  base_version  integer NOT NULL DEFAULT 0,
  client_seq    bigint,
  client_time   timestamptz,
  status        text NOT NULL CHECK (status IN ('processing', 'applied', 'conflict', 'rejected', 'resolved')),
  result        jsonb NOT NULL DEFAULT '{}',
  received_at   timestamptz NOT NULL DEFAULT now(),
  resolved_by   text,
  resolved_at   timestamptz,
  PRIMARY KEY (tenant_id, operation_id)
);
CREATE INDEX sync_operations_conflicts ON sync_operations (tenant_id, status) WHERE status = 'conflict';
CREATE INDEX sync_operations_user ON sync_operations (tenant_id, user_id, received_at DESC);

/* ---------- العزل والصلاحيات ---------- */
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sync_changes', 'sync_devices', 'sync_operations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant() OR current_setting(''app.platform'', true) = ''on'') WITH CHECK (tenant_id = app_tenant() OR current_setting(''app.platform'', true) = ''on'')', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, DELETE ON sync_changes TO midar_app;
GRANT SELECT, INSERT, UPDATE ON sync_devices TO midar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_operations TO midar_app;
