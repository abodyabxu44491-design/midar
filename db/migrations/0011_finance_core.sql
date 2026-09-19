-- =====================================================================
-- مِدار | MIDAR — الترحيل 0011: النظام المالي المتكامل
--
--   الحسابات والصناديق ← تصنيفات الإيراد والمصروف ← سجل حركات مركزي
--   يشمل: الرسوم، التبرعات، الرواتب، المصروفات التشغيلية، السحوبات.
--
--   قواعد ثابتة داخل قاعدة البيانات:
--     • كل حركة لها رقم ومصدر وسبب وحساب وتصنيف. لا حركة مجهولة.
--     • الحركة المعتمدة لا يتغير مبلغها ولا حسابها. التصحيح بالإلغاء.
--     • لا حذف لأي حركة مالية إطلاقًا.
--     • كل تعديل يُسجَّل في سجل التدقيق تلقائيًا.
-- =====================================================================

/* ---------------- الحسابات والصناديق ---------------- */
CREATE TABLE finance_accounts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  kind            text NOT NULL CHECK (kind IN ('bank', 'cash', 'online', 'other')),
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  low_balance     numeric(14,2) CHECK (low_balance IS NULL OR low_balance >= 0),
  note            text CHECK (char_length(note) <= 300),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

-- الحساب الافتراضي لكل طريقة دفع (نقدًا، تحويل، شبكة، إلكتروني)
CREATE TABLE finance_method_accounts (
  tenant_id  text NOT NULL,
  method     text NOT NULL CHECK (method IN ('cash', 'transfer', 'card', 'online')),
  account_id bigint NOT NULL,
  PRIMARY KEY (tenant_id, method),
  FOREIGN KEY (tenant_id, account_id) REFERENCES finance_accounts (tenant_id, id) ON DELETE CASCADE
);

/* ---------------- تصنيفات الإيرادات والمصروفات ---------------- */
CREATE TABLE finance_categories (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  direction  text NOT NULL CHECK (direction IN ('income', 'expense')),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  code       text CHECK (code ~ '^[a-z_]{2,30}$'),      -- تصنيفات النظام
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, direction, name)
);
CREATE UNIQUE INDEX finance_categories_code ON finance_categories (tenant_id, code) WHERE code IS NOT NULL;

/* ---------------- سجل الحركات المالية ---------------- */
CREATE TABLE finance_entries (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL,
  entry_no      text NOT NULL,                       -- رقم العملية: F-000123
  direction     text NOT NULL CHECK (direction IN ('income', 'expense')),
  amount        numeric(14,2) NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  account_id    bigint NOT NULL,
  category_id   bigint NOT NULL,
  occurred_on   date NOT NULL,
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 300),   -- سبب الحركة
  beneficiary   text CHECK (char_length(beneficiary) <= 120),                  -- الجهة المستفيدة
  method        text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'transfer', 'card', 'online')),
  reference     text CHECK (char_length(reference) <= 80),                     -- رقم العملية في البنك
  attachment    text CHECK (char_length(attachment) <= 300),                   -- رابط أو رقم الفاتورة
  status        text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected', 'void')),
  source_type   text NOT NULL DEFAULT 'manual'
                  CHECK (source_type IN ('manual', 'fee', 'refund', 'donation', 'salary', 'expense', 'withdrawal')),
  source_id     bigint,
  term_id       bigint,
  note          text CHECK (char_length(note) <= 300),
  created_by    text NOT NULL,
  approved_by   text,
  approved_at   timestamptz,
  void_reason   text CHECK (char_length(void_reason) <= 300),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, entry_no),
  CHECK (status <> 'approved' OR approved_by IS NOT NULL),
  CHECK (status <> 'void' OR char_length(void_reason) >= 3),
  FOREIGN KEY (tenant_id, account_id)  REFERENCES finance_accounts  (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, category_id) REFERENCES finance_categories (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, term_id)     REFERENCES terms (tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX finance_entries_date ON finance_entries (tenant_id, occurred_on DESC, id DESC);
CREATE INDEX finance_entries_account ON finance_entries (tenant_id, account_id);
CREATE INDEX finance_entries_source ON finance_entries (tenant_id, source_type, source_id);

CREATE TRIGGER finance_accounts_touch BEFORE UPDATE ON finance_accounts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- حماية الحركات: لا حذف، ولا تغيير للمبلغ أو الحساب بعد الاعتماد، والإلغاء نهائي
CREATE FUNCTION finance_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'الحركات المالية لا تُحذف. استخدم الإلغاء مع ذكر السبب' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('void', 'rejected') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'الحركة الملغاة أو المرفوضة لا تُعاد' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'approved' AND (NEW.amount <> OLD.amount OR NEW.account_id <> OLD.account_id
      OR NEW.direction <> OLD.direction OR NEW.occurred_on <> OLD.occurred_on) THEN
    RAISE EXCEPTION 'لا يمكن تغيير مبلغ أو حساب أو تاريخ حركة معتمدة. ألغِها وأنشئ غيرها' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    NEW.approved_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER finance_entries_guard BEFORE UPDATE OR DELETE ON finance_entries
  FOR EACH ROW EXECUTE FUNCTION finance_entries_guard();
CREATE TRIGGER finance_entries_audit AFTER INSERT OR UPDATE OR DELETE ON finance_entries
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER finance_accounts_audit AFTER INSERT OR UPDATE OR DELETE ON finance_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------------- التبرعات ---------------- */
CREATE TABLE donations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL,
  donor_name  text CHECK (char_length(donor_name) <= 120),
  anonymous   boolean NOT NULL DEFAULT false,
  phone       text CHECK (phone ~ '^[0-9+ ]{0,20}$'),
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  purpose     text CHECK (char_length(purpose) <= 200),
  method      text NOT NULL CHECK (method IN ('cash', 'transfer', 'card', 'online')),
  reference   text CHECK (char_length(reference) <= 80),
  received_on date NOT NULL,
  entry_id    bigint,
  note        text CHECK (char_length(note) <= 300),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (anonymous OR char_length(donor_name) >= 2),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES finance_entries (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX donations_date ON donations (tenant_id, received_on DESC);
CREATE TRIGGER donations_audit AFTER INSERT OR UPDATE OR DELETE ON donations FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------------- الموظفون والرواتب ---------------- */
CREATE TABLE staff (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  full_name    text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  job_title    text CHECK (char_length(job_title) <= 80),
  category     text NOT NULL DEFAULT 'teacher' CHECK (category IN ('teacher', 'admin', 'worker', 'other')),
  phone        text CHECK (phone ~ '^[0-9+ ]{0,20}$'),
  iban         text CHECK (iban IS NULL OR iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  base_salary  numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  teacher_id   bigint,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL
);
CREATE TRIGGER staff_touch BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER staff_audit AFTER INSERT OR UPDATE OR DELETE ON staff FOR EACH ROW EXECUTE FUNCTION audit_row_change();

CREATE TABLE payroll_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  period      date NOT NULL,                       -- أول يوم في الشهر
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid', 'void')),
  note        text CHECK (char_length(note) <= 300),
  created_by  text NOT NULL,
  approved_by text,
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, period)
);
CREATE TRIGGER payroll_runs_touch BEFORE UPDATE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER payroll_runs_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION audit_row_change();

CREATE TABLE payroll_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL,
  run_id      bigint NOT NULL,
  staff_id    bigint NOT NULL,
  base        numeric(12,2) NOT NULL DEFAULT 0 CHECK (base >= 0),
  allowances  numeric(12,2) NOT NULL DEFAULT 0 CHECK (allowances >= 0),
  bonus       numeric(12,2) NOT NULL DEFAULT 0 CHECK (bonus >= 0),
  deductions  numeric(12,2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  advances    numeric(12,2) NOT NULL DEFAULT 0 CHECK (advances >= 0),
  net         numeric(12,2) GENERATED ALWAYS AS (base + allowances + bonus - deductions - advances) STORED,
  note        text CHECK (char_length(note) <= 200),
  entry_id    bigint,
  UNIQUE (run_id, staff_id),
  FOREIGN KEY (tenant_id, run_id)   REFERENCES payroll_runs (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff        (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, entry_id) REFERENCES finance_entries (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX payroll_items_run ON payroll_items (run_id);
CREATE TRIGGER payroll_items_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_items FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------------- العزل والصلاحيات ---------------- */
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_accounts','finance_method_accounts','finance_categories','finance_entries',
                           'donations','staff','payroll_runs','payroll_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO midar_app', t);
  END LOOP;
END $$;
GRANT DELETE ON finance_method_accounts, payroll_items TO midar_app;

/* ---------------- رصيد الحساب ---------------- */
CREATE FUNCTION account_balance(p_account bigint) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT opening_balance FROM finance_accounts WHERE id = p_account), 0)
       + COALESCE((SELECT SUM(CASE WHEN direction = 'income' THEN amount ELSE -amount END)
                     FROM finance_entries WHERE account_id = p_account AND status = 'approved'), 0)
$$;
GRANT EXECUTE ON FUNCTION account_balance(bigint) TO midar_app;

/* ---------------- التصنيفات الافتراضية لكل مدرسة ---------------- */
CREATE FUNCTION seed_finance_defaults() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t text := app_tenant(); acc bigint;
BEGIN
  IF t IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM finance_categories WHERE tenant_id = t) THEN RETURN; END IF;

  INSERT INTO finance_categories (tenant_id, direction, name, code) VALUES
    (t, 'income', 'الرسوم الدراسية', 'tuition'),
    (t, 'income', 'رسوم التسجيل', 'registration'),
    (t, 'income', 'النقل المدرسي', 'transport_income'),
    (t, 'income', 'الأنشطة', 'activities_income'),
    (t, 'income', 'التبرعات', 'donation'),
    (t, 'income', 'إيرادات أخرى', 'other_income'),
    (t, 'expense', 'الرواتب', 'salaries'),
    (t, 'expense', 'الإيجار', 'rent'),
    (t, 'expense', 'الكهرباء والمياه', 'utilities'),
    (t, 'expense', 'الإنترنت والاتصالات', 'internet'),
    (t, 'expense', 'الصيانة', 'maintenance'),
    (t, 'expense', 'المستلزمات والقرطاسية', 'supplies'),
    (t, 'expense', 'النقل', 'transport_expense'),
    (t, 'expense', 'الأنشطة', 'activities_expense'),
    (t, 'expense', 'النظافة والأمن', 'services'),
    (t, 'expense', 'اشتراكات وبرامج', 'subscriptions'),
    (t, 'expense', 'سحوبات', 'withdrawal'),
    (t, 'expense', 'مصروفات أخرى', 'other_expense');

  INSERT INTO finance_accounts (tenant_id, name, kind) VALUES (t, 'الصندوق النقدي', 'cash') RETURNING id INTO acc;
  INSERT INTO finance_method_accounts (tenant_id, method, account_id) VALUES (t, 'cash', acc);
  INSERT INTO finance_accounts (tenant_id, name, kind) VALUES (t, 'الحساب البنكي', 'bank') RETURNING id INTO acc;
  INSERT INTO finance_method_accounts (tenant_id, method, account_id) VALUES
    (t, 'transfer', acc), (t, 'card', acc), (t, 'online', acc);
END $$;
GRANT EXECUTE ON FUNCTION seed_finance_defaults() TO midar_app;

/* ---------------- الترقيم ---------------- */
-- يستخدم next_counter('finance') لأرقام الحركات
