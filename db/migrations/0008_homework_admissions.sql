-- =====================================================================
-- مِدار | MIDAR — الترحيل 0008: الواجبات وطلبات الالتحاق
-- =====================================================================

/* ---------- الواجبات ---------- */
CREATE TABLE assignments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL,
  class_id    bigint NOT NULL,
  subject_id  bigint NOT NULL,
  teacher_id  bigint,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  details     text CHECK (char_length(details) <= 2000),
  due_date    date,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id)   REFERENCES classes  (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX assignments_class ON assignments (tenant_id, class_id, due_date DESC);

CREATE TABLE assignment_submissions (
  tenant_id      text NOT NULL,
  assignment_id  bigint NOT NULL,
  student_id     bigint NOT NULL,
  submitted      boolean NOT NULL DEFAULT true,
  note           text CHECK (char_length(note) <= 300),
  marked_by      text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES assignments (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id)    REFERENCES students    (tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER assignments_touch BEFORE UPDATE ON assignments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER submissions_touch BEFORE UPDATE ON assignment_submissions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER assignments_audit AFTER INSERT OR UPDATE OR DELETE ON assignments FOR EACH ROW EXECUTE FUNCTION audit_row_change();

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assignments USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE assignment_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assignment_submissions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON assignments TO midar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON assignment_submissions TO midar_app;

/* ---------- طلبات الالتحاق (تسجيل طالب جديد من صفحة المدرسة) ---------- */
CREATE TABLE admissions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_name    text NOT NULL CHECK (char_length(student_name) BETWEEN 2 AND 120),
  grade_wanted    text CHECK (char_length(grade_wanted) <= 60),
  birth_date      date,
  guardian_name   text NOT NULL CHECK (char_length(guardian_name) BETWEEN 2 AND 120),
  guardian_phone  text NOT NULL CHECK (guardian_phone ~ '^[0-9+ ]{6,20}$'),
  note            text CHECK (char_length(note) <= 1000),
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'accepted', 'rejected')),
  review_note     text CHECK (char_length(review_note) <= 300),
  student_id      bigint,
  ip              inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX admissions_status ON admissions (tenant_id, status, id DESC);
CREATE TRIGGER admissions_touch BEFORE UPDATE ON admissions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER admissions_audit AFTER INSERT OR UPDATE OR DELETE ON admissions FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE admissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admissions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON admissions TO midar_app;

-- تسجيل الطلب من الصفحة العامة: 3 طلبات كحد أقصى لكل جهاز يوميًا لكل مدرسة
CREATE FUNCTION submit_admission(p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id bigint; t text := app_tenant();
BEGIN
  IF t IS NULL THEN RAISE EXCEPTION 'لا توجد مدرسة محددة' USING ERRCODE = 'P0001'; END IF;
  IF (SELECT count(*) FROM admissions WHERE tenant_id = t
        AND ip = NULLIF(current_setting('app.ip', true), '')::inet
        AND created_at > now() - interval '1 day') >= 3 THEN
    RAISE EXCEPTION 'تم استقبال طلبك مسبقًا. ستتواصل معك المدرسة قريبًا.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO admissions (tenant_id, student_name, grade_wanted, birth_date, guardian_name, guardian_phone, note, ip)
  VALUES (t, p ->> 'student_name', p ->> 'grade_wanted', NULLIF(p ->> 'birth_date', '')::date,
          p ->> 'guardian_name', p ->> 'guardian_phone', p ->> 'note',
          NULLIF(current_setting('app.ip', true), '')::inet)
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
GRANT EXECUTE ON FUNCTION submit_admission(jsonb) TO midar_app;

/* ---------- خيارات الإظهار ---------- */
ALTER TABLE school_public_settings
  ADD COLUMN show_admissions boolean NOT NULL DEFAULT false,      -- نموذج طلب التحاق في صفحة المدرسة
  ADD COLUMN profile_show_homework boolean NOT NULL DEFAULT true; -- الواجبات داخل ملف الطالب
