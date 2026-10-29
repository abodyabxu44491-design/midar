-- =====================================================================
-- مِدار | MIDAR — الترحيل 0105: تشغيل الجامعة
--   مواعيد منظمة للشعب (أيام ووقت بداية ونهاية) لمنع تعارض الجدول عند التسجيل.
--   إعدادات: رسوم الساعة المعتمدة، والمعدل الأدنى للتخرج، وتسجيل الطالب بنفسه.
--   التخرج: تاريخه والمعدل النهائي. ورسوم الساعات: ما فُوتر لكل طالب في كل فصل.
--   صفحة التحقق تقول «الجامعة» لشهادات الجامعات. إضافي فقط.
-- =====================================================================
ALTER TABLE uni_sections
  ADD COLUMN days      smallint[] NOT NULL DEFAULT '{}' CHECK (days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  ADD COLUMN starts_at time,
  ADD COLUMN ends_at   time,
  ADD CONSTRAINT uni_sections_time CHECK ((starts_at IS NULL) = (ends_at IS NULL) AND (starts_at IS NULL OR ends_at > starts_at));

ALTER TABLE uni_settings
  ADD COLUMN credit_fee        numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit_fee >= 0),
  ADD COLUMN grad_min_cgpa     numeric(3,2) NOT NULL DEFAULT 2 CHECK (grad_min_cgpa >= 0),
  ADD COLUMN self_registration boolean NOT NULL DEFAULT true;

ALTER TABLE uni_student_programs
  ADD COLUMN graduated_on date,
  ADD COLUMN final_cgpa   numeric(3,2);

CREATE TABLE uni_term_invoices (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id bigint NOT NULL,
  term_id    bigint NOT NULL,
  invoice_id bigint NOT NULL,
  credits    smallint NOT NULL CHECK (credits >= 0),
  amount     numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, term_id) REFERENCES uni_terms(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX uni_term_invoices_student ON uni_term_invoices (tenant_id, student_id, term_id);
ALTER TABLE uni_term_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON uni_term_invoices USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE TRIGGER uni_term_invoices_audit AFTER INSERT OR UPDATE OR DELETE ON uni_term_invoices FOR EACH ROW EXECUTE FUNCTION audit_row_change();
GRANT SELECT, INSERT, UPDATE, DELETE ON uni_term_invoices TO midar_app;

CREATE OR REPLACE FUNCTION verify_certificate(c text) RETURNS TABLE (school text, student text, class_name text, title text, issued_at timestamptz,
  revoked boolean, result text, percent numeric, org_type text, kind text, course text, program text, hours numeric, completed_on text,
  status text, serial text, replaced_on timestamptz, org_word text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.name, x.data -> 'student' ->> 'name', x.data -> 'student' ->> 'class_name', x.title, x.issued_at,
         x.status <> 'issued', x.data ->> 'result', NULLIF(x.data -> 'summary' ->> 'percent', '')::numeric,
         t.org_type, x.kind, x.data -> 'course' ->> 'name', x.data -> 'course' ->> 'program',
         NULLIF(x.data -> 'course' ->> 'hours', '')::numeric, x.data -> 'course' ->> 'completed_on',
         x.status, x.serial, CASE WHEN x.status <> 'issued' THEN x.revoked_at END,
         CASE t.org_type
              WHEN 'institute' THEN COALESCE(NULLIF(i.terms ->> 'org', ''), NULLIF(o.terms ->> 'org', ''), 'المعهد')
              WHEN 'university' THEN COALESCE(NULLIF(o.terms ->> 'org', ''), 'الجامعة')
              ELSE 'المدرسة' END
    FROM certificates x JOIN tenants t ON t.id = x.tenant_id JOIN org_types o ON o.key = t.org_type_key
    LEFT JOIN institute_settings i ON i.tenant_id = t.id
   WHERE x.code = upper(c) AND t.status <> 'archived';
$$;
