-- =====================================================================
-- مِدار | MIDAR — الترحيل 0101: تشغيل الأقسام بمفتاح، ومصطلحات المؤسسة، وسجل تغيير النوع
--   tenant_modules: صف لكل (مؤسسة، قسم) بدل عمود لكل قسم، فيُضاف قسم جديد (مثل حلقات التحفيظ) بلا تعديل جداول.
--   يُنسخ إليه محتوى school_modules كما هو. ويبقى school_modules ويُحدَّث معه حتى نتأكد، فالرجوع لا يفقد شيئًا.
--   tenant_terms: تعديلات المؤسسة على مصطلحات نوعها.
--   org_type_changes: سجل كل تغيير لنوع مؤسسة، بالقديم والجديد ومن نفّذ والسبب وما تأثر.
--   إضافي فقط: لا يُحذف شيء ولا يتغير ما تراه أي مدرسة.
-- =====================================================================

CREATE TABLE tenant_modules (
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  key        text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  enabled    boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
CREATE TRIGGER tenant_modules_touch BEFORE UPDATE ON tenant_modules FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER tenant_modules_audit AFTER INSERT OR UPDATE OR DELETE ON tenant_modules FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_modules USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON tenant_modules TO midar_app;

-- نسخ الوضع الحالي لكل مدرسة كما هو (كل عمود قسم يصير صفًا).
INSERT INTO tenant_modules (tenant_id, key, enabled, updated_at)
SELECT m.tenant_id, kv.key, kv.value::boolean, m.updated_at
  FROM school_modules m, jsonb_each_text(to_jsonb(m) - 'tenant_id' - 'updated_at') kv;

CREATE TABLE tenant_terms (
  tenant_id  text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  terms      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(terms) = 'object' AND octet_length(terms::text) <= 8000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenant_terms_touch BEFORE UPDATE ON tenant_terms FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER tenant_terms_audit AFTER INSERT OR UPDATE OR DELETE ON tenant_terms FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE tenant_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_terms USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON tenant_terms TO midar_app;

-- يقرؤه المالك وحده؛ المدرسة لا ترى سجل تغيير نوعها إلا عبر ملفها في لوحة المالك.
CREATE TABLE org_type_changes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant      text NOT NULL,                 -- سجل دائم: بلا ربط بالجدول، فيبقى حتى لو حُذفت المؤسسة
  from_key    text NOT NULL,
  to_key      text NOT NULL,
  from_engine text NOT NULL,
  to_engine   text NOT NULL,
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 300),
  impact      jsonb NOT NULL DEFAULT '{}',
  actor       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_type_changes_tenant ON org_type_changes (tenant, id DESC);
ALTER TABLE org_type_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_type_changes_platform ON org_type_changes USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT ON org_type_changes TO midar_app;

-- الأقسام الافتراضية للأنواع تطابق ما تحصل عليه المدرسة الجديدة اليوم: كل الأقسام إلا التبرعات.
UPDATE org_types SET default_features = array_remove(default_features, 'donations');
