-- =====================================================================
-- مِدار | MIDAR — الترحيل 0031: صور مصغّرة للعرض السريع
--   الصورة المصغرة (حوالي 480 بكسل) تُولَّد في المتصفح عند الرفع وتُستخدم في المعاينات والقوائم،
--   والأصلية تُطلب فقط عند الحاجة (الطباعة، أو فتح الصورة).
-- =====================================================================
ALTER TABLE exam_images
  ADD COLUMN thumb_mime text CHECK (thumb_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  ADD COLUMN thumb bytea CHECK (thumb IS NULL OR octet_length(thumb) <= 262144),
  ADD CONSTRAINT exam_images_thumb_pair CHECK ((thumb IS NULL) = (thumb_mime IS NULL));
