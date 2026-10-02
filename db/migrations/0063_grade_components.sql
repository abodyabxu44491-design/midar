-- =====================================================================
-- مِدار | MIDAR — الترحيل 0063: توزيع الدرجات (أنواع الدرجات وأوزانها)
--   المدرسة تحدد أنواع الدرجات (مشاركة، واجبات، اختبارات قصيرة، شهري، نهائي…) ووزن كل نوع من 100،
--   لكل المدرسة أو لصف بعينه. كل درجة يرصدها المعلم تتبع نوعًا، ونتيجة المادة في الكشف والشهادة
--   = مجموع (وزن النوع × نسبة الطالب في درجات هذا النوع).
--   مدرسة بلا توزيع تبقى على الحساب السابق (مجموع الدرجات ÷ مجموع القصوى).
-- =====================================================================
CREATE TABLE grade_components (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  grade_id    bigint,                 -- NULL = توزيع عام لكل الصفوف؛ وإلا توزيع خاص بهذا الصف
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  weight      numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  is_default  boolean NOT NULL DEFAULT false,   -- النوع الذي تُحسب عليه الدرجات بلا نوع (القديمة والمرصودة آليًا)
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, grade_id) REFERENCES grades (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX grade_components_name ON grade_components (tenant_id, COALESCE(grade_id, 0), name);
CREATE UNIQUE INDEX grade_components_default ON grade_components (tenant_id, COALESCE(grade_id, 0)) WHERE is_default;
CREATE INDEX grade_components_scope ON grade_components (tenant_id, grade_id, sort_order);
CREATE TRIGGER grade_components_audit AFTER INSERT OR UPDATE OR DELETE ON grade_components FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE grade_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON grade_components USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON grade_components TO midar_app;

-- نوع الدرجة لكل «اختبار» (أي عنصر تقييم يرصده المعلم). لا يُحذف نوع عليه درجات.
ALTER TABLE exams
  ADD COLUMN component_id bigint,
  ADD CONSTRAINT exams_component_fk FOREIGN KEY (tenant_id, component_id) REFERENCES grade_components (tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX exams_component ON exams (tenant_id, component_id) WHERE component_id IS NOT NULL;
