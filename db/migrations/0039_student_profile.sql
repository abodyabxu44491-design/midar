-- =====================================================================
-- مِدار | MIDAR — الترحيل 0039: بيانات الطالب الأساسية
--   رقم الطالب (معرّف الاستيراد والتحديث)، تاريخ الميلاد، الجنس، جوال الطالب، الصورة.
--   كلها اختيارية، فلا يتأثر أي طالب موجود.
-- =====================================================================

ALTER TABLE students
  ADD COLUMN student_no    text CHECK (student_no IS NULL OR char_length(student_no) BETWEEN 1 AND 30),
  ADD COLUMN birth_date    date CHECK (birth_date IS NULL OR birth_date BETWEEN DATE '1990-01-01' AND DATE '2100-01-01'),
  ADD COLUMN gender        text CHECK (gender IS NULL OR gender IN ('male', 'female')),
  ADD COLUMN student_phone text CHECK (student_phone IS NULL OR student_phone ~ '^[0-9+ ]{0,20}$'),
  ADD COLUMN photo         bytea CHECK (photo IS NULL OR octet_length(photo) <= 150000),
  ADD COLUMN photo_type    text CHECK (photo_type IS NULL OR photo_type IN ('image/jpeg', 'image/png', 'image/webp'));

-- رقم الطالب لا يتكرر داخل المدرسة (الفراغ مسموح لأكثر من طالب)
CREATE UNIQUE INDEX students_student_no ON students (tenant_id, student_no) WHERE student_no IS NOT NULL;
-- بحث الاستيراد عن التكرار المحتمل (الاسم + جوال ولي الأمر)
CREATE INDEX students_dup_lookup ON students (tenant_id, guardian_phone) WHERE guardian_phone IS NOT NULL;

-- سجل التدقيق يحفظ لقطة كاملة من الصف: نستثني الصورة (بيانات ثنائية كبيرة) حتى لا تتضخم القائمة مع كل تعديل.
-- الدالة نفسها من الترحيل 0002 مع إضافة 'photo' إلى المستثنى.
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'password_hash' - 'photo' END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'password_hash' - 'photo' END;
  ip_txt text := NULLIF(current_setting('app.ip', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND (o - 'updated_at' - 'version' - 'last_login_at' - 'failed_logins' - 'locked_until')
                        = (n - 'updated_at' - 'version' - 'last_login_at' - 'failed_logins' - 'locked_until') THEN
    RETURN NULL; -- لا تغيير حقيقي (مثل تحديث وقت آخر دخول أو تغيير الصورة وحدها)
  END IF;
  INSERT INTO audit_log (tenant_id, actor, action, table_name, record_id, old_data, new_data, ip)
  VALUES (COALESCE(n ->> 'tenant_id', o ->> 'tenant_id'), app_actor(), lower(TG_OP), TG_TABLE_NAME,
          COALESCE(n ->> 'id', o ->> 'id', n ->> 'exam_id' || ':' || (n ->> 'student_id'), o ->> 'exam_id' || ':' || (o ->> 'student_id')),
          o, n, ip_txt::inet);
  RETURN NULL;
END $$;
