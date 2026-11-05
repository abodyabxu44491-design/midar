-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.
--
-- The platform's official identity and contact details, entered by the owner (nothing is shown until it is filled in),
-- and the inquiries the platform receives from the site's forms or by email, each with its status and a log of what
-- was done about it.

ALTER TABLE platform_settings
  ADD COLUMN site_url          text CHECK (site_url IS NULL OR site_url ~ '^https://[a-z0-9.-]+\.[a-z]{2,}$'),
  ADD COLUMN email_info        text CHECK (email_info IS NULL OR email_info ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  ADD COLUMN email_support     text CHECK (email_support IS NULL OR email_support ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  ADD COLUMN email_sales       text CHECK (email_sales IS NULL OR email_sales ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  ADD COLUMN email_admin       text CHECK (email_admin IS NULL OR email_admin ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  ADD COLUMN founded_year      integer CHECK (founded_year IS NULL OR founded_year BETWEEN 1990 AND 2100),
  ADD COLUMN social_links      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(social_links) = 'object' AND octet_length(social_links::text) <= 2000),
  ADD COLUMN about_summary     text CHECK (about_summary IS NULL OR char_length(about_summary) <= 600),
  ADD COLUMN about_audience    text CHECK (about_audience IS NULL OR char_length(about_audience) <= 400),
  ADD COLUMN services_upcoming text CHECK (services_upcoming IS NULL OR char_length(services_upcoming) <= 1500),
  ADD COLUMN inquiry_notify    boolean NOT NULL DEFAULT true;

CREATE TABLE inquiries (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel      text NOT NULL CHECK (channel IN ('form', 'email')),
  kind         text NOT NULL CHECK (kind IN ('general', 'support', 'sales', 'complaint', 'admin', 'other')),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  email        text CHECK (email IS NULL OR (char_length(email) <= 200 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$')),
  phone        text CHECK (phone IS NULL OR phone ~ '^[0-9+ ]{6,20}$'),
  organization text CHECK (organization IS NULL OR char_length(organization) <= 150),
  subject      text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 200),
  body         text NOT NULL CHECK (char_length(body) BETWEEN 5 AND 10000),
  to_address   text CHECK (to_address IS NULL OR char_length(to_address) <= 200),
  message_id   text UNIQUE CHECK (message_id IS NULL OR char_length(message_id) <= 300),
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'replied', 'closed')),
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX inquiries_open ON inquiries (status, id DESC);
CREATE INDEX inquiries_ip ON inquiries (ip, created_at DESC);
CREATE TRIGGER inquiries_touch BEFORE UPDATE ON inquiries FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- What was done about an inquiry: received, status changes, notes, replies. Kept as it happened.
CREATE TABLE inquiry_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inquiry_id bigint NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('received', 'status', 'note', 'reply', 'notify')),
  body       text CHECK (body IS NULL OR char_length(body) <= 10000),
  actor      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inquiry_events_of ON inquiry_events (inquiry_id, id);
CREATE TRIGGER inquiry_events_immutable BEFORE UPDATE ON inquiry_events FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiry_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON inquiries USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
CREATE POLICY platform_only ON inquiry_events USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON inquiries TO midar_app;
GRANT SELECT, INSERT, DELETE ON inquiry_events TO midar_app;

-- A visitor's message from a site form. It cannot read anything back, and one address can send a few per hour.
CREATE FUNCTION submit_inquiry(p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id bigint; addr inet := NULLIF(current_setting('app.ip', true), '')::inet;
BEGIN
  IF addr IS NOT NULL AND (SELECT count(*) FROM inquiries WHERE ip = addr AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'وصلتنا رسائلك. سنرد عليك قريبًا، ويمكنك المتابعة بعد ساعة.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM inquiries WHERE created_at > now() - interval '10 minutes' AND channel = 'form') >= 60 THEN
    RAISE EXCEPTION 'نستقبل رسائل كثيرة الآن. حاول بعد دقائق.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM inquiries WHERE md5(body) = md5(p ->> 'body') AND created_at > now() - interval '1 day') THEN
    RAISE EXCEPTION 'وصلتنا هذه الرسالة من قبل، وسنرد عليها.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO inquiries (channel, kind, name, email, phone, organization, subject, body, ip)
  VALUES ('form', p ->> 'kind', p ->> 'name', NULLIF(p ->> 'email', ''), NULLIF(p ->> 'phone', ''), NULLIF(p ->> 'organization', ''),
          p ->> 'subject', p ->> 'body', addr)
  RETURNING id INTO new_id;
  INSERT INTO inquiry_events (inquiry_id, kind, body, actor) VALUES (new_id, 'received', 'من نموذج الموقع', 'الموقع');
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION submit_inquiry(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_inquiry(jsonb) TO midar_app;

-- New inquiries reach the owner's devices like new requests do.
ALTER TABLE owner_push_cursor ADD COLUMN last_inquiry_id bigint NOT NULL DEFAULT 0;
UPDATE owner_push_cursor SET last_inquiry_id = 0;
