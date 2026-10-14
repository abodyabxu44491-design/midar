-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- Testimonials: real school reviews the owner adds, approves and orders. Only approved ones with consent are public.
CREATE TABLE testimonials (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_name  text NOT NULL CHECK (char_length(school_name) BETWEEN 2 AND 150),
  author_name  text CHECK (char_length(author_name) <= 120),
  author_title text CHECK (char_length(author_title) <= 80),
  body         text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 600),
  rating       smallint CHECK (rating BETWEEN 1 AND 5),
  logo         text CHECK (logo IS NULL OR (logo ~ '^data:image/(png|jpeg|webp);base64,' AND char_length(logo) < 400000)),
  consent      boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  tenant_id    text REFERENCES tenants(id) ON DELETE SET NULL,
  sort         int NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER testimonials_touch BEFORE UPDATE ON testimonials FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
CREATE POLICY testimonials_read ON testimonials FOR SELECT USING (true);
CREATE POLICY testimonials_write ON testimonials FOR ALL USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON testimonials TO midar_app;

-- Plans: a first-year price (the renewal price stays yearly_price), who the plan is for, and how many schools it covers.
ALTER TABLE plans
  ADD COLUMN first_year_price   numeric(12,2) CHECK (first_year_price IS NULL OR first_year_price >= 0),
  ADD COLUMN audience           text CHECK (char_length(audience) <= 400),
  ADD COLUMN max_schools        int NOT NULL DEFAULT 1 CHECK (max_schools BETWEEN 1 AND 100),
  ADD COLUMN extra_school_price numeric(12,2) CHECK (extra_school_price IS NULL OR extra_school_price >= 0);

-- Registration details (school and manager) kept with the request.
ALTER TABLE leads ADD COLUMN details jsonb NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION submit_lead(p jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id bigint; k text := COALESCE(p ->> 'kind', 'trial'); pl bigint := NULLIF(p ->> 'plan_id', '')::bigint;
        key9 text := right(regexp_replace(COALESCE(p ->> 'phone', ''), '\D', '', 'g'), 9); dup bigint;
BEGIN
  IF k NOT IN ('trial', 'subscription', 'contact') THEN
    RAISE EXCEPTION 'نوع الطلب غير صحيح' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM leads WHERE ip = NULLIF(current_setting('app.ip', true), '')::inet
       AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'تم استقبال طلبك مسبقًا. سنتواصل معك قريبًا.' USING ERRCODE = 'P0001';
  END IF;
  IF k <> 'contact' AND length(key9) >= 8 THEN
    SELECT id INTO dup FROM leads
     WHERE kind = k AND status IN ('new', 'reviewing', 'approved', 'awaiting_payment')
       AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 9) = key9
       AND created_at > now() - interval '60 days'
     ORDER BY id DESC LIMIT 1;
    IF dup IS NOT NULL THEN
      RAISE EXCEPTION 'لديك طلب قائم بالرقم % وهو قيد المراجعة. تابع حالته من «متابعة طلب».', dup USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF pl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plans WHERE id = pl AND status = 'active' AND is_public) THEN
    RAISE EXCEPTION 'الباقة المختارة غير متاحة' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO leads (school_name, contact_name, phone, email, city, students_count, note, ip,
                     kind, source, plan_id, billing_cycle, months, try_plan, addon_keys, details)
  VALUES (p ->> 'school_name', p ->> 'contact_name', p ->> 'phone', p ->> 'email', p ->> 'city',
          NULLIF(p ->> 'students_count', '')::int, p ->> 'note', NULLIF(current_setting('app.ip', true), '')::inet,
          k, 'public', pl, NULLIF(p ->> 'billing_cycle', ''), NULLIF(p ->> 'months', '')::int,
          COALESCE((p ->> 'try_plan')::boolean, true),
          COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p -> 'addon_keys', '[]'))
                          INTERSECT SELECT key FROM features WHERE is_active AND requestable), '{}'),
          COALESCE(p -> 'details', '{}'))
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

-- Public status lookup: request number + the phone used on it.
CREATE OR REPLACE FUNCTION lead_status(p_id bigint, p_phone text)
RETURNS TABLE (id bigint, kind text, status text, school_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.kind, l.status, l.school_name, l.created_at, l.updated_at FROM leads l
   WHERE l.id = p_id AND length(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')) >= 8
     AND right(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 9) = right(regexp_replace(p_phone, '\D', '', 'g'), 9)
$$;
REVOKE ALL ON FUNCTION lead_status(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lead_status(bigint, text) TO midar_app;

-- The three public plans as the owner priced them. Every feature is in every plan; plans differ by size.
UPDATE plans SET name = 'مدار الأساسية', tagline = 'للمدارس الصغيرة', first_year_price = 299, yearly_price = 500, monthly_price = NULL, max_students = 500, max_schools = 1,
  audience = 'المدارس الصغيرة التي تريد تنظيم أعمالها الأساسية والانتقال من الورق إلى نظام إلكتروني.',
  discount_kind = 'none', discount_value = NULL, sale_yearly_price = NULL, sale_monthly_price = NULL, promo_percent = NULL, promo_ends_at = NULL
 WHERE code = 'basic';
UPDATE plans SET name = 'مدار المتقدمة', tagline = 'للمدارس المتوسطة', first_year_price = 499, yearly_price = 800, monthly_price = NULL, max_students = 1000, max_schools = 1,
  audience = 'المدارس المتوسطة التي تعتمد على النظام في الإدارة والمعلمين والمحاسبة وتحتاج متابعة أوسع.',
  discount_kind = 'none', discount_value = NULL, sale_yearly_price = NULL, sale_monthly_price = NULL, promo_percent = NULL, promo_ends_at = NULL, highlight = true
 WHERE code = 'pro';
UPDATE plans SET name = 'مدار الاحترافية', tagline = 'لمجموعات المدارس', first_year_price = 999, yearly_price = 1500, monthly_price = NULL, max_students = NULL, max_schools = 3,
  extra_school_price = 200,
  audience = 'المدارس الكبيرة والمجموعات التي تدير أكثر من مدرسة من مركز تحكم واحد، لكل مدرسة إدارتها الخاصة.',
  discount_kind = 'none', discount_value = NULL, sale_yearly_price = NULL, sale_monthly_price = NULL, promo_percent = NULL, promo_ends_at = NULL, highlight = false
 WHERE code = 'enterprise';
INSERT INTO plan_features (plan_id, feature_key, sort)
SELECT p.id, f.key, f.sort FROM plans p CROSS JOIN features f
 WHERE p.code IN ('basic', 'pro', 'enterprise') AND f.is_active
ON CONFLICT DO NOTHING;
