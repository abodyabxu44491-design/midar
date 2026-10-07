-- =====================================================================
-- مِدار | MIDAR — الترحيل 0068: بوابة مِدار الذكية (المرحلة الأولى)
--   attendance_credentials : رمز حضور مستقل لكل طالب (بصمة للبحث + نسخة مشفرة لإعادة الطباعة)، يُلغى ويُعاد إصداره
--   gates                  : بوابات المدرسة (الرئيسية، الشرقية…)
--   gate_devices           : أجهزة البوابة: رابط اقتران لمرة واحدة ← موافقة الإدارة ← سر خاص بالجهاز
--   attendance_events      : كل مسح حدث مستقل بهوية من الجهاز (event_id) تمنع التكرار، ويُحفظ حتى المرفوض
--   attendance_days        : حالة اليوم (مفتوح ← مغلق ← معتمد) والأيام الاستثنائية
--   attendance_audit       : سجل مقروء لكل تعديل على الحضور (من، متى، القديم والجديد، السبب، الجهاز)
--   attendance             : حالات جديدة (مستأذن، رحلة، نشاط خارجي) + مصدر التسجيل والبوابة ووقت الدخول ودقائق التأخر
-- التفاصيل في docs/SMART_GATE.md
-- =====================================================================

/* ---------- رموز الحضور ---------- */
CREATE TABLE attendance_credentials (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id    bigint NOT NULL,
  kind          text NOT NULL DEFAULT 'qr' CHECK (kind IN ('qr', 'nfc')),
  token_hash    bytea NOT NULL UNIQUE,
  token_enc     text CHECK (token_enc IS NULL OR char_length(token_enc) <= 300),
  version       integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  issued_by     text NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  revoked_by    text,
  revoked_at    timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 200),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX attendance_credentials_active ON attendance_credentials (tenant_id, student_id, kind) WHERE status = 'active';
CREATE TRIGGER attendance_credentials_audit AFTER INSERT OR UPDATE OR DELETE ON attendance_credentials FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE attendance_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_credentials USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_credentials TO midar_app;

/* ---------- البوابات ---------- */
CREATE TABLE gates (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  location    text CHECK (location IS NULL OR char_length(location) <= 120),
  direction   text NOT NULL DEFAULT 'in' CHECK (direction IN ('in', 'out', 'both')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER gates_touch BEFORE UPDATE ON gates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER gates_audit AFTER INSERT OR UPDATE OR DELETE ON gates FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE gates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gates USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON gates TO midar_app;

/* ---------- أجهزة البوابة ---------- */
CREATE TABLE gate_devices (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  public_id       text NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9_-]{16,40}$'),
  gate_id         bigint NOT NULL,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  status          text NOT NULL DEFAULT 'pairing' CHECK (status IN ('pairing', 'pending', 'active', 'disabled', 'revoked')),
  pair_code_hash  bytea,
  pair_expires_at timestamptz,
  secret_hash     bytea,
  fingerprint     jsonb CHECK (fingerprint IS NULL OR jsonb_typeof(fingerprint) = 'object'),
  app_version     text CHECK (app_version IS NULL OR char_length(app_version) <= 40),
  last_seen_at    timestamptz,
  last_sync_at    timestamptz,
  last_ip         inet,
  clock_skew_ms   integer,
  pending_events  integer NOT NULL DEFAULT 0 CHECK (pending_events >= 0),
  created_by      text NOT NULL,
  approved_by     text,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, gate_id) REFERENCES gates (tenant_id, id) ON DELETE RESTRICT,
  CHECK (status <> 'active' OR secret_hash IS NOT NULL)
);
CREATE TRIGGER gate_devices_touch BEFORE UPDATE ON gate_devices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE gate_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gate_devices USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON gate_devices TO midar_app;

/* ---------- أحداث المسح ---------- */
CREATE TABLE attendance_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_id      uuid NOT NULL,
  day           date NOT NULL,
  device_id     bigint,
  gate_id       bigint,
  credential_id bigint,
  student_id    bigint,
  kind          text NOT NULL DEFAULT 'qr' CHECK (kind IN ('qr', 'nfc', 'legacy')),
  direction     text NOT NULL DEFAULT 'in' CHECK (direction IN ('in', 'out')),
  client_ts     timestamptz,
  server_ts     timestamptz NOT NULL DEFAULT now(),
  effective_ts  timestamptz NOT NULL,
  offline       boolean NOT NULL DEFAULT false,
  result        text NOT NULL CHECK (result IN ('present', 'late', 'kept', 'duplicate', 'rejected')),
  reason        text CHECK (reason IS NULL OR char_length(reason) <= 60),
  suspicious    text CHECK (suspicious IS NULL OR char_length(suspicious) <= 60),
  review_state  text CHECK (review_state IN ('open', 'dismissed', 'confirmed')),
  reviewed_by   text,
  attendance_id bigint,
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES gate_devices (tenant_id, id) ON DELETE SET NULL (device_id),
  FOREIGN KEY (tenant_id, gate_id) REFERENCES gates (tenant_id, id) ON DELETE SET NULL (gate_id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX attendance_events_day ON attendance_events (tenant_id, day, id DESC);
CREATE INDEX attendance_events_student ON attendance_events (tenant_id, student_id, effective_ts DESC);
CREATE INDEX attendance_events_review ON attendance_events (tenant_id, day) WHERE review_state = 'open';
ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_events USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
-- سجل لا يُعدَّل: يُسمح فقط بتحديث حالة المراجعة
GRANT SELECT, INSERT, DELETE ON attendance_events TO midar_app;
GRANT UPDATE (review_state, reviewed_by) ON attendance_events TO midar_app;

/* ---------- حالة اليوم ---------- */
CREATE TABLE attendance_days (
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  day           date NOT NULL,
  mode          text NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal', 'custom_hours', 'no_attendance')),
  open_at       time,
  late_after    time,
  close_at      time,
  state         text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed', 'finalized')),
  closed_at     timestamptz,
  finalized_by  text,
  finalized_at  timestamptz,
  absent_count  integer,
  absence_notified_at timestamptz,
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day),
  CHECK (mode <> 'custom_hours' OR (open_at IS NOT NULL AND late_after IS NOT NULL AND close_at IS NOT NULL
                                    AND open_at <= late_after AND late_after < close_at))
);
CREATE TRIGGER attendance_days_touch BEFORE UPDATE ON attendance_days FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER attendance_days_audit AFTER INSERT OR UPDATE OR DELETE ON attendance_days FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE attendance_days ENABLE ROW LEVEL SECURITY;
-- المهمة المجدولة تبحث عن المدارس التي حان إغلاق يومها (منصة)، ثم تعمل داخل كل مدرسة
CREATE POLICY tenant_isolation ON attendance_days
  USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_days TO midar_app;

/* ---------- سجل تعديلات الحضور ---------- */
CREATE TABLE attendance_audit (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id    bigint NOT NULL,
  day           date NOT NULL,
  actor         text NOT NULL,
  old_status    text,
  new_status    text,
  old_source    text,
  new_source    text,
  reason        text CHECK (reason IS NULL OR char_length(reason) <= 300),
  device        text CHECK (device IS NULL OR char_length(device) <= 120),
  ip            inet,
  at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX attendance_audit_student ON attendance_audit (tenant_id, student_id, day DESC);
CREATE INDEX attendance_audit_recent ON attendance_audit (tenant_id, at DESC);
ALTER TABLE attendance_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_audit USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, DELETE ON attendance_audit TO midar_app;

/* ---------- توسيع الحضور ---------- */
ALTER TABLE attendance DROP CONSTRAINT attendance_status_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('present', 'absent', 'late', 'excused', 'permitted', 'trip', 'activity'));
ALTER TABLE attendance
  ADD COLUMN source       text NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('gate', 'manual', 'teacher', 'review', 'sync', 'import', 'excuse')),
  ADD COLUMN gate_id      bigint,
  ADD COLUMN device_id    bigint,
  ADD COLUMN first_in_at  timestamptz,
  ADD COLUMN minutes_late smallint CHECK (minutes_late IS NULL OR minutes_late >= 0),
  ADD COLUMN offline      boolean NOT NULL DEFAULT false,
  ADD COLUMN reviewed_by  text;
ALTER TABLE attendance ADD FOREIGN KEY (tenant_id, gate_id) REFERENCES gates (tenant_id, id) ON DELETE SET NULL (gate_id);
ALTER TABLE attendance ADD FOREIGN KEY (tenant_id, device_id) REFERENCES gate_devices (tenant_id, id) ON DELETE SET NULL (device_id);
-- السجلات القديمة من بوابة PR #9 (ملاحظة «بوابة الحضور»)
UPDATE attendance SET source = 'gate', first_in_at = created_at WHERE note LIKE '%بوابة%';

/* ---------- منطقة الحذر: الأحداث والتدقيق سجلات، والأجهزة مؤقتة ---------- */
CREATE OR REPLACE FUNCTION danger_tables() RETURNS TABLE (name text, depth int, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE t AS (
    SELECT c.table_name::text AS name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name NOT IN ('danger_operations', 'tenant_backups')
  ), fk AS (
    SELECT DISTINCT k.conrelid::regclass::text AS child, k.confrelid::regclass::text AS parent
      FROM pg_constraint k WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace
       AND k.conrelid <> k.confrelid
       AND k.conrelid::regclass::text IN (SELECT name FROM t) AND k.confrelid::regclass::text IN (SELECT name FROM t)
  ), d AS (
    SELECT name, 0 AS depth FROM t
    UNION ALL
    SELECT fk.child, d.depth + 1 FROM d JOIN fk ON fk.parent = d.name WHERE d.depth < 50
  )
  SELECT name, max(depth)::int,
         CASE WHEN name IN ('audit_log', 'security_events', 'sms_messages', 'ai_queries', 'notification_deliveries',
                            'attendance_events', 'attendance_audit') THEN 'log'
              WHEN name IN ('sessions', 'sync_changes', 'sync_devices', 'sync_operations', 'password_requests', 'push_subscriptions',
                            'notification_prefs', 'gate_devices') THEN 'transient'
              WHEN name IN ('subscriptions', 'subscription_events', 'subscription_invoices', 'tenant_prices', 'renewal_requests', 'leads', 'sms_ledger') THEN 'billing'
              ELSE 'data' END
    FROM d GROUP BY name;
$$;
