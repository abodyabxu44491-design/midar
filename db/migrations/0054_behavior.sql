-- =====================================================================
-- مِدار | MIDAR — الترحيل 0054: السلوك والانضباط
--   behavior_categories  بنود السلوك: إيجابية (تضيف نقاطًا) وسلبية (تخصم)، تعدّلها المدرسة
--   behavior_records     كل مخالفة أو إنجاز لطالب، بنقاطه وقت التسجيل (لا تتغير بتعديل البند لاحقًا)
--   درجة السلوك = الدرجة الأساسية (من الإعدادات) + مجموع النقاط في الفصل الدراسي الحالي
-- =====================================================================
CREATE TABLE behavior_categories (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  kind        text NOT NULL CHECK (kind IN ('positive', 'negative')),
  points      integer NOT NULL CHECK (points BETWEEN 1 AND 100),
  is_active   boolean NOT NULL DEFAULT true,
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER behavior_categories_audit AFTER INSERT OR UPDATE OR DELETE ON behavior_categories FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE behavior_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON behavior_categories USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON behavior_categories TO midar_app;

CREATE TABLE behavior_records (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id   bigint NOT NULL,
  category_id  bigint,
  kind         text NOT NULL CHECK (kind IN ('positive', 'negative')),
  points       integer NOT NULL CHECK (points BETWEEN -100 AND 100 AND points <> 0),
  title        text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 80),
  note         text CHECK (note IS NULL OR char_length(note) <= 500),
  day          date NOT NULL DEFAULT CURRENT_DATE,
  term_id      bigint DEFAULT current_term(),
  teacher_id   bigint,
  recorded_by  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'positive') = (points > 0)),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, category_id) REFERENCES behavior_categories (tenant_id, id) ON DELETE SET NULL (category_id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (teacher_id),
  FOREIGN KEY (tenant_id, term_id) REFERENCES terms (tenant_id, id) ON DELETE SET NULL (term_id)
);
CREATE INDEX behavior_records_student ON behavior_records (tenant_id, student_id, day DESC);
CREATE INDEX behavior_records_day ON behavior_records (tenant_id, day DESC);
CREATE TRIGGER behavior_records_audit AFTER INSERT OR UPDATE OR DELETE ON behavior_records FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE behavior_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON behavior_records USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON behavior_records TO midar_app;
