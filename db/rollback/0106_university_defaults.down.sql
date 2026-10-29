-- مِدار | MIDAR — الرجوع عن الترحيل 0106. التشغيل: psql "$MIGRATION_DATABASE_URL" -1 -f db/rollback/0106_university_defaults.down.sql
UPDATE org_types SET default_features = '{}', version = version - 1 WHERE key = 'university';
DELETE FROM schema_migrations WHERE filename = '0106_university_defaults.sql';
