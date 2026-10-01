-- =====================================================================
-- مِدار | MIDAR — الترحيل 0059: الخدمات والتواصل
--   النقل المدرسي (الحافلات وطلابها وصعودهم ونزولهم)، المكتبة (الكتب والإعارة)، العهد والمخزون،
--   العيادة (الملف الصحي والزيارات)، الاستبيانات، مواعيد أولياء الأمور، سجل المساعد الذكي،
--   وسجل التذكيرات (حتى لا يتكرر تذكير القسط أو الكتاب أو الموعد)
-- =====================================================================
CREATE TABLE buses (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  plate         text CHECK (plate IS NULL OR char_length(plate) <= 30),
  driver_name   text CHECK (driver_name IS NULL OR char_length(driver_name) <= 80),
  driver_phone  text CHECK (driver_phone IS NULL OR char_length(driver_phone) <= 20),
  supervisor    text CHECK (supervisor IS NULL OR char_length(supervisor) <= 80),
  capacity      integer CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 200),
  route         text CHECK (route IS NULL OR char_length(route) <= 1000),
  fee           numeric(12,2) CHECK (fee IS NULL OR fee >= 0),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER buses_audit AFTER INSERT OR UPDATE OR DELETE ON buses FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE buses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON buses USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON buses TO midar_app;

CREATE TABLE bus_students (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  bus_id      bigint NOT NULL,
  student_id  bigint NOT NULL,
  stop        text CHECK (stop IS NULL OR char_length(stop) <= 120),
  direction   text NOT NULL DEFAULT 'both' CHECK (direction IN ('both', 'to_school', 'from_school')),
  pickup_time text CHECK (pickup_time IS NULL OR char_length(pickup_time) <= 20),
  UNIQUE (student_id),
  FOREIGN KEY (tenant_id, bus_id) REFERENCES buses (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE TRIGGER bus_students_audit AFTER INSERT OR UPDATE OR DELETE ON bus_students FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE bus_students ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bus_students USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON bus_students TO midar_app;

CREATE TABLE bus_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  bus_id      bigint NOT NULL,
  student_id  bigint NOT NULL,
  day         date NOT NULL DEFAULT CURRENT_DATE,
  kind        text NOT NULL CHECK (kind IN ('boarded', 'arrived', 'left', 'dropped', 'absent')),
  at          timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL,
  UNIQUE (student_id, day, kind),
  FOREIGN KEY (tenant_id, bus_id) REFERENCES buses (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX bus_events_day ON bus_events (tenant_id, bus_id, day);
ALTER TABLE bus_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bus_events USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON bus_events TO midar_app;

CREATE TABLE library_books (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  author      text CHECK (author IS NULL OR char_length(author) <= 120),
  isbn        text CHECK (isbn IS NULL OR char_length(isbn) <= 20),
  category    text CHECK (category IS NULL OR char_length(category) <= 60),
  shelf       text CHECK (shelf IS NULL OR char_length(shelf) <= 30),
  copies      integer NOT NULL DEFAULT 1 CHECK (copies BETWEEN 0 AND 10000),
  notes       text CHECK (notes IS NULL OR char_length(notes) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER library_books_audit AFTER INSERT OR UPDATE OR DELETE ON library_books FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE library_books ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_books USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON library_books TO midar_app;

CREATE TABLE library_loans (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  book_id      bigint NOT NULL,
  student_id   bigint,
  staff_id     bigint,
  loaned_on    date NOT NULL DEFAULT CURRENT_DATE,
  due_on       date NOT NULL,
  returned_on  date,
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by   text NOT NULL,
  CHECK ((student_id IS NULL) <> (staff_id IS NULL)),
  CHECK (due_on >= loaned_on),
  FOREIGN KEY (tenant_id, book_id) REFERENCES library_books (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX library_loans_open ON library_loans (tenant_id, due_on) WHERE returned_on IS NULL;
CREATE TRIGGER library_loans_audit AFTER INSERT OR UPDATE OR DELETE ON library_loans FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE library_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_loans USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON library_loans TO midar_app;

CREATE TABLE inventory_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  category      text CHECK (category IS NULL OR char_length(category) <= 60),
  unit          text NOT NULL DEFAULT 'قطعة' CHECK (char_length(unit) BETWEEN 1 AND 20),
  quantity      numeric(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity  numeric(12,2) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  location      text CHECK (location IS NULL OR char_length(location) <= 80),
  note          text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER inventory_items_audit AFTER INSERT OR UPDATE OR DELETE ON inventory_items FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_items USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_items TO midar_app;

CREATE TABLE inventory_moves (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  item_id     bigint NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('in', 'out', 'custody', 'return', 'adjust')),
  qty         numeric(12,2) NOT NULL CHECK (qty > 0),
  staff_id    bigint,
  day         date NOT NULL DEFAULT CURRENT_DATE,
  note        text CHECK (note IS NULL OR char_length(note) <= 300),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (kind NOT IN ('custody', 'return') OR staff_id IS NOT NULL),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX inventory_moves_item ON inventory_moves (tenant_id, item_id, created_at DESC);
CREATE TRIGGER inventory_moves_audit AFTER INSERT OR UPDATE OR DELETE ON inventory_moves FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE inventory_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_moves USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_moves TO midar_app;

CREATE TABLE health_profiles (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id      bigint NOT NULL UNIQUE,
  blood_type      text CHECK (blood_type IS NULL OR blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies       text CHECK (allergies IS NULL OR char_length(allergies) <= 500),
  chronic         text CHECK (chronic IS NULL OR char_length(chronic) <= 500),
  medications     text CHECK (medications IS NULL OR char_length(medications) <= 500),
  emergency_phone text CHECK (emergency_phone IS NULL OR char_length(emergency_phone) <= 20),
  notes           text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  updated_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE TRIGGER health_profiles_audit AFTER INSERT OR UPDATE OR DELETE ON health_profiles FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE health_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON health_profiles USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON health_profiles TO midar_app;

CREATE TABLE clinic_visits (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id    bigint NOT NULL,
  visited_at    timestamptz NOT NULL DEFAULT now(),
  complaint     text NOT NULL CHECK (char_length(complaint) BETWEEN 2 AND 300),
  action        text CHECK (action IS NULL OR char_length(action) <= 500),
  temperature   numeric(4,1) CHECK (temperature IS NULL OR temperature BETWEEN 30 AND 45),
  sent_home     boolean NOT NULL DEFAULT false,
  recorded_by   text NOT NULL,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX clinic_visits_student ON clinic_visits (tenant_id, student_id, visited_at DESC);
CREATE TRIGGER clinic_visits_audit AFTER INSERT OR UPDATE OR DELETE ON clinic_visits FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE clinic_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clinic_visits USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_visits TO midar_app;

CREATE TABLE surveys (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 150),
  description  text CHECK (description IS NULL OR char_length(description) <= 1000),
  audience     text NOT NULL CHECK (audience IN ('parents', 'staff', 'all')),
  questions    jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) BETWEEN 1 AND 40),
  anonymous    boolean NOT NULL DEFAULT true,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closed')),
  closes_on    date,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER surveys_audit AFTER INSERT OR UPDATE OR DELETE ON surveys FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON surveys USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON surveys TO midar_app;

CREATE TABLE survey_responses (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  survey_id   bigint NOT NULL,
  student_id  bigint,
  user_id     bigint,
  answers     jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 30000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (user_id IS NULL)),
  UNIQUE (survey_id, student_id),
  UNIQUE (survey_id, user_id),
  FOREIGN KEY (tenant_id, survey_id) REFERENCES surveys (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON survey_responses USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_responses TO midar_app;

CREATE TABLE meeting_slots (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  teacher_id  bigint,
  host_name   text NOT NULL CHECK (char_length(host_name) BETWEEN 2 AND 80),
  day         date NOT NULL,
  start_time  time NOT NULL,
  minutes     smallint NOT NULL CHECK (minutes BETWEEN 5 AND 180),
  mode        text NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person', 'phone', 'video')),
  location    text CHECK (location IS NULL OR char_length(location) <= 120),
  note        text CHECK (note IS NULL OR char_length(note) <= 300),
  class_id    bigint,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX meeting_slots_day ON meeting_slots (tenant_id, day);
CREATE TRIGGER meeting_slots_audit AFTER INSERT OR UPDATE OR DELETE ON meeting_slots FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE meeting_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meeting_slots USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_slots TO midar_app;

CREATE TABLE meeting_bookings (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  slot_id      bigint NOT NULL,
  student_id   bigint NOT NULL,
  topic        text CHECK (topic IS NULL OR char_length(topic) <= 300),
  status       text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'done', 'no_show')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, slot_id) REFERENCES meeting_slots (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX meeting_bookings_one ON meeting_bookings (slot_id) WHERE status <> 'cancelled';
CREATE TRIGGER meeting_bookings_audit AFTER INSERT OR UPDATE OR DELETE ON meeting_bookings FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE meeting_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meeting_bookings USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_bookings TO midar_app;

CREATE TABLE ai_queries (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id     bigint,
  question    text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 1000),
  answer      text CHECK (answer IS NULL OR char_length(answer) <= 20000),
  tokens_in   integer,
  tokens_out  integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_queries_tenant ON ai_queries (tenant_id, created_at DESC);
ALTER TABLE ai_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_queries USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_queries TO midar_app;

CREATE TABLE reminder_log (
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  key         text NOT NULL CHECK (char_length(key) <= 120),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reminder_log USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, DELETE ON reminder_log TO midar_app;

-- منطقة الحذر: سجلات التذكير مؤقتة، وأسئلة المساعد سجل
CREATE OR REPLACE FUNCTION danger_tables() RETURNS TABLE (name text, depth int, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE t AS (
    SELECT c.table_name::text AS name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name NOT IN ('danger_operations', 'tenant_backups')
  ), fk AS (
    SELECT DISTINCT k.conrelid::regclass::text AS child, k.confrelid::regclass::text AS parent
      FROM pg_constraint k WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace
       AND k.conrelid <> k.confrelid
       AND k.conrelid::regclass::text IN (SELECT name FROM t) AND k.confrelid::regclass::text IN (SELECT name FROM t)
  ), d AS (
    SELECT name, 0 AS depth FROM t
    UNION ALL
    SELECT fk.child, d.depth + 1 FROM d JOIN fk ON fk.parent = d.name WHERE d.depth < 50
  )
  SELECT name, max(depth)::int,
         CASE WHEN name IN ('audit_log', 'security_events', 'sms_messages', 'ai_queries') THEN 'log'
              WHEN name IN ('sessions', 'sync_changes', 'sync_devices', 'sync_operations', 'password_requests', 'push_subscriptions', 'reminder_log') THEN 'transient'
              WHEN name IN ('subscriptions', 'subscription_events', 'subscription_invoices', 'tenant_prices', 'renewal_requests', 'leads', 'sms_ledger') THEN 'billing'
              ELSE 'data' END
    FROM d GROUP BY name;
$$;
