-- =====================================================================
-- مِدار | MIDAR — الترحيل 0003: الحسابات البنكية وإشعارات التحويل
--
-- طريقة السداد:
--   1) الإدارة تضيف حساب/حسابات المدرسة البنكية.
--   2) ولي الأمر يضغط "ادفع" فيظهر له الحساب البنكي، يحوّل من تطبيق بنكه،
--      ثم يرسل "إشعار تحويل" (المبلغ، التاريخ، اسم المحوِّل، رقم العملية).
--   3) الإدارة تراجع الإشعار: تأكيد (يُسجل كدفعة تحويل بإيصال) أو رفض مع السبب.
--   4) الدفع النقدي تسجله الإدارة مباشرة عند الحضور للمدرسة.
-- =====================================================================

ALTER TABLE tenants ADD COLUMN payment_note text CHECK (char_length(payment_note) <= 500);

CREATE TABLE payment_accounts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  bank_name       text NOT NULL CHECK (char_length(bank_name) BETWEEN 2 AND 80),
  account_holder  text NOT NULL CHECK (char_length(account_holder) BETWEEN 2 AND 120),
  iban            text NOT NULL CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  account_number  text CHECK (account_number ~ '^[0-9-]{4,34}$'),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, iban)
);
CREATE TRIGGER payment_accounts_touch BEFORE UPDATE ON payment_accounts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE payment_claims (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        text NOT NULL,
  invoice_id       bigint NOT NULL,
  student_id       bigint NOT NULL,
  account_id       bigint,
  amount           numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  transfer_date    date NOT NULL,
  sender_name      text NOT NULL CHECK (char_length(sender_name) BETWEEN 2 AND 120),
  bank_reference   text CHECK (char_length(bank_reference) <= 60),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  review_note      text CHECK (char_length(review_note) <= 300),
  reviewed_by      text,
  reviewed_at      timestamptz,
  payment_id       bigint REFERENCES payments(id) ON DELETE RESTRICT,
  idempotency_key  text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 80),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (status <> 'confirmed' OR payment_id IS NOT NULL),
  CHECK (status <> 'rejected' OR char_length(review_note) >= 3),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, account_id) REFERENCES payment_accounts (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX payment_claims_pending ON payment_claims (tenant_id, status, created_at DESC);
CREATE INDEX payment_claims_invoice ON payment_claims (invoice_id);

-- الإشعار بعد مراجعته لا يتغير
CREATE FUNCTION payment_claims_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'لا تُحذف إشعارات التحويل' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'تمت مراجعة هذا الإشعار مسبقًا' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.invoice_id <> OLD.invoice_id OR NEW.student_id <> OLD.student_id OR NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'لا يمكن نقل إشعار التحويل' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> 'pending' THEN
    NEW.reviewed_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_claims_guard BEFORE UPDATE OR DELETE ON payment_claims FOR EACH ROW EXECUTE FUNCTION payment_claims_guard();

-- سجل التدقيق + العزل + الصلاحيات
CREATE TRIGGER payment_accounts_audit AFTER INSERT OR UPDATE OR DELETE ON payment_accounts FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER payment_claims_audit AFTER INSERT OR UPDATE OR DELETE ON payment_claims FOR EACH ROW EXECUTE FUNCTION audit_row_change();

ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_accounts USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE payment_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_claims USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

GRANT SELECT, INSERT, UPDATE ON payment_accounts, payment_claims TO midar_app;
