-- =====================================================================
-- مِدار | MIDAR — الترحيل 0047: اليمن هي السوق الأساسية
--   المدرسة الجديدة تبدأ بالريال اليمني ورمز الاتصال 967 (كانت 966 والريال السعودي)،
--   وكلاهما يتغير تلقائيًا حسب «الدولة» في ملف المدرسة، ويبقى قابلًا للتعديل.
--   تصحيح المدارس القائمة: مدرسة دولتها اليمن ورمز رسائلها ما يزال 966 الافتراضي ← 967
--   (وإلا تذهب رسائل واتساب لأرقام خاطئة: 777123456 ← 966777123456).
-- =====================================================================
ALTER TABLE tenants ALTER COLUMN currency SET DEFAULT 'YER';
ALTER TABLE finance_accounts ALTER COLUMN currency SET DEFAULT 'YER';
ALTER TABLE school_messages ALTER COLUMN country_code SET DEFAULT '967';

UPDATE school_messages m SET country_code = '967'
  FROM school_profile p
 WHERE p.tenant_id = m.tenant_id AND m.country_code = '966'
   AND (p.country ILIKE '%يمن%' OR p.country ILIKE '%yemen%');

-- الحساب البنكي: البنوك والمحافظ في اليمن غالبًا بلا آيبان، فيكفي رقم الحساب أو المحفظة (واحد منهما على الأقل)
ALTER TABLE payment_accounts ALTER COLUMN iban DROP NOT NULL;
ALTER TABLE payment_accounts ADD CONSTRAINT payment_accounts_iban_or_number CHECK (iban IS NOT NULL OR account_number IS NOT NULL);
