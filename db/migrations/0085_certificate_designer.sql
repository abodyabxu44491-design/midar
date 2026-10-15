-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- Certificate designer: each institution designs its own certificates on an A4 page with freely placed
-- elements (text with data fields, images, logo, QR, grades table, signature, lines and frames).
--   certificate_templates: the designs; one default per certificate kind.
--   certificate_assets: uploaded images (logos, stamps, signatures, background paper). They are never
--     changed or deleted, only hidden from the library, so an issued certificate always renders as issued.
-- An issued certificate keeps a copy of its design in its own data; editing a template later never
-- changes certificates already issued.

CREATE TABLE certificate_assets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  mime        text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes  integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 3145728),
  width       integer CHECK (width IS NULL OR width BETWEEN 1 AND 20000),
  height      integer CHECK (height IS NULL OR height BETWEEN 1 AND 20000),
  data        bytea NOT NULL,
  hidden      boolean NOT NULL DEFAULT false,
  uploaded_by text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX certificate_assets_tenant ON certificate_assets (tenant_id, hidden, id DESC);
ALTER TABLE certificate_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certificate_assets USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON certificate_assets TO midar_app;
GRANT UPDATE (hidden) ON certificate_assets TO midar_app;

CREATE TABLE certificate_templates (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  kind        text NOT NULL CHECK (kind IN ('term', 'year', 'custom', 'course', 'attendance', 'any')),
  layout      jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'object' AND octet_length(layout::text) <= 300000),
  is_default  boolean NOT NULL DEFAULT false,
  version     integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_by  text NOT NULL,
  updated_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (NOT (is_default AND archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX certificate_templates_default ON certificate_templates (tenant_id, kind) WHERE is_default;
CREATE INDEX certificate_templates_tenant ON certificate_templates (tenant_id, archived_at, kind);
CREATE TRIGGER certificate_templates_touch BEFORE UPDATE ON certificate_templates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE certificate_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certificate_templates USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON certificate_templates TO midar_app;
