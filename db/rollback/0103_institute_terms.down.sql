-- =====================================================================
-- مِدار | MIDAR — الرجوع عن الترحيل 0103، عند الحاجة فقط وبعد نسخة احتياطية، ومع إرجاع الكود السابق.
--   التشغيل: psql "$MIGRATION_DATABASE_URL" -1 -f db/rollback/0103_institute_terms.down.sql
-- =====================================================================
UPDATE org_types SET terms = terms - 'org', version = version - 1 WHERE key = 'learning_center' AND terms ->> 'org' = 'المركز';
DROP FUNCTION verify_certificate(text);
CREATE FUNCTION verify_certificate(c text) RETURNS TABLE (school text, student text, class_name text, title text, issued_at timestamptz,
  revoked boolean, result text, percent numeric, org_type text, kind text, course text, program text, hours numeric, completed_on text,
  status text, serial text, replaced_on timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.name, x.data -> 'student' ->> 'name', x.data -> 'student' ->> 'class_name', x.title, x.issued_at,
         x.status <> 'issued', x.data ->> 'result', NULLIF(x.data -> 'summary' ->> 'percent', '')::numeric,
         t.org_type, x.kind, x.data -> 'course' ->> 'name', x.data -> 'course' ->> 'program',
         NULLIF(x.data -> 'course' ->> 'hours', '')::numeric, x.data -> 'course' ->> 'completed_on',
         x.status, x.serial, CASE WHEN x.status <> 'issued' THEN x.revoked_at END
    FROM certificates x JOIN tenants t ON t.id = x.tenant_id
   WHERE x.code = upper(c) AND t.status <> 'archived';
$$;
REVOKE ALL ON FUNCTION verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_certificate(text) TO midar_app;
DELETE FROM schema_migrations WHERE filename = '0103_institute_terms.sql';
