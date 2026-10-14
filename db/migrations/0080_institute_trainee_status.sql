-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- In schools a non-active status takes the student off the lists (archived). In institutes a trainee's status
-- (withdrawn, deferred, suspended, finished) is part of the record and the trainee stays listed and searchable.
CREATE OR REPLACE FUNCTION students_sync_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  IF (SELECT org_type FROM tenants WHERE id = NEW.tenant_id) = 'institute' THEN
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND OLD.archived_at IS NOT NULL AND OLD.status <> 'active' THEN
      NEW.archived_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'active' THEN
    NEW.archived_at := NULL;
  ELSIF NEW.archived_at IS NULL THEN
    NEW.archived_at := now();
  END IF;
  RETURN NEW;
END $$;

-- Trainees archived by the school rule before this change come back to the lists.
UPDATE students s SET archived_at = NULL
  FROM tenants t WHERE t.id = s.tenant_id AND t.org_type = 'institute' AND s.archived_at IS NOT NULL;
