-- =====================================================================
-- مِدار | MIDAR — الترحيل 0066: محرك الإشعارات
--   notifications            + الأولوية والتصنيف والأرشفة ومفتاح منع التكرار
--   notification_deliveries  طابور التسليم وسجله: إشعار × جهاز، بحالة وعدد محاولات وسبب الفشل
--                            pending → processing → sent / retrying / failed / skipped
--   notification_prefs       اختيارات ولي الأمر (لكل طالب) أو المستخدم: الأنواع التي لا يريد تنبيهها على الجوال
--   school_notify            + الأحداث الإلزامية وساعات الهدوء
--   announcements            + الفئة المستهدفة (مرحلة، صف، شعبة، طلاب، معلمون، منسوبون)
-- =====================================================================

ALTER TABLE notifications
  ADD COLUMN priority    smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 3),   -- 1 عاجل، 2 مهم، 3 عادي
  ADD COLUMN category    text NOT NULL DEFAULT 'other' CHECK (category ~ '^[a-z_]{2,20}$'),
  ADD COLUMN dedup_key   text CHECK (dedup_key IS NULL OR char_length(dedup_key) <= 200),
  ADD COLUMN repeats     integer NOT NULL DEFAULT 1 CHECK (repeats >= 1),                -- كم مرة تكرر نفس الحدث فدُمج
  ADD COLUMN created_by  text CHECK (created_by IS NULL OR char_length(created_by) <= 120),
  ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN archived_at timestamptz;
CREATE INDEX notifications_dedup ON notifications (tenant_id, dedup_key, created_at DESC) WHERE dedup_key IS NOT NULL;
CREATE INDEX notifications_tenant_time ON notifications (tenant_id, created_at DESC);

CREATE TABLE notification_deliveries (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  notification_id  bigint NOT NULL,
  subscription_id  bigint REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  channel          text NOT NULL DEFAULT 'push' CHECK (channel IN ('push')),
  device           text CHECK (device IS NULL OR char_length(device) <= 60),   -- وصف مختصر للجهاز (مزوّد الإشعار) للتشخيص
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'retrying', 'failed', 'skipped')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  provider_status  integer,
  error            text CHECK (error IS NULL OR char_length(error) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  UNIQUE (notification_id, subscription_id),
  FOREIGN KEY (tenant_id, notification_id) REFERENCES notifications (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX notification_deliveries_due ON notification_deliveries (next_attempt_at) WHERE status IN ('pending', 'retrying', 'processing');
CREATE INDEX notification_deliveries_notification ON notification_deliveries (tenant_id, notification_id);
CREATE INDEX notification_deliveries_recent ON notification_deliveries (tenant_id, created_at DESC);
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
-- عامل التسليم يبحث عن المدارس التي لديها عمل (منصة)، ثم يعمل داخل معاملة كل مدرسة
CREATE POLICY tenant_isolation ON notification_deliveries
  USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_deliveries TO midar_app;

CREATE TABLE notification_prefs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id  bigint,
  user_id     bigint,
  muted       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(muted) <= 30),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (user_id IS NULL)),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX notification_prefs_one ON notification_prefs (tenant_id, COALESCE(student_id, 0), COALESCE(user_id, 0));
CREATE TRIGGER notification_prefs_touch BEFORE UPDATE ON notification_prefs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_prefs USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_prefs TO midar_app;

-- ساعات الهدوء: الإشعارات غير العاجلة خلالها تؤجَّل لنهايتها (بتوقيت المدرسة). فارغة = بلا ساعات هدوء
ALTER TABLE school_notify
  ADD COLUMN quiet_start time,
  ADD COLUMN quiet_end   time,
  ADD COLUMN timezone    text NOT NULL DEFAULT 'Asia/Aden' CHECK (char_length(timezone) BETWEEN 3 AND 60);

-- الإعلان الجماعي: لمن؟ (فارغ = الطريقة القديمة: كل أولياء الأمور أو شعبة class_id)
ALTER TABLE announcements
  ADD COLUMN target jsonb CHECK (target IS NULL OR jsonb_typeof(target) = 'object'),
  ADD COLUMN recipients integer;

-- منطقة الحذر: سجل التسليم سجل، واختيارات الإشعارات بيانات مؤقتة
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
         CASE WHEN name IN ('audit_log', 'security_events', 'sms_messages', 'ai_queries', 'notification_deliveries') THEN 'log'
              WHEN name IN ('sessions', 'sync_changes', 'sync_devices', 'sync_operations', 'password_requests', 'push_subscriptions', 'notification_prefs') THEN 'transient'
              WHEN name IN ('subscriptions', 'subscription_events', 'subscription_invoices', 'tenant_prices', 'renewal_requests', 'leads', 'sms_ledger') THEN 'billing'
              ELSE 'data' END
    FROM d GROUP BY name;
$$;
