-- =====================================================================
-- مِدار | MIDAR — الترحيل 0033: خصم الباقات
-- السعر الأصلي + خصم اختياري بثلاث طرق:
--   percent: نسبة مئوية   |   amount: مبلغ يُخصم من السعر   |   price: سعر نهائي بعد الخصم لكل مدة
-- مع بداية ونهاية اختيارية للعرض، وبدون الحاجة لذكر سبب الخصم.
-- الأسعار المعروضة في كل مكان تُحسب من هذه الحقول في الخادم (لا أسعار مكتوبة في الواجهة).
-- =====================================================================
ALTER TABLE plans
  ADD COLUMN discount_kind      text NOT NULL DEFAULT 'none' CHECK (discount_kind IN ('none', 'percent', 'amount', 'price')),
  ADD COLUMN discount_value     numeric(12,2) CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD COLUMN sale_monthly_price numeric(12,2) CHECK (sale_monthly_price IS NULL OR sale_monthly_price >= 0),
  ADD COLUMN sale_yearly_price  numeric(12,2) CHECK (sale_yearly_price IS NULL OR sale_yearly_price >= 0),
  ADD COLUMN discount_starts_at date,
  ADD COLUMN discount_ends_at   date,
  ADD CONSTRAINT plans_discount_dates CHECK (discount_starts_at IS NULL OR discount_ends_at IS NULL OR discount_ends_at >= discount_starts_at),
  ADD CONSTRAINT plans_discount_percent CHECK (discount_kind <> 'percent' OR discount_value BETWEEN 1 AND 90),
  ADD CONSTRAINT plans_discount_value CHECK (discount_kind NOT IN ('percent', 'amount') OR discount_value IS NOT NULL);

-- نقل الخصومات السابقة: العرض المؤقت الساري أولًا، ثم الخصم العام
UPDATE plans SET discount_kind = 'percent', discount_value = promo_percent, discount_ends_at = promo_ends_at
 WHERE promo_percent IS NOT NULL AND promo_ends_at >= CURRENT_DATE;
UPDATE plans SET discount_kind = 'percent', discount_value = discount_percent
 WHERE discount_kind = 'none' AND discount_percent > 0;
-- الحقول القديمة لم تعد تُستخدم في الحساب (تبقى للتوافق فقط)
UPDATE plans SET discount_percent = 0, promo_percent = NULL, promo_ends_at = NULL;
