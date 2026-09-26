-- =====================================================================
-- مِدار | MIDAR — الترحيل 0036: مسار طلب «نسيت كلمة المرور» حسب دور الحساب
--
--   المعلم والمحاسب ← إدارة المدرسة تعتمد وتُصدر الرابط (المالك لا يدخل)
--   مدير المدرسة    ← مالك المنصة مباشرة (لا تعتمد الإدارة إعادة كلمة مرور حساب إداري)
--
-- المسار يُحدَّد بالدور الفعلي للحساب في قاعدة البيانات، وليس بالمسمى الذي يكتبه صاحب الطلب:
-- من يطلب إعادة كلمة مرور حساب إداري مدّعيًا أنه «معلم» يذهب طلبه للمالك ولا يصل لاعتماد الإدارة.
-- =====================================================================
ALTER TABLE password_requests
  ADD COLUMN route        text NOT NULL DEFAULT 'school' CHECK (route IN ('school', 'owner')),
  ADD COLUMN account_role text CHECK (account_role IN ('admin', 'teacher', 'accountant'));

-- الطلبات السابقة: ربطها بحساباتها، والمحال منها للمالك أو الخاص بحساب إداري يبقى عند المالك
UPDATE password_requests r SET account_role = u.role, user_id = COALESCE(r.user_id, u.id)
  FROM users u WHERE u.tenant_id = r.tenant_id AND u.username = lower(trim(r.username));
UPDATE password_requests SET route = 'owner' WHERE status = 'referred' OR account_role = 'admin';
CREATE INDEX password_requests_route ON password_requests (tenant_id, route, status);

CREATE OR REPLACE FUNCTION submit_password_request(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text := app_tenant(); new_ref text; u record;
BEGIN
  IF t IS NULL THEN RAISE EXCEPTION 'لا توجد مدرسة محددة' USING ERRCODE = 'P0001'; END IF;
  IF (SELECT count(*) FROM password_requests WHERE tenant_id = t
        AND ip = NULLIF(current_setting('app.ip', true), '')::inet
        AND created_at > now() - interval '1 day') >= 3 THEN
    RAISE EXCEPTION 'وصلنا طلبك مسبقًا. سيتم التواصل معك قريبًا.' USING ERRCODE = 'P0001';
  END IF;
  -- الحساب الفعلي (إن وُجد) يحدد من يعتمد الطلب. لا يُكشف لصاحب الطلب وجود الحساب أو دوره.
  SELECT id, role INTO u FROM users WHERE tenant_id = t AND username = lower(trim(p ->> 'username'));
  new_ref := 'PR-' || to_char(now(), 'YYMM') || '-' || upper(substr(md5(random()::text), 1, 5));
  INSERT INTO password_requests (ref, tenant_id, full_name, username, phone, branch, job_title,
      description, contact_pref, ip, user_id, account_role, route)
  VALUES (new_ref, t, p ->> 'full_name', p ->> 'username', p ->> 'phone', p ->> 'branch',
          p ->> 'job_title', p ->> 'description', COALESCE(p ->> 'contact_pref', 'phone'),
          NULLIF(current_setting('app.ip', true), '')::inet,
          u.id, u.role, CASE WHEN u.role = 'admin' THEN 'owner' ELSE 'school' END);
  RETURN new_ref;
END $$;

-- رسالة انتهاء الرابط: محايدة (قد يكون المعتمد الإدارة أو المالك حسب الحساب)
CREATE OR REPLACE FUNCTION password_reset_check(p_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT id, ref, status, token_expires_at INTO r FROM password_requests WHERE token_hash = p_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'الرابط غير صحيح أو استُخدم مسبقًا' USING ERRCODE = 'P0002'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'هذا الرابط لم يعد صالحًا' USING ERRCODE = 'P0001'; END IF;
  IF r.token_expires_at < now() THEN
    UPDATE password_requests SET status = 'expired' WHERE id = r.id;
    RAISE EXCEPTION 'انتهت صلاحية الرابط. اطلب رابطًا جديدًا من صفحة «نسيت كلمة المرور».' USING ERRCODE = 'P0001';
  END IF;
  RETURN r.ref;
END $$;
