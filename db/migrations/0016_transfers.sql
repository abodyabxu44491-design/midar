-- =====================================================================
-- مِدار | MIDAR — الترحيل 0016: التحويل بين الحسابات والصناديق
--   إيداع نقدية في البنك، أو تحويل بين صندوقين، يُسجَّل كحركتين مرتبطتين.
-- =====================================================================

ALTER TABLE finance_entries DROP CONSTRAINT finance_entries_source_type_check;
ALTER TABLE finance_entries ADD CONSTRAINT finance_entries_source_type_check
  CHECK (source_type IN ('manual', 'fee', 'refund', 'donation', 'salary', 'expense', 'withdrawal', 'transfer'));

ALTER TABLE finance_entries ADD COLUMN transfer_group bigint;
CREATE INDEX finance_entries_transfer ON finance_entries (tenant_id, transfer_group) WHERE transfer_group IS NOT NULL;

COMMENT ON COLUMN finance_entries.transfer_group IS 'يربط طرفي التحويل بين حسابين (صادر ووارد)';

-- تصنيف التحويلات لكل مدرسة (يُنشأ عند أول تحويل)
CREATE OR REPLACE FUNCTION transfer_categories() RETURNS TABLE (out_id bigint, in_id bigint)
LANGUAGE plpgsql AS $$
DECLARE t text := app_tenant(); o bigint; i bigint;
BEGIN
  SELECT id INTO o FROM finance_categories WHERE tenant_id = t AND code = 'transfer_out';
  IF o IS NULL THEN
    INSERT INTO finance_categories (tenant_id, direction, name, code)
    VALUES (t, 'expense', 'تحويل صادر بين الحسابات', 'transfer_out') RETURNING id INTO o;
  END IF;
  SELECT id INTO i FROM finance_categories WHERE tenant_id = t AND code = 'transfer_in';
  IF i IS NULL THEN
    INSERT INTO finance_categories (tenant_id, direction, name, code)
    VALUES (t, 'income', 'تحويل وارد بين الحسابات', 'transfer_in') RETURNING id INTO i;
  END IF;
  RETURN QUERY SELECT o, i;
END $$;
GRANT EXECUTE ON FUNCTION transfer_categories() TO midar_app;
