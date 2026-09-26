-- صفحة تغيير كلمة المرور تُفتح بلا جلسة، فتحتاج دوال محدودة الصلاحية
-- تعمل بالرمز المجزّأ فقط ولا تكشف أي بيانات أخرى.

CREATE FUNCTION password_reset_check(p_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT id, ref, status, token_expires_at INTO r FROM password_requests WHERE token_hash = p_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'الرابط غير صحيح أو استُخدم مسبقًا' USING ERRCODE = 'P0002'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'هذا الرابط لم يعد صالحًا' USING ERRCODE = 'P0001'; END IF;
  IF r.token_expires_at < now() THEN
    UPDATE password_requests SET status = 'expired' WHERE id = r.id;
    RAISE EXCEPTION 'انتهت صلاحية الرابط. اطلب رابطًا جديدًا من إدارة المدرسة.' USING ERRCODE = 'P0001';
  END IF;
  RETURN r.ref;
END $$;
GRANT EXECUTE ON FUNCTION password_reset_check(text) TO midar_app;

-- التنفيذ: يغيّر كلمة المرور، ينهي جلسات الحساب، ويُبطل الرابط نهائيًا
CREATE FUNCTION password_reset_apply(p_hash text, p_password_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT id, ref, user_id, status, token_expires_at INTO r
    FROM password_requests WHERE token_hash = p_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الرابط غير صحيح أو استُخدم مسبقًا' USING ERRCODE = 'P0002'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'هذا الرابط لم يعد صالحًا' USING ERRCODE = 'P0001'; END IF;
  IF r.token_expires_at < now() THEN
    UPDATE password_requests SET status = 'expired' WHERE id = r.id;
    RAISE EXCEPTION 'انتهت صلاحية الرابط' USING ERRCODE = 'P0001';
  END IF;

  UPDATE users SET password_hash = p_password_hash, must_change_password = false,
      failed_logins = 0, locked_until = NULL, password_changed_at = now()
    WHERE id = r.user_id;
  DELETE FROM sessions WHERE user_id = r.user_id;
  UPDATE password_requests SET status = 'used', used_at = now(), token_hash = NULL, token_expires_at = NULL
    WHERE id = r.id;
  RETURN r.ref;
END $$;
GRANT EXECUTE ON FUNCTION password_reset_apply(text, text) TO midar_app;
