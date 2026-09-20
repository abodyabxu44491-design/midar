-- =====================================================================
-- مِدار | MIDAR — الترحيل 0017
--   1) عزل الصفوف (RLS) على الجداول الثلاثة التي كانت خارج العزل: tenants و sessions و security_events.
--      كان عزل المدارس عليها يعتمد على انضباط الكود وحده، بينما بقية الجداول محمية في قاعدة البيانات نفسها.
--   2) جدول عدّادات الحدود المشتركة بين نسخ الخادم (rate_limits).
--
--   تنبيه نشر: بين تنفيذ الترحيل ونشر الكود الجديد (دقائق) يردّ الكود القديم بـ 401 لأنه لا يستطيع قراءة الجلسات.
--   الجلسات نفسها لا تُحذف وتعود للعمل فور نشر الكود الجديد. الترتيب المعتاد (ترحيل ثم نشر) هو الصحيح لأن
--   الكود الجديد يحتاج أعمدة الترحيل 0018؛ فانشر في وقت هادئ.
-- =====================================================================

-- ---------- المدارس: لا ترى المدرسة إلا صفها، والمنصة (لوحة المالك) ترى الكل ----------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON tenants
  USING (id = app_tenant() OR current_setting('app.platform', true) = 'on');

-- ---------- الجلسات ----------
-- تُقرأ الجلسة قبل معرفة مدرستها، فيُسمح بصف واحد فقط: الذي بصمته app.session_hash (يضبطه الخادم من الكوكي).
-- ولا يستطيع أحد سرد الجلسات أو قراءة جلسة لا يملك رمزها.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_scope ON sessions
  USING (tenant_id = app_tenant()
      OR token_hash = NULLIF(current_setting('app.session_hash', true), '')
      OR current_setting('app.platform', true) = 'on');

-- ---------- سجل الأحداث الأمنية (محاولات الدخول الفاشلة) ----------
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_event_scope ON security_events
  USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on');

-- ---------- عدّادات الحدود المشتركة (نافذة ثابتة لكل مفتاح) ----------
-- لا تحمل بيانات مدارس (مفتاحها عنوان IP ونوع الحد) فلا حاجة لعزل صفوف عليها.
CREATE TABLE rate_limits (
  key      text PRIMARY KEY CHECK (char_length(key) <= 200),
  hits     integer NOT NULL CHECK (hits >= 0),
  reset_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_reset ON rate_limits (reset_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO midar_app;
