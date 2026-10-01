-- =====================================================================
-- مِدار | MIDAR — الترحيل 0057: شؤون الموظفين، وتحضير الدروس، والتقويم المدرسي
--   staff_attendance   حضور كل موظف يوميًا (من الإدارة، أو المعلم يسجل حضوره من بوابته)
--   leave_requests     طلبات الإجازة: يقدمها المعلم أو تسجلها الإدارة، وتُعتمد أو تُرفض
--                      الإجازة غير المدفوعة والغياب بلا إجازة يُخصمان من الراتب عند إنشاء المسير
--   substitutions      حصص الانتظار: معلم بديل لحصة معلم غائب في يوم محدد
--   lesson_plans       تحضير الدروس الأسبوعي لكل شعبة ومادة، يراجعه المدير
--   calendar_events    فعاليات التقويم المدرسي (والتقويم يجمع معها الإجازات والاختبارات)
-- =====================================================================
-- الحصة تُربط بمدرستها (مفتاح مركّب كبقية الجداول)
ALTER TABLE timetable_slots ADD CONSTRAINT timetable_slots_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE staff_attendance (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  staff_id     bigint NOT NULL,
  day          date NOT NULL,
  status       text NOT NULL CHECK (status IN ('present', 'late', 'absent', 'leave', 'excused')),
  check_in     time,
  check_out    time,
  late_min     integer CHECK (late_min IS NULL OR late_min BETWEEN 0 AND 1440),
  note         text CHECK (note IS NULL OR char_length(note) <= 300),
  source       text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'self', 'leave')),
  recorded_by  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, day),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX staff_attendance_day ON staff_attendance (tenant_id, day);
CREATE TRIGGER staff_attendance_touch BEFORE UPDATE ON staff_attendance FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER staff_attendance_audit AFTER INSERT OR UPDATE OR DELETE ON staff_attendance FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_attendance USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_attendance TO midar_app;

CREATE TABLE leave_requests (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  staff_id       bigint NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('sick', 'annual', 'emergency', 'unpaid', 'official', 'other')),
  from_day       date NOT NULL,
  to_day         date NOT NULL,
  reason         text CHECK (reason IS NULL OR char_length(reason) <= 500),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by   text NOT NULL,
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text CHECK (decision_note IS NULL OR char_length(decision_note) <= 300),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (to_day >= from_day AND to_day - from_day <= 120),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX leave_requests_staff ON leave_requests (tenant_id, staff_id, from_day DESC);
CREATE TRIGGER leave_requests_audit AFTER INSERT OR UPDATE OR DELETE ON leave_requests FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leave_requests USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_requests TO midar_app;

CREATE TABLE substitutions (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  day                   date NOT NULL,
  slot_id               bigint NOT NULL,
  absent_teacher_id     bigint,
  substitute_teacher_id bigint NOT NULL,
  note                  text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, day),
  FOREIGN KEY (tenant_id, slot_id) REFERENCES timetable_slots (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, absent_teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (absent_teacher_id),
  FOREIGN KEY (tenant_id, substitute_teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX substitutions_day ON substitutions (tenant_id, day);
CREATE TRIGGER substitutions_audit AFTER INSERT OR UPDATE OR DELETE ON substitutions FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE substitutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON substitutions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON substitutions TO midar_app;

CREATE TABLE lesson_plans (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  teacher_id   bigint NOT NULL,
  class_id     bigint NOT NULL,
  subject_id   bigint NOT NULL,
  week_start   date NOT NULL,
  topic        text NOT NULL CHECK (char_length(topic) BETWEEN 2 AND 200),
  objectives   text CHECK (objectives IS NULL OR char_length(objectives) <= 2000),
  content      text CHECK (content IS NULL OR char_length(content) <= 4000),
  activities   text CHECK (activities IS NULL OR char_length(activities) <= 2000),
  assessment   text CHECK (assessment IS NULL OR char_length(assessment) <= 1000),
  homework     text CHECK (homework IS NULL OR char_length(homework) <= 1000),
  resources    text CHECK (resources IS NULL OR char_length(resources) <= 1000),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
  review_note  text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  reviewed_by  text,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, class_id, subject_id, week_start),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX lesson_plans_week ON lesson_plans (tenant_id, week_start DESC);
CREATE TRIGGER lesson_plans_touch BEFORE UPDATE ON lesson_plans FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER lesson_plans_audit AFTER INSERT OR UPDATE OR DELETE ON lesson_plans FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE lesson_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lesson_plans USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON lesson_plans TO midar_app;

CREATE TABLE calendar_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  kind         text NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'exam', 'meeting', 'activity', 'trip', 'deadline', 'other')),
  starts_on    date NOT NULL,
  ends_on      date NOT NULL,
  time_text    text CHECK (time_text IS NULL OR char_length(time_text) <= 40),
  audience     text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'staff', 'parents')),
  class_id     bigint,
  description  text CHECK (description IS NULL OR char_length(description) <= 1000),
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX calendar_events_range ON calendar_events (tenant_id, starts_on);
CREATE TRIGGER calendar_events_audit AFTER INSERT OR UPDATE OR DELETE ON calendar_events FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calendar_events USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_events TO midar_app;
