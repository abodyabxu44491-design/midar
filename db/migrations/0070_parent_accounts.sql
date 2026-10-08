-- =====================================================================
-- مِدار | MIDAR — الترحيل 0070: حساب ولي الأمر الموحّد
--   parents               : حساب واحد لولي الأمر في المدرسة (جوال + كلمة مرور)، لا حساب لكل طالب
--   parent_students       : علاقة متعددة بمعرّفات ثابتة (ولي أمر ↔ أبناء، وطالب ↔ أكثر من ولي أمر)
--                           فك الارتباط لا يحذف السجل (removed_at) للحفاظ على التاريخ
--   parent_link_requests  : طلب ولي الأمر ربط ابن (عند اشتراط موافقة المدرسة)
--   sessions.parent_id    : جلسة ولي الأمر (نوع parent) — تُقرأ في الخادم مع كل طلب لملف طالب
-- =====================================================================
CREATE TABLE parents (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  full_name        text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  phone            text NOT NULL CHECK (phone ~ '^\+?[0-9]{6,20}$'),
  email            text CHECK (email IS NULL OR (char_length(email) <= 120 AND email ~ '^[^@\s]+@[^@\s]+$')),
  password_hash    text,
  must_change_password boolean NOT NULL DEFAULT true,
  initial_password_enc text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at    timestamptz,
  password_changed_at timestamptz,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, phone)
);
CREATE TRIGGER parents_touch BEFORE UPDATE ON parents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER parents_audit AFTER INSERT OR UPDATE OR DELETE ON parents FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON parents USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON parents TO midar_app;

CREATE TABLE parent_students (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  parent_id    bigint NOT NULL,
  student_id   bigint NOT NULL,
  relation     text NOT NULL DEFAULT 'guardian' CHECK (relation IN ('father', 'mother', 'guardian', 'other')),
  can_view_fees boolean NOT NULL DEFAULT true,
  source       text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'auto', 'key', 'request')),
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz,
  removed_by   text,
  FOREIGN KEY (tenant_id, parent_id) REFERENCES parents (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
-- علاقة فعالة واحدة لكل (ولي أمر، طالب)؛ السجلات المفكوكة تبقى للتاريخ
CREATE UNIQUE INDEX parent_students_active ON parent_students (tenant_id, parent_id, student_id) WHERE removed_at IS NULL;
CREATE INDEX parent_students_student ON parent_students (tenant_id, student_id) WHERE removed_at IS NULL;
CREATE TRIGGER parent_students_audit AFTER INSERT OR UPDATE OR DELETE ON parent_students FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE parent_students ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON parent_students USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON parent_students TO midar_app;

CREATE TABLE parent_link_requests (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  parent_id    bigint NOT NULL,
  student_id   bigint NOT NULL,
  relation     text NOT NULL DEFAULT 'guardian' CHECK (relation IN ('father', 'mother', 'guardian', 'other')),
  note         text CHECK (note IS NULL OR char_length(note) <= 300),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by   text,
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES parents (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX parent_link_requests_open ON parent_link_requests (tenant_id, parent_id, student_id) WHERE status = 'pending';
CREATE TRIGGER parent_link_requests_audit AFTER INSERT OR UPDATE OR DELETE ON parent_link_requests FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE parent_link_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON parent_link_requests USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON parent_link_requests TO midar_app;

-- جلسات أولياء الأمور
ALTER TABLE sessions DROP CONSTRAINT sessions_kind_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_kind_check CHECK (kind IN ('owner', 'admin', 'teacher', 'accountant', 'parent'));
ALTER TABLE sessions ADD COLUMN parent_id bigint REFERENCES parents(id) ON DELETE CASCADE;
ALTER TABLE sessions ADD CONSTRAINT sessions_parent_kind CHECK ((kind = 'parent') = (parent_id IS NOT NULL));
CREATE INDEX sessions_parent ON sessions (parent_id) WHERE parent_id IS NOT NULL;

-- اشتراكات الإشعار الفوري التي سجّلها ولي أمر من حسابه: تُزال عند فك ارتباطه بالطالب
ALTER TABLE push_subscriptions ADD COLUMN parent_id bigint REFERENCES parents(id) ON DELETE CASCADE;
