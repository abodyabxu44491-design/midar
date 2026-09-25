-- =====================================================================
-- مِدار | MIDAR — الترحيل 0026: طلبات تغيير كلمة المرور
--
--   المسار: المستخدم يطلب ← إدارة المدرسة تتحقق وتحيل ← مالك المنصة يعتمد
--   ← يُنشأ رابط مؤقت يُستخدم مرة واحدة ← تُنهى جلسات الحساب.
--   لا تُخزَّن كلمات المرور ولا الرموز نصًا: يُحفظ تجزئة الرمز فقط.
-- =====================================================================

CREATE TABLE password_requests (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ref              text NOT NULL UNIQUE,                -- رقم مرجعي يُعطى للمستخدم
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id          bigint,                              -- يُربط عند التحقق
  full_name        text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  username         text NOT NULL CHECK (char_length(username) BETWEEN 2 AND 120),
  phone            text NOT NULL CHECK (phone ~ '^[0-9+ ]{6,20}$'),
  branch           text CHECK (char_length(branch) <= 120),
  job_title        text NOT NULL CHECK (job_title IN ('admin', 'accountant', 'teacher')),
  description      text NOT NULL CHECK (char_length(description) BETWEEN 5 AND 600),
  contact_pref     text NOT NULL DEFAULT 'phone' CHECK (contact_pref IN ('phone', 'whatsapp', 'email')),
  status           text NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'referred', 'approved', 'used', 'rejected', 'expired')),
  admin_note       text CHECK (char_length(admin_note) <= 400),
  owner_note       text CHECK (char_length(owner_note) <= 400),
  reviewed_by      text,                                -- الإداري الذي راجع
  approved_by      text,                                -- المالك الذي اعتمد
  token_hash       text,                                -- تجزئة رابط التغيير (لا يُخزَّن الرمز)
  token_expires_at timestamptz,
  used_at          timestamptz,
  ip               inet,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'approved' OR token_hash IS NOT NULL)
);
CREATE INDEX password_requests_status ON password_requests (status, id DESC);
CREATE INDEX password_requests_tenant ON password_requests (tenant_id, id DESC);
CREATE UNIQUE INDEX password_requests_token ON password_requests (token_hash) WHERE token_hash IS NOT NULL;

CREATE TRIGGER password_requests_touch BEFORE UPDATE ON password_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- سجل تدقيق بلا رموز: نسجّل الحالة والملاحظات فقط
CREATE FUNCTION password_requests_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO audit_log (tenant_id, actor, action, table_name, record_id, old_data, new_data, ip)
  VALUES (COALESCE(NEW.tenant_id, OLD.tenant_id), app_actor(),
          lower(TG_OP), 'password_requests', COALESCE(NEW.id, OLD.id)::text,
          CASE WHEN TG_OP = 'INSERT' THEN NULL
               ELSE jsonb_build_object('status', OLD.status, 'admin_note', OLD.admin_note, 'owner_note', OLD.owner_note) END,
          jsonb_build_object('ref', COALESCE(NEW.ref, OLD.ref), 'status', COALESCE(NEW.status, OLD.status),
                             'username', COALESCE(NEW.username, OLD.username),
                             'reviewed_by', NEW.reviewed_by, 'approved_by', NEW.approved_by),
          NULLIF(current_setting('app.ip', true), '')::inet);
  RETURN NULL;
END $$;
CREATE TRIGGER password_requests_audit AFTER INSERT OR UPDATE OR DELETE ON password_requests
  FOR EACH ROW EXECUTE FUNCTION password_requests_audit();

ALTER TABLE password_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform ON password_requests
  USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE ON password_requests TO midar_app;

-- إرسال الطلب من صفحة الدخول (بدون جلسة): 3 طلبات لكل جهاز يوميًا
CREATE FUNCTION submit_password_request(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text := app_tenant(); new_ref text;
BEGIN
  IF t IS NULL THEN RAISE EXCEPTION 'لا توجد مدرسة محددة' USING ERRCODE = 'P0001'; END IF;
  IF (SELECT count(*) FROM password_requests WHERE tenant_id = t
        AND ip = NULLIF(current_setting('app.ip', true), '')::inet
        AND created_at > now() - interval '1 day') >= 3 THEN
    RAISE EXCEPTION 'وصلنا طلبك مسبقًا. ستتواصل معك إدارة المدرسة.' USING ERRCODE = 'P0001';
  END IF;
  new_ref := 'PR-' || to_char(now(), 'YYMM') || '-' || upper(substr(md5(random()::text), 1, 5));
  INSERT INTO password_requests (ref, tenant_id, full_name, username, phone, branch, job_title,
      description, contact_pref, ip)
  VALUES (new_ref, t, p ->> 'full_name', p ->> 'username', p ->> 'phone', p ->> 'branch',
          p ->> 'job_title', p ->> 'description', COALESCE(p ->> 'contact_pref', 'phone'),
          NULLIF(current_setting('app.ip', true), '')::inet);
  RETURN new_ref;
END $$;
GRANT EXECUTE ON FUNCTION submit_password_request(jsonb) TO midar_app;
