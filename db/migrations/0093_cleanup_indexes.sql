-- The nightly cleanup deletes old rows by date; without these indexes it reads the whole table.
CREATE INDEX IF NOT EXISTS sync_changes_changed_at ON sync_changes (changed_at);
CREATE INDEX IF NOT EXISTS security_events_created_at ON security_events (created_at);
