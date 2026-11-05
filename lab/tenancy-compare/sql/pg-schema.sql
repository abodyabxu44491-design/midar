-- Lab schema for PostgreSQL with row-level security. Run as the owner role (lab_owner).
-- The application connects as lab_app, which cannot bypass RLS: every query sees only the rows of the school set in
-- app.tenant_id for the current transaction, even a query written without any WHERE clause.
CREATE OR REPLACE FUNCTION app_tenant() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.tenant_id', true), '') $$;

CREATE TABLE users (
  tenant_id  text NOT NULL,
  id         bigint NOT NULL,
  username   text NOT NULL,
  pw_hash    text NOT NULL,
  role       text NOT NULL CHECK (role IN ('admin', 'teacher', 'accountant', 'parent')),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, username)
);
CREATE TABLE classes (
  tenant_id  text NOT NULL,
  id         bigint NOT NULL,
  name       text NOT NULL,
  teacher_id bigint,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES users (tenant_id, id)
);
CREATE TABLE students (
  tenant_id  text NOT NULL,
  id         bigint NOT NULL,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  class_id   bigint NOT NULL,
  parent_id  bigint,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES users (tenant_id, id)
);
CREATE TABLE grades (
  tenant_id  text NOT NULL,
  student_id bigint NOT NULL,
  subject    text NOT NULL,
  score      int NOT NULL CHECK (score BETWEEN 0 AND 100),
  updated_by bigint NOT NULL,
  version    int NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, student_id, subject),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id)
);
CREATE TABLE attendance (
  tenant_id  text NOT NULL,
  student_id bigint NOT NULL,
  day        date NOT NULL,
  status     text NOT NULL CHECK (status IN ('present', 'absent', 'late')),
  PRIMARY KEY (tenant_id, student_id, day),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id)
);
CREATE TABLE invoices (
  tenant_id  text NOT NULL,
  id         bigint NOT NULL,
  student_id bigint NOT NULL,
  amount     bigint NOT NULL CHECK (amount > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id)
);
CREATE TABLE payments (
  tenant_id  text NOT NULL,
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id bigint NOT NULL,
  amount     bigint NOT NULL CHECK (amount > 0),
  idem_key   text NOT NULL CHECK (char_length(idem_key) BETWEEN 8 AND 80),
  created_by bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idem_key),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id)
);
CREATE INDEX payments_invoice ON payments (tenant_id, invoice_id);
CREATE TABLE audit_log (
  tenant_id  text NOT NULL,
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor      bigint,
  action     text NOT NULL,
  detail     text,
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER payments_no_change BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE FUNCTION payments_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (tenant_id, actor, action, detail) VALUES (NEW.tenant_id, NEW.created_by, 'payment', NEW.invoice_id || ':' || NEW.amount);
  RETURN NEW;
END $$;
CREATE TRIGGER payments_audit AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION payments_audit();

-- Row-level security on every table. FORCE applies it to the table owner too.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'classes', 'students', 'grades', 'attendance', 'invoices', 'payments', 'audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO lab_app;
GRANT SELECT, INSERT, UPDATE ON users, classes, students, grades, attendance, invoices TO lab_app;
GRANT SELECT, INSERT ON payments, audit_log TO lab_app;
GRANT DELETE ON payments TO lab_app;   -- granted on purpose: the trigger, not the grant, must stop a delete (tested)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO lab_app;
