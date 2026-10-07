-- =====================================================================
-- مِدار | MIDAR — الترحيل 0069: بوابة مِدار الذكية (المراحل 2–4)
--   gates                    : موقع البوابة ونصف القطر (اختياري) لتنبيه الجهاز البعيد عن المدرسة
--   gate_devices             : آخر موقع للجهاز، وتنبيه الانقطاع (مرة لليوم)
--   attendance               : الانصراف (آخر خروج وبوابته)
--   attendance_events        : نتيجة «انصرف»
--   attendance_stage_hours   : أوقات حضور خاصة لكل مرحلة (تتقدم على العامة، ويتقدم عليها اليوم الاستثنائي)
-- =====================================================================
ALTER TABLE gates
  ADD COLUMN geo_lat numeric(9,6) CHECK (geo_lat BETWEEN -90 AND 90),
  ADD COLUMN geo_lng numeric(9,6) CHECK (geo_lng BETWEEN -180 AND 180),
  ADD COLUMN geo_radius_m integer CHECK (geo_radius_m BETWEEN 50 AND 5000),
  ADD CONSTRAINT gates_geo_all CHECK ((geo_lat IS NULL) = (geo_lng IS NULL) AND (geo_lat IS NULL) = (geo_radius_m IS NULL));

ALTER TABLE gate_devices
  ADD COLUMN geo_lat numeric(9,6),
  ADD COLUMN geo_lng numeric(9,6),
  ADD COLUMN geo_accuracy_m integer,
  ADD COLUMN geo_at timestamptz,
  ADD COLUMN offline_alerted_on date;

ALTER TABLE attendance
  ADD COLUMN last_out_at timestamptz,
  ADD COLUMN out_gate_id bigint;
ALTER TABLE attendance ADD FOREIGN KEY (tenant_id, out_gate_id) REFERENCES gates (tenant_id, id) ON DELETE SET NULL (out_gate_id);

ALTER TABLE attendance_events DROP CONSTRAINT attendance_events_result_check;
ALTER TABLE attendance_events ADD CONSTRAINT attendance_events_result_check
  CHECK (result IN ('present', 'late', 'kept', 'duplicate', 'rejected', 'departed'));

CREATE TABLE attendance_stage_hours (
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  stage_id    bigint NOT NULL,
  open_at     time NOT NULL,
  late_after  time NOT NULL,
  close_at    time NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, stage_id),
  FOREIGN KEY (tenant_id, stage_id) REFERENCES stages (tenant_id, id) ON DELETE CASCADE,
  CHECK (open_at <= late_after AND late_after < close_at)
);
CREATE TRIGGER attendance_stage_hours_touch BEFORE UPDATE ON attendance_stage_hours FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER attendance_stage_hours_audit AFTER INSERT OR UPDATE OR DELETE ON attendance_stage_hours FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE attendance_stage_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_stage_hours USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_stage_hours TO midar_app;
