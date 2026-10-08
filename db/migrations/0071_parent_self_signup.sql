-- =====================================================================
-- مِدار | MIDAR — الترحيل 0071: تسجيل ولي الأمر بنفسه (بريد إلكتروني أو جوال)
--   الحساب يُعرَّف بالبريد أو الجوال (أحدهما على الأقل)، وكلاهما فريد في المدرسة.
--   source: من أنشأ الحساب (الإدارة / ولي الأمر بنفسه)
-- =====================================================================
ALTER TABLE parents ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE parents ADD CONSTRAINT parents_identity CHECK (phone IS NOT NULL OR email IS NOT NULL);
CREATE UNIQUE INDEX parents_email ON parents (tenant_id, lower(email)) WHERE email IS NOT NULL;
ALTER TABLE parents ADD COLUMN source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'self'));
