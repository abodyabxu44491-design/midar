-- =====================================================================
-- مِدار | MIDAR — الترحيل 0029: مصمم الاختبارات الورقية
--
--   بنك الأسئلة ← ورقة الاختبار (أقسام وأسئلة) ← القوالب ← النماذج المتعددة ← الطباعة
--
--   * محتوى الورقة (الأقسام والأسئلة) مستند JSON واحد: يُحفظ تلقائيًا أثناء الكتابة،
--     ويُنسخ كما هو، ولا يتغير الاختبار المعتمد إذا عُدّل سؤال في البنك لاحقًا.
--   * الاختبار المعتمد أو المطبوع مقفل داخل قاعدة البيانات نفسها: لا يتغير محتواه
--     إلا بإعادته إلى «مسودة» صراحةً (إعادة فتح للتعديل).
--   * لا حذف لاختبار معتمد أو مطبوع؛ الحذف للمسودات فقط، والباقي يُؤرشف.
--   * الصور تُحفظ في جدول مستقل بلا سجل تدقيق لمحتواها (حتى لا يمتلئ السجل ببيانات ثنائية).
-- =====================================================================

/* ---------- القسم قابل للتشغيل والإيقاف ---------- */
ALTER TABLE school_modules ADD COLUMN exam_papers boolean NOT NULL DEFAULT true;

/* ---------- الصور: شعار المدرسة وصور الأسئلة ---------- */
CREATE TABLE exam_images (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind        text NOT NULL DEFAULT 'question' CHECK (kind IN ('question', 'logo')),
  teacher_id  bigint,                            -- NULL = رفعتها الإدارة
  mime        text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes  integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  data        bytea NOT NULL,
  uploaded_by text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (teacher_id)
);
CREATE INDEX exam_images_tenant ON exam_images (tenant_id, kind);

/* ---------- سياسة المدرسة للاختبارات ---------- */
CREATE TABLE exam_paper_settings (
  tenant_id            text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  require_approval     boolean NOT NULL DEFAULT false,  -- الإدارة تعتمد الاختبار قبل طباعته
  teacher_can_reopen   boolean NOT NULL DEFAULT true,   -- المعلم يعيد فتح اختباره المعتمد (عند عدم اشتراط اعتماد الإدارة)
  teacher_answer_keys  boolean NOT NULL DEFAULT true,   -- المعلم يطبع نموذج إجابة اختباره
  show_logo            boolean NOT NULL DEFAULT true,   -- إظهار شعار المدرسة في أوراق الاختبارات
  logo_image_id        bigint,
  default_instructions text CHECK (char_length(default_instructions) <= 2000),
  footer_text          text CHECK (char_length(footer_text) <= 200),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, logo_image_id) REFERENCES exam_images (tenant_id, id) ON DELETE SET NULL (logo_image_id)
);
CREATE TRIGGER exam_paper_settings_touch BEFORE UPDATE ON exam_paper_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER exam_paper_settings_audit AFTER INSERT OR UPDATE OR DELETE ON exam_paper_settings FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------- أنواع الاختبارات المخصصة (الأنواع الأساسية في الكود) ---------- */
CREATE TABLE exam_types (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  is_active   boolean NOT NULL DEFAULT true,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER exam_types_audit AFTER INSERT OR UPDATE OR DELETE ON exam_types FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------- بنك الأسئلة ---------- */
CREATE TABLE question_bank (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  teacher_id    bigint,                              -- صاحب السؤال
  subject_id    bigint NOT NULL,
  grade_id      bigint,
  term_id       bigint,
  unit          text CHECK (char_length(unit) <= 120),
  lesson        text CHECK (char_length(lesson) <= 120),
  qtype         text NOT NULL CHECK (qtype IN ('mcq', 'multi', 'truefalse', 'fill', 'short', 'essay',
                                                'match', 'order', 'image', 'table', 'math', 'custom')),
  difficulty    text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  marks         numeric(6,2) NOT NULL CHECK (marks > 0 AND marks <= 1000),
  body          jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 60000),
  is_shared     boolean NOT NULL DEFAULT false,      -- يراه معلمو المادة نفسها في المدرسة
  is_archived   boolean NOT NULL DEFAULT false,
  used_count    integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (teacher_id),
  FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, grade_id)   REFERENCES grades   (tenant_id, id) ON DELETE SET NULL (grade_id),
  FOREIGN KEY (tenant_id, term_id)    REFERENCES terms    (tenant_id, id) ON DELETE SET NULL (term_id)
);
CREATE INDEX question_bank_lookup ON question_bank (tenant_id, subject_id, grade_id, qtype, difficulty) WHERE NOT is_archived;
CREATE INDEX question_bank_owner  ON question_bank (tenant_id, teacher_id, id DESC);
CREATE TRIGGER question_bank_touch BEFORE UPDATE ON question_bank FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER question_bank_audit AFTER INSERT OR UPDATE OR DELETE ON question_bank FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------- ورقة الاختبار ---------- */
CREATE TABLE exam_papers (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  teacher_id        bigint,                          -- كاتب الاختبار
  subject_id        bigint NOT NULL,
  class_id          bigint,                          -- الشعبة
  grade_id          bigint,                          -- الصف
  term_id           bigint,
  title             text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 150),
  exam_type         text NOT NULL DEFAULT 'اختبار قصير' CHECK (char_length(exam_type) BETWEEN 2 AND 60),
  exam_date         date,
  duration_min      smallint CHECK (duration_min IS NULL OR duration_min BETWEEN 1 AND 600),
  total_marks       numeric(7,2) CHECK (total_marks IS NULL OR (total_marks > 0 AND total_marks <= 10000)),  -- الدرجة النهائية المحددة
  computed_marks    numeric(7,2) NOT NULL DEFAULT 0 CHECK (computed_marks >= 0),                              -- مجموع درجات الأسئلة (يحسبه الخادم)
  question_count    integer NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  instructions      text CHECK (char_length(instructions) <= 3000),
  expected_pages    smallint CHECK (expected_pages IS NULL OR expected_pages BETWEEN 1 AND 50),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'approved', 'printed', 'archived')),
  archived_from     text CHECK (archived_from IN ('draft', 'ready', 'approved', 'printed')),
  content           jsonb NOT NULL DEFAULT '{"sections":[]}' CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 1500000),
  layout            jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(layout) = 'object' AND octet_length(layout::text) <= 20000),
  versions          smallint NOT NULL DEFAULT 1 CHECK (versions BETWEEN 1 AND 4),     -- عدد النماذج A..D
  shuffle_questions boolean NOT NULL DEFAULT true,
  shuffle_options   boolean NOT NULL DEFAULT true,
  seed              integer NOT NULL DEFAULT (floor(random() * 2000000000))::int,     -- ثابت لكل اختبار: النموذج B يبقى هو نفسه في كل طباعة
  is_template       boolean NOT NULL DEFAULT false,
  template_name     text CHECK (char_length(template_name) <= 150),
  source_paper_id   bigint,
  version           integer NOT NULL DEFAULT 1,                                       -- قفل التعديل المتزامن
  approved_by       text,
  approved_at       timestamptz,
  printed_at        timestamptz,
  print_count       integer NOT NULL DEFAULT 0 CHECK (print_count >= 0),
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (NOT is_template OR template_name IS NOT NULL),
  CHECK ((status = 'archived') = (archived_from IS NOT NULL)),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (teacher_id),
  FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, class_id)   REFERENCES classes  (tenant_id, id) ON DELETE SET NULL (class_id),
  FOREIGN KEY (tenant_id, grade_id)   REFERENCES grades   (tenant_id, id) ON DELETE SET NULL (grade_id),
  FOREIGN KEY (tenant_id, term_id)    REFERENCES terms    (tenant_id, id) ON DELETE SET NULL (term_id)
);
CREATE INDEX exam_papers_teacher ON exam_papers (tenant_id, teacher_id, is_template, updated_at DESC);
CREATE INDEX exam_papers_status  ON exam_papers (tenant_id, status) WHERE NOT is_template;
CREATE TRIGGER exam_papers_touch BEFORE UPDATE ON exam_papers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
-- تدقيق خفيف: الحفظ التلقائي يعمل كل بضع ثوانٍ أثناء الكتابة، فلا يُنسخ محتوى الورقة كاملًا في السجل
-- مع كل حفظ. يُسجَّل الإنشاء والحذف وأي تغيير في الحالة أو البيانات الأساسية، بدون المحتوى والتصميم.
CREATE FUNCTION exam_paper_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  skip text[] := ARRAY['content', 'layout', 'version', 'updated_at', 'computed_marks', 'question_count'];
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - skip END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - skip END;
BEGIN
  IF TG_OP = 'UPDATE' AND o = n THEN RETURN NULL; END IF;
  INSERT INTO audit_log (tenant_id, actor, action, table_name, record_id, old_data, new_data, ip)
  VALUES (COALESCE(n ->> 'tenant_id', o ->> 'tenant_id'), app_actor(), lower(TG_OP), TG_TABLE_NAME,
          COALESCE(n ->> 'id', o ->> 'id'), o, n, NULLIF(current_setting('app.ip', true), '')::inet);
  RETURN NULL;
END $$;
CREATE TRIGGER exam_papers_audit AFTER INSERT OR UPDATE OR DELETE ON exam_papers FOR EACH ROW EXECUTE FUNCTION exam_paper_audit();

-- قفل الاختبار المعتمد: الحماية داخل القاعدة وليس في الواجهة فقط
CREATE FUNCTION exam_paper_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' AND NOT OLD.is_template THEN
      RAISE EXCEPTION 'لا يُحذف إلا الاختبار المسودة. الاختبار المعتمد أو المطبوع يُؤرشف.' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  -- المعتمد والمطبوع والمؤرشف: لا يتغير المحتوى ولا البيانات الأساسية إلا بعد إعادة فتحه (العودة إلى مسودة)
  IF OLD.status IN ('approved', 'printed', 'archived') AND NEW.status NOT IN ('draft', 'ready') AND (
       NEW.content IS DISTINCT FROM OLD.content OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.total_marks IS DISTINCT FROM OLD.total_marks
    OR NEW.versions IS DISTINCT FROM OLD.versions OR NEW.seed IS DISTINCT FROM OLD.seed
    OR NEW.shuffle_questions IS DISTINCT FROM OLD.shuffle_questions OR NEW.shuffle_options IS DISTINCT FROM OLD.shuffle_options) THEN
    RAISE EXCEPTION 'الاختبار معتمد ومقفل. أعد فتحه للتعديل أولًا.' USING ERRCODE = 'P0001';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER exam_papers_guard BEFORE UPDATE OR DELETE ON exam_papers FOR EACH ROW EXECUTE FUNCTION exam_paper_guard();

/* ---------- التعليمات المحفوظة ---------- */
CREATE TABLE exam_instruction_presets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  teacher_id  bigint NOT NULL,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 80),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 2 AND 3000),
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX exam_instruction_presets_default ON exam_instruction_presets (tenant_id, teacher_id) WHERE is_default;
CREATE TRIGGER exam_instruction_presets_audit AFTER INSERT OR UPDATE OR DELETE ON exam_instruction_presets FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------- العزل والصلاحيات ---------- */
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exam_images', 'exam_paper_settings', 'exam_types', 'question_bank', 'exam_papers', 'exam_instruction_presets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, DELETE ON exam_images TO midar_app;
GRANT SELECT, INSERT, UPDATE ON exam_paper_settings TO midar_app;
GRANT SELECT, INSERT, UPDATE ON exam_types TO midar_app;
GRANT SELECT, INSERT, UPDATE ON question_bank TO midar_app;              -- لا حذف نهائي: السؤال يُؤرشف
GRANT SELECT, INSERT, UPDATE, DELETE ON exam_papers TO midar_app;        -- الحذف للمسودات فقط (المشغّل أعلاه)
GRANT SELECT, INSERT, UPDATE, DELETE ON exam_instruction_presets TO midar_app;
