-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- School groups (the professional plan): one general administration that creates and follows several schools,
-- while each school keeps its own administration and data. The owner creates the group and sets its school quota.
CREATE TABLE school_groups (
  id                   text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{2,29}$'),
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 150),
  manager_name         text NOT NULL CHECK (char_length(manager_name) BETWEEN 2 AND 120),
  phone                text CHECK (char_length(phone) <= 25),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  max_schools          int NOT NULL DEFAULT 3 CHECK (max_schools BETWEEN 1 AND 100),
  extra_school_price   numeric(12,2) CHECK (extra_school_price IS NULL OR extra_school_price >= 0),
  plan_id              bigint REFERENCES plans(id) ON DELETE SET NULL,
  ends_on              date,
  username             text NOT NULL DEFAULT 'admin' CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
  password_hash        text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  failed_logins        int NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  password_changed_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER school_groups_touch BEFORE UPDATE ON school_groups FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE school_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_groups_platform ON school_groups USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON school_groups TO midar_app;

ALTER TABLE tenants ADD COLUMN group_id text REFERENCES school_groups(id) ON DELETE SET NULL;
CREATE INDEX tenants_group ON tenants (group_id) WHERE group_id IS NOT NULL;

-- Group sessions carry the group, never a school or a user.
ALTER TABLE sessions ADD COLUMN group_id text REFERENCES school_groups(id) ON DELETE CASCADE;
ALTER TABLE sessions DROP CONSTRAINT sessions_kind_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_kind_check CHECK (kind IN ('owner', 'admin', 'teacher', 'accountant', 'parent', 'group'));
ALTER TABLE sessions DROP CONSTRAINT sessions_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_check CHECK ((kind IN ('owner', 'group')) = (user_id IS NULL AND tenant_id IS NULL));
ALTER TABLE sessions ADD CONSTRAINT sessions_group_kind CHECK ((kind = 'group') = (group_id IS NOT NULL));
CREATE INDEX sessions_group ON sessions (group_id) WHERE group_id IS NOT NULL;
