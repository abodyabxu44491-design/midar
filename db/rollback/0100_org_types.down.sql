-- =====================================================================
-- مِدار | MIDAR — الرجوع عن الترحيل 0100 (أنواع المؤسسات)، عند الحاجة فقط وبعد نسخة احتياطية.
--   يحذف ما أضافه الترحيل وحده: سجل الأنواع وعمود النوع في المؤسسات. لا يمس أي بيانات أخرى،
--   وtenants.org_type (مدرسة أو معهد) يبقى كما كان قبل الترحيل.
--   التشغيل: psql "$MIGRATION_DATABASE_URL" -1 -f db/rollback/0100_org_types.down.sql
-- =====================================================================
DROP TRIGGER IF EXISTS tenants_org_type ON tenants;
DROP FUNCTION IF EXISTS tenants_org_type_check();
ALTER TABLE tenants DROP COLUMN IF EXISTS org_type_key;
DROP TABLE IF EXISTS org_types;
DELETE FROM schema_migrations WHERE filename = '0100_org_types.sql';
