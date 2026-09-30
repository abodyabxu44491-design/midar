-- =====================================================================
-- مِدار | MIDAR — الترحيل 0042: تدقيق ربط المواد بالصفوف
--   subject_grades بلا عمود id، فيُسجَّل معرّفه في سجل العمليات «المادة:الصف».
--   الدالة نفسها من 0041 مع هذا المعرّف فقط.
-- =====================================================================

CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'password_hash' - 'initial_password_enc' - 'photo' END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'password_hash' - 'initial_password_enc' - 'photo' END;
  ip_txt text := NULLIF(current_setting('app.ip', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND (o - 'updated_at' - 'version' - 'last_login_at' - 'failed_logins' - 'locked_until')
                        = (n - 'updated_at' - 'version' - 'last_login_at' - 'failed_logins' - 'locked_until') THEN
    RETURN NULL;
  END IF;
  INSERT INTO audit_log (tenant_id, actor, action, table_name, record_id, old_data, new_data, ip)
  VALUES (COALESCE(n ->> 'tenant_id', o ->> 'tenant_id'), app_actor(), lower(TG_OP), TG_TABLE_NAME,
          COALESCE(n ->> 'id', o ->> 'id',
                   n ->> 'exam_id' || ':' || (n ->> 'student_id'), o ->> 'exam_id' || ':' || (o ->> 'student_id'),
                   n ->> 'subject_id' || ':' || (n ->> 'grade_id'), o ->> 'subject_id' || ':' || (o ->> 'grade_id')),
          o, n, ip_txt::inet);
  RETURN NULL;
END $$;

CREATE TRIGGER subject_grades_audit AFTER INSERT OR UPDATE OR DELETE ON subject_grades
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
