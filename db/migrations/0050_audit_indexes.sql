-- =====================================================================
-- مِدار | MIDAR — الترحيل 0050: فهارس من الفحص الشامل
--   أعمدة ربط بلا فهرس في جداول كبيرة، تُقرأ في صفحات متكررة:
--   • assignment_submissions.student_id: واجبات الطالب في ملفه وصفحة ولي الأمر (عشرات الآلاف من الصفوف)
--   • payroll_items.staff_id / entry_id: سجل رواتب الموظف، وربط قيد الراتب بسطره
--   • finance_entries.category_id: التوزيع حسب التصنيف في التقارير المالية
--   • payment_claims.invoice_id: إشعارات التحويل لكل فاتورة (يُفحص عند كل إشعار جديد)
-- =====================================================================
CREATE INDEX IF NOT EXISTS assignment_submissions_student ON assignment_submissions (tenant_id, student_id);
CREATE INDEX IF NOT EXISTS payroll_items_staff ON payroll_items (staff_id);
CREATE INDEX IF NOT EXISTS payroll_items_entry ON payroll_items (entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_entries_category ON finance_entries (tenant_id, category_id);
CREATE INDEX IF NOT EXISTS payment_claims_invoice ON payment_claims (invoice_id);
