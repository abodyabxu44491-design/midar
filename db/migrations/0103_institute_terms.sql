-- =====================================================================
-- مِدار | MIDAR — الترحيل 0103: كلمة المؤسسة في المعاهد والمراكز
--   «org»: الكلمة التي تسمي بها المؤسسة نفسها في لوحتها وشهاداتها (المعهد، المركز…). المركز التعليمي يسمي نفسه «المركز».
--   صفحة التحقق من الشهادة تعرض كلمة المؤسسة نفسها بدل «المعهد» الثابتة. لا يتغير شيء للمدارس ولا للمعاهد الحالية.
-- =====================================================================
UPDATE org_types SET terms = terms || '{"org": "المركز"}', version = version + 1 WHERE key = 'learning_center' AND NOT terms ? 'org';

DROP FUNCTION verify_certificate(text);
CREATE FUNCTION verify_certificate(c text) RETURNS TABLE (school text, student text, class_name text, title text, issued_at timestamptz,
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
REVOKE ALL ON FUNCTION verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_certificate(text) TO midar_app;
