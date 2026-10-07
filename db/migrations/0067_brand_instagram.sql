-- =====================================================================
-- مِدار | MIDAR — الترحيل 0067: حساب إنستغرام المنصة (يظهر في الصفحة الرسمية وصفحتي الخصوصية والشروط)
-- =====================================================================
ALTER TABLE platform_settings
  ADD COLUMN brand_instagram text CHECK (brand_instagram IS NULL OR brand_instagram ~ '^[A-Za-z0-9._]{1,30}$');

-- بيانات التواصل الجديدة للمنصة (رقم سعودي بالصيغة الدولية ليعمل رابط واتساب): تُعدَّل لاحقًا من لوحة المالك
UPDATE platform_settings SET brand_phone = '+966510235422', support_whatsapp = '+966510235422', brand_instagram = 'midar.school' WHERE id;
