-- =====================================================================
-- مِدار | MIDAR — الترحيل 0001: الجداول الأساسية
-- برمجة وتطوير: المبرمج عبدالله السكني
--
-- مبادئ الأساس:
--   1) كل جدول مدرسة يحمل tenant_id، وكل علاقة بين جدولين تمر عبر
--      (tenant_id, id) معًا، فقاعدة البيانات نفسها تمنع ربط طالب بفصل مدرسة أخرى.
--   2) المبالغ بنوع NUMERIC(12,2) وليس أرقامًا عشرية تقريبية.
--   3) لا حذف نهائي للطلاب أو الفواتير أو المدفوعات أو السجل.
--   4) كل قيمة لها قيود تحقق (CHECK) داخل القاعدة، وليس في الواجهة فقط.
-- =====================================================================

-- ---------- دوال مساعدة ----------
CREATE FUNCTION app_tenant() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '') $$;

CREATE FUNCTION app_actor() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('app.actor', true), ''), 'system') $$;

CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------- المدارس (المستأجرون) ----------
CREATE TABLE tenants (
  id                text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{2,29}$'),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 150),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  plan              text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic', 'pro', 'enterprise')),
  max_students      integer NOT NULL DEFAULT 200 CHECK (max_students BETWEEN 1 AND 100000),
  subscription_end  date,
  directory_code    text NOT NULL CHECK (directory_code ~ '^[A-Z2-9]{6,12}$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_touch BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- عدادات متسلسلة لكل مدرسة (أرقام الإيصالات بدون فجوات أو تكرار)
CREATE TABLE tenant_counters (
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name       text NOT NULL,
  value      bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  PRIMARY KEY (tenant_id, name)
);

-- ---------- الهيكل الأكاديمي ----------
CREATE TABLE classes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER classes_touch BEFORE UPDATE ON classes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE subjects (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER subjects_touch BEFORE UPDATE ON subjects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- المعلمون والمستخدمون ----------
CREATE TABLE teachers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  full_name   text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  phone       text CHECK (phone ~ '^[0-9+ ]{0,20}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER teachers_touch BEFORE UPDATE ON teachers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE users (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  role                 text NOT NULL CHECK (role IN ('admin', 'teacher')),
  full_name            text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  username             text NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
  password_hash        text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  teacher_id           bigint,
  is_active            boolean NOT NULL DEFAULT true,
  failed_logins        integer NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until         timestamptz,
  password_changed_at  timestamptz NOT NULL DEFAULT now(),
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, username),
  UNIQUE (tenant_id, id),
  -- حساب المعلم لازم يرتبط بملف معلم، وحساب المدير لا
  CHECK ((role = 'teacher') = (teacher_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX users_one_account_per_teacher ON users (teacher_id) WHERE teacher_id IS NOT NULL;
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE teacher_assignments (
  tenant_id   text NOT NULL,
  teacher_id  bigint NOT NULL,
  class_id    bigint NOT NULL,
  subject_id  bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, class_id, subject_id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, class_id)   REFERENCES classes  (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX teacher_assignments_class ON teacher_assignments (tenant_id, class_id);

-- ---------- الجلسات وأحداث الأمان ----------
CREATE TABLE sessions (
  token_hash    text PRIMARY KEY CHECK (char_length(token_hash) = 64),
  kind          text NOT NULL CHECK (kind IN ('owner', 'admin', 'teacher')),
  user_id       bigint REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     text REFERENCES tenants(id) ON DELETE CASCADE,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  CHECK ((kind = 'owner') = (user_id IS NULL AND tenant_id IS NULL))
);
CREATE INDEX sessions_expiry ON sessions (expires_at);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_tenant ON sessions (tenant_id);

CREATE TABLE security_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL,          -- owner_login_failed, key_failed, ...
  subject     text,                   -- اسم المستخدم أو رقم الطالب
  tenant_id   text,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_lookup ON security_events (kind, subject, created_at DESC);

-- ---------- الطلاب ----------
CREATE TABLE students (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  class_id        bigint,
  full_name       text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  guardian_name   text CHECK (char_length(guardian_name) <= 120),
  guardian_phone  text CHECK (guardian_phone ~ '^[0-9+ ]{0,20}$'),
  access_key      text NOT NULL CHECK (access_key ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}$'),
  fees_enabled    boolean NOT NULL DEFAULT false,
  archived_at     timestamptz,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, access_key),
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX students_class ON students (tenant_id, class_id) WHERE archived_at IS NULL;

-- رقم النسخة يزيد مع كل تعديل (يمنع تعديلين متزامنين يلغي أحدهما الآخر)
CREATE FUNCTION students_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  IF NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'لا يمكن نقل طالب بين المدارس' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER students_update BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION students_before_update();

-- ---------- الحضور ----------
CREATE TABLE attendance (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL,
  student_id   bigint NOT NULL,
  day          date NOT NULL CHECK (day BETWEEN DATE '2020-01-01' AND DATE '2100-01-01'),
  status       text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  note         text CHECK (char_length(note) <= 300),
  recorded_by  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, day),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX attendance_day ON attendance (tenant_id, day);
CREATE TRIGGER attendance_touch BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- الاختبارات والدرجات ----------
CREATE TABLE exams (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL,
  class_id      bigint NOT NULL,
  subject_id    bigint NOT NULL,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  exam_date     date,
  max_score     numeric(6,2) NOT NULL CHECK (max_score > 0 AND max_score <= 1000),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published')),
  created_by    text NOT NULL,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id)   REFERENCES classes  (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER exams_touch BEFORE UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- لا يُسمح بتغيير الدرجة القصوى بعد إدخال درجات
CREATE FUNCTION exams_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.max_score <> OLD.max_score AND EXISTS (SELECT 1 FROM scores WHERE exam_id = OLD.id AND score IS NOT NULL) THEN
    RAISE EXCEPTION 'لا يمكن تغيير الدرجة القصوى بعد إدخال الدرجات' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'published' AND OLD.status <> 'published' THEN
    NEW.published_at := now();
  ELSIF NEW.status <> 'published' THEN
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE scores (
  tenant_id   text NOT NULL,
  exam_id     bigint NOT NULL,
  student_id  bigint NOT NULL,
  score       numeric(6,2) CHECK (score >= 0),
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_id, student_id),
  FOREIGN KEY (tenant_id, exam_id)    REFERENCES exams    (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER exams_guard BEFORE UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION exams_guard();

-- الدرجة لا تتجاوز القصوى، ولا تتغير إلا والاختبار مسودة
CREATE FUNCTION scores_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE e exams%ROWTYPE;
BEGIN
  SELECT * INTO e FROM exams WHERE id = COALESCE(NEW.exam_id, OLD.exam_id);
  IF e.status <> 'draft' THEN
    RAISE EXCEPTION 'الدرجات مقفلة لأن الاختبار أُرسل للاعتماد أو نُشر' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.score IS NOT NULL AND NEW.score > e.max_score THEN
      RAISE EXCEPTION 'الدرجة % أكبر من الدرجة القصوى %', NEW.score, e.max_score USING ERRCODE = 'P0001';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER scores_guard BEFORE INSERT OR UPDATE OR DELETE ON scores FOR EACH ROW EXECUTE FUNCTION scores_guard();

-- ---------- المالية ----------
CREATE TABLE invoices (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL,
  student_id   bigint NOT NULL,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  amount       numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  due_date     date,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'void')),
  void_reason  text,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (status = 'open' OR char_length(void_reason) >= 3),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX invoices_student ON invoices (tenant_id, student_id);

CREATE TABLE payments (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        text NOT NULL,
  invoice_id       bigint NOT NULL,
  kind             text NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'refund')),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  method           text NOT NULL CHECK (method IN ('cash', 'transfer', 'card', 'online')),
  receipt_no       text NOT NULL,
  idempotency_key  text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 80),
  provider_ref     text,
  note             text CHECK (char_length(note) <= 300),
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_no),
  UNIQUE (tenant_id, idempotency_key),     -- الضغط المزدوج لا يسجل دفعتين
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX payments_invoice ON payments (invoice_id);

-- صافي المدفوع لفاتورة
CREATE FUNCTION invoice_net_paid(p_invoice bigint) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount ELSE -amount END), 0)
  FROM payments WHERE invoice_id = p_invoice
$$;

-- حماية الدفعات: تقفل الفاتورة، وتمنع الدفع الزائد أو الاسترداد الزائد
CREATE FUNCTION payments_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE inv invoices%ROWTYPE; paid numeric;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  paid := invoice_net_paid(NEW.invoice_id);
  IF NEW.kind = 'payment' THEN
    IF inv.status <> 'open' THEN
      RAISE EXCEPTION 'الفاتورة ملغاة ولا تقبل الدفع' USING ERRCODE = 'P0001';
    END IF;
    IF paid + NEW.amount > inv.amount THEN
      RAISE EXCEPTION 'المبلغ أكبر من المتبقي على الفاتورة (المتبقي %)', inv.amount - paid USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NEW.amount > paid THEN
      RAISE EXCEPTION 'مبلغ الاسترداد أكبر من المدفوع (%)', paid USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_insert BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION payments_before_insert();

-- الدفعات سجل مالي ثابت: لا تعديل ولا حذف (التصحيح يكون باسترداد)
CREATE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'السجل % ثابت ولا يمكن تعديله أو حذفه', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE FUNCTION invoices_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'لا تُحذف الفواتير. استخدم الإلغاء بدلًا من ذلك' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.student_id <> OLD.student_id OR NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'لا يمكن نقل فاتورة لطالب آخر' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.amount <> OLD.amount AND EXISTS (SELECT 1 FROM payments WHERE invoice_id = OLD.id) THEN
    RAISE EXCEPTION 'لا يمكن تعديل مبلغ فاتورة عليها دفعات' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'لا يمكن إعادة فتح فاتورة ملغاة' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'void' AND OLD.status = 'open' AND invoice_net_paid(OLD.id) > 0 THEN
    RAISE EXCEPTION 'لا يمكن إلغاء فاتورة عليها مبالغ مدفوعة. استردها أولًا' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_guard();

-- الطلاب لا يُحذفون نهائيًا (أرشفة فقط) حتى لا تضيع سجلاتهم المالية والأكاديمية
CREATE TRIGGER students_no_delete BEFORE DELETE ON students FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- ---------- الإعلانات ----------
CREATE TABLE announcements (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL,
  class_id    bigint,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  body        text CHECK (char_length(body) <= 2000),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX announcements_tenant ON announcements (tenant_id, created_at DESC);
