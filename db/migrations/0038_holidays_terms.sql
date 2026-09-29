-- =====================================================================
-- مِدار | MIDAR — الترحيل 0038: الإجازات والعطل + نظام فصول مرن (1 إلى 6)
-- =====================================================================

-- الفصول: كان الحد 3، نرفعه لدعم النظام المخصص
ALTER TABLE terms DROP CONSTRAINT IF EXISTS terms_ordinal_check;
ALTER TABLE terms ADD CONSTRAINT terms_ordinal_check CHECK (ordinal BETWEEN 1 AND 6);

-- الإجازات والعطل: مصدر واحد يقرأه الحضور والجدول والتقويم
CREATE TABLE holidays (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name               text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  kind               text NOT NULL DEFAULT 'official'
                     CHECK (kind IN ('official', 'mid_term', 'term_end', 'eid', 'emergency', 'school', 'custom')),
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  notes              text CHECK (notes IS NULL OR char_length(notes) <= 300),
  affects_attendance boolean NOT NULL DEFAULT true,
  show_in_calendar   boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (end_date >= start_date)
);
CREATE INDEX holidays_dates ON holidays (tenant_id, start_date, end_date);
CREATE TRIGGER holidays_touch BEFORE UPDATE ON holidays FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER holidays_audit AFTER INSERT OR UPDATE OR DELETE ON holidays FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON holidays USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON holidays TO midar_app;
