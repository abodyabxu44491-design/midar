-- One-time backup codes for the owner's second factor: for signing in when the phone with the authenticator app
-- is not at hand. Stored hashed; each works once; generating a new set replaces the old one.
CREATE TABLE owner_recovery_codes (
  code_hash  text PRIMARY KEY CHECK (char_length(code_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz
);
ALTER TABLE owner_recovery_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON owner_recovery_codes USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_recovery_codes TO midar_app;
