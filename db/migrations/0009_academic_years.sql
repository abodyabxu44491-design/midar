-- =====================================================================
-- مِدار | MIDAR — الترحيل 0009: السنة الدراسية والفصول الدراسية
--
--   سنة دراسية واحدة حالية لكل مدرسة، وبداخلها فصلان أو ثلاثة.
--   الاختبارات والفواتير تُربط تلقائيًا بالفصل الحالي.
--   بدء سنة جديدة ينقل الطلاب بين الصفوف ويحفظ سجل السنة المنتهية.
-- =====================================================================

CREATE TABLE academic_years (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  CHECK (end_date > start_date)
);
-- سنة حالية واحدة فقط لكل مدرسة
CREATE UNIQUE INDEX academic_years_one_current ON academic_years (tenant_id) WHERE is_current;

CREATE TABLE terms (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL,
  year_id     bigint NOT NULL,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  ordinal     smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (year_id, ordinal),
  CHECK (end_date > start_date),
  FOREIGN KEY (tenant_id, year_id) REFERENCES academic_years (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX terms_one_current ON terms (tenant_id) WHERE is_current;

CREATE TRIGGER academic_years_touch BEFORE UPDATE ON academic_years FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER terms_touch BEFORE UPDATE ON terms FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER academic_years_audit AFTER INSERT OR UPDATE OR DELETE ON academic_years FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER terms_audit AFTER INSERT OR UPDATE OR DELETE ON terms FOR EACH ROW EXECUTE FUNCTION audit_row_change();

ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON academic_years USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terms USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON academic_years, terms TO midar_app;

/* ---------- ربط البيانات بالفصل الدراسي ---------- */
ALTER TABLE exams ADD COLUMN term_id bigint,
  ADD CONSTRAINT exams_term_fk FOREIGN KEY (tenant_id, term_id) REFERENCES terms (tenant_id, id) ON DELETE SET NULL;
CREATE INDEX exams_term ON exams (tenant_id, term_id);

ALTER TABLE invoices ADD COLUMN term_id bigint,
  ADD CONSTRAINT invoices_term_fk FOREIGN KEY (tenant_id, term_id) REFERENCES terms (tenant_id, id) ON DELETE SET NULL;

ALTER TABLE assignments ADD COLUMN term_id bigint,
  ADD CONSTRAINT assignments_term_fk FOREIGN KEY (tenant_id, term_id) REFERENCES terms (tenant_id, id) ON DELETE SET NULL;

-- الفصل الحالي (تُستخدم عند إنشاء أي اختبار أو فاتورة)
CREATE FUNCTION current_term() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT id FROM terms WHERE tenant_id = app_tenant() AND is_current LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION current_term() TO midar_app;

ALTER TABLE exams ALTER COLUMN term_id SET DEFAULT current_term();
ALTER TABLE invoices ALTER COLUMN term_id SET DEFAULT current_term();
ALTER TABLE assignments ALTER COLUMN term_id SET DEFAULT current_term();

/* ---------- سجل الطالب في السنوات السابقة ---------- */
CREATE TABLE student_years (
  tenant_id     text NOT NULL,
  student_id    bigint NOT NULL,
  year_id       bigint NOT NULL,
  class_id      bigint,
  class_name    text,                -- محفوظ نصًا حتى لو حُذف الفصل لاحقًا
  result        text CHECK (result IN ('promoted', 'repeated', 'graduated', 'left')),
  average       numeric(5,2),
  archived_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, year_id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, year_id)    REFERENCES academic_years (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX student_years_year ON student_years (tenant_id, year_id);
ALTER TABLE student_years ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON student_years USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON student_years TO midar_app;
CREATE TRIGGER student_years_audit AFTER INSERT OR UPDATE OR DELETE ON student_years FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------- سنة افتراضية للمدارس القائمة ---------- */
DO $$
DECLARE t record; y bigint; s date; e date;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    s := date_trunc('year', CURRENT_DATE)::date;
    e := (s + interval '1 year - 1 day')::date;
    INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current)
    VALUES (t.id, to_char(s, 'YYYY') || '/' || to_char(e, 'YYYY'), s, e, true)
    RETURNING id INTO y;
    INSERT INTO terms (tenant_id, year_id, name, ordinal, start_date, end_date, is_current) VALUES
      (t.id, y, 'الفصل الأول',  1, s, (s + interval '4 months - 1 day')::date, true),
      (t.id, y, 'الفصل الثاني', 2, (s + interval '4 months')::date, (s + interval '8 months - 1 day')::date, false),
      (t.id, y, 'الفصل الثالث', 3, (s + interval '8 months')::date, e, false);
    UPDATE exams      SET term_id = (SELECT id FROM terms WHERE tenant_id = t.id AND ordinal = 1) WHERE tenant_id = t.id AND term_id IS NULL;
    UPDATE invoices   SET term_id = (SELECT id FROM terms WHERE tenant_id = t.id AND ordinal = 1) WHERE tenant_id = t.id AND term_id IS NULL;
    UPDATE assignments SET term_id = (SELECT id FROM terms WHERE tenant_id = t.id AND ordinal = 1) WHERE tenant_id = t.id AND term_id IS NULL;
  END LOOP;
END $$;
