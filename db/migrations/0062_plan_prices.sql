-- =====================================================================
-- مِدار | MIDAR — الترحيل 0062: أسعار الباقات السنوية الجديدة
--   الأساسية 500 ← 299، الاحترافية 1000 ← 399، المؤسسات 1500 ← 499 (سنويًا، بعد الخصم)
--   الاشتراك سنوي فقط. الاشتراكات القائمة لا تتغير (لكل اشتراك لقطة سعره).
--   كل هذا قابل للتعديل لاحقًا من لوحة المالك ← الباقات.
-- =====================================================================
UPDATE plans p SET yearly_price = v.yearly, sale_yearly_price = v.sale, monthly_price = NULL, sale_monthly_price = NULL,
       discount_kind = 'price', discount_value = NULL, discount_starts_at = NULL, discount_ends_at = NULL, contact_only = false
  FROM (VALUES ('basic', 500, 299), ('pro', 1000, 399), ('enterprise', 1500, 499)) AS v(code, yearly, sale)
 WHERE p.code = v.code;
