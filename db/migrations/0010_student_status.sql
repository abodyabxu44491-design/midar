-- =====================================================================
-- مِدار | MIDAR — الترحيل 0010: حالة الطالب ونتيجة السنة
--
--   حالة الطالب: على رأس القيد | متخرج | منقول لمدرسة أخرى | منسحب
--   نتيجة السنة: ناجح | راسب | غير مكتمل، وتُحسب آليًا من الدرجات
--   الإجراء عند بدء سنة جديدة: ترفيع | إعادة | تخرّج | نقل | انسحاب
-- =====================================================================

/* ---------- حالة الطالب ---------- */
ALTER TABLE students
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'graduated', 'transferred', 'withdrawn')),
  ADD COLUMN status_note text CHECK (char_length(status_note) <= 300),
  ADD COLUMN status_changed_at timestamptz;

-- الأرشفة تتبع الحالة تلقائيًا: أي حالة غير «على رأس القيد» تعني خروج الطالب من القوائم
CREATE FUNCTION students_sync_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  IF NEW.status = 'active' THEN
    NEW.archived_at := NULL;
  ELSIF NEW.archived_at IS NULL THEN
    NEW.archived_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER students_status_sync BEFORE INSERT OR UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION students_sync_status();

-- الطلاب المؤرشفون سابقًا يُعتبرون منسحبين حتى تحدد المدرسة حالتهم
UPDATE students SET status = 'withdrawn' WHERE archived_at IS NOT NULL AND status = 'active';

/* ---------- نتيجة السنة ---------- */
ALTER TABLE student_years
  DROP CONSTRAINT IF EXISTS student_years_result_check;
ALTER TABLE student_years
  ADD CONSTRAINT student_years_result_check
    CHECK (result IN ('promoted', 'repeated', 'graduated', 'transferred', 'withdrawn')),
  ADD COLUMN outcome text CHECK (outcome IN ('passed', 'failed', 'incomplete')),
  ADD COLUMN attendance_rate numeric(5,2) CHECK (attendance_rate BETWEEN 0 AND 100),
  ADD COLUMN note text CHECK (char_length(note) <= 300);

/* ---------- درجة النجاح لكل سنة ---------- */
ALTER TABLE academic_years
  ADD COLUMN pass_mark numeric(5,2) NOT NULL DEFAULT 50 CHECK (pass_mark BETWEEN 0 AND 100);

COMMENT ON COLUMN academic_years.pass_mark IS 'النسبة المئوية التي يُعتبر الطالب ناجحًا عندها أو فوقها';
COMMENT ON COLUMN students.status IS 'active = على رأس القيد، graduated = متخرج، transferred = منقول لمدرسة أخرى، withdrawn = منسحب';
