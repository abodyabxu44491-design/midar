-- Signing in from a new device needs a code sent to the account's email; the device is then remembered
-- (a long-lived random token, stored hashed) and later sign-ins from it need only the password.
ALTER TABLE account_codes DROP CONSTRAINT account_codes_purpose_check;
ALTER TABLE account_codes ADD CONSTRAINT account_codes_purpose_check CHECK (purpose IN ('signup', 'reset', 'device'));
-- A code that was entered correctly (as opposed to one replaced by a newer code or left unused): the send limits
-- count only the unused ones, so signing in on a phone and then a laptop within a minute is not blocked.
ALTER TABLE account_codes ADD COLUMN used_at timestamptz;

CREATE TABLE account_devices (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  label        text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX account_devices_account ON account_devices (account_id) WHERE revoked_at IS NULL;
ALTER TABLE account_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON account_devices USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON account_devices TO midar_app;
