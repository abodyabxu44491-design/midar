-- Lab schema for SQLite (D1 shared, and a Durable Object per school).
-- D1 (shared): every table carries tenant_id and composite keys (tenant_id, id), so a row can only reference rows
-- of the same school. In a Durable Object the same tables exist but the whole database belongs to one school;
-- tenant_id is still stored (always that school) so both backends run identical SQL.
-- Money is stored in the smallest unit (integer), because SQLite has no exact decimal type.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  tenant_id  TEXT NOT NULL,
  id         INTEGER NOT NULL,
  username   TEXT NOT NULL,
  pw_hash    TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'accountant', 'parent')),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, username)
);

CREATE TABLE IF NOT EXISTS classes (
  tenant_id  TEXT NOT NULL,
  id         INTEGER NOT NULL,
  name       TEXT NOT NULL,
  teacher_id INTEGER,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES users (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS students (
  tenant_id  TEXT NOT NULL,
  id         INTEGER NOT NULL,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  class_id   INTEGER NOT NULL,
  parent_id  INTEGER,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES users (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS grades (
  tenant_id  TEXT NOT NULL,
  student_id INTEGER NOT NULL,
  subject    TEXT NOT NULL,
  score      INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  updated_by INTEGER NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, student_id, subject),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS attendance (
  tenant_id  TEXT NOT NULL,
  student_id INTEGER NOT NULL,
  day        TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status     TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late')),
  PRIMARY KEY (tenant_id, student_id, day),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS invoices (
  tenant_id  TEXT NOT NULL,
  id         INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS payments (
  tenant_id  TEXT NOT NULL,
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  idem_key   TEXT NOT NULL CHECK (length(idem_key) BETWEEN 8 AND 80),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, idem_key),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS payments_invoice ON payments (tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS audit_log (
  tenant_id  TEXT NOT NULL,
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Payments and the audit log are append-only: no update or delete, whatever the application code does.
CREATE TRIGGER IF NOT EXISTS payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
CREATE TRIGGER IF NOT EXISTS payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
-- Every payment is written to the audit log by the database itself.
CREATE TRIGGER IF NOT EXISTS payments_audit AFTER INSERT ON payments BEGIN
  INSERT INTO audit_log (tenant_id, actor, action, detail) VALUES (NEW.tenant_id, NEW.created_by, 'payment', NEW.invoice_id || ':' || NEW.amount);
END;
