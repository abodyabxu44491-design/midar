-- =====================================================================
-- مِدار | MIDAR — الترحيل 0058: لا مميزات مدفوعة منفصلة — كل المميزات لكل المدارس
--   كل الأقسام (ومنها مساعد إدخال البيانات) تدخل في كل الباقات وكل الاشتراكات القائمة.
--   الباقات تختلف بالسعر والمدة وحدود الطلاب والمعلمين فقط، والمدرسة توقف ما لا تحتاجه من إعداداتها.
--   الخدمات (الدعم الفني والتدريب…) تبقى حسب الباقة.
-- =====================================================================
INSERT INTO plan_features (plan_id, feature_key, sort)
SELECT p.id, f.key, f.sort FROM plans p CROSS JOIN features f
 WHERE f.kind IN ('core', 'module') AND f.is_active
ON CONFLICT DO NOTHING;

UPDATE subscriptions s SET snapshot = jsonb_set(s.snapshot, '{features}', (s.snapshot -> 'features') || COALESCE((
  SELECT jsonb_agg(f.key) FROM features f WHERE f.kind IN ('core', 'module') AND NOT (s.snapshot -> 'features') ? f.key), '[]'::jsonb));

-- الأقسام لا تُطلب كإضافة ولا سعر لها
UPDATE features SET requestable = false, addon_monthly = NULL, addon_yearly = NULL WHERE kind IN ('core', 'module');
