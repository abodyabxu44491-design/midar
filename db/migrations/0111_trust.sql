-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.
--
-- Trust on the public site: reviews that can be checked, and certifications only when they can be verified.

-- Reviews: who agreed to publication and when, which service the school uses, and a fingerprint of the text so the
-- same review cannot be published twice. A school that is a customer (tenant_id) has at most one published review.
ALTER TABLE testimonials
  ADD COLUMN service_used text CHECK (service_used IS NULL OR char_length(service_used) BETWEEN 2 AND 120),
  ADD COLUMN consent_by   text CHECK (consent_by IS NULL OR char_length(consent_by) BETWEEN 2 AND 120),
  ADD COLUMN consent_at   date CHECK (consent_at IS NULL OR consent_at <= CURRENT_DATE + 1),
  ADD COLUMN body_hash    text GENERATED ALWAYS AS (md5(lower(regexp_replace(btrim(body), '\s+', ' ', 'g')))) STORED;
-- New publications need the consent recorded; reviews published before this keep showing (the owner panel flags them).
ALTER TABLE testimonials ADD CONSTRAINT testimonials_consent_recorded
  CHECK (status <> 'approved' OR (consent AND consent_by IS NOT NULL AND consent_at IS NOT NULL)) NOT VALID;
CREATE UNIQUE INDEX testimonials_one_per_school ON testimonials (tenant_id) WHERE status = 'approved' AND tenant_id IS NOT NULL;
CREATE UNIQUE INDEX testimonials_no_duplicate ON testimonials (body_hash) WHERE status <> 'hidden';

-- A visitor can report a published review as incorrect. Reports are seen by the owner only.
CREATE TABLE testimonial_reports (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  testimonial_id bigint NOT NULL REFERENCES testimonials(id) ON DELETE CASCADE,
  reason         text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  contact        text CHECK (contact IS NULL OR char_length(contact) <= 120),
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolution     text CHECK (resolution IS NULL OR char_length(resolution) <= 300)
);
CREATE INDEX testimonial_reports_open ON testimonial_reports (testimonial_id) WHERE resolved_at IS NULL;
ALTER TABLE testimonial_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON testimonial_reports USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, UPDATE, DELETE ON testimonial_reports TO midar_app;

-- The one way the public adds a report: only on a published review, at most one per address per review a day, and at
-- most 20 a day from one address.
CREATE FUNCTION report_testimonial(p_id bigint, p_reason text, p_contact text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ip_ inet := NULLIF(current_setting('app.ip', true), '')::inet;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM testimonials WHERE id = p_id AND status = 'approved' AND consent) THEN
    RAISE EXCEPTION 'التقييم غير موجود' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM testimonial_reports WHERE testimonial_id = p_id AND ip = ip_ AND created_at > now() - interval '1 day')
     OR (SELECT count(*) FROM testimonial_reports WHERE ip = ip_ AND created_at > now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION 'وصلنا بلاغك، وسنراجعه.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO testimonial_reports (testimonial_id, reason, contact, ip) VALUES (p_id, p_reason, NULLIF(p_contact, ''), ip_);
END $$;
REVOKE ALL ON FUNCTION report_testimonial(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_testimonial(bigint, text, text) TO midar_app;

-- Certifications the company actually holds. A certification is published only with a way to verify it (an official
-- link or a certificate number) and the owner's confirmation that the evidence is on file; an expired one stops showing.
CREATE TABLE accreditations (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issuer             text NOT NULL CHECK (char_length(issuer) BETWEEN 2 AND 150),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 150),
  number             text CHECK (number IS NULL OR char_length(number) BETWEEN 2 AND 80),
  issued_on          date,
  expires_on         date,
  verify_url         text CHECK (verify_url IS NULL OR (verify_url ~ '^https://' AND char_length(verify_url) <= 500)),
  scope              text NOT NULL CHECK (char_length(scope) BETWEEN 5 AND 500),
  evidence_confirmed boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  sort               integer NOT NULL DEFAULT 100,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on),
  CHECK (status <> 'published' OR (evidence_confirmed AND (verify_url IS NOT NULL OR number IS NOT NULL)))
);
CREATE TRIGGER accreditations_touch BEFORE UPDATE ON accreditations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER accreditations_audit AFTER INSERT OR UPDATE OR DELETE ON accreditations FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE accreditations ENABLE ROW LEVEL SECURITY;
CREATE POLICY accreditations_read ON accreditations FOR SELECT
  USING (status = 'published' OR current_setting('app.platform', true) = 'on');
CREATE POLICY accreditations_write ON accreditations FOR ALL USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON accreditations TO midar_app;
