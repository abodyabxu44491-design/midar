-- Indexes for foreign keys on the larger tables that had none: removing or checking a gate, a device, a subject,
-- a term or a teacher no longer scans the whole table. Additive only: no data is changed. The gate and device
-- columns are empty for most rows (attendance recorded by teachers), so those indexes cover only the filled rows.
CREATE INDEX IF NOT EXISTS attendance_gate ON attendance (tenant_id, gate_id) WHERE gate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_out_gate ON attendance (tenant_id, out_gate_id) WHERE out_gate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_device ON attendance (tenant_id, device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_events_gate ON attendance_events (tenant_id, gate_id) WHERE gate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_events_device ON attendance_events (tenant_id, device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS exams_subject ON exams (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS behavior_records_term ON behavior_records (tenant_id, term_id);
CREATE INDEX IF NOT EXISTS behavior_records_teacher ON behavior_records (tenant_id, teacher_id) WHERE teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_term ON invoices (tenant_id, term_id);
CREATE INDEX IF NOT EXISTS finance_entries_term ON finance_entries (tenant_id, term_id) WHERE term_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS timetable_slots_subject ON timetable_slots (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS assignments_teacher ON assignments (tenant_id, teacher_id) WHERE teacher_id IS NOT NULL;
