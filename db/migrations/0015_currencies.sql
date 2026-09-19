-- =====================================================================
-- مِدار | MIDAR — الترحيل 0015: العملات (ريال سعودي، ريال يمني، دولار)
--
--   لكل مدرسة عملة أساسية تظهر بها التقارير والرسوم.
--   ولكل حساب أو صندوق عملته، ويمكن أن تختلف عن الأساسية
--   (مثل صندوق بالدولار داخل مدرسة عملتها الريال اليمني).
--   كل حركة تحفظ مبلغها بعملة حسابها وسعر التحويل والمبلغ بالعملة الأساسية.
-- =====================================================================

ALTER TABLE tenants
  ADD COLUMN currency text NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR', 'YER', 'USD'));

ALTER TABLE finance_accounts
  ADD COLUMN currency text NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR', 'YER', 'USD'));

-- حسابات المدارس القائمة تأخذ العملة الأساسية لمدرستها
UPDATE finance_accounts a SET currency = t.currency FROM tenants t WHERE t.id = a.tenant_id;

ALTER TABLE finance_entries
  ADD COLUMN rate numeric(14,6) NOT NULL DEFAULT 1 CHECK (rate > 0),
  ADD COLUMN amount_base numeric(14,2) GENERATED ALWAYS AS (round(amount * rate, 2)) STORED;

COMMENT ON COLUMN finance_entries.rate IS 'سعر تحويل عملة الحساب إلى العملة الأساسية للمدرسة (1 إذا تطابقتا)';
COMMENT ON COLUMN finance_entries.amount_base IS 'المبلغ بالعملة الأساسية، يُحسب تلقائيًا';

-- الرصيد يبقى بعملة الحساب نفسه
CREATE OR REPLACE FUNCTION account_balance(p_account bigint) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT opening_balance FROM finance_accounts WHERE id = p_account), 0)
       + COALESCE((SELECT SUM(CASE WHEN direction = 'income' THEN amount ELSE -amount END)
                     FROM finance_entries WHERE account_id = p_account AND status = 'approved'), 0)
$$;

-- الحسابات الافتراضية تُنشأ بعملة المدرسة
CREATE OR REPLACE FUNCTION seed_finance_defaults() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t text := app_tenant(); acc bigint; cur text;
BEGIN
  IF t IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM finance_categories WHERE tenant_id = t) THEN RETURN; END IF;
  SELECT currency INTO cur FROM tenants WHERE id = t;

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

  INSERT INTO finance_accounts (tenant_id, name, kind, currency) VALUES (t, 'الصندوق النقدي', 'cash', cur) RETURNING id INTO acc;
  INSERT INTO finance_method_accounts (tenant_id, method, account_id) VALUES (t, 'cash', acc);
  INSERT INTO finance_accounts (tenant_id, name, kind, currency) VALUES (t, 'الحساب البنكي', 'bank', cur) RETURNING id INTO acc;
  INSERT INTO finance_method_accounts (tenant_id, method, account_id) VALUES
    (t, 'transfer', acc), (t, 'card', acc), (t, 'online', acc);
END $$;
