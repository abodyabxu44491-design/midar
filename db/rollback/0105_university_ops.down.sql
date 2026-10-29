-- =====================================================================
-- مِدار | MIDAR — الرجوع عن الترحيل 0105، عند الحاجة فقط وبعد نسخة احتياطية، ومع إرجاع الكود السابق.
--   فواتير الساعات الصادرة تبقى فواتير عادية في جدول الفواتير؛ يُحذف فقط ربطها بالفصول الجامعية.
--   التشغيل: psql "$MIGRATION_DATABASE_URL" -1 -f db/rollback/0105_university_ops.down.sql
-- =====================================================================
DROP TABLE IF EXISTS uni_term_invoices;
ALTER TABLE uni_student_programs DROP COLUMN IF EXISTS graduated_on, DROP COLUMN IF EXISTS final_cgpa;
ALTER TABLE uni_settings DROP COLUMN IF EXISTS credit_fee, DROP COLUMN IF EXISTS grad_min_cgpa, DROP COLUMN IF EXISTS self_registration;
ALTER TABLE uni_sections DROP CONSTRAINT IF EXISTS uni_sections_time, DROP COLUMN IF EXISTS days, DROP COLUMN IF EXISTS starts_at, DROP COLUMN IF EXISTS ends_at;
CREATE OR REPLACE FUNCTION verify_certificate(c text) RETURNS TABLE (school text, student text, class_name text, title text, issued_at timestamptz,
  revoked boolean, result text, percent numeric, org_type text, kind text, course text, program text, hours numeric, completed_on text,
  status text, serial text, replaced_on timestamptz, org_word text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.name, x.data -> 'student' ->> 'name', x.data -> 'student' ->> 'class_name', x.title, x.issued_at,
         x.status <> 'issued', x.data ->> 'result', NULLIF(x.data -> 'summary' ->> 'percent', '')::numeric,
         t.org_type, x.kind, x.data -> 'course' ->> 'name', x.data -> 'course' ->> 'program',
         NULLIF(x.data -> 'course' ->> 'hours', '')::numeric, x.data -> 'course' ->> 'completed_on',
         x.status, x.serial, CASE WHEN x.status <> 'issued' THEN x.revoked_at END,
         CASE WHEN t.org_type = 'institute'
              THEN COALESCE(NULLIF(i.terms ->> 'org', ''), NULLIF(o.terms ->> 'org', ''), 'المعهد') ELSE 'المدرسة' END
    FROM certificates x JOIN tenants t ON t.id = x.tenant_id JOIN org_types o ON o.key = t.org_type_key
    LEFT JOIN institute_settings i ON i.tenant_id = t.id
   WHERE x.code = upper(c) AND t.status <> 'archived';
$$;
DELETE FROM schema_migrations WHERE filename = '0105_university_ops.sql';
