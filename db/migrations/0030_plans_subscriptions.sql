-- =====================================================================
-- مِدار | MIDAR — الترحيل 0030: الباقات والاشتراكات والتجربة المجانية
--
--   كتالوج المميزات ← الباقات (أسعار ومميزات وحدود من لوحة المالك)
--   ← الاشتراك (لقطة ثابتة من الباقة وقت التفعيل + إضافات) ← سجل الاشتراك
--   ← الطلبات من الصفحة العامة ومن المدارس (تجربة، اشتراك، ميزة، ترقية، تجديد، تواصل)
--
-- قاعدة ثابتة: الاشتراك شيء وبيانات المدرسة شيء آخر.
-- انتهاء الاشتراك أو التجربة يغيّر حالة الوصول فقط، ولا يحذف أي بيانات.
-- =====================================================================

/* ---------- 1) كتالوج المميزات ---------- */
-- core: أساس المنصة (موجود دائمًا)، module: قسم برمجي يُفرض في الخادم، service: خدمة (دعم، تدريب…)
CREATE TABLE features (
  key            text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description    text CHECK (char_length(description) <= 300),
  category       text NOT NULL DEFAULT 'عام' CHECK (char_length(category) BETWEEN 2 AND 40),
  kind           text NOT NULL CHECK (kind IN ('core', 'module', 'service')),
  sort           integer NOT NULL DEFAULT 100,
  is_active      boolean NOT NULL DEFAULT true,
  requestable    boolean NOT NULL DEFAULT true,            -- تستطيع المدرسة طلبها كإضافة
  addon_monthly  numeric(12,2) CHECK (addon_monthly IS NULL OR addon_monthly >= 0),
  addon_yearly   numeric(12,2) CHECK (addon_yearly IS NULL OR addon_yearly >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER features_touch BEFORE UPDATE ON features FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

INSERT INTO features (key, name, description, category, kind, sort, requestable) VALUES
  ('students',       'إدارة الطلاب',            'ملف لكل طالب، الحالات، والاستيراد من ملف', 'الأساس', 'core', 1, false),
  ('teachers',       'المعلمون والإسناد',        'حسابات المعلمين وتوزيع المواد',           'الأساس', 'core', 2, false),
  ('structure',      'الهيكل الأكاديمي',         'المراحل والصفوف والشعب والمواد',          'الأساس', 'core', 3, false),
  ('parent_portal',  'صفحة أولياء الأمور',       'رابط للمدرسة وملف لكل طالب بمعرّف سري',   'الأساس', 'core', 4, false),
  ('data_export',    'نسخة من بيانات المدرسة',   'تنزيل كل بيانات المدرسة في أي وقت',       'الأساس', 'core', 5, false),
  ('attendance',     'الحضور والغياب',           'تسجيل الحضور اليومي وتقاريره',            'أكاديمي', 'module', 10, true),
  ('exams',          'الاختبارات والدرجات',      'إدخال الدرجات واعتمادها ونشرها',          'أكاديمي', 'module', 11, true),
  ('reports',        'كشوف الدرجات',             'كشف رسمي لكل طالب',                       'أكاديمي', 'module', 12, true),
  ('exam_papers',    'مصمم الاختبارات الورقية',  'بنك الأسئلة وتصميم الاختبارات وطباعتها',  'أكاديمي', 'module', 13, true),
  ('timetable',      'الجدول الدراسي',           'جدول لكل صف ولكل معلم مع منع التعارض',     'أكاديمي', 'module', 14, true),
  ('homework',       'الواجبات',                 'ينشرها المعلم ويتابعها ولي الأمر',        'أكاديمي', 'module', 15, true),
  ('analytics',      'التحليلات',                'نسب الحضور ومتوسطات الدرجات',             'أكاديمي', 'module', 16, true),
  ('announcements',  'التعاميم',                 'رسائل المدرسة لأولياء الأمور',            'التواصل', 'module', 20, true),
  ('messaging',      'تنبيهات واتساب',           'أزرار تنبيه ولي الأمر بالغياب والرسوم',   'التواصل', 'module', 21, true),
  ('admissions',     'طلبات التسجيل',            'طلبات التحاق الطلاب الجدد',               'التواصل', 'module', 22, true),
  ('fees',           'الرسوم والفواتير',          'فواتير الطلاب والسداد والإيصالات',        'المالية', 'module', 30, true),
  ('finance',        'النظام المالي',            'الحسابات والصناديق وسجل الحركات',         'المالية', 'module', 31, true),
  ('transfers',      'التحويل بين الحسابات',     'يحتاج النظام المالي',                     'المالية', 'module', 32, true),
  ('donations',      'التبرعات',                 'يحتاج النظام المالي',                     'المالية', 'module', 33, true),
  ('payroll',        'الرواتب',                  'الموظفون ومسير الرواتب',                  'المالية', 'module', 34, true),
  ('whatsapp_support','دعم فني عبر واتساب',       NULL,                                       'الخدمات', 'service', 50, false),
  ('onboarding',     'مساعدة في إدخال البيانات', NULL,                                       'الخدمات', 'service', 51, true),
  ('training',       'تدريب فريق المدرسة',       NULL,                                       'الخدمات', 'service', 52, true),
  ('priority_support','أولوية في الدعم',          NULL,                                       'الخدمات', 'service', 53, true);

/* ---------- 2) الباقات ---------- */
CREATE TABLE plans (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,29}$'),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  tagline           text CHECK (char_length(tagline) <= 80),
  description       text CHECK (char_length(description) <= 500),
  badge             text CHECK (char_length(badge) <= 30),          -- مثل: الأكثر طلبًا
  currency          text NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR', 'YER', 'USD')),
  monthly_price     numeric(12,2) CHECK (monthly_price IS NULL OR monthly_price >= 0),
  yearly_price      numeric(12,2) CHECK (yearly_price IS NULL OR yearly_price >= 0),
  setup_fee         numeric(12,2) NOT NULL DEFAULT 0 CHECK (setup_fee >= 0),
  discount_percent  numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90),
  promo_label       text CHECK (char_length(promo_label) <= 60),     -- عرض مؤقت
  promo_percent     numeric(5,2) CHECK (promo_percent IS NULL OR promo_percent BETWEEN 1 AND 90),
  promo_ends_at     date,
  contact_only      boolean NOT NULL DEFAULT false,                  -- «تواصل معنا» بدل السعر
  max_students      integer CHECK (max_students IS NULL OR max_students BETWEEN 1 AND 100000),   -- NULL = مفتوح
  max_teachers      integer CHECK (max_teachers IS NULL OR max_teachers BETWEEN 1 AND 10000),
  trial_enabled     boolean NOT NULL DEFAULT true,
  is_public         boolean NOT NULL DEFAULT true,                   -- يظهر في الصفحة العامة
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  highlight         boolean NOT NULL DEFAULT false,
  sort              integer NOT NULL DEFAULT 100,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((promo_percent IS NULL) = (promo_ends_at IS NULL))
);
CREATE TRIGGER plans_touch BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE plan_features (
  plan_id     bigint NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES features(key) ON UPDATE CASCADE ON DELETE CASCADE,
  sort        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (plan_id, feature_key)
);

-- الباقات الافتتاحية (كلها قابلة للتعديل من لوحة المالك)
INSERT INTO plans (code, name, tagline, monthly_price, yearly_price, max_students, max_teachers, sort, highlight, badge)
VALUES ('basic', 'الأساسية', 'للمدارس الصغيرة', 299, 2990, 150, 15, 1, false, NULL),
       ('pro', 'الاحترافية', 'كل ما تحتاجه المدرسة', 500, 5000, 800, 60, 2, true, 'الأكثر طلبًا'),
       ('enterprise', 'المؤسسات', 'للمجمّعات والمدارس الكبيرة', 1200, 12000, NULL, NULL, 3, false, NULL);
INSERT INTO plan_features (plan_id, feature_key, sort)
SELECT p.id, f.key, f.sort FROM plans p JOIN features f ON
  (p.code = 'basic' AND f.key IN ('students', 'teachers', 'structure', 'parent_portal', 'data_export', 'attendance', 'exams',
                                  'reports', 'homework', 'announcements', 'messaging', 'whatsapp_support'))
  OR (p.code = 'pro' AND f.key IN ('students', 'teachers', 'structure', 'parent_portal', 'data_export', 'attendance', 'exams',
                                  'reports', 'exam_papers', 'timetable', 'homework', 'analytics', 'announcements', 'messaging',
                                  'admissions', 'fees', 'finance', 'transfers', 'whatsapp_support'))
  OR (p.code = 'enterprise');

-- سعر خاص لمدرسة معينة (لا يغيّر سعر باقي المدارس)
CREATE TABLE tenant_prices (
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id       bigint NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  monthly_price numeric(12,2) CHECK (monthly_price IS NULL OR monthly_price >= 0),
  yearly_price  numeric(12,2) CHECK (yearly_price IS NULL OR yearly_price >= 0),
  note          text CHECK (char_length(note) <= 200),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, plan_id)
);

/* ---------- 3) الاشتراكات ---------- */
CREATE TABLE subscriptions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind            text NOT NULL CHECK (kind IN ('trial', 'paid', 'free')),
  status          text NOT NULL CHECK (status IN ('trial', 'active', 'pending_payment', 'trial_expired', 'expired',
                                                  'suspended', 'canceled', 'ended')),
  plan_id         bigint REFERENCES plans(id) ON DELETE SET NULL,
  plan_name       text NOT NULL CHECK (char_length(plan_name) BETWEEN 2 AND 60),
  -- لقطة وقت التفعيل: المميزات والحدود والأسعار (تعديل الباقة لاحقًا لا يغيّرها إلا بقرار المالك)
  snapshot        jsonb NOT NULL CHECK (jsonb_typeof(snapshot -> 'features') = 'array'),
  addons          jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(addons) = 'array'),   -- [{key, until, price, note}]
  billing_cycle   text NOT NULL DEFAULT 'none' CHECK (billing_cycle IN ('monthly', 'yearly', 'custom', 'none')),
  price           numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  discount        numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  currency        text NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR', 'YER', 'USD')),
  starts_on       date NOT NULL,
  ends_on         date,                                  -- NULL = بلا نهاية
  grace_days      integer NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 120),
  max_students    integer CHECK (max_students IS NULL OR max_students BETWEEN 1 AND 100000),
  max_teachers    integer CHECK (max_teachers IS NULL OR max_teachers BETWEEN 1 AND 10000),
  source_lead_id  bigint REFERENCES leads(id) ON DELETE SET NULL,
  note            text CHECK (char_length(note) <= 500),
  created_by      text NOT NULL,
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK (kind <> 'trial' OR ends_on IS NOT NULL)
);
CREATE INDEX subscriptions_tenant ON subscriptions (tenant_id, id DESC);
CREATE INDEX subscriptions_status ON subscriptions (status, ends_on);
CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- سجل الاشتراك: كل تجربة وتفعيل وتجديد وترقية وإضافة وإيقاف وإعادة تفعيل
CREATE TABLE subscription_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id bigint REFERENCES subscriptions(id) ON DELETE SET NULL,
  event           text NOT NULL CHECK (char_length(event) BETWEEN 2 AND 40),
  details         jsonb NOT NULL DEFAULT '{}',
  actor           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_events_tenant ON subscription_events (tenant_id, id DESC);
-- تنبيه «تبقى X أيام» يُسجَّل مرة واحدة لكل اشتراك ولكل عدد أيام
CREATE UNIQUE INDEX subscription_events_reminder ON subscription_events (subscription_id, event, (details ->> 'days'))
  WHERE event = 'reminder';

ALTER TABLE tenants
  ADD COLUMN subscription_id bigint REFERENCES subscriptions(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS tenants_plan_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check CHECK (char_length(plan) BETWEEN 2 AND 60);

/* ---------- 4) إعدادات التجربة والاشتراك ---------- */
ALTER TABLE platform_settings
  ADD COLUMN trial_enabled          boolean NOT NULL DEFAULT true,
  ADD COLUMN trial_days             integer NOT NULL DEFAULT 30 CHECK (trial_days BETWEEN 1 AND 365),
  ADD COLUMN trial_all_plans        boolean NOT NULL DEFAULT true,     -- false = حسب إعداد كل باقة
  ADD COLUMN trial_without_plan     boolean NOT NULL DEFAULT true,     -- «أريد تجربة المنصة» بدون اختيار باقة
  ADD COLUMN trials_per_school      integer NOT NULL DEFAULT 1 CHECK (trials_per_school BETWEEN 1 AND 10),
  ADD COLUMN trial_reminder_days    integer[] NOT NULL DEFAULT '{7,3,1}',
  ADD COLUMN trial_grace_days       integer NOT NULL DEFAULT 0 CHECK (trial_grace_days BETWEEN 0 AND 30),
  ADD COLUMN trial_owner_extend     boolean NOT NULL DEFAULT true,
  ADD COLUMN show_plans_after_expiry boolean NOT NULL DEFAULT true,
  ADD COLUMN default_grace_days     integer NOT NULL DEFAULT 7 CHECK (default_grace_days BETWEEN 0 AND 60),
  ADD COLUMN feature_request_mode   text NOT NULL DEFAULT 'request' CHECK (feature_request_mode IN ('request', 'upgrade', 'hidden')),
  ADD COLUMN site_headline          text CHECK (char_length(site_headline) <= 120),
  ADD COLUMN site_subheadline       text CHECK (char_length(site_subheadline) <= 300);

/* ---------- 5) الطلبات: جدول واحد لكل طلبات العملاء ---------- */
ALTER TABLE leads DROP CONSTRAINT leads_status_check;
UPDATE leads SET status = CASE status WHEN 'contacted' THEN 'reviewing' WHEN 'converted' THEN 'active' ELSE status END;
ALTER TABLE leads
  ADD CONSTRAINT leads_status_check CHECK (status IN ('new', 'reviewing', 'approved', 'awaiting_payment', 'active',
                                                     'rejected', 'canceled', 'expired')),
  ADD COLUMN kind            text NOT NULL DEFAULT 'trial' CHECK (kind IN ('trial', 'subscription', 'feature', 'contact', 'upgrade', 'renewal')),
  ADD COLUMN source          text NOT NULL DEFAULT 'public' CHECK (source IN ('public', 'school')),
  ADD COLUMN plan_id         bigint REFERENCES plans(id) ON DELETE SET NULL,
  ADD COLUMN billing_cycle   text CHECK (billing_cycle IN ('monthly', 'yearly')),
  ADD COLUMN months          integer CHECK (months IS NULL OR months BETWEEN 1 AND 36),
  ADD COLUMN try_plan        boolean NOT NULL DEFAULT true,          -- يريد تجربة الباقة المختارة
  ADD COLUMN addon_keys      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN feature_key     text REFERENCES features(key) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN requested_by    text,
  ADD COLUMN handled_by      text,
  ADD COLUMN seen_at         timestamptz;                            -- لعدّاد «طلب جديد» في لوحة المالك
-- طلبات المدرسة لا تحتاج هاتفًا عامًا مثل الزائر
ALTER TABLE leads ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE leads ADD CONSTRAINT leads_public_contact CHECK (source = 'school' OR phone IS NOT NULL);
ALTER TABLE leads ADD CONSTRAINT leads_school_tenant CHECK (source = 'public' OR tenant_id IS NOT NULL);
CREATE INDEX leads_kind ON leads (kind, status, id DESC);
CREATE INDEX leads_tenant ON leads (tenant_id, id DESC) WHERE tenant_id IS NOT NULL;
-- المدرسة ترى طلباتها وتنشئها، والمالك يرى الكل (الزائر يمر بدالة محمية)
DROP POLICY leads_platform ON leads;
CREATE POLICY leads_scope ON leads
  USING ((source = 'school' AND tenant_id = app_tenant()) OR current_setting('app.platform', true) = 'on')
  WITH CHECK ((source = 'school' AND tenant_id = app_tenant()) OR current_setting('app.platform', true) = 'on');

-- نقل طلبات التجديد السابقة إلى الجدول الموحد
INSERT INTO leads (school_name, contact_name, phone, note, status, owner_note, tenant_id, kind, source, months,
                   requested_by, created_at)
SELECT t.name, COALESCE(r.contact_name, r.requested_by), r.contact_phone, r.note,
       CASE r.status WHEN 'contacted' THEN 'reviewing' WHEN 'done' THEN 'active' ELSE r.status END,
       r.owner_note, r.tenant_id,
       CASE r.kind WHEN 'renew' THEN 'renewal' WHEN 'upgrade' THEN 'upgrade' ELSE 'contact' END,
       'school', r.months, r.requested_by, r.created_at
  FROM renewal_requests r JOIN tenants t ON t.id = r.tenant_id;

-- التسجيل من الصفحة العامة: تجربة، اشتراك، تواصل (حد 5 طلبات يوميًا لكل عنوان)
CREATE OR REPLACE FUNCTION submit_lead(p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id bigint; k text := COALESCE(p ->> 'kind', 'trial'); pl bigint := NULLIF(p ->> 'plan_id', '')::bigint;
BEGIN
  IF k NOT IN ('trial', 'subscription', 'contact') THEN
    RAISE EXCEPTION 'نوع الطلب غير صحيح' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM leads WHERE ip = NULLIF(current_setting('app.ip', true), '')::inet
       AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'تم استقبال طلبك مسبقًا. سنتواصل معك قريبًا.' USING ERRCODE = 'P0001';
  END IF;
  IF pl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plans WHERE id = pl AND status = 'active' AND is_public) THEN
    RAISE EXCEPTION 'الباقة المختارة غير متاحة' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO leads (school_name, contact_name, phone, email, city, students_count, note, ip,
                     kind, source, plan_id, billing_cycle, months, try_plan, addon_keys)
  VALUES (p ->> 'school_name', p ->> 'contact_name', p ->> 'phone', p ->> 'email', p ->> 'city',
          NULLIF(p ->> 'students_count', '')::int, p ->> 'note', NULLIF(current_setting('app.ip', true), '')::inet,
          k, 'public', pl, NULLIF(p ->> 'billing_cycle', ''), NULLIF(p ->> 'months', '')::int,
          COALESCE((p ->> 'try_plan')::boolean, true),
          COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p -> 'addon_keys', '[]'))
                          INTERSECT SELECT key FROM features WHERE is_active AND requestable), '{}'))
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

/* ---------- 6) تحويل المدارس الحالية: اشتراك لكل مدرسة بكل مميزاتها الحالية ---------- */
-- لا تفقد أي مدرسة قائمة أي قسم عند النشر، والمالك يعدّل اشتراكها لاحقًا من لوحته
INSERT INTO subscriptions (tenant_id, kind, status, plan_id, plan_name, snapshot, billing_cycle, price, currency,
                           starts_on, ends_on, grace_days, max_students, created_by, note)
SELECT t.id, 'paid', 'active', p.id, COALESCE(p.name, 'مخصصة'),
       jsonb_build_object('features', (SELECT jsonb_agg(key ORDER BY sort) FROM features WHERE is_active),
                          'limits', jsonb_build_object('max_students', t.max_students, 'max_teachers', NULL),
                          'captured_at', now(), 'grandfathered', true),
       'yearly', t.subscription_price, t.currency, t.created_at::date,
       GREATEST(t.subscription_end, t.created_at::date), t.grace_days, t.max_students, 'النظام',
       'تحويل تلقائي من النظام السابق — كل الأقسام الحالية محفوظة'
  FROM tenants t LEFT JOIN plans p ON p.code = t.plan;
UPDATE tenants t SET subscription_id = s.id FROM subscriptions s WHERE s.tenant_id = t.id;
INSERT INTO subscription_events (tenant_id, subscription_id, event, details, actor)
SELECT tenant_id, id, 'migrated', jsonb_build_object('plan', plan_name), 'النظام' FROM subscriptions;

/* ---------- 7) انتهاء الاشتراكات والتجارب: تغيير حالة فقط، بلا حذف ---------- */
CREATE FUNCTION expire_subscriptions() RETURNS TABLE (tenant_id text, name text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tg integer := (SELECT trial_grace_days FROM platform_settings WHERE id);
BEGIN
  RETURN QUERY
  WITH changed AS (
    UPDATE subscriptions s
       SET status = CASE WHEN s.status = 'trial' THEN 'trial_expired' ELSE 'expired' END
      FROM tenants t
     WHERE t.subscription_id = s.id AND s.ends_on IS NOT NULL
       AND ((s.status = 'trial' AND s.ends_on + tg < CURRENT_DATE)
         OR (s.status = 'active' AND s.ends_on + s.grace_days < CURRENT_DATE))
    RETURNING s.id, s.tenant_id, s.status
  ), logged AS (
    INSERT INTO subscription_events (tenant_id, subscription_id, event, details, actor)
    SELECT c.tenant_id, c.id, c.status, '{}', 'النظام' FROM changed c
  ), kicked AS (
    -- المعلمون والمحاسبون يخرجون، والمدير يبقى ليرى صفحة التجديد
    DELETE FROM sessions ss USING changed c, users u
     WHERE ss.tenant_id = c.tenant_id AND u.id = ss.user_id AND u.role <> 'admin'
  )
  SELECT c.tenant_id, t.name, c.status FROM changed c JOIN tenants t ON t.id = c.tenant_id;

  -- تنبيهات قبل انتهاء التجربة (7 و3 و1 أيام افتراضيًا) تُسجَّل مرة واحدة لكل عدد أيام
  INSERT INTO subscription_events (tenant_id, subscription_id, event, details, actor)
  SELECT s.tenant_id, s.id, 'reminder', jsonb_build_object('days', d.days), 'النظام'
    FROM subscriptions s JOIN tenants t ON t.subscription_id = s.id
    CROSS JOIN LATERAL unnest((SELECT trial_reminder_days FROM platform_settings WHERE id)) AS d(days)
   WHERE s.status = 'trial' AND s.ends_on - CURRENT_DATE <= d.days AND s.ends_on >= CURRENT_DATE
  ON CONFLICT DO NOTHING;
END $$;

-- الدالة القديمة (مستخدمة في لوحة المالك) صارت تنهي الاشتراكات بدل إيقاف المدرسة
CREATE OR REPLACE FUNCTION suspend_expired_tenants() RETURNS TABLE (tenant_id text, name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.tenant_id, e.name FROM expire_subscriptions() e;
$$;

/* ---------- 8) العزل والصلاحيات ---------- */
ALTER TABLE features ENABLE ROW LEVEL SECURITY;
CREATE POLICY features_read ON features FOR SELECT USING (true);
CREATE POLICY features_write ON features FOR ALL USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_read ON plans FOR SELECT USING (true);
CREATE POLICY plans_write ON plans FOR ALL USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
ALTER TABLE plan_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_features_read ON plan_features FOR SELECT USING (true);
CREATE POLICY plan_features_write ON plan_features FOR ALL USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
ALTER TABLE tenant_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_prices_platform ON tenant_prices USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
-- المدرسة تقرأ اشتراكها وسجله فقط، والكتابة للمنصة وحدها
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_read ON subscriptions FOR SELECT
  USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on');
CREATE POLICY subscriptions_write ON subscriptions FOR ALL USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_events_read ON subscription_events FOR SELECT
  USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on');
CREATE POLICY subscription_events_write ON subscription_events FOR ALL USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');

CREATE TRIGGER features_audit AFTER INSERT OR UPDATE OR DELETE ON features FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER plans_audit AFTER INSERT OR UPDATE OR DELETE ON plans FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER tenant_prices_audit AFTER INSERT OR UPDATE OR DELETE ON tenant_prices FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER subscriptions_audit AFTER INSERT OR UPDATE OR DELETE ON subscriptions FOR EACH ROW EXECUTE FUNCTION audit_row_change();

GRANT SELECT, INSERT, UPDATE ON features TO midar_app;
GRANT SELECT, INSERT, UPDATE ON plans TO midar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_features TO midar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_prices TO midar_app;
GRANT SELECT, INSERT, UPDATE ON subscriptions TO midar_app;
GRANT SELECT, INSERT ON subscription_events TO midar_app;
GRANT EXECUTE ON FUNCTION expire_subscriptions() TO midar_app;
