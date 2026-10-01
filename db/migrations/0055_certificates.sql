-- =====================================================================
-- مِدار | MIDAR — الترحيل 0055: الشهادات الرسمية برمز تحقق
--   كل شهادة تحفظ نسخة ثابتة من النتيجة وقت إصدارها (لا تتغير لو عُدّلت الدرجات لاحقًا)، ولها رمز فريد
--   على مستوى المنصة. أي شخص يمسح رمز QR يرى: اسم المدرسة، اسم الطالب، الشهادة، النتيجة، وهل هي سارية أو ملغاة.
--   لا يكشف التحقق أي بيانات أخرى عن الطالب.
-- =====================================================================
CREATE TABLE certificates (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code          text NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  student_id    bigint NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('term', 'year', 'custom')),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  term_id       bigint,
  year_id       bigint,
  data          jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  issued_by     text NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 200),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, term_id) REFERENCES terms (tenant_id, id) ON DELETE SET NULL (term_id),
  FOREIGN KEY (tenant_id, year_id) REFERENCES academic_years (tenant_id, id) ON DELETE SET NULL (year_id)
);
-- شهادة سارية واحدة لكل طالب لنفس الفصل أو السنة (إعادة الإصدار تلغي السابقة)
CREATE UNIQUE INDEX certificates_one_valid ON certificates (tenant_id, student_id, kind, COALESCE(term_id, 0), COALESCE(year_id, 0)) WHERE revoked_at IS NULL AND kind <> 'custom';
CREATE INDEX certificates_student ON certificates (tenant_id, student_id, issued_at DESC);
CREATE TRIGGER certificates_audit AFTER INSERT OR UPDATE OR DELETE ON certificates FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certificates USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON certificates TO midar_app;

-- التحقق العام: بالرمز فقط، ويعيد الحد الأدنى اللازم للتأكد من صحة الشهادة
CREATE FUNCTION verify_certificate(c text) RETURNS TABLE (school text, student text, class_name text, title text, issued_at timestamptz,
  revoked boolean, result text, percent numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.name, x.data -> 'student' ->> 'name', x.data -> 'student' ->> 'class_name', x.title, x.issued_at,
         x.revoked_at IS NOT NULL, x.data ->> 'result', NULLIF(x.data -> 'summary' ->> 'percent', '')::numeric
    FROM certificates x JOIN tenants t ON t.id = x.tenant_id
   WHERE x.code = upper(c) AND t.status <> 'archived';
$$;
REVOKE ALL ON FUNCTION verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_certificate(text) TO midar_app;
