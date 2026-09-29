-- =====================================================================
-- مِدار | MIDAR — الترحيل 0041: عرض بيانات الدخول الأولية للمعلم ما دام لم يغيّرها
--   كلمة المرور المؤقتة تُحفظ مشفّرة (AES-256-GCM بمفتاح خارج قاعدة البيانات CREDENTIAL_KEY)
--   في عمود منفصل، وتُمسح تلقائيًا من القاعدة نفسها فور تغيير كلمة المرور بأي طريقة.
--   password_hash يبقى الأصل الوحيد للتحقق، ولا يُخزَّن أي نص صريح.
-- =====================================================================

ALTER TABLE users
  ADD COLUMN initial_password_enc text CHECK (initial_password_enc IS NULL OR char_length(initial_password_enc) <= 400);

-- أي تغيير لكلمة المرور (المعلم، الاستعادة، الإدارة) يمسح النسخة المؤقتة ما لم يضع الأمر نفسه نسخة جديدة.
CREATE FUNCTION users_clear_initial_password() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.initial_password_enc IS NOT NULL
     AND NEW.initial_password_enc IS NOT DISTINCT FROM OLD.initial_password_enc
     AND (NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.must_change_password = false) THEN
    NEW.initial_password_enc := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_clear_initial_password BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_clear_initial_password();

-- سجل التدقيق يحفظ لقطة كاملة من الصف: نستثني الأسرار (password_hash، initial_password_enc) والصور.
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
          COALESCE(n ->> 'id', o ->> 'id', n ->> 'exam_id' || ':' || (n ->> 'student_id'), o ->> 'exam_id' || ':' || (o ->> 'student_id')),
          o, n, ip_txt::inet);
  RETURN NULL;
END $$;
