-- =====================================================================
-- مِدار | MIDAR — الترحيل 0005: الجدول الدراسي، طلبات التجربة،
--                                قوالب رسائل واتساب، وإعدادات المنصة
-- =====================================================================

/* ---------------- 1) الجدول الدراسي ---------------- */
CREATE TABLE timetable_slots (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL,
  class_id    bigint NOT NULL,
  day         smallint NOT NULL CHECK (day BETWEEN 0 AND 6),     -- 0 = الأحد
  period      smallint NOT NULL CHECK (period BETWEEN 1 AND 10),
  subject_id  bigint NOT NULL,
  teacher_id  bigint,
  room        text CHECK (char_length(room) <= 30),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, day, period),                                -- حصة واحدة للصف في كل وقت
  FOREIGN KEY (tenant_id, class_id)   REFERENCES classes  (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL
);
-- قاعدة البيانات نفسها تمنع وجود المعلم في فصلين بنفس الوقت
CREATE UNIQUE INDEX timetable_teacher_conflict ON timetable_slots (teacher_id, day, period) WHERE teacher_id IS NOT NULL;
CREATE INDEX timetable_class ON timetable_slots (tenant_id, class_id, day, period);

CREATE TRIGGER timetable_touch BEFORE UPDATE ON timetable_slots FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER timetable_audit AFTER INSERT OR UPDATE OR DELETE ON timetable_slots FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE timetable_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON timetable_slots USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON timetable_slots TO midar_app;

/* ---------------- 2) خيارات إظهار الجدول ---------------- */
ALTER TABLE school_public_settings
  ADD COLUMN show_timetable boolean NOT NULL DEFAULT true,          -- جدول الصف في الصفحة العامة
  ADD COLUMN profile_show_timetable boolean NOT NULL DEFAULT true;  -- جدول الصف داخل ملف الطالب

/* ---------------- 3) قوالب رسائل واتساب ---------------- */
CREATE TABLE school_messages (
  tenant_id     text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  country_code  text NOT NULL DEFAULT '966' CHECK (country_code ~ '^[0-9]{1,4}$'),
  absence       text NOT NULL DEFAULT 'السلام عليكم، نفيدكم بغياب الطالب {الطالب} اليوم {التاريخ}. نأمل إفادتنا بالسبب. {المدرسة}',
  late          text NOT NULL DEFAULT 'السلام عليكم، نفيدكم بتأخر الطالب {الطالب} اليوم {التاريخ}. {المدرسة}',
  fees          text NOT NULL DEFAULT 'السلام عليكم، نذكركم برسوم الطالب {الطالب} المتبقية: {المبلغ}. يمكنكم السداد عبر: {الرابط} — {المدرسة}',
  general       text NOT NULL DEFAULT 'السلام عليكم ولي أمر الطالب {الطالب}، ',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(absence) BETWEEN 5 AND 600 AND char_length(late) BETWEEN 5 AND 600
     AND char_length(fees) BETWEEN 5 AND 600 AND char_length(general) BETWEEN 2 AND 600)
);
CREATE TRIGGER school_messages_touch BEFORE UPDATE ON school_messages FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER school_messages_audit AFTER INSERT OR UPDATE OR DELETE ON school_messages FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE school_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_messages USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON school_messages TO midar_app;

/* ---------------- 4) طلبات التجربة (تصل لمالك المنصة) ---------------- */
CREATE TABLE leads (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_name    text NOT NULL CHECK (char_length(school_name) BETWEEN 2 AND 150),
  contact_name   text NOT NULL CHECK (char_length(contact_name) BETWEEN 2 AND 120),
  phone          text NOT NULL CHECK (phone ~ '^[0-9+ ]{6,20}$'),
  email          text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$'),
  city           text CHECK (char_length(city) <= 60),
  students_count integer CHECK (students_count IS NULL OR students_count BETWEEN 1 AND 100000),
  note           text CHECK (char_length(note) <= 1000),
  status         text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'rejected')),
  owner_note     text CHECK (char_length(owner_note) <= 500),
  tenant_id      text REFERENCES tenants(id) ON DELETE SET NULL,   -- المدرسة التي أُنشئت من الطلب
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_status ON leads (status, id DESC);
CREATE TRIGGER leads_touch BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
-- طلبات التجربة ليست بيانات مدرسة، فتُقرأ من لوحة المالك فقط
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_platform ON leads USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
-- التسجيل من الصفحة العامة يمر بدالة محمية (بدون قراءة الطلبات الأخرى)
CREATE FUNCTION submit_lead(p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id bigint;
BEGIN
  IF (SELECT count(*) FROM leads WHERE ip = NULLIF(current_setting('app.ip', true), '')::inet
       AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'تم استقبال طلبك مسبقًا. سنتواصل معك قريبًا.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO leads (school_name, contact_name, phone, email, city, students_count, note, ip)
  VALUES (p ->> 'school_name', p ->> 'contact_name', p ->> 'phone', p ->> 'email', p ->> 'city',
          NULLIF(p ->> 'students_count', '')::int, p ->> 'note', NULLIF(current_setting('app.ip', true), '')::inet)
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
GRANT SELECT, INSERT, UPDATE ON leads TO midar_app;
GRANT EXECUTE ON FUNCTION submit_lead(jsonb) TO midar_app;

/* ---------------- 5) إعدادات المنصة (تخص المالك) ---------------- */
CREATE TABLE platform_settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),      -- صف واحد فقط
  landing_mode   text NOT NULL DEFAULT 'blank' CHECK (landing_mode IN ('blank', 'marketing')),
  brand_phone    text CHECK (brand_phone ~ '^[0-9+ ]{0,20}$'),
  brand_email    text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (id) VALUES (true);
CREATE TRIGGER platform_settings_touch BEFORE UPDATE ON platform_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_read ON platform_settings FOR SELECT USING (true);
CREATE POLICY platform_write ON platform_settings FOR UPDATE USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, UPDATE ON platform_settings TO midar_app;
