-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.
--
-- The trust center: internal badges and certificates issued by the platform itself. Each badge rests on a check that
-- was actually run, with its date, method and evidence; a certificate can only be issued from a check that passed.
-- They are internal: never a government accreditation or a third party's certification, and the pages say so.

-- One row per run of a check. Automatic checks are run by the platform (it inspects its own configuration, database
-- or DNS); recorded ones are procedures the owner performed and documents with evidence (a reference, a link, notes).
CREATE TABLE trust_checks (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('identity', 'domain', 'code_ownership', 'admin_protection', 'backup_restore',
                                            'data_privacy', 'support', 'quality')),
  method      text NOT NULL CHECK (method IN ('automatic', 'recorded')),
  passed      boolean NOT NULL,
  summary     text NOT NULL CHECK (char_length(summary) BETWEEN 3 AND 500),
  evidence    jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 20000),
  reference   text CHECK (reference IS NULL OR char_length(reference) <= 300),
  checked_by  text NOT NULL,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  CHECK (valid_until > checked_at)
);
CREATE INDEX trust_checks_latest ON trust_checks (kind, checked_at DESC);
CREATE TRIGGER trust_checks_immutable BEFORE UPDATE OR DELETE ON trust_checks FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Internal certificates. The number is public and opens the verification page; the certificate copies the check it
-- rests on, so it reads the same even after later checks. A revoked certificate stays verifiable as revoked.
CREATE TABLE trust_certificates (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ref           text NOT NULL UNIQUE CHECK (ref ~ '^MS-[0-9]{4}-[0-9]{4}$'),
  kind          text NOT NULL,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 150),
  scope         text NOT NULL CHECK (char_length(scope) BETWEEN 10 AND 800),
  check_id      bigint NOT NULL REFERENCES trust_checks(id),
  issuer        text NOT NULL CHECK (char_length(issuer) BETWEEN 2 AND 150),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  valid_until   timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 300),
  issued_by     text NOT NULL,
  CHECK (valid_until > issued_at),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX trust_certificates_kind ON trust_certificates (kind, issued_at DESC);

CREATE TABLE trust_serials (year integer PRIMARY KEY CHECK (year BETWEEN 2000 AND 2200), last integer NOT NULL CHECK (last >= 0));

-- Domain ownership is proved by a DNS TXT record holding a token the platform generated.
ALTER TABLE platform_settings
  ADD COLUMN trust_domain       text CHECK (trust_domain IS NULL OR trust_domain ~ '^([a-z0-9-]+\.)+[a-z]{2,}$'),
  ADD COLUMN trust_domain_token text CHECK (trust_domain_token IS NULL OR trust_domain_token ~ '^[A-Za-z0-9_-]{20,64}$');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trust_checks', 'trust_certificates', 'trust_serials'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY platform_write ON %I USING (current_setting('app.platform', true) = 'on')
                    WITH CHECK (current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
-- The public trust page and certificate verification read through these definer functions only.
CREATE FUNCTION trust_public_badges() RETURNS TABLE (kind text, method text, summary text, checked_at timestamptz, valid_until timestamptz,
  certificate text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.kind, c.method, c.summary, c.checked_at, c.valid_until,
         (SELECT x.ref FROM trust_certificates x WHERE x.check_id = c.id AND x.revoked_at IS NULL AND x.valid_until > now()
           ORDER BY x.issued_at DESC LIMIT 1)
    FROM (SELECT DISTINCT ON (kind) * FROM trust_checks ORDER BY kind, checked_at DESC) c
   WHERE c.passed AND c.valid_until > now();
$$;
CREATE FUNCTION trust_verify(p_ref text) RETURNS TABLE (ref text, kind text, title text, scope text, issuer text, issued_at timestamptz,
  valid_until timestamptz, revoked_at timestamptz, revoke_reason text, check_method text, check_summary text, checked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT x.ref, x.kind, x.title, x.scope, x.issuer, x.issued_at, x.valid_until, x.revoked_at, x.revoke_reason,
         c.method, c.summary, c.checked_at
    FROM trust_certificates x JOIN trust_checks c ON c.id = x.check_id WHERE x.ref = upper(p_ref);
$$;
REVOKE ALL ON FUNCTION trust_public_badges(), trust_verify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trust_public_badges(), trust_verify(text) TO midar_app;
GRANT SELECT, INSERT ON trust_checks TO midar_app;
GRANT SELECT, INSERT, UPDATE ON trust_certificates, trust_serials TO midar_app;
