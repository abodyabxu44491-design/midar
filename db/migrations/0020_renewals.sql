-- =====================================================================
-- مِدار | MIDAR — الترحيل 0020: طلبات تجديد الاشتراك
--   ترسلها المدرسة من إعداداتها، وتصل إلى لوحة المالك.
-- =====================================================================

CREATE TABLE renewal_requests (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind            text NOT NULL DEFAULT 'renew' CHECK (kind IN ('renew', 'upgrade', 'support')),
  months          integer CHECK (months IS NULL OR months BETWEEN 1 AND 36),
  students_wanted integer CHECK (students_wanted IS NULL OR students_wanted BETWEEN 1 AND 100000),
  note            text CHECK (char_length(note) <= 1000),
  contact_name    text CHECK (char_length(contact_name) <= 120),
  contact_phone   text CHECK (char_length(contact_phone) <= 25),
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'done', 'rejected')),
  owner_note      text CHECK (char_length(owner_note) <= 500),
  requested_by    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX renewal_requests_status ON renewal_requests (status, id DESC);
CREATE INDEX renewal_requests_tenant ON renewal_requests (tenant_id, id DESC);

CREATE TRIGGER renewal_requests_touch BEFORE UPDATE ON renewal_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER renewal_requests_audit AFTER INSERT OR UPDATE OR DELETE ON renewal_requests FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- المدرسة ترى طلباتها فقط، والمالك يرى الكل
ALTER TABLE renewal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform ON renewal_requests
  USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE ON renewal_requests TO midar_app;

-- بيانات التواصل مع إدارة المنصة (تظهر للمدارس في الإعدادات)
ALTER TABLE platform_settings
  ADD COLUMN support_whatsapp text CHECK (support_whatsapp ~ '^[0-9+]{0,20}$'),
  ADD COLUMN support_note text CHECK (char_length(support_note) <= 300);
UPDATE platform_settings SET support_whatsapp = COALESCE(support_whatsapp, brand_phone);
