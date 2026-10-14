-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- A school administrator who forgot the password verifies the registered mobile by SMS, then sets a new one.
CREATE TABLE staff_recovery (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash          text,
  otp_expires_at    timestamptz,
  otp_attempts      int NOT NULL DEFAULT 0,
  otp_sends         int NOT NULL DEFAULT 0,
  otp_last_sent_at  timestamptz,
  ticket_hash       text CHECK (ticket_hash IS NULL OR char_length(ticket_hash) = 64),
  ticket_expires_at timestamptz,
  used_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_recovery_user ON staff_recovery (tenant_id, user_id, created_at DESC);
ALTER TABLE staff_recovery ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_recovery USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON staff_recovery TO midar_app;
