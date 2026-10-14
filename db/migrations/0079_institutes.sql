-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- Training institutes run on the same platform as schools. Trainees reuse the students table, trainers the teachers table,
-- fees the invoices/payments tables and certificates the certificates table; only training-specific entities are new.

ALTER TABLE tenants ADD COLUMN org_type text NOT NULL DEFAULT 'school' CHECK (org_type IN ('school', 'institute'));

-- Trainee data an institute may collect (every field optional; the institute decides which ones it requires).
ALTER TABLE students
  ADD COLUMN national_id     text CHECK (national_id IS NULL OR char_length(national_id) BETWEEN 4 AND 30),
  ADD COLUMN email           text CHECK (email IS NULL OR (char_length(email) <= 120 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  ADD COLUMN qualification   text CHECK (qualification IS NULL OR char_length(qualification) <= 120),
  ADD COLUMN prior_specialty text CHECK (prior_specialty IS NULL OR char_length(prior_specialty) <= 120),
  ADD COLUMN enrolled_on     date;
ALTER TABLE students DROP CONSTRAINT students_status_check;
ALTER TABLE students ADD CONSTRAINT students_status_check
  CHECK (status IN ('active', 'graduated', 'transferred', 'withdrawn', 'deferred', 'suspended'));
CREATE UNIQUE INDEX students_national_id ON students (tenant_id, national_id) WHERE national_id IS NOT NULL AND archived_at IS NULL;

-- Institute staff roles on admin accounts: director runs everything; the others see only their part.
ALTER TABLE users ADD COLUMN staff_role text CHECK (staff_role IN ('director', 'academic', 'registrar', 'reception'));

CREATE TABLE institute_settings (
  tenant_id        text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  terms            jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(terms) = 'object'),
  required_fields  text[] NOT NULL DEFAULT '{}',
  min_attendance   numeric(5,2) NOT NULL DEFAULT 75 CHECK (min_attendance BETWEEN 0 AND 100),
  pass_mark        numeric(5,2) NOT NULL DEFAULT 60 CHECK (pass_mark BETWEEN 0 AND 100),
  registration_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (registration_fee >= 0),
  late_counts_as   numeric(3,2) NOT NULL DEFAULT 1 CHECK (late_counts_as BETWEEN 0 AND 1),
  signer_title     text CHECK (signer_title IS NULL OR char_length(signer_title) <= 60),
  signer_name      text CHECK (signer_name IS NULL OR char_length(signer_name) <= 80),
  certificate_note text CHECK (certificate_note IS NULL OR char_length(certificate_note) <= 300),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE programs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code        text NOT NULL CHECK (code ~ '^[A-Za-z0-9-]{2,20}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 150),
  department  text CHECK (department IS NULL OR char_length(department) <= 100),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE courses (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  program_id     bigint,
  code           text NOT NULL CHECK (code ~ '^[A-Za-z0-9-]{2,20}$'),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 150),
  department     text CHECK (department IS NULL OR char_length(department) <= 100),
  description    text CHECK (description IS NULL OR char_length(description) <= 2000),
  objectives     text CHECK (objectives IS NULL OR char_length(objectives) <= 2000),
  prerequisites  text CHECK (prerequisites IS NULL OR char_length(prerequisites) <= 1000),
  trainer_id     bigint,
  hours          numeric(7,2) NOT NULL CHECK (hours > 0 AND hours <= 5000),
  seats          integer CHECK (seats IS NULL OR seats BETWEEN 1 AND 5000),
  starts_on      date,
  ends_on        date,
  schedule       text CHECK (schedule IS NULL OR char_length(schedule) <= 300),
  fee            numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee >= 0 AND fee <= 100000000),
  mode           text NOT NULL DEFAULT 'onsite' CHECK (mode IN ('onsite', 'remote', 'blended')),
  status         text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'open', 'running', 'completed', 'canceled')),
  grading        text NOT NULL DEFAULT 'score' CHECK (grading IN ('score', 'pass_fail')),
  pass_mark      numeric(5,2) CHECK (pass_mark IS NULL OR pass_mark BETWEEN 0 AND 100),
  min_attendance numeric(5,2) CHECK (min_attendance IS NULL OR min_attendance BETWEEN 0 AND 100),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, trainer_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (trainer_id)
);
CREATE INDEX courses_status ON courses (tenant_id, status, starts_on);

CREATE TABLE course_groups (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  course_id  bigint NOT NULL,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  trainer_id bigint,
  seats      integer CHECK (seats IS NULL OR seats BETWEEN 1 AND 5000),
  schedule   text CHECK (schedule IS NULL OR char_length(schedule) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, course_id, name),
  FOREIGN KEY (tenant_id, course_id) REFERENCES courses (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, trainer_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (trainer_id)
);

-- One row per trainee per course: the agreed fee is frozen here, so later course fee changes never rewrite history.
CREATE TABLE enrollments (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id        bigint NOT NULL,
  course_id         bigint NOT NULL,
  group_id          bigint,
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'active', 'completed', 'failed', 'withdrawn', 'deferred', 'suspended')),
  enrolled_on       date NOT NULL DEFAULT CURRENT_DATE,
  fee               numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  discount          numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  invoice_id        bigint,
  status_reason     text CHECK (status_reason IS NULL OR char_length(status_reason) <= 300),
  status_changed_at timestamptz,
  completed_on      date,
  final_score       numeric(6,2),
  result            text CHECK (result IN ('passed', 'failed')),
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (discount <= fee),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, course_id) REFERENCES courses (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, group_id) REFERENCES course_groups (tenant_id, id) ON DELETE SET NULL (group_id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) ON DELETE SET NULL (invoice_id)
);
CREATE UNIQUE INDEX enrollments_one_open ON enrollments (tenant_id, student_id, course_id) WHERE status NOT IN ('withdrawn');
CREATE INDEX enrollments_course ON enrollments (tenant_id, course_id, status);
CREATE INDEX enrollments_student ON enrollments (tenant_id, student_id);

-- Every change in a trainee's path or a course's trainer, kept for the record.
CREATE TABLE training_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  enrollment_id bigint,
  course_id     bigint,
  group_id      bigint,
  kind          text NOT NULL CHECK (kind IN ('enrolled', 'status', 'transfer', 'trainer', 'fee', 'result')),
  from_value    text CHECK (from_value IS NULL OR char_length(from_value) <= 200),
  to_value      text CHECK (to_value IS NULL OR char_length(to_value) <= 200),
  reason        text CHECK (reason IS NULL OR char_length(reason) <= 300),
  actor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, course_id) REFERENCES courses (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX training_log_enrollment ON training_log (tenant_id, enrollment_id, id DESC);
CREATE INDEX training_log_course ON training_log (tenant_id, course_id, id DESC);

-- Attendance is counted in sessions and real hours, not school days.
CREATE TABLE training_sessions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  course_id      bigint NOT NULL,
  group_id       bigint,
  trainer_id     bigint,
  day            date NOT NULL,
  starts_at      time,
  hours          numeric(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  mode           text NOT NULL DEFAULT 'onsite' CHECK (mode IN ('onsite', 'remote')),
  status         text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'held', 'canceled', 'rescheduled')),
  topic          text CHECK (topic IS NULL OR char_length(topic) <= 200),
  rescheduled_to date,
  note           text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, course_id) REFERENCES courses (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, group_id) REFERENCES course_groups (tenant_id, id) ON DELETE SET NULL (group_id),
  FOREIGN KEY (tenant_id, trainer_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (trainer_id)
);
CREATE INDEX training_sessions_course ON training_sessions (tenant_id, course_id, day);
CREATE INDEX training_sessions_day ON training_sessions (tenant_id, day);

CREATE TABLE session_attendance (
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id    bigint NOT NULL,
  enrollment_id bigint NOT NULL,
  status        text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  late_minutes  integer CHECK (late_minutes IS NULL OR late_minutes BETWEEN 0 AND 600),
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  recorded_by   text NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id, enrollment_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES training_sessions (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX session_attendance_enrollment ON session_attendance (tenant_id, enrollment_id);

-- Each course defines its own assessment scheme: weights, maximums, or plain pass/fail.
CREATE TABLE assessments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  course_id  bigint NOT NULL,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  kind       text NOT NULL DEFAULT 'theory' CHECK (kind IN ('theory', 'practical', 'assignment', 'project', 'final', 'other')),
  max_score  numeric(7,2) CHECK (max_score IS NULL OR max_score > 0),
  weight     numeric(5,2) NOT NULL DEFAULT 0 CHECK (weight BETWEEN 0 AND 100),
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, course_id, name),
  FOREIGN KEY (tenant_id, course_id) REFERENCES courses (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE assessment_scores (
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assessment_id bigint NOT NULL,
  enrollment_id bigint NOT NULL,
  score         numeric(7,2) CHECK (score IS NULL OR score >= 0),
  passed        boolean,
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  updated_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, assessment_id, enrollment_id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES assessments (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments (tenant_id, id) ON DELETE CASCADE
);

-- Who changed a mark, when, and what it was before.
CREATE TABLE score_changes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assessment_id bigint NOT NULL,
  enrollment_id bigint NOT NULL,
  old_score     numeric(7,2),
  new_score     numeric(7,2),
  old_passed    boolean,
  new_passed    boolean,
  reason        text CHECK (reason IS NULL OR char_length(reason) <= 200),
  actor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES assessments (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX score_changes_enrollment ON score_changes (tenant_id, enrollment_id, id DESC);

-- Course fees and certificates reuse the existing invoices and certificates, linked to the enrollment.
ALTER TABLE invoices ADD COLUMN enrollment_id bigint;
ALTER TABLE invoices ADD FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments (tenant_id, id) ON DELETE SET NULL (enrollment_id);
CREATE INDEX invoices_enrollment ON invoices (tenant_id, enrollment_id) WHERE enrollment_id IS NOT NULL;

ALTER TABLE certificates ADD COLUMN enrollment_id bigint;
ALTER TABLE certificates ADD FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments (tenant_id, id) ON DELETE SET NULL (enrollment_id);
ALTER TABLE certificates DROP CONSTRAINT certificates_kind_check;
ALTER TABLE certificates ADD CONSTRAINT certificates_kind_check CHECK (kind IN ('term', 'year', 'custom', 'course', 'attendance'));
CREATE INDEX certificates_enrollment ON certificates (tenant_id, enrollment_id) WHERE enrollment_id IS NOT NULL;

-- Public verification shows only what a certificate may publish: no ids, phones or scores beyond the stated result.
DROP FUNCTION verify_certificate(text);
CREATE FUNCTION verify_certificate(c text) RETURNS TABLE (school text, student text, class_name text, title text, issued_at timestamptz,
  revoked boolean, result text, percent numeric, org_type text, kind text, course text, program text, hours numeric, completed_on text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.name, x.data -> 'student' ->> 'name', x.data -> 'student' ->> 'class_name', x.title, x.issued_at,
         x.revoked_at IS NOT NULL, x.data ->> 'result', NULLIF(x.data -> 'summary' ->> 'percent', '')::numeric,
         t.org_type, x.kind, x.data -> 'course' ->> 'name', x.data -> 'course' ->> 'program',
         NULLIF(x.data -> 'course' ->> 'hours', '')::numeric, x.data -> 'course' ->> 'completed_on'
    FROM certificates x JOIN tenants t ON t.id = x.tenant_id
   WHERE x.code = upper(c) AND t.status <> 'archived';
$$;
REVOKE ALL ON FUNCTION verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_certificate(text) TO midar_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['institute_settings', 'programs', 'courses', 'course_groups', 'enrollments', 'training_log',
                           'training_sessions', 'session_attendance', 'assessments', 'assessment_scores', 'score_changes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO midar_app', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['institute_settings', 'programs', 'courses', 'enrollments'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t || '_touch', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['programs', 'courses', 'course_groups', 'enrollments', 'training_sessions', 'assessments'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t || '_audit', t);
  END LOOP;
END $$;
