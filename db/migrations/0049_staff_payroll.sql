-- =====================================================================
-- مِدار | MIDAR — الترحيل 0049: الموظفون جزء من المالية، والمعلمون موظفون تلقائيًا
--   • أنواع الموظفين: معلم، إداري، محاسب، مشرف، حارس، سائق، عامل نظافة، عامل، أخرى
--   • كل معلم يُضاف تلقائيًا للموظفين (ويتبعه اسمه وجواله)، فيظهر في المالية براتبه الشهري
--   • الراتب: أساسي + بدل ثابت شهري، وطريقة الصرف ورقم الحساب أو المحفظة (بلا آيبان إلزامي)
--   • الرواتب مفعّلة افتراضيًا ضمن المالية (كانت موقوفة)
-- =====================================================================
ALTER TABLE staff DROP CONSTRAINT staff_category_check;
ALTER TABLE staff ADD CONSTRAINT staff_category_check
  CHECK (category IN ('teacher', 'admin', 'accountant', 'supervisor', 'guard', 'driver', 'cleaner', 'worker', 'other'));
ALTER TABLE staff
  ADD COLUMN allowance      numeric(12,2) NOT NULL DEFAULT 0 CHECK (allowance >= 0),
  ADD COLUMN pay_method     text NOT NULL DEFAULT 'cash' CHECK (pay_method IN ('cash', 'transfer')),
  ADD COLUMN account_number text CHECK (account_number IS NULL OR account_number ~ '^[0-9-]{4,34}$'),
  ADD COLUMN hire_date      date,
  ADD COLUMN notes          text CHECK (char_length(notes) <= 300);

-- موظف واحد لكل معلم
CREATE UNIQUE INDEX staff_one_per_teacher ON staff (tenant_id, teacher_id) WHERE teacher_id IS NOT NULL;

-- المعلم الجديد يصبح موظفًا تلقائيًا، وتعديل اسمه أو جواله ينعكس، وحذفه يوقف سجله الوظيفي (لا يُحذف لارتباطه بالرواتب)
CREATE FUNCTION teachers_sync_staff() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO staff (tenant_id, full_name, job_title, category, phone, teacher_id, hire_date)
    VALUES (NEW.tenant_id, NEW.full_name, COALESCE(NEW.job_title, 'معلم'), 'teacher', NEW.phone, NEW.id, NEW.hire_date)
    ON CONFLICT DO NOTHING;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.full_name IS DISTINCT FROM OLD.full_name OR NEW.phone IS DISTINCT FROM OLD.phone THEN
      UPDATE staff SET full_name = NEW.full_name, phone = NEW.phone WHERE teacher_id = NEW.id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE staff SET is_active = false WHERE teacher_id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teachers_staff_insert AFTER INSERT ON teachers FOR EACH ROW EXECUTE FUNCTION teachers_sync_staff();
CREATE TRIGGER teachers_staff_update AFTER UPDATE ON teachers FOR EACH ROW EXECUTE FUNCTION teachers_sync_staff();
CREATE TRIGGER teachers_staff_delete BEFORE DELETE ON teachers FOR EACH ROW EXECUTE FUNCTION teachers_sync_staff();

-- المعلمون الحاليون: سجل وظيفي لمن ليس له
INSERT INTO staff (tenant_id, full_name, job_title, category, phone, teacher_id, hire_date)
SELECT t.tenant_id, t.full_name, COALESCE(t.job_title, 'معلم'), 'teacher', t.phone, t.id, t.hire_date
  FROM teachers t WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.tenant_id = t.tenant_id AND s.teacher_id = t.id);

-- الرواتب جزء من المالية: مفعّلة افتراضيًا، وللمدارس القائمة التي تشغّل المالية
ALTER TABLE school_modules ALTER COLUMN payroll SET DEFAULT true;
UPDATE school_modules SET payroll = true WHERE finance AND NOT payroll;

-- إصلاح: مفاتيح مركّبة (المدرسة + المعرّف) بـ ON DELETE SET NULL كانت تحاول تفريغ tenant_id أيضًا فيفشل الحذف
-- («حقل مطلوب ناقص»)، مثل حذف معلم له حصص في الجدول أو واجبات. الصيغة الصحيحة تفرّغ عمود الربط وحده.
ALTER TABLE timetable_slots DROP CONSTRAINT timetable_slots_tenant_id_teacher_id_fkey,
  ADD CONSTRAINT timetable_slots_tenant_id_teacher_id_fkey FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (teacher_id);
ALTER TABLE assignments DROP CONSTRAINT assignments_tenant_id_teacher_id_fkey,
  ADD CONSTRAINT assignments_tenant_id_teacher_id_fkey FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (teacher_id);
ALTER TABLE staff DROP CONSTRAINT staff_tenant_id_teacher_id_fkey,
  ADD CONSTRAINT staff_tenant_id_teacher_id_fkey FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (teacher_id);
ALTER TABLE admissions DROP CONSTRAINT admissions_tenant_id_student_id_fkey,
  ADD CONSTRAINT admissions_tenant_id_student_id_fkey FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE SET NULL (student_id);
ALTER TABLE exams DROP CONSTRAINT exams_term_fk,
  ADD CONSTRAINT exams_term_fk FOREIGN KEY (tenant_id, term_id) REFERENCES terms (tenant_id, id) ON DELETE SET NULL (term_id);
ALTER TABLE invoices DROP CONSTRAINT invoices_term_fk,
  ADD CONSTRAINT invoices_term_fk FOREIGN KEY (tenant_id, term_id) REFERENCES terms (tenant_id, id) ON DELETE SET NULL (term_id);
ALTER TABLE assignments DROP CONSTRAINT assignments_term_fk,
  ADD CONSTRAINT assignments_term_fk FOREIGN KEY (tenant_id, term_id) REFERENCES terms (tenant_id, id) ON DELETE SET NULL (term_id);
ALTER TABLE finance_entries DROP CONSTRAINT finance_entries_tenant_id_term_id_fkey,
  ADD CONSTRAINT finance_entries_tenant_id_term_id_fkey FOREIGN KEY (tenant_id, term_id) REFERENCES terms (tenant_id, id) ON DELETE SET NULL (term_id);
