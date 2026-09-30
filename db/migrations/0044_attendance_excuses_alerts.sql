-- =====================================================================
-- مِدار | MIDAR — الترحيل 0044: سبب الغياب، وأعذار أولياء الأمور، وتنبيهات الطلاب
--   excuse: سبب الغياب أو التأخر كما تسجله المدرسة، ويظهر لولي الأمر في ملف الطالب.
--   (note يبقى للسجل الداخلي: سبب تعديل حالة محفوظة)
--   parent_excuse: عذر يرسله ولي الأمر من صفحته عن يوم غياب أو تأخر، وتقبله الإدارة
--   (فتصبح الحالة «بعذر» ويُنسخ العذر إلى excuse) أو ترفضه.
--   student_alerts: تنبيهات وملاحظات على الطالب من الإدارة أو معلميه، ويظهر منها لولي الأمر
--   ما حُدد له، ويستطيع ولي الأمر تأكيد الاطلاع عليه.
-- =====================================================================

ALTER TABLE attendance
  ADD COLUMN excuse text CHECK (excuse IS NULL OR char_length(excuse) <= 200),
  ADD COLUMN parent_excuse text CHECK (parent_excuse IS NULL OR char_length(parent_excuse) <= 300),
  ADD COLUMN parent_excuse_at timestamptz,
  ADD COLUMN parent_excuse_state text CHECK (parent_excuse_state IN ('pending', 'accepted', 'rejected'));
CREATE INDEX attendance_excuses_pending ON attendance (tenant_id, parent_excuse_at) WHERE parent_excuse_state = 'pending';
CREATE INDEX IF NOT EXISTS attendance_student_day ON attendance (tenant_id, student_id, day DESC);

CREATE TABLE student_alerts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id    bigint NOT NULL,
  kind          text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'attendance', 'behavior', 'academic', 'health', 'praise')),
  level         text NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'urgent', 'positive')),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  body          text CHECK (body IS NULL OR char_length(body) <= 1000),
  for_parent    boolean NOT NULL DEFAULT true,
  created_by    text NOT NULL,
  teacher_id    bigint,
  acknowledged_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX student_alerts_student ON student_alerts (tenant_id, student_id, created_at DESC);
CREATE TRIGGER student_alerts_touch BEFORE UPDATE ON student_alerts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER student_alerts_audit AFTER INSERT OR UPDATE OR DELETE ON student_alerts FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE student_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON student_alerts USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON student_alerts TO midar_app;

-- حد تنبيه الغياب: عند بلوغ عدد أيام الغياب (بلا عذر) خلال 30 يومًا يظهر تنبيه تلقائي لولي الأمر وفي متابعة الإدارة
ALTER TABLE school_public_settings
  ADD COLUMN absence_alert_threshold integer NOT NULL DEFAULT 3 CHECK (absence_alert_threshold BETWEEN 0 AND 60),
  ADD COLUMN allow_parent_excuses boolean NOT NULL DEFAULT true;
