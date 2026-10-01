-- =====================================================================
-- مِدار | MIDAR — الترحيل 0056: الاختبارات الإلكترونية
--   المعلم ينشر ورقة اختبار من «مصمم الاختبارات» إلكترونيًا لشعبة، بوقت فتح وإغلاق ومدة.
--   الطالب يحل من جواله (من ملفه بمعرّفه)، والتصحيح تلقائي للأسئلة الموضوعية، والمعلم يصحح المقالية.
--   الأسئلة تُحفظ نسخة ثابتة وقت النشر (بإجاباتها في الخادم فقط)، والدرجة تنزل في «رصد الدرجات».
-- =====================================================================
CREATE TABLE online_exams (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  paper_id      bigint,
  class_id      bigint NOT NULL,
  subject_id    bigint NOT NULL,
  exam_id       bigint,                       -- اختبار «رصد الدرجات» الذي تنزل فيه الدرجة
  teacher_id    bigint,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 150),
  instructions  text CHECK (instructions IS NULL OR char_length(instructions) <= 3000),
  content       jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 1500000),
  max_score     numeric(7,2) NOT NULL CHECK (max_score > 0),
  opens_at      timestamptz NOT NULL,
  closes_at     timestamptz NOT NULL,
  duration_min  smallint NOT NULL CHECK (duration_min BETWEEN 1 AND 600),
  shuffle       boolean NOT NULL DEFAULT true,
  show_result   text NOT NULL DEFAULT 'score' CHECK (show_result IN ('none', 'score', 'answers')),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'graded')),
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, paper_id) REFERENCES exam_papers (tenant_id, id) ON DELETE SET NULL (paper_id),
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, exam_id) REFERENCES exams (tenant_id, id) ON DELETE SET NULL (exam_id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (teacher_id)
);
CREATE INDEX online_exams_class ON online_exams (tenant_id, class_id, opens_at DESC);
CREATE TRIGGER online_exams_audit AFTER INSERT OR UPDATE OR DELETE ON online_exams FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE online_exams ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON online_exams USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON online_exams TO midar_app;

CREATE TABLE online_attempts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  online_exam_id  bigint NOT NULL,
  student_id      bigint NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  deadline_at     timestamptz NOT NULL,
  submitted_at    timestamptz,
  answers         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 200000),
  marks           jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(marks) = 'object'),   -- درجة كل سؤال (تلقائي ثم تعديل المعلم)
  auto_score      numeric(7,2),
  score           numeric(7,2),
  needs_grading   boolean NOT NULL DEFAULT false,
  graded_at       timestamptz,
  graded_by       text,
  ip              inet,
  UNIQUE (online_exam_id, student_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, online_exam_id) REFERENCES online_exams (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX online_attempts_student ON online_attempts (tenant_id, student_id);
ALTER TABLE online_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON online_attempts USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON online_attempts TO midar_app;
