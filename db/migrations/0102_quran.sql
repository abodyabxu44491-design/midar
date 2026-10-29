-- =====================================================================
-- مِدار | MIDAR — الترحيل 0102: قسم حلقات التحفيظ
--   مستويات تحددها المؤسسة ← حلقات (لكل حلقة معلم) ← أعضاء الحلقة (طالب في حلقة واحدة في الوقت نفسه، مع هدف يومي)
--   ← سجل يومي: حفظ جديد، مراجعة، تسميع (اختبار مقطع)، غياب، عذر. المقطع مدى آيات (من سورة وآية إلى سورة وآية).
--   ← إنجازات (إتمام جزء أو ختم) تصدر لها شهادة من نظام الشهادات القائم برمز تحقق.
--   القسم موقوف افتراضيًا في كل المؤسسات، ويُشغَّل لأنواع التحفيظ. إضافي فقط: لا يتغير شيء قائم.
-- =====================================================================

CREATE TABLE quran_levels (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 300),
  sort        integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE halaqat (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  teacher_id  bigint,
  level_id    bigint,
  schedule    text CHECK (schedule IS NULL OR char_length(schedule) <= 120),
  capacity    integer CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 500),
  notes       text CHECK (notes IS NULL OR char_length(notes) <= 500),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers(tenant_id, id) ON DELETE SET NULL (teacher_id),
  FOREIGN KEY (tenant_id, level_id) REFERENCES quran_levels(tenant_id, id) ON DELETE SET NULL (level_id)
);
CREATE UNIQUE INDEX halaqat_name ON halaqat (tenant_id, name) WHERE status = 'active';
CREATE INDEX halaqat_teacher ON halaqat (tenant_id, teacher_id);

CREATE TABLE halaqa_members (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  halaqa_id    bigint NOT NULL,
  student_id   bigint NOT NULL,
  level_id     bigint,
  daily_target integer CHECK (daily_target IS NULL OR daily_target BETWEEN 1 AND 1000),   -- آيات الحفظ الجديد في اليوم
  started_on   date NOT NULL DEFAULT CURRENT_DATE,
  ended_on     date,
  note         text CHECK (note IS NULL OR char_length(note) <= 300),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, halaqa_id) REFERENCES halaqat(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, level_id) REFERENCES quran_levels(tenant_id, id) ON DELETE SET NULL (level_id),
  CHECK (ended_on IS NULL OR ended_on >= started_on)
);
CREATE UNIQUE INDEX halaqa_members_one ON halaqa_members (tenant_id, student_id) WHERE ended_on IS NULL;
CREATE INDEX halaqa_members_halaqa ON halaqa_members (tenant_id, halaqa_id) WHERE ended_on IS NULL;

CREATE TABLE quran_records (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id  bigint NOT NULL,
  halaqa_id   bigint,
  teacher_id  bigint,
  on_date     date NOT NULL DEFAULT CURRENT_DATE,
  kind        text NOT NULL CHECK (kind IN ('new', 'review', 'test', 'absent', 'excused')),
  from_surah  smallint CHECK (from_surah BETWEEN 1 AND 114),
  from_ayah   smallint CHECK (from_ayah >= 1),
  to_surah    smallint CHECK (to_surah BETWEEN 1 AND 114),
  to_ayah     smallint CHECK (to_ayah >= 1),
  from_index  smallint CHECK (from_index BETWEEN 1 AND 6236),     -- موضع الآية في المصحف كله (يحسبه الخادم)
  to_index    smallint CHECK (to_index BETWEEN 1 AND 6236),
  ayat        smallint NOT NULL DEFAULT 0 CHECK (ayat >= 0),
  grade       text CHECK (grade IN ('excellent', 'very_good', 'good', 'acceptable', 'weak', 'repeat')),
  mistakes    smallint CHECK (mistakes IS NULL OR mistakes BETWEEN 0 AND 500),
  notes       text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, halaqa_id) REFERENCES halaqat(tenant_id, id) ON DELETE SET NULL (halaqa_id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers(tenant_id, id) ON DELETE SET NULL (teacher_id),
  -- الحفظ والمراجعة والتسميع لها مقطع كامل؛ الغياب والعذر بلا مقطع
  CHECK ((kind IN ('absent', 'excused')) = (from_index IS NULL)),
  CHECK (from_index IS NULL OR (to_index IS NOT NULL AND from_index <= to_index AND from_surah IS NOT NULL AND to_surah IS NOT NULL))
);
CREATE INDEX quran_records_student ON quran_records (tenant_id, student_id, on_date DESC, id DESC);
CREATE INDEX quran_records_halaqa ON quran_records (tenant_id, halaqa_id, on_date);
CREATE UNIQUE INDEX quran_records_one_absence ON quran_records (tenant_id, student_id, on_date) WHERE kind IN ('absent', 'excused');

CREATE TABLE quran_achievements (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id     bigint NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('juz', 'khatm')),
  juz            smallint CHECK (juz BETWEEN 1 AND 30),
  achieved_on    date NOT NULL DEFAULT CURRENT_DATE,
  certificate_id bigint,
  note           text CHECK (note IS NULL OR char_length(note) <= 300),
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, certificate_id) REFERENCES certificates(tenant_id, id) ON DELETE SET NULL (certificate_id),
  CHECK ((kind = 'juz') = (juz IS NOT NULL))
);
CREATE UNIQUE INDEX quran_achievements_one ON quran_achievements (tenant_id, student_id, kind, COALESCE(juz, 0));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quran_levels', 'halaqat', 'halaqa_members', 'quran_records', 'quran_achievements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t || '_audit', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO midar_app', t);
  END LOOP;
END $$;
CREATE TRIGGER halaqat_touch BEFORE UPDATE ON halaqat FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- القسم في كتالوج المنصة (كل الأقسام في كل الباقات).
INSERT INTO features (key, name, description, category, kind, sort, requestable)
VALUES ('quran', 'حلقات التحفيظ', 'الحلقات ومستويات الحفظ وسجل الحفظ والمراجعة والتسميع والتقارير', 'أكاديمي', 'module', 17, false)
ON CONFLICT (key) DO NOTHING;

-- أنواع التحفيظ: قسم الحلقات ضمن أقسامها الافتراضية، وتُتاح بحالة «تجريبي». «الشعبة» تبقى شعبة (الحلقة شيء مستقل).
UPDATE org_types SET default_features = array_append(array_remove(default_features, 'quran'), 'quran'),
                     status = CASE WHEN status = 'planned' THEN 'beta' ELSE status END,
                     terms = terms - 'class' - 'classes', version = version + 1
 WHERE key IN ('quran_school', 'quran_institute');
UPDATE org_types SET default_features = ARRAY(SELECT key FROM features WHERE is_active AND key <> 'donations' ORDER BY sort)
 WHERE key IN ('quran_school', 'quran_institute') AND cardinality(default_features) <= 1;
