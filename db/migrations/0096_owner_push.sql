-- Phone notifications for the platform owner: the owner's devices that allowed notifications, and how far the
-- notifications have gone (the last security alert and the last request already sent), so each is sent once.
-- Additive only: two new tables, nothing existing is changed.
CREATE TABLE owner_push_subscriptions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint     text NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND char_length(endpoint) <= 1000),
  p256dh       text NOT NULL CHECK (char_length(p256dh) BETWEEN 40 AND 200),
  auth         text NOT NULL CHECK (char_length(auth) BETWEEN 10 AND 100),
  user_agent   text CHECK (char_length(user_agent) <= 300),
  failures     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz
);
ALTER TABLE owner_push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON owner_push_subscriptions USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_push_subscriptions TO midar_app;

CREATE TABLE owner_push_cursor (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_alert_id bigint NOT NULL DEFAULT 0,
  last_lead_id  bigint NOT NULL DEFAULT 0
);
-- Start from now: nothing that happened before this migration is sent.
INSERT INTO owner_push_cursor (id, last_alert_id, last_lead_id)
VALUES (1, COALESCE((SELECT max(id) FROM security_alerts), 0), COALESCE((SELECT max(id) FROM leads), 0));
ALTER TABLE owner_push_cursor ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON owner_push_cursor USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, UPDATE ON owner_push_cursor TO midar_app;
