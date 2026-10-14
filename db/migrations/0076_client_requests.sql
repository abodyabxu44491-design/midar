-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- Student family name (لقب) and residential area, both searchable.
ALTER TABLE students
  ADD COLUMN family_name text CHECK (family_name IS NULL OR char_length(family_name) BETWEEN 2 AND 60),
  ADD COLUMN area        text CHECK (area IS NULL OR char_length(area) BETWEEN 2 AND 80);
CREATE INDEX students_area ON students (tenant_id, area) WHERE area IS NOT NULL;

-- Admin accounts: «full» runs everything; «school» runs teaching and administration and sends money matters as requests.
ALTER TABLE users ADD COLUMN admin_scope text NOT NULL DEFAULT 'full' CHECK (admin_scope IN ('full', 'school'));

-- A finance account can be reserved for one purpose (the book deposit fund).
ALTER TABLE finance_accounts ADD COLUMN purpose text CHECK (purpose IN ('book_deposits'));
CREATE UNIQUE INDEX finance_accounts_purpose ON finance_accounts (tenant_id, purpose) WHERE purpose IS NOT NULL;

ALTER TABLE finance_entries DROP CONSTRAINT finance_entries_source_type_check;
ALTER TABLE finance_entries ADD CONSTRAINT finance_entries_source_type_check
  CHECK (source_type IN ('manual', 'fee', 'refund', 'donation', 'salary', 'expense', 'withdrawal', 'transfer', 'request', 'book_deposit'));

-- Administrative and financial requests: the school administration asks, finance reviews, approves or rejects, then pays.
CREATE TABLE finance_requests (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  request_no      text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('advance', 'purchase', 'maintenance', 'other')),
  title           text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 150),
  details         text CHECK (details IS NULL OR char_length(details) <= 1000),
  amount          numeric(14,2) NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  beneficiary     text CHECK (beneficiary IS NULL OR char_length(beneficiary) <= 120),
  teacher_id      bigint,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid', 'canceled')),
  requested_by    text NOT NULL,
  requested_by_id bigint,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      text,
  decided_at      timestamptz,
  decision_note   text CHECK (decision_note IS NULL OR char_length(decision_note) <= 300),
  approved_amount numeric(14,2) CHECK (approved_amount IS NULL OR approved_amount > 0),
  paid_by         text,
  paid_at         timestamptz,
  entry_id        bigint,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, request_no),
  CHECK (status <> 'rejected' OR char_length(decision_note) >= 3),
  CHECK (status <> 'paid' OR entry_id IS NOT NULL),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (teacher_id)
);
CREATE INDEX finance_requests_open ON finance_requests (tenant_id, status, requested_at DESC);
CREATE TRIGGER finance_requests_touch BEFORE UPDATE ON finance_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER finance_requests_audit AFTER INSERT OR UPDATE OR DELETE ON finance_requests FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE finance_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_requests USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON finance_requests TO midar_app;

-- Textbook deposits: held when a book is lent, refunded fully or partly on return, all through one fund.
CREATE TABLE book_deposits (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id       bigint NOT NULL,
  book_id          bigint,
  book_title       text NOT NULL CHECK (char_length(book_title) BETWEEN 1 AND 200),
  loan_id          bigint,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  method           text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'transfer', 'card', 'online')),
  status           text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'refunded', 'partial', 'forfeited')),
  received_on      date NOT NULL DEFAULT CURRENT_DATE,
  received_by      text NOT NULL,
  receipt_entry_id bigint,
  returned_on      date,
  condition        text CHECK (condition IN ('good', 'damaged', 'lost')),
  refund_amount    numeric(14,2) CHECK (refund_amount IS NULL OR refund_amount >= 0),
  deduction_reason text CHECK (deduction_reason IS NULL OR char_length(deduction_reason) <= 300),
  refunded_by      text,
  refund_entry_id  bigint,
  voucher_no       text,
  note             text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (refund_amount IS NULL OR refund_amount <= amount),
  CHECK (status = 'held' OR (returned_on IS NOT NULL AND condition IS NOT NULL AND refund_amount IS NOT NULL)),
  CHECK (refund_amount IS NULL OR refund_amount = amount OR char_length(deduction_reason) >= 3),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, book_id) REFERENCES library_books (tenant_id, id) ON DELETE SET NULL (book_id)
);
CREATE INDEX book_deposits_student ON book_deposits (tenant_id, student_id);
CREATE INDEX book_deposits_held ON book_deposits (tenant_id, received_on) WHERE status = 'held';
CREATE TRIGGER book_deposits_audit AFTER INSERT OR UPDATE OR DELETE ON book_deposits FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE book_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON book_deposits USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON book_deposits TO midar_app;
