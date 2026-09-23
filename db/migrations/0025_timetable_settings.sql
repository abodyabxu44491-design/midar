-- =====================================================================
-- مِدار | MIDAR — الترحيل 0025: إعدادات الجدول ومنع تعارض القاعات
-- =====================================================================

CREATE TABLE timetable_settings (
  tenant_id       text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  days            smallint[] NOT NULL DEFAULT '{0,1,2,3,4}',      -- 0 = الأحد
  periods_per_day smallint NOT NULL DEFAULT 7 CHECK (periods_per_day BETWEEN 1 AND 10),
  start_time      time NOT NULL DEFAULT '07:30',
  period_minutes  smallint NOT NULL DEFAULT 45 CHECK (period_minutes BETWEEN 20 AND 120),
  break_after     smallint CHECK (break_after IS NULL OR break_after BETWEEN 1 AND 10),
  break_minutes   smallint NOT NULL DEFAULT 20 CHECK (break_minutes BETWEEN 0 AND 120),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (array_length(days, 1) BETWEEN 1 AND 7)
);
CREATE TRIGGER timetable_settings_touch BEFORE UPDATE ON timetable_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER timetable_settings_audit AFTER INSERT OR UPDATE OR DELETE ON timetable_settings FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE timetable_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON timetable_settings USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON timetable_settings TO midar_app;

-- قاعة واحدة لا تُستخدم مرتين في نفس الوقت
CREATE UNIQUE INDEX timetable_room_conflict ON timetable_slots (tenant_id, room, day, period)
  WHERE room IS NOT NULL AND room <> '';
