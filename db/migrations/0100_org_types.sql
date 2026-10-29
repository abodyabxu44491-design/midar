-- =====================================================================
-- مِدار | MIDAR — الترحيل 0100: أنواع المؤسسات التعليمية
--   نظام واحد بأنواع مؤسسات متعددة: سجل يديره المالك، لكل نوع اسم ومحرك (مدرسي أو تدريبي أو جامعي)
--   وحالة (متاح، تجريبي، قيد التطوير، موقوف) ومصطلحات وأقسام افتراضية وإعدادات.
--   كل مؤسسة ترتبط بنوعها عبر tenants.org_type_key، ويبقى tenants.org_type كما هو بمعنى «المحرك».
--   إضافي فقط: لا يُحذف شيء ولا يتغير سلوك أي مدرسة قائمة؛ المدارس الحالية تُربط بالنوع المطابق لوضعها اليوم.
-- =====================================================================

CREATE TABLE org_types (
  key              text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description      text CHECK (description IS NULL OR char_length(description) <= 400),
  engine           text NOT NULL CHECK (engine IN ('school', 'institute', 'university')),
  status           text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'beta', 'planned', 'disabled')),
  sort             integer NOT NULL DEFAULT 100,
  default_features text[] NOT NULL DEFAULT '{}',
  terms            jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(terms) = 'object' AND octet_length(terms::text) <= 8000),
  settings         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object' AND octet_length(settings::text) <= 20000),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER org_types_touch BEFORE UPDATE ON org_types FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

INSERT INTO org_types (key, name, description, engine, status, sort, terms, settings) VALUES
  ('private_school', 'مدرسة أهلية', 'مدرسة خاصة بمراحل وصفوف وشعب ورسوم دراسية', 'school', 'available', 10, '{}',
     '{"school_type": "private"}'),
  ('public_school', 'مدرسة حكومية', 'مدرسة عامة بمراحل وصفوف وشعب', 'school', 'available', 20, '{}',
     '{"school_type": "public"}'),
  ('international_school', 'مدرسة دولية', 'مدرسة بمناهج دولية', 'school', 'available', 30, '{}',
     '{"school_type": "international"}'),
  ('kindergarten', 'روضة أطفال', 'مرحلة رياض الأطفال', 'school', 'available', 40,
     '{"student": "طفل", "students": "الأطفال", "teacher": "معلمة", "teachers": "المعلمات"}', '{"school_type": "private"}'),
  ('specialized_school', 'مدرسة متخصصة', 'مدرسة بتخصص تحدده المؤسسة', 'school', 'available', 50, '{}',
     '{"school_type": "other"}'),
  ('quran_school', 'مدرسة تحفيظ قرآن', 'مدرسة بحلقات تحفيظ ومستويات حفظ وسجل تسميع', 'school', 'planned', 60,
     '{"class": "حلقة", "classes": "الحلقات"}', '{"school_type": "quran"}'),
  ('training_institute', 'معهد تدريبي', 'برامج ودورات ومجموعات تدريبية', 'institute', 'available', 70,
     '{"student": "متدرب", "students": "المتدربون", "teacher": "مدرب", "teachers": "المدربون"}', '{}'),
  ('learning_center', 'مركز تعليمي', 'دورات ومجموعات تعليمية ورسوم دورات', 'institute', 'available', 80,
     '{"student": "دارس", "students": "الدارسون", "teacher": "معلم", "teachers": "المعلمون"}', '{}'),
  ('quran_institute', 'معهد تحفيظ', 'برامج تحفيظ بحلقات ومستويات', 'institute', 'planned', 90,
     '{"student": "دارس", "students": "الدارسون", "class": "حلقة", "classes": "الحلقات"}', '{}'),
  ('university', 'جامعة أو كلية', 'كليات وأقسام وساعات معتمدة ومعدلات', 'university', 'planned', 100,
     '{"student": "طالب", "students": "الطلاب", "teacher": "عضو هيئة تدريس", "teachers": "هيئة التدريس"}', '{}'),
  ('other', 'نوع آخر', 'مؤسسة تعليمية لا يناسبها نوع من الأنواع أعلاه', 'school', 'available', 200, '{}',
     '{"school_type": "other"}');

-- الأقسام الافتراضية لكل نوع تُحفظ الآن وتُطبَّق عند تجهيز المؤسسة في مرحلة لاحقة.
UPDATE org_types SET default_features = ARRAY(SELECT key FROM features WHERE is_active ORDER BY sort)
 WHERE key IN ('private_school', 'international_school', 'specialized_school', 'other', 'training_institute', 'learning_center');
UPDATE org_types SET default_features = ARRAY(SELECT key FROM features WHERE is_active
                                                AND key NOT IN ('fees', 'finance', 'transfers', 'donations') ORDER BY sort)
 WHERE key = 'public_school';
UPDATE org_types SET default_features = ARRAY(SELECT key FROM features WHERE is_active
                                                AND key NOT IN ('exam_papers', 'timetable') ORDER BY sort)
 WHERE key = 'kindergarten';

ALTER TABLE tenants ADD COLUMN org_type_key text REFERENCES org_types(key) ON UPDATE CASCADE ON DELETE RESTRICT;

-- كل مؤسسة لها نوع، ونوعها من نفس محركها. المؤسسة الجديدة بلا نوع تأخذ النوع الأساسي لمحركها.
CREATE FUNCTION tenants_org_type_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e text;
BEGIN
  IF NEW.org_type_key IS NULL THEN
    NEW.org_type_key := CASE NEW.org_type WHEN 'institute' THEN 'training_institute' ELSE 'private_school' END;
  END IF;
  SELECT engine INTO e FROM org_types WHERE key = NEW.org_type_key;
  IF e IS DISTINCT FROM NEW.org_type THEN
    RAISE EXCEPTION 'نوع المؤسسة لا يناسب طريقة تنظيمها الحالية' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- ربط المؤسسات الحالية بالنوع المطابق لوضعها اليوم (من نوع المؤسسة ونوع المدرسة المحفوظ في ملفها).
UPDATE tenants t SET org_type_key = CASE
    WHEN t.org_type = 'institute' THEN 'training_institute'
    ELSE CASE (SELECT p.school_type FROM school_profile p WHERE p.tenant_id = t.id)
      WHEN 'public' THEN 'public_school'
      WHEN 'international' THEN 'international_school'
      WHEN 'quran' THEN 'quran_school'
      WHEN 'other' THEN 'specialized_school'
      ELSE 'private_school' END
  END;
ALTER TABLE tenants ALTER COLUMN org_type_key SET NOT NULL;
CREATE TRIGGER tenants_org_type BEFORE INSERT OR UPDATE OF org_type, org_type_key ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_org_type_check();
CREATE INDEX tenants_org_type_key ON tenants (org_type_key);

ALTER TABLE org_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_types_read ON org_types FOR SELECT USING (true);
CREATE POLICY org_types_write ON org_types FOR ALL USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
CREATE TRIGGER org_types_audit AFTER INSERT OR UPDATE OR DELETE ON org_types FOR EACH ROW EXECUTE FUNCTION audit_row_change();
GRANT SELECT, INSERT, UPDATE ON org_types TO midar_app;
