-- =====================================================================
-- مِدار | MIDAR — الترحيل 0104: المحرك الجامعي (النسخة الأولى)
--   كليات ← أقسام ← برامج (درجة علمية وساعات) ← مقررات بساعات معتمدة ومتطلبات سابقة ← خطة البرنامج
--   ← فصول جامعية ← شعب المقررات المطروحة (مدرس وسعة) ← قبول الطالب في برنامج ← تسجيل المقررات بقواعد
--   ← الدرجات ← المعدل الفصلي والتراكمي والسجل الأكاديمي. سلّم التقديرات تحدده الجامعة.
--   الطلاب في جدول الطلاب نفسه، والمدرسون في جدول المعلمين، فتعمل الحسابات والتواصل كما هي.
--   النوع «جامعة أو كلية» يبقى «قيد التطوير»: لا يظهر في نموذج الطلب، والمالك وحده ينشئ مؤسسة منه للتجربة.
--   إضافي فقط: لا يتغير شيء للمدارس والمعاهد.
-- =====================================================================

ALTER TABLE tenants DROP CONSTRAINT tenants_org_type_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_org_type_check CHECK (org_type IN ('school', 'institute', 'university'));

CREATE TABLE uni_settings (
  tenant_id         text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  -- [{letter, min, points}] من الأعلى للأدنى؛ الحد الأدنى بالدرجة من 100
  grade_scale       jsonb NOT NULL DEFAULT '[{"letter":"A","min":90,"points":4},{"letter":"B+","min":85,"points":3.5},{"letter":"B","min":80,"points":3},{"letter":"C+","min":75,"points":2.5},{"letter":"C","min":70,"points":2},{"letter":"D+","min":65,"points":1.5},{"letter":"D","min":60,"points":1},{"letter":"F","min":0,"points":0}]'
                    CHECK (jsonb_typeof(grade_scale) = 'array'),
  max_points        numeric(3,1) NOT NULL DEFAULT 4 CHECK (max_points IN (4, 5)),
  max_credits       smallint NOT NULL DEFAULT 21 CHECK (max_credits BETWEEN 1 AND 40),
  min_credits       smallint NOT NULL DEFAULT 0 CHECK (min_credits BETWEEN 0 AND 40),
  probation_below   numeric(3,2) NOT NULL DEFAULT 2 CHECK (probation_below >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE uni_colleges (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code       text NOT NULL CHECK (code ~ '^[A-Za-z0-9-]{1,12}$'),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 150),
  dean       text CHECK (dean IS NULL OR char_length(dean) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, code)
);

CREATE TABLE uni_departments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  college_id bigint NOT NULL,
  code       text NOT NULL CHECK (code ~ '^[A-Za-z0-9-]{1,12}$'),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 150),
  head       text CHECK (head IS NULL OR char_length(head) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, college_id) REFERENCES uni_colleges(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE uni_programs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  department_id bigint NOT NULL,
  code          text NOT NULL CHECK (code ~ '^[A-Za-z0-9-]{1,12}$'),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 150),
  degree        text NOT NULL DEFAULT 'bachelor' CHECK (degree IN ('diploma', 'associate', 'bachelor', 'master', 'doctorate')),
  total_credits smallint NOT NULL CHECK (total_credits BETWEEN 1 AND 400),
  years         smallint CHECK (years IS NULL OR years BETWEEN 1 AND 10),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, department_id) REFERENCES uni_departments(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE uni_courses (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  department_id bigint NOT NULL,
  code          text NOT NULL CHECK (code ~ '^[A-Za-z0-9-]{2,16}$'),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 150),
  credits       smallint NOT NULL CHECK (credits BETWEEN 0 AND 12),
  prerequisites bigint[] NOT NULL DEFAULT '{}',
  description   text CHECK (description IS NULL OR char_length(description) <= 1000),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, department_id) REFERENCES uni_departments(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE uni_program_courses (
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  program_id bigint NOT NULL,
  course_id  bigint NOT NULL,
  kind       text NOT NULL DEFAULT 'required' CHECK (kind IN ('required', 'elective')),
  level      smallint CHECK (level IS NULL OR level BETWEEN 1 AND 20),   -- المستوى أو الفصل المقترح في الخطة
  PRIMARY KEY (tenant_id, program_id, course_id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES uni_programs(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, course_id) REFERENCES uni_courses(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE uni_terms (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  status     text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'registration', 'running', 'grading', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, name),
  CHECK (ends_on > starts_on)
);

CREATE TABLE uni_sections (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  term_id     bigint NOT NULL,
  course_id   bigint NOT NULL,
  code        text NOT NULL DEFAULT '1' CHECK (char_length(code) BETWEEN 1 AND 10),
  teacher_id  bigint,
  capacity    smallint NOT NULL DEFAULT 40 CHECK (capacity BETWEEN 1 AND 1000),
  schedule    text CHECK (schedule IS NULL OR char_length(schedule) <= 200),
  room        text CHECK (room IS NULL OR char_length(room) <= 60),
  grades_submitted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, term_id, course_id, code),
  FOREIGN KEY (tenant_id, term_id) REFERENCES uni_terms(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, course_id) REFERENCES uni_courses(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers(tenant_id, id) ON DELETE SET NULL (teacher_id)
);
CREATE INDEX uni_sections_teacher ON uni_sections (tenant_id, teacher_id);

CREATE TABLE uni_student_programs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id      bigint NOT NULL,
  program_id      bigint NOT NULL,
  admitted_term_id bigint,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'graduated', 'withdrawn', 'suspended', 'transferred')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, program_id) REFERENCES uni_programs(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, admitted_term_id) REFERENCES uni_terms(tenant_id, id) ON DELETE SET NULL (admitted_term_id)
);
CREATE UNIQUE INDEX uni_student_programs_one ON uni_student_programs (tenant_id, student_id) WHERE status = 'active';

CREATE TABLE uni_registrations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id  bigint NOT NULL,
  section_id  bigint NOT NULL,
  status      text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'dropped', 'withdrawn')),
  mark        numeric(5,2) CHECK (mark IS NULL OR mark BETWEEN 0 AND 100),
  letter      text CHECK (letter IS NULL OR char_length(letter) <= 4),
  points      numeric(3,2) CHECK (points IS NULL OR points >= 0),
  graded_by   text,
  graded_at   timestamptz,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, student_id, section_id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, section_id) REFERENCES uni_sections(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX uni_registrations_section ON uni_registrations (tenant_id, section_id) WHERE status = 'registered';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['uni_settings', 'uni_colleges', 'uni_departments', 'uni_programs', 'uni_courses', 'uni_program_courses',
                           'uni_terms', 'uni_sections', 'uni_student_programs', 'uni_registrations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t || '_audit', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO midar_app', t);
  END LOOP;
END $$;

-- الشهادات والكشوف: كشف الدرجات الجامعي يستخدم نوع «transcript» القائم.
