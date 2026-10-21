-- Owner account security and security alerts.
--
-- 1) The owner's second factor (TOTP) can be enrolled from the owner sign-in screen itself: the secret is stored
--    encrypted (AES-GCM with CREDENTIAL_KEY, outside the database). Sign-in without a second factor is no longer
--    possible: until one exists, a correct password only opens the enrollment step, never a session.
-- 2) Security alerts the owner sees and is notified of: repeated failed sign-ins, attempts to reach another
--    school's records, large deletions, large exports, owner sign-ins from a new device. Any connection may raise
--    an alert through raise_security_alert(); only the platform (owner) context can read or acknowledge them.
CREATE TABLE owner_security (
  id               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  totp_enc         text,
  enrolled_at      timestamptz,
  pending_enc      text,
  pending_hash     text,
  pending_expires  timestamptz
);
INSERT INTO owner_security (id) VALUES (1);
ALTER TABLE owner_security ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON owner_security USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, UPDATE ON owner_security TO midar_app;

-- Devices the owner signed in from (hash of the browser and network), to tell a new device from a known one.
CREATE TABLE owner_devices (
  fingerprint   text PRIMARY KEY CHECK (char_length(fingerprint) = 64),
  label         text,
  ip            text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE owner_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON owner_devices USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_devices TO midar_app;

CREATE TABLE security_alerts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  severity    text NOT NULL CHECK (severity IN ('high', 'medium', 'info')),
  kind        text NOT NULL CHECK (char_length(kind) <= 60),
  title       text NOT NULL CHECK (char_length(title) <= 200),
  detail      text CHECK (char_length(detail) <= 1000),
  tenant_id   text,
  seen_at     timestamptz,
  emailed_at  timestamptz
);
CREATE INDEX security_alerts_recent ON security_alerts (created_at DESC);
CREATE INDEX security_alerts_unseen ON security_alerts (id) WHERE seen_at IS NULL;
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON security_alerts USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, UPDATE ON security_alerts TO midar_app;

-- Raising an alert works from any context (a school's own transaction included), but cannot read alerts.
-- The same alert kind for the same school is raised at most once every 10 minutes, so a burst stays one alert.
CREATE FUNCTION raise_security_alert(p_kind text, p_severity text, p_title text, p_detail text, p_tenant text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM security_alerts WHERE kind = p_kind AND tenant_id IS NOT DISTINCT FROM p_tenant
             AND created_at > now() - interval '10 minutes') THEN
    RETURN;
  END IF;
  INSERT INTO security_alerts (kind, severity, title, detail, tenant_id)
  VALUES (left(p_kind, 60), p_severity, left(p_title, 200), left(p_detail, 1000), p_tenant);
END $$;
REVOKE ALL ON FUNCTION raise_security_alert(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION raise_security_alert(text, text, text, text, text) TO midar_app;

-- Large deletions: one statement removing 50 or more rows from a core table raises an alert (planned operations
-- such as the danger zone raise it too, which is intended: the owner sees every large removal).
CREATE FUNCTION alert_mass_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; t text;
BEGIN
  -- A removal the platform itself plans (records set aside for a holiday) marks its transaction and is not alarming.
  IF current_setting('app.planned_delete', true) = 'on' THEN RETURN NULL; END IF;
  SELECT count(*), min(tenant_id::text) INTO n, t FROM old_rows;
  IF n >= 50 THEN
    PERFORM raise_security_alert('mass_delete:' || TG_TABLE_NAME, 'high',
      'حذف كمية كبيرة من السجلات', format('حُذف %s سجلًا من جدول %s دفعة واحدة', n, TG_TABLE_NAME), t);
  END IF;
  RETURN NULL;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['students', 'scores', 'attendance', 'exams', 'invoices', 'teachers', 'users', 'grades', 'certificates', 'parents'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION alert_mass_delete()',
      t || '_mass_delete_alert', t);
  END LOOP;
END $$;

-- The danger zone treats security alerts as a log (like the audit log): never removed with a school's data.
CREATE OR REPLACE FUNCTION danger_tables() RETURNS TABLE (name text, depth int, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE t AS (
    SELECT c.table_name::text AS name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name NOT IN ('danger_operations', 'tenant_backups')
  ), fk AS (
    SELECT DISTINCT k.conrelid::regclass::text AS child, k.confrelid::regclass::text AS parent
      FROM pg_constraint k WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace
       AND k.conrelid <> k.confrelid
       AND k.conrelid::regclass::text IN (SELECT name FROM t) AND k.confrelid::regclass::text IN (SELECT name FROM t)
  ), d AS (
    SELECT name, 0 AS depth FROM t
    UNION ALL
    SELECT fk.child, d.depth + 1 FROM d JOIN fk ON fk.parent = d.name WHERE d.depth < 50
  )
  SELECT name, max(depth)::int,
         CASE WHEN name IN ('account_schools') THEN 'access'
              WHEN name IN ('audit_log', 'security_events', 'sms_messages', 'ai_queries', 'notification_deliveries',
                            'attendance_events', 'attendance_audit', 'security_alerts') THEN 'log'
              WHEN name IN ('sessions', 'sync_changes', 'sync_devices', 'sync_operations', 'password_requests', 'push_subscriptions',
                            'notification_prefs', 'gate_devices') THEN 'transient'
              WHEN name IN ('subscriptions', 'subscription_events', 'subscription_invoices', 'tenant_prices', 'renewal_requests', 'leads', 'sms_ledger') THEN 'billing'
              ELSE 'data' END
    FROM d GROUP BY name;
$$;
