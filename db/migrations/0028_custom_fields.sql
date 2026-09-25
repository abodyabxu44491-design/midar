-- =====================================================================
-- مِدار | MIDAR — الترحيل 0028: الحقول المخصصة
--   كل مدرسة تضيف حقولها (رقم الحافلة، الحالة الصحية، المدرسة السابقة…)
--   بلا تعديل في البرمجة، وتتحكم في نوعها وإلزاميتها وأين تظهر.
-- =====================================================================

CREATE TABLE custom_fields (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entity      text NOT NULL DEFAULT 'student' CHECK (entity IN ('student', 'teacher', 'staff')),
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label       text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 60),
  type        text NOT NULL CHECK (type IN ('text', 'number', 'date', 'select', 'boolean')),
  options     text[] CHECK (type <> 'select' OR array_length(options, 1) BETWEEN 1 AND 30),
  required    boolean NOT NULL DEFAULT false,
  show_admin  boolean NOT NULL DEFAULT true,     -- في بطاقة الطالب داخل اللوحة
  show_parent boolean NOT NULL DEFAULT false,    -- في ملف الطالب لولي الأمر
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, entity, key)
);
CREATE TRIGGER custom_fields_touch BEFORE UPDATE ON custom_fields FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER custom_fields_audit AFTER INSERT OR UPDATE OR DELETE ON custom_fields FOR EACH ROW EXECUTE FUNCTION audit_row_change();

CREATE TABLE custom_values (
  tenant_id  text NOT NULL,
  field_id   bigint NOT NULL,
  entity_id  bigint NOT NULL,
  value      text CHECK (char_length(value) <= 400),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_id, entity_id),
  FOREIGN KEY (tenant_id, field_id) REFERENCES custom_fields (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX custom_values_entity ON custom_values (tenant_id, entity_id);
CREATE TRIGGER custom_values_touch BEFORE UPDATE ON custom_values FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER custom_values_audit AFTER INSERT OR UPDATE OR DELETE ON custom_values FOR EACH ROW EXECUTE FUNCTION audit_row_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_fields', 'custom_values'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO midar_app', t);
  END LOOP;
END $$;
