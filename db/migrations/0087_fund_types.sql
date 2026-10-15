-- Funds: a donations fund is its own type, so donations go to it and fees, salaries and expenses never land in
-- it unless someone chooses it on purpose. Every income and expense screen now names its fund explicitly.
ALTER TABLE finance_accounts DROP CONSTRAINT finance_accounts_kind_check;
ALTER TABLE finance_accounts ADD CONSTRAINT finance_accounts_kind_check CHECK (kind IN ('bank', 'cash', 'online', 'donations', 'other'));

-- The default funds no longer collide with funds a school opened before its first finance visit: existing names
-- and payment-method links are kept.
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
    (t, 'expense', 'مصروفات أخرى', 'other_expense')
  ON CONFLICT DO NOTHING;

  INSERT INTO finance_accounts (tenant_id, name, kind, currency) VALUES (t, 'الصندوق النقدي', 'cash', cur) ON CONFLICT (tenant_id, name) DO NOTHING;
  SELECT id INTO acc FROM finance_accounts WHERE tenant_id = t AND name = 'الصندوق النقدي';
  INSERT INTO finance_method_accounts (tenant_id, method, account_id) VALUES (t, 'cash', acc) ON CONFLICT (tenant_id, method) DO NOTHING;
  INSERT INTO finance_accounts (tenant_id, name, kind, currency) VALUES (t, 'الحساب البنكي', 'bank', cur) ON CONFLICT (tenant_id, name) DO NOTHING;
  SELECT id INTO acc FROM finance_accounts WHERE tenant_id = t AND name = 'الحساب البنكي';
  INSERT INTO finance_method_accounts (tenant_id, method, account_id) VALUES
    (t, 'transfer', acc), (t, 'card', acc), (t, 'online', acc)
  ON CONFLICT (tenant_id, method) DO NOTHING;
END $$;
