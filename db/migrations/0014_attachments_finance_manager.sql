-- =====================================================================
-- مِدار | MIDAR — الترحيل 0014: مرفقات الحركات المالية + المدير المالي
--
--   المرفقات تُحفظ داخل قاعدة البيانات نفسها: لا حساب تخزين خارجي،
--   وتُنسخ احتياطيًا مع البيانات، وتخضع لعزل المدارس مثل أي جدول.
--   الحد لكل ملف 2 ميجابايت، وصور أو PDF فقط.
-- =====================================================================

ALTER TABLE users ADD COLUMN can_manage_accounts boolean NOT NULL DEFAULT false;
UPDATE users SET can_manage_accounts = true WHERE role = 'admin';

CREATE OR REPLACE FUNCTION users_default_perms() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    NEW.can_approve_finance := true;
    NEW.can_manage_payroll := true;
    NEW.can_manage_accounts := true;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE attachments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entity_type  text NOT NULL CHECK (entity_type IN ('finance_entry', 'donation', 'payroll_run')),
  entity_id    bigint NOT NULL,
  filename     text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 160),
  mime         text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),   -- 2 ميجابايت
  data         bytea NOT NULL,
  uploaded_by  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_entity ON attachments (tenant_id, entity_type, entity_id);

-- المرفق دليل مالي: لا يُعدَّل بعد رفعه
CREATE FUNCTION attachments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'المرفق لا يُعدَّل. ارفع مرفقًا جديدًا' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER attachments_immutable BEFORE UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION attachments_guard();

-- سجل التدقيق يحفظ بيانات المرفق بدون محتواه
CREATE FUNCTION attachments_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO audit_log (tenant_id, actor, action, table_name, record_id, new_data, ip)
  VALUES (COALESCE(NEW.tenant_id, OLD.tenant_id), app_actor(),
          CASE TG_OP WHEN 'INSERT' THEN 'insert' ELSE 'delete' END, 'attachments',
          COALESCE(NEW.id, OLD.id)::text,
          jsonb_build_object('filename', COALESCE(NEW.filename, OLD.filename),
                             'entity_type', COALESCE(NEW.entity_type, OLD.entity_type),
                             'entity_id', COALESCE(NEW.entity_id, OLD.entity_id),
                             'size_bytes', COALESCE(NEW.size_bytes, OLD.size_bytes)),
          NULLIF(current_setting('app.ip', true), '')::inet);
  RETURN NULL;
END $$;
CREATE TRIGGER attachments_audit AFTER INSERT OR DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION attachments_audit();

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attachments USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, DELETE ON attachments TO midar_app;

COMMENT ON COLUMN users.can_manage_accounts IS 'إدارة الحسابات والصناديق والتصنيفات المالية';
