-- =====================================================================
-- مِدار | MIDAR — الترحيل 0046: العمليات الطويلة في الخلفية
--   العمليات الثقيلة (استيراد الطلاب والمعلمين، إنشاء مدرسة العرض) تُنفَّذ في الخلفية
--   ويُعرض تقدمها، فلا تنقطع بمهلة الطلب ولا يبقى المستخدم أمام شاشة متجمدة.
--   لا تُحفظ هنا أي كلمة مرور: النتيجة السرية تبقى في ذاكرة الخادم وتُسلَّم لصاحب العملية فقط.
--   tenant_id فارغ = عملية للمالك على مستوى المنصة.
-- =====================================================================
CREATE TABLE jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text,
  kind         text NOT NULL CHECK (kind IN ('showcase_school', 'import_students', 'import_teachers')),
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  done         integer NOT NULL DEFAULT 0 CHECK (done >= 0),
  total        integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  step         text CHECK (step IS NULL OR char_length(step) <= 200),
  summary      jsonb,
  error        text CHECK (error IS NULL OR char_length(error) <= 1000),
  owner_key    text NOT NULL,          -- من بدأها (لا يرى نتيجتها غيره)
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
-- عملية واحدة جارية من كل نوع لكل مدرسة (والمالك) — القاعدة تمنع السباق بين طلبين متزامنين
CREATE UNIQUE INDEX jobs_one_running ON jobs (COALESCE(tenant_id, ''), kind) WHERE status = 'running';
CREATE INDEX jobs_created ON jobs (created_at);
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_scope ON jobs
  USING ((tenant_id IS NOT NULL AND tenant_id = app_tenant()) OR current_setting('app.platform', true) = 'on')
  WITH CHECK ((tenant_id IS NOT NULL AND tenant_id = app_tenant()) OR current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO midar_app;
