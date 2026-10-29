-- =====================================================================
-- مِدار | MIDAR — الرجوع عن الترحيل 0102 (حلقات التحفيظ)، عند الحاجة فقط وبعد نسخة احتياطية، ومع إرجاع الكود السابق.
--   يحذف جداول الحلقات وسجلاتها. الشهادات التي صدرت منها تبقى في جدول الشهادات (هي شهادات مخصصة عادية).
--   تنبيه: إن كانت مؤسسات قد بدأت تسجّل في الحلقات فخذ تصديرًا لهذه الجداول أولًا، لأن بياناتها تُفقد بالرجوع.
--   التشغيل: psql "$MIGRATION_DATABASE_URL" -1 -f db/rollback/0102_quran.down.sql
-- =====================================================================
DROP TABLE IF EXISTS quran_achievements;
DROP TABLE IF EXISTS quran_records;
DROP TABLE IF EXISTS halaqa_members;
DROP TABLE IF EXISTS halaqat;
DROP TABLE IF EXISTS quran_levels;
DELETE FROM tenant_modules WHERE key = 'quran';
DELETE FROM plan_features WHERE feature_key = 'quran';
DELETE FROM features WHERE key = 'quran';
-- نوعا التحفيظ يعودان كما كانا قبل الترحيل: قيد التطوير، بلا أقسام افتراضية، وبمصطلح «حلقة» للشعبة.
UPDATE org_types SET default_features = '{}', status = CASE WHEN status = 'beta' THEN 'planned' ELSE status END,
                     terms = terms || '{"class": "حلقة", "classes": "الحلقات"}', version = version - 1
 WHERE key IN ('quran_school', 'quran_institute');
DELETE FROM schema_migrations WHERE filename = '0102_quran.sql';
