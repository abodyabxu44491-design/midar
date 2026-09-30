-- =====================================================================
-- مِدار | MIDAR — الترحيل 0040: ملف المعلم الكامل
--   حقول شخصية ووظيفية جديدة (كلها اختيارية فلا يتأثر أي معلم موجود)،
--   صورة المعلم، وتاريخ تغيير اسم المستخدم لتحديد حالة بيانات الدخول.
--   لا يُضاف قيد فريد على الرقم الوظيفي: قد تحوي المدارس الحالية تكرارًا،
--   فتُمنع الإضافة المكررة من الخدمة فقط دون رفض الترحيل.
-- =====================================================================

ALTER TABLE teachers
  ADD COLUMN short_name       text CHECK (short_name IS NULL OR char_length(short_name) BETWEEN 1 AND 60),
  ADD COLUMN gender           text CHECK (gender IS NULL OR gender IN ('male', 'female')),
  ADD COLUMN birth_date       date CHECK (birth_date IS NULL OR birth_date BETWEEN DATE '1940-01-01' AND DATE '2100-01-01'),
  ADD COLUMN job_title        text CHECK (job_title IS NULL OR char_length(job_title) <= 80),
  ADD COLUMN qualification    text CHECK (qualification IS NULL OR char_length(qualification) <= 120),
  ADD COLUMN hire_date        date CHECK (hire_date IS NULL OR hire_date BETWEEN DATE '1960-01-01' AND DATE '2100-01-01'),
  ADD COLUMN employment_type  text CHECK (employment_type IS NULL OR employment_type IN ('full_time', 'part_time', 'contract', 'volunteer')),
  ADD COLUMN address          text CHECK (address IS NULL OR char_length(address) <= 200),
  ADD COLUMN emergency_name   text CHECK (emergency_name IS NULL OR char_length(emergency_name) <= 120),
  ADD COLUMN emergency_phone  text CHECK (emergency_phone IS NULL OR emergency_phone ~ '^[0-9+ ]{0,20}$'),
  ADD COLUMN photo            bytea CHECK (photo IS NULL OR octet_length(photo) <= 150000),
  ADD COLUMN photo_type       text CHECK (photo_type IS NULL OR photo_type IN ('image/jpeg', 'image/png', 'image/webp'));

ALTER TABLE users ADD COLUMN username_changed_at timestamptz;

-- بحث الرقم الوظيفي وتنبيه التكرار
CREATE INDEX IF NOT EXISTS teachers_employee_no ON teachers (tenant_id, employee_no) WHERE employee_no IS NOT NULL;

-- لقطة التدقيق لا تحفظ الصورة (بيانات ثنائية كبيرة). الدالة نفسها من 0039 مع استثناء 'photo' (موجود أصلًا).
