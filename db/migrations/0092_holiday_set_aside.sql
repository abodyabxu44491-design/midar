-- A holiday declared after attendance was already taken (a sudden holiday): the records of those days are set
-- aside, not deleted, so the days count as a holiday everywhere (no present, absent or late). If the holiday
-- is removed or shortened, the records come back exactly as they were.
CREATE TABLE attendance_set_aside (
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id  bigint NOT NULL,
  day         date NOT NULL,
  row_data    jsonb NOT NULL,
  set_aside_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, student_id, day)
);
CREATE INDEX attendance_set_aside_day ON attendance_set_aside (tenant_id, day);
ALTER TABLE attendance_set_aside ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_set_aside USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_set_aside TO midar_app;

-- The app may not delete attendance; this function does exactly the set-aside / restore for the current
-- school (app_tenant()) and nothing else.
CREATE FUNCTION apply_holidays_to_attendance(OUT set_aside int, OUT restored int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid text := app_tenant();
BEGIN
  IF tid IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
  WITH gone AS (
    DELETE FROM attendance a
     WHERE a.tenant_id = tid
       AND EXISTS (SELECT 1 FROM holidays h WHERE h.tenant_id = tid AND h.affects_attendance AND a.day BETWEEN h.start_date AND h.end_date)
    RETURNING a.*)
  INSERT INTO attendance_set_aside (tenant_id, student_id, day, row_data)
  SELECT tenant_id, student_id, day, to_jsonb(gone) FROM gone
  ON CONFLICT (tenant_id, student_id, day) DO UPDATE SET row_data = EXCLUDED.row_data, set_aside_at = now();
  GET DIAGNOSTICS set_aside = ROW_COUNT;

  WITH due AS (
    DELETE FROM attendance_set_aside s
     WHERE s.tenant_id = tid
       AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.tenant_id = tid AND h.affects_attendance AND s.day BETWEEN h.start_date AND h.end_date)
    RETURNING s.row_data)
  INSERT INTO attendance OVERRIDING SYSTEM VALUE
  SELECT r.* FROM due, jsonb_populate_record(NULL::attendance, due.row_data) r
   WHERE r.tenant_id = tid AND EXISTS (SELECT 1 FROM students st WHERE st.id = r.student_id AND st.tenant_id = tid)
  ON CONFLICT (student_id, day) DO NOTHING;
  GET DIAGNOSTICS restored = ROW_COUNT;
END $$;
REVOKE ALL ON FUNCTION apply_holidays_to_attendance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_holidays_to_attendance() TO midar_app;
