-- =====================================================================
-- مِدار | MIDAR — الترحيل 0024: ملف المعلم، قوالب الرسوم والتقسيط، والخصومات
-- =====================================================================

/* ---------- ملف المعلم ---------- */
ALTER TABLE teachers
  ADD COLUMN employee_no text CHECK (char_length(employee_no) <= 30),
  ADD COLUMN national_id text CHECK (national_id IS NULL OR national_id ~ '^[0-9]{5,20}$'),
  ADD COLUMN email text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$'),
  ADD COLUMN specialty text CHECK (char_length(specialty) <= 60),
  ADD COLUMN department text CHECK (char_length(department) <= 60);
CREATE UNIQUE INDEX teachers_employee_no ON teachers (tenant_id, employee_no) WHERE employee_no IS NOT NULL;

/* ---------- قوالب الرسوم ---------- */
CREATE TABLE fee_plans (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  grade_id        bigint,
  amount          numeric(12,2) NOT NULL CHECK (amount >= 0 AND amount <= 10000000),
  installments    smallint NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 12),
  first_due       date,
  interval_months smallint NOT NULL DEFAULT 1 CHECK (interval_months BETWEEN 1 AND 12),
  term_id         bigint,
  note            text CHECK (char_length(note) <= 300),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  FOREIGN KEY (tenant_id, grade_id) REFERENCES grades (tenant_id, id) ON DELETE SET NULL (grade_id),
  FOREIGN KEY (tenant_id, term_id)  REFERENCES terms  (tenant_id, id) ON DELETE SET NULL (term_id)
);
CREATE TRIGGER fee_plans_touch BEFORE UPDATE ON fee_plans FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER fee_plans_audit AFTER INSERT OR UPDATE OR DELETE ON fee_plans FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------- خصومات ومنح الطلاب ---------- */
CREATE TABLE fee_adjustments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL,
  student_id bigint NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('discount', 'scholarship', 'exemption', 'extra')),
  percent    numeric(5,2) CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
  amount     numeric(12,2) CHECK (amount IS NULL OR (amount > 0 AND amount <= 10000000)),
  note       text CHECK (char_length(note) <= 200),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'exemption' OR percent IS NOT NULL OR amount IS NOT NULL),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX fee_adjustments_student ON fee_adjustments (tenant_id, student_id);
CREATE TRIGGER fee_adjustments_audit AFTER INSERT OR UPDATE OR DELETE ON fee_adjustments FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------- ربط الفاتورة بقالبها ودفعتها ---------- */
ALTER TABLE invoices
  ADD COLUMN plan_id bigint,
  ADD COLUMN installment_no smallint CHECK (installment_no IS NULL OR installment_no BETWEEN 1 AND 12),
  ADD CONSTRAINT invoices_plan_fk FOREIGN KEY (tenant_id, plan_id) REFERENCES fee_plans (tenant_id, id) ON DELETE SET NULL (plan_id);
-- لا تتكرر دفعة القالب نفسه لنفس الطالب مهما أُعيد التطبيق
CREATE UNIQUE INDEX invoices_plan_once ON invoices (student_id, plan_id, installment_no)
  WHERE plan_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_plans', 'fee_adjustments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO midar_app', t);
  END LOOP;
END $$;
