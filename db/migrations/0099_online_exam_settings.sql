-- =====================================================================
-- مِدار | MIDAR — الترحيل 0099: إعدادات الاختبار الإلكتروني ومتابعة المحاولة
--   online_exams.settings: طريقة العرض (سؤال أو قسم في كل صفحة)، منع الرجوع، رمز الدخول، حد الخروج من الصفحة.
--   online_attempts.events: عدد مرات الخروج من صفحة الاختبار، والأسئلة المعلَّمة للمراجعة، وآخر صفحة، والوقت الإضافي.
--   عمودان جديدان بقيم افتراضية فقط، ولا يتغير أي سجل قائم.
-- =====================================================================
ALTER TABLE online_exams
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object' AND octet_length(settings::text) <= 4000);

ALTER TABLE online_attempts
  ADD COLUMN events jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(events) = 'object' AND octet_length(events::text) <= 20000);
