-- إصلاح: حذف الصف كان يحاول تفريغ tenant_id مع grade_id (مفتاح مركّب)
-- الصحيح: تفريغ عمود grade_id وحده وإبقاء الشعبة في مدرستها.
ALTER TABLE classes DROP CONSTRAINT classes_grade_fk;
ALTER TABLE classes ADD CONSTRAINT classes_grade_fk
  FOREIGN KEY (tenant_id, grade_id) REFERENCES grades (tenant_id, id) ON DELETE SET NULL (grade_id);
