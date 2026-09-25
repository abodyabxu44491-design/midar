-- =====================================================================
-- مِدار | MIDAR — الترحيل 0031: فهارس الأداء
-- كل فهرس هنا جاء من قياس فعلي (EXPLAIN ANALYZE) على مدرسة بـ 3600 طالب
-- و234 ألف سجل حضور و129 ألف درجة و10800 فاتورة.
-- =====================================================================

-- درجات الطالب (كشف الدرجات وملف ولي الأمر): المفتاح الأساسي يبدأ بالاختبار، فالبحث بالطالب كان يمسح كل الدرجات
CREATE INDEX IF NOT EXISTS scores_student ON scores (student_id);

-- الطلاب كثيرو الغياب (لوحة التنبيهات): فهرس للغياب فقط بدل قراءة كل سجلات الحضور لآخر 30 يومًا
CREATE INDEX IF NOT EXISTS attendance_absent_recent ON attendance (tenant_id, day, student_id) WHERE status = 'absent';

-- الفواتير المتأخرة (التنبيهات والتحصيل): كانت مسحًا كاملًا لجدول الفواتير
CREATE INDEX IF NOT EXISTS invoices_open_due ON invoices (tenant_id, due_date) WHERE status = 'open';

-- اختبارات الشعبة (المعلم والإدارة وكشوف الدرجات)
CREATE INDEX IF NOT EXISTS exams_class ON exams (tenant_id, class_id, subject_id);

-- قائمة الطلاب المقسمة إلى صفحات: الترتيب حسب الشعبة ثم الاسم مباشرة من الفهرس
CREATE INDEX IF NOT EXISTS students_active_list ON students (tenant_id, class_id, full_name) WHERE status = 'active';
