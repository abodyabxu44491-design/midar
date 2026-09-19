-- =====================================================================
-- مِدار | MIDAR — الترحيل 0012: دور المحاسب وصلاحيات المالية
--
--   حساب مستقل للمحاسب يرى المالية والرسوم فقط، ولا يرى الطلاب ولا الدرجات.
--   العمليات الحساسة (السحوبات، الرواتب) تحتاج صلاحية اعتماد صريحة.
-- =====================================================================

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'teacher', 'accountant'));

ALTER TABLE users
  ADD COLUMN can_approve_finance boolean NOT NULL DEFAULT false,
  ADD COLUMN can_manage_payroll  boolean NOT NULL DEFAULT false;

-- مدير المدرسة يملك كل صلاحيات المالية
UPDATE users SET can_approve_finance = true, can_manage_payroll = true WHERE role = 'admin';

ALTER TABLE sessions DROP CONSTRAINT sessions_kind_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_kind_check CHECK (kind IN ('owner', 'admin', 'teacher', 'accountant'));

COMMENT ON COLUMN users.can_approve_finance IS 'اعتماد أو رفض الحركات المالية المعلّقة';
COMMENT ON COLUMN users.can_manage_payroll IS 'إنشاء مسير الرواتب واعتماده وصرفه';
