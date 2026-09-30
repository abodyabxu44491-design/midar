-- =====================================================================
-- مِدار | MIDAR — الترحيل 0043: شعار المدرسة، ونشر صور المعلمين
--   الشعار صورة واحدة للمدرسة (في جدول الصور نفسه، بفحص المحتوى نفسه) تظهر في الشريط العلوي
--   والصفحة العامة وملف الطالب والأوراق المطبوعة وورقة الاختبار.
--   المدارس التي رفعت شعارًا للاختبارات الورقية يصبح شعارها شعار المدرسة.
--   صور المعلمين في الصفحة العامة وملف الطالب لولي الأمر: موقوفة افتراضيًا (خصوصية) وتشغّلها الإدارة.
-- =====================================================================

ALTER TABLE exam_images DROP CONSTRAINT IF EXISTS exam_images_kind_check;
ALTER TABLE exam_images ADD CONSTRAINT exam_images_kind_check CHECK (kind IN ('question', 'logo', 'school_logo'));

ALTER TABLE school_profile
  ADD COLUMN logo_image_id bigint,
  ADD CONSTRAINT school_profile_logo_fk FOREIGN KEY (tenant_id, logo_image_id)
    REFERENCES exam_images (tenant_id, id) ON DELETE SET NULL (logo_image_id);

INSERT INTO school_profile (tenant_id)
  SELECT tenant_id FROM exam_paper_settings WHERE logo_image_id IS NOT NULL
  ON CONFLICT DO NOTHING;
UPDATE school_profile p SET logo_image_id = s.logo_image_id
  FROM exam_paper_settings s
 WHERE s.tenant_id = p.tenant_id AND s.logo_image_id IS NOT NULL AND p.logo_image_id IS NULL;

ALTER TABLE school_public_settings ADD COLUMN show_teacher_photos boolean NOT NULL DEFAULT false;
