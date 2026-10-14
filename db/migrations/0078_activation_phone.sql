-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- School administrators sign in with their verified mobile number; no username is handed out.
ALTER TABLE users
  ADD COLUMN phone             text CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{6,20}$'),
  ADD COLUMN phone_verified_at timestamptz;
CREATE UNIQUE INDEX users_admin_phone ON users (tenant_id, phone) WHERE phone IS NOT NULL;

-- Activation now verifies the approved phone with a one-time SMS code before the password can be set.
ALTER TABLE school_activations
  ADD COLUMN phone             text,
  ADD COLUMN manager_name      text,
  ADD COLUMN phone_verified_at timestamptz,
  ADD COLUMN otp_hash          text,
  ADD COLUMN otp_channel       text CHECK (otp_channel IN ('sms', 'manual')),
  ADD COLUMN otp_expires_at    timestamptz,
  ADD COLUMN otp_attempts      int NOT NULL DEFAULT 0,
  ADD COLUMN otp_sends         int NOT NULL DEFAULT 0,
  ADD COLUMN otp_last_sent_at  timestamptz;

ALTER TABLE school_events DROP CONSTRAINT school_events_kind_check;
ALTER TABLE school_events ADD CONSTRAINT school_events_kind_check
  CHECK (kind IN ('note', 'change', 'approved', 'account', 'activation_link', 'delivery', 'password', 'status', 'activated', 'error', 'phone_verified', 'otp'));
