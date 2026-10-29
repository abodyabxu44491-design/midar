-- =====================================================================
-- مِدار | MIDAR — الرجوع عن الترحيل 0101، عند الحاجة فقط وبعد نسخة احتياطية، ومع إرجاع الكود السابق.
--   school_modules بقي محدَّثًا مع tenant_modules طوال الوقت، فالكود السابق يجد كل الأقسام كما هي.
--   يُفقد فقط ما لا مكان له في البنية السابقة: مصطلحات المؤسسات الخاصة، وسجل تغيير الأنواع.
--   التشغيل: psql "$MIGRATION_DATABASE_URL" -1 -f db/rollback/0101_tenant_modules.down.sql
-- =====================================================================
DROP TABLE IF EXISTS org_type_changes;
DROP TABLE IF EXISTS tenant_terms;
DROP TABLE IF EXISTS tenant_modules;
UPDATE org_types SET default_features = array_append(default_features, 'donations')
 WHERE key IN ('private_school', 'international_school', 'specialized_school', 'other', 'training_institute', 'learning_center',
               'public_school', 'kindergarten') AND NOT 'donations' = ANY(default_features)
   AND EXISTS (SELECT 1 FROM features WHERE key = 'donations');
DELETE FROM schema_migrations WHERE filename = '0101_tenant_modules.sql';
