-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- School managers sign in with their own Midar account (verified email + password, or Google / Apple),
-- linked to the schools they manage. The school's admin user row stays the unit of permissions;
-- the account only proves who is entering. Nothing existing is dropped (rollback = switch the feature off).
--
--   accounts            one person, platform-wide: verified email, password hash (scrypt)
--   account_identities  Google / Apple identities, matched by the provider's stable subject id
--   account_schools     which school (and which admin user in it) each account may manage
--   account_codes       one-time email codes (sign-up, password reset), stored hashed
--   oauth_states        short-lived state / nonce / PKCE verifier for Google and Apple redirects
--   mail_gateway        the platform's SMTP server (one row, password sealed with CREDENTIAL_KEY)
--   auth_providers      Google / Apple client settings (secrets sealed)

CREATE TABLE accounts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email             text NOT NULL CHECK (char_length(email) <= 160 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_verified_at timestamptz,
  password_hash     text,
  full_name         text CHECK (full_name IS NULL OR char_length(full_name) <= 120),
  disabled_at       timestamptz,
  last_login_at     timestamptz,
  password_changed_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_email ON accounts (lower(email));

CREATE TABLE account_identities (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('google', 'apple')),
  subject      text NOT NULL CHECK (char_length(subject) <= 255),
  email        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (provider, subject),
  UNIQUE (account_id, provider)
);

CREATE TABLE account_schools (
  account_id  bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_via  text NOT NULL CHECK (linked_via IN ('email', 'google', 'apple', 'password')),
  linked_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  PRIMARY KEY (account_id, tenant_id)
);
CREATE UNIQUE INDEX account_schools_user ON account_schools (user_id) WHERE revoked_at IS NULL;
CREATE INDEX account_schools_tenant ON account_schools (tenant_id);

CREATE TABLE account_codes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purpose      text NOT NULL CHECK (purpose IN ('signup', 'reset')),
  email        text NOT NULL,
  account_id   bigint REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash    text NOT NULL,
  -- sign-up only: the chosen password (hashed) and name, applied once the email is proven
  pending_hash text,
  pending_name text,
  setup_token_hash text,
  attempts     int NOT NULL DEFAULT 0,
  sends        int NOT NULL DEFAULT 1,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  ticket_hash  text,
  ticket_expires_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_codes_email ON account_codes (lower(email), purpose, created_at DESC);

CREATE TABLE oauth_states (
  state_hash   text PRIMARY KEY CHECK (char_length(state_hash) = 64),
  provider     text NOT NULL CHECK (provider IN ('google', 'apple')),
  purpose      text NOT NULL CHECK (purpose IN ('login', 'setup', 'link')),
  nonce        text NOT NULL,
  verifier     text,
  school       text,
  setup_token_hash text,
  account_id   bigint REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mail_gateway (
  id            int PRIMARY KEY CHECK (id = 1),
  enabled       boolean NOT NULL DEFAULT false,
  host          text NOT NULL DEFAULT '',
  port          int NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
  secure        boolean NOT NULL DEFAULT false,
  username      text NOT NULL DEFAULT '',
  password_sealed text,
  from_email    text NOT NULL DEFAULT '',
  from_name     text NOT NULL DEFAULT 'مدار',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO mail_gateway (id) VALUES (1);

CREATE TABLE auth_providers (
  provider      text PRIMARY KEY CHECK (provider IN ('google', 'apple')),
  enabled       boolean NOT NULL DEFAULT false,
  client_id     text NOT NULL DEFAULT '',
  team_id       text NOT NULL DEFAULT '',
  key_id        text NOT NULL DEFAULT '',
  secret_sealed text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO auth_providers (provider) VALUES ('google'), ('apple');

-- Setup links (the school link the owner sends) remember how far the manager got.
ALTER TABLE school_activations
  ADD COLUMN started_at timestamptz,
  ADD COLUMN account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN linked_at  timestamptz,
  ADD COLUMN recovery   boolean NOT NULL DEFAULT false;

-- Account sessions (who the manager is), next to the per-school admin sessions (what they may do).
ALTER TABLE sessions ADD COLUMN account_id bigint REFERENCES accounts(id) ON DELETE CASCADE;
CREATE INDEX sessions_account ON sessions (account_id) WHERE account_id IS NOT NULL;
ALTER TABLE sessions DROP CONSTRAINT sessions_kind_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_kind_check CHECK (kind IN ('owner', 'admin', 'teacher', 'accountant', 'parent', 'group', 'account'));
ALTER TABLE sessions DROP CONSTRAINT sessions_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_check CHECK ((kind IN ('owner', 'group', 'account')) = (user_id IS NULL AND tenant_id IS NULL));
ALTER TABLE sessions ADD CONSTRAINT sessions_account_kind CHECK ((kind = 'account') = (account_id IS NOT NULL));

ALTER TABLE school_events DROP CONSTRAINT school_events_kind_check;
ALTER TABLE school_events ADD CONSTRAINT school_events_kind_check
  CHECK (kind IN ('note', 'change', 'approved', 'account', 'activation_link', 'delivery', 'password', 'status', 'activated', 'error',
                  'phone_verified', 'otp', 'setup_started', 'account_linked', 'access_reset'));

-- Platform-only tables: reached through the platform scope, never from a school's scope.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts', 'account_identities', 'account_schools', 'account_codes', 'oauth_states', 'mail_gateway', 'auth_providers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY platform_only ON %I USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on')$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO midar_app', t);
  END LOOP;
END $$;
