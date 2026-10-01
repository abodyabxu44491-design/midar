-- =====================================================================
-- مِدار | MIDAR — الترحيل 0060: حذف «مساعد إدخال البيانات»
--   القسم أُزيل من المنصة: يُحذف من المميزات والباقات ولقطات الاشتراكات ومفاتيح التشغيل.
--   الإضافة اليدوية والاستيراد من Excel يبقيان كما هما.
-- =====================================================================
UPDATE subscriptions SET snapshot = jsonb_set(snapshot, '{features}', (snapshot -> 'features') - 'data_assistant')
 WHERE jsonb_typeof(snapshot -> 'features') = 'array' AND (snapshot -> 'features') ? 'data_assistant';
UPDATE subscriptions SET addons = addons - 'data_assistant'
 WHERE jsonb_typeof(addons) = 'array' AND addons ? 'data_assistant';
DELETE FROM features WHERE key = 'data_assistant';   -- plan_features تُحذف تبعًا، وطلبات الاهتمام تبقى بلا ميزة
ALTER TABLE school_modules DROP COLUMN IF EXISTS data_assistant;
