-- =====================================================================
-- مِدار | MIDAR — الترحيل 0053: مركز الإشعارات (داخل المنصة + إشعار فوري + رسالة نصية)
--   notifications       صندوق إشعارات: لولي الأمر (لكل طالب) أو لمستخدم من المنسوبين
--   push_subscriptions  أجهزة مسجلة للإشعار الفوري (Web Push). مفاتيح الجهاز فقط، بلا بيانات شخصية
--   school_notify       أي حدث يُرسل إشعارًا فوريًا أو رسالة نصية (تختاره المدرسة)
--   sms_gateway         مزوّد الرسائل (صف واحد يضبطه المالك). المفتاح السري مشفّر بمفتاح خارج القاعدة
--   sms_ledger          رصيد رسائل كل مدرسة (يضيفه المالك، وتخصمه الرسائل المرسلة) — فوترة لا تمسها منطقة الحذر
--   sms_messages        سجل كل رسالة نصية وحالتها
--   school_feature_settings  إعدادات صغيرة للأقسام الجديدة (درجة السلوك الأساسية، خصم الغياب، خصم الإخوة…)
-- =====================================================================

CREATE TABLE notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id  bigint,
  user_id     bigint,
  kind        text NOT NULL CHECK (kind ~ '^[a-z_]{2,30}$'),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  body        text CHECK (body IS NULL OR char_length(body) <= 1000),
  link        text CHECK (link IS NULL OR char_length(link) <= 200),
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (user_id IS NULL)),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX notifications_student ON notifications (tenant_id, student_id, created_at DESC) WHERE student_id IS NOT NULL;
CREATE INDEX notifications_user ON notifications (tenant_id, user_id, created_at DESC) WHERE user_id IS NOT NULL;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO midar_app;

CREATE TABLE push_subscriptions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id      bigint,
  user_id         bigint,
  endpoint        text NOT NULL CHECK (endpoint ~ '^https://' AND char_length(endpoint) <= 1000),
  p256dh          text NOT NULL CHECK (char_length(p256dh) BETWEEN 40 AND 200),
  auth            text NOT NULL CHECK (char_length(auth) BETWEEN 10 AND 100),
  failures        integer NOT NULL DEFAULT 0,
  last_sent_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (user_id IS NULL)),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX push_subscriptions_one ON push_subscriptions (tenant_id, endpoint, COALESCE(student_id, 0), COALESCE(user_id, 0));
CREATE INDEX push_subscriptions_student ON push_subscriptions (tenant_id, student_id) WHERE student_id IS NOT NULL;
CREATE INDEX push_subscriptions_user ON push_subscriptions (tenant_id, user_id) WHERE user_id IS NOT NULL;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON push_subscriptions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO midar_app;

CREATE TABLE school_notify (
  tenant_id   text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  rules       jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(rules) = 'object'),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER school_notify_touch BEFORE UPDATE ON school_notify FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER school_notify_audit AFTER INSERT OR UPDATE OR DELETE ON school_notify FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE school_notify ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_notify USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON school_notify TO midar_app;

CREATE TABLE school_feature_settings (
  tenant_id   text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  settings    jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object'),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER school_feature_settings_touch BEFORE UPDATE ON school_feature_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER school_feature_settings_audit AFTER INSERT OR UPDATE OR DELETE ON school_feature_settings FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE school_feature_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_feature_settings USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON school_feature_settings TO midar_app;

/* ---------- الرسائل النصية ---------- */
-- المزوّد: طلب HTTP عام يناسب أي مزوّد (يمني أو سعودي أو دولي). القوالب فيها {to} و{message} و{sender}
CREATE TABLE sms_gateway (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled       boolean NOT NULL DEFAULT false,
  provider_name text NOT NULL DEFAULT '' CHECK (char_length(provider_name) <= 60),
  url           text NOT NULL DEFAULT '' CHECK (url = '' OR (url ~ '^https://' AND char_length(url) <= 500)),
  method        text NOT NULL DEFAULT 'POST' CHECK (method IN ('GET', 'POST')),
  content_type  text NOT NULL DEFAULT 'json' CHECK (content_type IN ('json', 'form')),
  body_template text NOT NULL DEFAULT '' CHECK (char_length(body_template) <= 2000),
  headers_sealed text,                        -- ترويسات الطلب (فيها المفتاح السري) مشفّرة
  sender        text NOT NULL DEFAULT '' CHECK (char_length(sender) <= 20),
  success_match text NOT NULL DEFAULT '' CHECK (char_length(success_match) <= 100),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sms_gateway (id) VALUES (1);
ALTER TABLE sms_gateway ENABLE ROW LEVEL SECURITY;
CREATE POLICY sms_gateway_platform ON sms_gateway USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, UPDATE ON sms_gateway TO midar_app;

CREATE TABLE sms_ledger (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  delta       integer NOT NULL CHECK (delta <> 0),
  reason      text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 120),
  message_id  bigint,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_ledger_tenant ON sms_ledger (tenant_id, created_at DESC);
ALTER TABLE sms_ledger ENABLE ROW LEVEL SECURITY;
-- المدرسة تقرأ رصيدها وتخصم برسائلها فقط، والإضافة من المالك (منصة)
CREATE POLICY sms_ledger_read ON sms_ledger FOR SELECT USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on');
CREATE POLICY sms_ledger_spend ON sms_ledger FOR INSERT WITH CHECK ((tenant_id = app_tenant() AND delta < 0) OR current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT ON sms_ledger TO midar_app;

CREATE TABLE sms_messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id  bigint,
  to_phone    text NOT NULL CHECK (to_phone ~ '^[0-9]{8,15}$'),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 700),
  kind        text NOT NULL CHECK (kind ~ '^[a-z_]{2,30}$'),
  segments    integer NOT NULL CHECK (segments BETWEEN 1 AND 10),
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'no_credit', 'disabled')),
  error       text CHECK (error IS NULL OR char_length(error) <= 300),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE SET NULL (student_id)
);
CREATE INDEX sms_messages_tenant ON sms_messages (tenant_id, created_at DESC);
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sms_messages USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON sms_messages TO midar_app;

-- منطقة الحذر: الرصيد فوترة لا تُحذف، وسجل الرسائل سجل، والأجهزة المسجلة مؤقتة
CREATE OR REPLACE FUNCTION danger_tables() RETURNS TABLE (name text, depth int, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE t AS (
    SELECT c.table_name::text AS name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name NOT IN ('danger_operations', 'tenant_backups')
  ), fk AS (
    SELECT DISTINCT k.conrelid::regclass::text AS child, k.confrelid::regclass::text AS parent
      FROM pg_constraint k WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace
       AND k.conrelid <> k.confrelid
       AND k.conrelid::regclass::text IN (SELECT name FROM t) AND k.confrelid::regclass::text IN (SELECT name FROM t)
  ), d AS (
    SELECT name, 0 AS depth FROM t
    UNION ALL
    SELECT fk.child, d.depth + 1 FROM d JOIN fk ON fk.parent = d.name WHERE d.depth < 50
  )
  SELECT name, max(depth)::int,
         CASE WHEN name IN ('audit_log', 'security_events', 'sms_messages', 'ai_queries') THEN 'log'
              WHEN name IN ('sessions', 'sync_changes', 'sync_devices', 'sync_operations', 'password_requests', 'push_subscriptions') THEN 'transient'
              WHEN name IN ('subscriptions', 'subscription_events', 'subscription_invoices', 'tenant_prices', 'renewal_requests', 'leads', 'sms_ledger') THEN 'billing'
              ELSE 'data' END
    FROM d GROUP BY name;
$$;
