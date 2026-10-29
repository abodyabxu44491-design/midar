-- =====================================================================
-- مِدار | MIDAR — الرجوع عن الترحيل 0104 (المحرك الجامعي)، عند الحاجة فقط وبعد نسخة احتياطية، ومع إرجاع الكود السابق.
--   يُرفض الرجوع إن وُجدت مؤسسة على المحرك الجامعي: انقلها أو احذفها أولًا (فهي تجريبية ما دام النوع قيد التطوير).
--   التشغيل: psql "$MIGRATION_DATABASE_URL" -1 -f db/rollback/0104_university.down.sql
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE org_type = 'university') THEN
    RAISE EXCEPTION 'توجد مؤسسات على المحرك الجامعي؛ انقلها أو احذفها قبل الرجوع';
  END IF;
END $$;
DROP TABLE IF EXISTS uni_registrations, uni_student_programs, uni_sections, uni_terms, uni_program_courses, uni_courses, uni_programs,
  uni_departments, uni_colleges, uni_settings;
ALTER TABLE tenants DROP CONSTRAINT tenants_org_type_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_org_type_check CHECK (org_type IN ('school', 'institute'));
DELETE FROM tenant_counters WHERE name = 'uni_student_no';
DELETE FROM schema_migrations WHERE filename = '0104_university.sql';
