-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- Results are approved before any certificate is issued, and a certificate is never edited or deleted.
--   result_batches: one result per class and term/year (schools) or per course (institutes), going
--     draft → review → (returned → review)* → approved. Approval stores a snapshot and its hash; a certificate
--     is issued only while the live results still match it. A grade changed after approval sends the result
--     back to review automatically.
--   certificates: a serial number per institution and year, a status (issued, revoked, replaced) and a link
--     between a replaced certificate and the one replacing it. The content of an issued certificate is frozen.
--   result_events / certificate_events: an append-only record of who did what and when.
-- Approval here is the institution's own (internal) approval; nothing in this file records a ministry's.

CREATE TABLE result_batches (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  scope            text NOT NULL CHECK (scope IN ('term', 'year', 'course')),
  class_id         bigint,
  term_id          bigint,
  year_id          bigint,
  course_id        bigint,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'returned', 'approved')),
  return_reason    text CHECK (return_reason IS NULL OR char_length(return_reason) <= 300),
  exception_reason text CHECK (exception_reason IS NULL OR char_length(exception_reason) <= 300),
  snapshot         jsonb,
  snapshot_hash    text,
  reopened         boolean NOT NULL DEFAULT false,
  prepared_by      text NOT NULL,
  submitted_by     text,
  submitted_at     timestamptz,
  reviewed_by      text,
  reviewed_at      timestamptz,
  approved_by      text,
  approved_at      timestamptz,
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((scope IN ('term', 'year') AND class_id IS NOT NULL AND course_id IS NULL)
      OR (scope = 'course' AND course_id IS NOT NULL AND class_id IS NULL)),
  CHECK (scope <> 'term' OR term_id IS NOT NULL),
  CHECK (scope <> 'year' OR year_id IS NOT NULL),
  CHECK (status <> 'approved' OR (snapshot IS NOT NULL AND snapshot_hash IS NOT NULL AND approved_by IS NOT NULL)),
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, term_id) REFERENCES terms (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, year_id) REFERENCES academic_years (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, course_id) REFERENCES courses (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX result_batches_class ON result_batches (tenant_id, scope, class_id, COALESCE(term_id, 0), COALESCE(year_id, 0)) WHERE scope IN ('term', 'year');
CREATE UNIQUE INDEX result_batches_course ON result_batches (tenant_id, course_id) WHERE scope = 'course';
CREATE INDEX result_batches_status ON result_batches (tenant_id, status);
CREATE TRIGGER result_batches_touch BEFORE UPDATE ON result_batches FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE result_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON result_batches USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON result_batches TO midar_app;

CREATE TABLE result_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  batch_id   bigint NOT NULL,
  action     text NOT NULL CHECK (action IN ('created', 'submitted', 'returned', 'approved', 'reopened', 'changed', 'issued')),
  actor      text NOT NULL,
  reason     text CHECK (reason IS NULL OR char_length(reason) <= 300),
  meta       jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(meta) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES result_batches (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX result_events_batch ON result_events (tenant_id, batch_id, id);
ALTER TABLE result_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON result_events USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON result_events TO midar_app;

-- ---------- Certificates: status, serial number, replacement ----------
ALTER TABLE certificates
  ADD COLUMN status      text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'revoked', 'replaced')),
  ADD COLUMN serial      text,
  ADD COLUMN batch_id    bigint,
  ADD COLUMN replaces    bigint,
  ADD COLUMN replaced_by bigint,
  ADD COLUMN revoked_by  text,
  ADD CONSTRAINT certificates_batch_fk FOREIGN KEY (tenant_id, batch_id) REFERENCES result_batches (tenant_id, id) ON DELETE SET NULL (batch_id);

UPDATE certificates SET status = CASE WHEN revoked_at IS NULL THEN 'issued'
                                      WHEN revoke_reason = 'أُعيد إصدارها' THEN 'replaced' ELSE 'revoked' END;
-- Earlier certificates get serial numbers in the order they were issued.
WITH n AS (
  SELECT id, extract(year FROM issued_at)::int AS y,
         row_number() OVER (PARTITION BY tenant_id, extract(year FROM issued_at) ORDER BY issued_at, id) AS k
    FROM certificates
)
UPDATE certificates c SET serial = n.y || '-' || lpad(n.k::text, 6, '0') FROM n WHERE n.id = c.id;
ALTER TABLE certificates ALTER COLUMN serial SET NOT NULL,
  ADD CONSTRAINT certificates_serial_format CHECK (serial ~ '^[0-9]{4}-[0-9]{6}$'),
  ADD CONSTRAINT certificates_status_dates CHECK ((status = 'issued') = (revoked_at IS NULL));
CREATE UNIQUE INDEX certificates_serial ON certificates (tenant_id, serial);

CREATE TABLE certificate_serials (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  year      integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  last      integer NOT NULL CHECK (last >= 0),
  PRIMARY KEY (tenant_id, year)
);
INSERT INTO certificate_serials (tenant_id, year, last)
SELECT tenant_id, left(serial, 4)::int, max(right(serial, 6)::int) FROM certificates GROUP BY 1, 2;
ALTER TABLE certificate_serials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certificate_serials USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON certificate_serials TO midar_app;

-- The next serial number of the current tenant for this year. The counter row is locked while it advances,
-- and a missing counter starts after the highest serial already issued, so numbers never repeat.
CREATE FUNCTION next_certificate_serial() RETURNS text
LANGUAGE sql AS $$
  INSERT INTO certificate_serials (tenant_id, year, last)
  VALUES (app_tenant(), extract(year FROM now())::int,
          COALESCE((SELECT max(right(serial, 6)::int) FROM certificates
                     WHERE tenant_id = app_tenant() AND serial LIKE extract(year FROM now())::int || '-%'), 0) + 1)
  ON CONFLICT (tenant_id, year) DO UPDATE SET last = certificate_serials.last + 1
  RETURNING year || '-' || lpad(last::text, 6, '0');
$$;

-- An issued certificate keeps its content; it can only become revoked or replaced, and that is final.
CREATE FUNCTION certificates_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code <> OLD.code OR NEW.serial <> OLD.serial OR NEW.data <> OLD.data OR NEW.title <> OLD.title
     OR NEW.student_id <> OLD.student_id OR NEW.kind <> OLD.kind OR NEW.issued_at <> OLD.issued_at OR NEW.issued_by <> OLD.issued_by THEN
    RAISE EXCEPTION 'لا يمكن تعديل شهادة صادرة. ألغها وأصدر شهادة بديلة.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'issued' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'الشهادة ملغاة أو مستبدلة ولا يمكن تغيير حالتها' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> 'issued' AND OLD.status = 'issued' THEN
    NEW.revoked_at := COALESCE(NEW.revoked_at, now());
  END IF;
  -- The replacing certificate is linked once, right after it is issued.
  IF OLD.status <> 'issued' AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason
     OR (NEW.replaced_by IS DISTINCT FROM OLD.replaced_by AND (OLD.replaced_by IS NOT NULL OR OLD.status <> 'replaced'))) THEN
    RAISE EXCEPTION 'سجل الإلغاء لا يُعدَّل' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER certificates_guard BEFORE UPDATE ON certificates FOR EACH ROW EXECUTE FUNCTION certificates_guard();

CREATE TABLE certificate_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  certificate_id bigint NOT NULL,
  action         text NOT NULL CHECK (action IN ('issued', 'revoked', 'replaced', 'printed')),
  actor          text NOT NULL,
  reason         text CHECK (reason IS NULL OR char_length(reason) <= 300),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, certificate_id) REFERENCES certificates (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX certificate_events_cert ON certificate_events (tenant_id, certificate_id, id);
ALTER TABLE certificate_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certificate_events USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON certificate_events TO midar_app;
INSERT INTO certificate_events (tenant_id, certificate_id, action, actor, created_at)
SELECT tenant_id, id, 'issued', issued_by, issued_at FROM certificates;
INSERT INTO certificate_events (tenant_id, certificate_id, action, actor, reason, created_at)
SELECT tenant_id, id, status, 'النظام', revoke_reason, revoked_at FROM certificates WHERE status <> 'issued';

-- ---------- Grades changed after approval send the result back to review ----------
CREATE FUNCTION reopen_results(cls bigint, trm bigint, why text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE b record;
BEGIN
  FOR b IN
    UPDATE result_batches r SET status = 'review', reopened = true, approved_by = NULL, approved_at = NULL
     WHERE r.status = 'approved' AND r.class_id = cls
       AND ((r.scope = 'term' AND r.term_id = trm) OR (r.scope = 'year' AND r.year_id = (SELECT year_id FROM terms WHERE id = trm)))
    RETURNING r.id, r.tenant_id
  LOOP
    INSERT INTO result_events (tenant_id, batch_id, action, actor, reason) VALUES (b.tenant_id, b.id, 'changed', 'النظام', why);
  END LOOP;
END $$;

CREATE FUNCTION scores_reopen_results() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE e record; sid bigint := COALESCE(NEW.exam_id, OLD.exam_id);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.score IS NOT DISTINCT FROM OLD.score THEN RETURN NULL; END IF;
  SELECT class_id, term_id, status INTO e FROM exams WHERE id = sid;
  IF e.status = 'published' THEN PERFORM reopen_results(e.class_id, e.term_id, 'تغيّرت درجات بعد الاعتماد'); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER scores_reopen_results AFTER INSERT OR UPDATE OR DELETE ON scores FOR EACH ROW EXECUTE FUNCTION scores_reopen_results();

CREATE FUNCTION exams_reopen_results() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN PERFORM reopen_results(OLD.class_id, OLD.term_id, 'حُذف اختبار منشور بعد الاعتماد'); END IF;
    RETURN NULL;
  END IF;
  IF (OLD.status = 'published') <> (NEW.status = 'published')
     OR (NEW.status = 'published' AND (NEW.max_score <> OLD.max_score OR NEW.subject_id <> OLD.subject_id
         OR NEW.component_id IS DISTINCT FROM OLD.component_id OR NEW.term_id IS DISTINCT FROM OLD.term_id OR NEW.class_id <> OLD.class_id)) THEN
    PERFORM reopen_results(OLD.class_id, OLD.term_id, 'تغيّر اختبار منشور بعد الاعتماد');
    IF NEW.class_id <> OLD.class_id OR NEW.term_id IS DISTINCT FROM OLD.term_id THEN
      PERFORM reopen_results(NEW.class_id, NEW.term_id, 'تغيّر اختبار منشور بعد الاعتماد');
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER exams_reopen_results AFTER UPDATE OR DELETE ON exams FOR EACH ROW EXECUTE FUNCTION exams_reopen_results();

CREATE FUNCTION enrollments_reopen_results() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b record;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.result IS NOT DISTINCT FROM OLD.result
     AND NEW.final_score IS NOT DISTINCT FROM OLD.final_score AND NEW.course_id = OLD.course_id THEN RETURN NULL; END IF;
  FOR b IN
    UPDATE result_batches r SET status = 'review', reopened = true, approved_by = NULL, approved_at = NULL
     WHERE r.status = 'approved' AND r.scope = 'course' AND r.course_id IN (OLD.course_id, NEW.course_id)
    RETURNING r.id, r.tenant_id
  LOOP
    INSERT INTO result_events (tenant_id, batch_id, action, actor, reason) VALUES (b.tenant_id, b.id, 'changed', 'النظام', 'تغيّرت نتيجة متدرب بعد الاعتماد');
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER enrollments_reopen_results AFTER UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION enrollments_reopen_results();

-- ---------- Public verification: status and serial, never a draft or anything private ----------
DROP FUNCTION verify_certificate(text);
CREATE FUNCTION verify_certificate(c text) RETURNS TABLE (school text, student text, class_name text, title text, issued_at timestamptz,
  revoked boolean, result text, percent numeric, org_type text, kind text, course text, program text, hours numeric, completed_on text,
  status text, serial text, replaced_on timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.name, x.data -> 'student' ->> 'name', x.data -> 'student' ->> 'class_name', x.title, x.issued_at,
         x.status <> 'issued', x.data ->> 'result', NULLIF(x.data -> 'summary' ->> 'percent', '')::numeric,
         t.org_type, x.kind, x.data -> 'course' ->> 'name', x.data -> 'course' ->> 'program',
         NULLIF(x.data -> 'course' ->> 'hours', '')::numeric, x.data -> 'course' ->> 'completed_on',
         x.status, x.serial, CASE WHEN x.status <> 'issued' THEN x.revoked_at END
    FROM certificates x JOIN tenants t ON t.id = x.tenant_id
   WHERE x.code = upper(c) AND t.status <> 'archived';
$$;
REVOKE ALL ON FUNCTION verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_certificate(text) TO midar_app;
