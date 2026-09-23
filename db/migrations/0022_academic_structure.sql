-- =====================================================================
-- مِدار | MIDAR — الترحيل 0022: الهيكل الأكاديمي وملف المدرسة
--
--   المراحل ← الصفوف ← الشعب (الفصول) ← المواد
--   الشعب هي جدول classes نفسه (حتى لا تتأثر الحضور والدرجات والجداول)،
--   ويُضاف لها انتماؤها لصفّها وترتيبها.
-- =====================================================================

/* ---------- ملف المدرسة ---------- */
CREATE TABLE school_profile (
  tenant_id          text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  school_type        text CHECK (school_type IN ('private', 'public', 'international', 'quran', 'other')),
  gender             text CHECK (gender IN ('boys', 'girls', 'mixed')),
  country            text CHECK (char_length(country) <= 60),
  city               text CHECK (char_length(city) <= 60),
  address            text CHECK (char_length(address) <= 200),
  email              text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$'),
  phone              text CHECK (phone ~ '^[0-9+ ]{0,20}$'),
  template           text CHECK (char_length(template) <= 40),
  setup_completed_at timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER school_profile_touch BEFORE UPDATE ON school_profile FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER school_profile_audit AFTER INSERT OR UPDATE OR DELETE ON school_profile FOR EACH ROW EXECUTE FUNCTION audit_row_change();

/* ---------- المراحل ---------- */
CREATE TABLE stages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  code       text CHECK (code ~ '^[a-z_]{2,20}$'),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

/* ---------- الصفوف ---------- */
CREATE TABLE grades (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL,
  stage_id   bigint NOT NULL,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, stage_id, name),
  FOREIGN KEY (tenant_id, stage_id) REFERENCES stages (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX grades_stage ON grades (tenant_id, stage_id, sort_order);

/* ---------- الشعب: نفس جدول الفصول ---------- */
ALTER TABLE classes
  ADD COLUMN grade_id bigint,
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT classes_grade_fk FOREIGN KEY (tenant_id, grade_id) REFERENCES grades (tenant_id, id) ON DELETE SET NULL;
CREATE INDEX classes_grade ON classes (tenant_id, grade_id, sort_order);

/* ---------- المواد: رمز وحصص أسبوعية وربط بالصفوف ---------- */
ALTER TABLE subjects
  ADD COLUMN code text CHECK (code IS NULL OR char_length(code) <= 20),
  ADD COLUMN weekly_periods smallint CHECK (weekly_periods IS NULL OR weekly_periods BETWEEN 0 AND 40),
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;

CREATE TABLE subject_grades (
  tenant_id  text NOT NULL,
  subject_id bigint NOT NULL,
  grade_id   bigint NOT NULL,
  PRIMARY KEY (subject_id, grade_id),
  FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, grade_id)   REFERENCES grades   (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX subject_grades_grade ON subject_grades (tenant_id, grade_id);

/* ---------- العزل والتدقيق ---------- */
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_profile', 'stages', 'grades', 'subject_grades'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO midar_app', t);
  END LOOP;
END $$;
CREATE TRIGGER stages_audit AFTER INSERT OR UPDATE OR DELETE ON stages FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER grades_audit AFTER INSERT OR UPDATE OR DELETE ON grades FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- المدارس القائمة: ملف فارغ يُعبّأ لاحقًا، وتُعتبر مُعدّة إذا كان لديها فصول
INSERT INTO school_profile (tenant_id, setup_completed_at)
SELECT t.id, CASE WHEN EXISTS (SELECT 1 FROM classes c WHERE c.tenant_id = t.id) THEN now() END
  FROM tenants t
ON CONFLICT DO NOTHING;
