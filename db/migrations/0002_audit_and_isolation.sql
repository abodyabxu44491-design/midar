-- =====================================================================
-- مِدار | MIDAR — الترحيل 0002: سجل التدقيق + عزل المدارس داخل قاعدة البيانات
--
-- 1) سجل تدقيق تلقائي: أي إضافة أو تعديل أو حذف يُسجَّل مع القيم القديمة والجديدة.
-- 2) أمان الصفوف (RLS): مستخدم التطبيق لا يرى إلا صفوف المدرسة المحددة في الجلسة،
--    حتى لو وُجد خطأ برمجي في الكود.
-- 3) صلاحيات دنيا: مستخدم التطبيق لا يستطيع حذف الطلاب أو الفواتير أو المدفوعات أو السجل.
-- =====================================================================

-- ---------- سجل التدقيق ----------
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text,                         -- NULL = عمليات المنصة
  actor       text NOT NULL,
  action      text NOT NULL,
  table_name  text,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant ON audit_log (tenant_id, id DESC);

CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- تسجيل تلقائي لأي تغيير في جداول المدرسة (بدون كلمات المرور)
CREATE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'password_hash' END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'password_hash' END;
  ip_txt text := NULLIF(current_setting('app.ip', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND (o - 'updated_at' - 'version' - 'last_login_at' - 'failed_logins' - 'locked_until')
                        = (n - 'updated_at' - 'version' - 'last_login_at' - 'failed_logins' - 'locked_until') THEN
    RETURN NULL; -- لا تغيير حقيقي (مثل تحديث وقت آخر دخول)
  END IF;
  INSERT INTO audit_log (tenant_id, actor, action, table_name, record_id, old_data, new_data, ip)
  VALUES (COALESCE(n ->> 'tenant_id', o ->> 'tenant_id'), app_actor(), lower(TG_OP), TG_TABLE_NAME,
          COALESCE(n ->> 'id', o ->> 'id', n ->> 'exam_id' || ':' || (n ->> 'student_id'), o ->> 'exam_id' || ':' || (o ->> 'student_id')),
          o, n, ip_txt::inet);
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','classes','subjects','teachers','users','teacher_assignments','students',
                           'attendance','exams','scores','invoices','payments','announcements']
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t || '_audit', t);
  END LOOP;
END $$;

-- ---------- أمان الصفوف (عزل المدارس) ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_counters','classes','subjects','teachers','users','teacher_assignments','students',
                           'attendance','exams','scores','invoices','payments','announcements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_log FOR SELECT USING (
  tenant_id = app_tenant()
  OR (tenant_id IS NULL AND current_setting('app.platform', true) = 'on')
);
CREATE POLICY audit_write ON audit_log FOR INSERT WITH CHECK (
  tenant_id = app_tenant()
  OR (tenant_id IS NULL AND current_setting('app.platform', true) = 'on')
);

-- ---------- دوال المنصة (أعداد فقط، بدون أي بيانات طلاب) ----------
CREATE FUNCTION platform_tenant_usage()
RETURNS TABLE (tenant_id text, students bigint, teachers bigint, open_sessions bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id,
    (SELECT count(*) FROM students s WHERE s.tenant_id = t.id AND s.archived_at IS NULL),
    (SELECT count(*) FROM teachers x WHERE x.tenant_id = t.id),
    (SELECT count(*) FROM sessions z WHERE z.tenant_id = t.id AND z.expires_at > now())
  FROM tenants t
$$;

-- رقم متسلسل آمن لكل مدرسة (إيصالات)
CREATE FUNCTION next_counter(p_name text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO tenant_counters (tenant_id, name, value) VALUES (app_tenant(), p_name, 1)
  ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_counters.value + 1
  RETURNING value INTO v;
  RETURN v;
END $$;

-- ---------- الصلاحيات الدنيا لمستخدم التطبيق ----------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO midar_app;

GRANT SELECT, INSERT, UPDATE ON tenants, tenant_counters, classes, subjects, teachers, users,
  students, attendance, exams, scores, invoices, announcements TO midar_app;
GRANT SELECT, INSERT ON payments, security_events TO midar_app;           -- الدفعات لا تُعدل
GRANT SELECT, INSERT ON audit_log TO midar_app;                          -- السجل لا يُعدل ولا يُحذف
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO midar_app;
GRANT SELECT, INSERT, DELETE ON teacher_assignments TO midar_app;
GRANT DELETE ON classes, subjects, teachers, announcements TO midar_app; -- مقيدة بالمفاتيح الأجنبية
GRANT DELETE ON scores TO midar_app;
GRANT DELETE ON security_events TO midar_app;

GRANT EXECUTE ON FUNCTION app_tenant(), app_actor(), invoice_net_paid(bigint), platform_tenant_usage(), next_counter(text) TO midar_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO midar_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO midar_app;
