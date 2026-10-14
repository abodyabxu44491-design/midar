-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- A permanent file for every school: the registration data stays with the school after approval and can be edited.
ALTER TABLE tenants
  ADD COLUMN profile     jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN lead_id     bigint,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by text,
  ADD COLUMN activated_at timestamptz;

-- Creating a school from a request is guarded so a double click cannot create two schools; a failure is kept for retry.
ALTER TABLE leads
  ADD COLUMN converting_at timestamptz,
  ADD COLUMN last_error    text CHECK (last_error IS NULL OR char_length(last_error) <= 500);

-- Activation links: the school's administrator opens the link and sets their own password. Only the hash is used for
-- lookup; the link itself is kept encrypted so the owner can show the same valid link again until it is used or replaced.
CREATE TABLE school_activations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  token_enc   text,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX school_activations_tenant ON school_activations (tenant_id, created_at DESC);
ALTER TABLE school_activations ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_activations_platform ON school_activations USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE ON school_activations TO midar_app;

-- Everything that happens to a school file: notes, edits, approval, links, deliveries (with their real outcome).
CREATE TABLE school_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('note', 'change', 'approved', 'account', 'activation_link', 'delivery', 'password', 'status', 'activated', 'error')),
  channel    text CHECK (channel IN ('email', 'whatsapp', 'copy', 'pdf', 'manual')),
  recipient  text CHECK (recipient IS NULL OR char_length(recipient) <= 160),
  status     text CHECK (status IN ('sent', 'failed', 'pending')),
  error      text CHECK (error IS NULL OR char_length(error) <= 500),
  body       text CHECK (body IS NULL OR char_length(body) <= 2000),
  meta       jsonb NOT NULL DEFAULT '{}',
  actor      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'delivery' OR (channel IS NOT NULL AND status IS NOT NULL))
);
CREATE INDEX school_events_tenant ON school_events (tenant_id, created_at DESC);
CREATE INDEX school_events_delivery ON school_events (tenant_id, created_at DESC) WHERE kind = 'delivery';
ALTER TABLE school_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_events_platform ON school_events USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE ON school_events TO midar_app;

-- Public activation: check a link and apply the new password, without exposing anything else.
CREATE FUNCTION school_activation_check(p_hash text)
RETURNS TABLE (school text, school_id text, username text, full_name text, expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.name, t.id, u.username, u.full_name, a.expires_at
    FROM school_activations a JOIN tenants t ON t.id = a.tenant_id JOIN users u ON u.id = a.user_id
   WHERE a.token_hash = p_hash AND a.used_at IS NULL AND a.revoked_at IS NULL AND a.expires_at > now() AND u.is_active
$$;
REVOKE ALL ON FUNCTION school_activation_check(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION school_activation_check(text) TO midar_app;

CREATE FUNCTION school_activation_apply(p_hash text, p_password_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM school_activations WHERE token_hash = p_hash FOR UPDATE;
  IF NOT FOUND OR a.used_at IS NOT NULL OR a.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'رابط التفعيل غير صحيح أو استُخدم مسبقًا. اطلب رابطًا جديدًا من إدارة مدار.' USING ERRCODE = 'P0002';
  END IF;
  IF a.expires_at < now() THEN RAISE EXCEPTION 'انتهت صلاحية رابط التفعيل. اطلب رابطًا جديدًا من إدارة مدار.' USING ERRCODE = 'P0001'; END IF;
  UPDATE users SET password_hash = p_password_hash, must_change_password = false, initial_password_enc = NULL,
         failed_logins = 0, locked_until = NULL, password_changed_at = now()
   WHERE id = a.user_id;
  DELETE FROM sessions WHERE user_id = a.user_id;
  UPDATE school_activations SET used_at = now(), token_enc = NULL WHERE id = a.id;
  UPDATE tenants SET activated_at = COALESCE(activated_at, now()) WHERE id = a.tenant_id;
  INSERT INTO school_events (tenant_id, kind, body, actor) VALUES (a.tenant_id, 'activated', 'عيّن مدير المدرسة كلمة المرور من رابط التفعيل', 'مدير المدرسة');
  RETURN a.tenant_id;
END $$;
REVOKE ALL ON FUNCTION school_activation_apply(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION school_activation_apply(text, text) TO midar_app;

-- Existing schools keep the data of the request they came from.
UPDATE tenants t SET lead_id = l.id, approved_at = COALESCE(t.approved_at, t.created_at),
       profile = jsonb_strip_nulls(jsonb_build_object(
         'contact_name', l.contact_name, 'phone', l.phone, 'email', l.email, 'city', l.city,
         'students_count', l.students_count, 'note', l.note)) || COALESCE(l.details, '{}')
  FROM (SELECT DISTINCT ON (tenant_id) * FROM leads WHERE tenant_id IS NOT NULL AND kind IN ('trial', 'subscription', 'contact')
         ORDER BY tenant_id, id) l
 WHERE l.tenant_id = t.id AND t.lead_id IS NULL;
UPDATE tenants t SET activated_at = u.first_login
  FROM (SELECT tenant_id, min(last_login_at) AS first_login FROM users WHERE role = 'admin' AND last_login_at IS NOT NULL GROUP BY tenant_id) u
 WHERE u.tenant_id = t.id AND t.activated_at IS NULL;
