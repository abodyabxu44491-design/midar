-- =====================================================================
-- مِدار | MIDAR — الترحيل 0061: قنوات مجانية بلا تكلفة على المنصة
--   1) مفتاح المساعد الذكي الخاص بالمدرسة (مشفّر، لا يُعاد للواجهة أبدًا)
--   2) بوابة رسائل نصية خاصة بالمدرسة (جوال أندرويد بشريحتها أو مزوّدها) — لا تستهلك رصيد المنصة
--   3) قائمة إرسال واتساب: رسائل جاهزة يرسلها الإداري واحدة تلو الأخرى من جواله مجانًا
-- =====================================================================

CREATE TABLE school_ai (
  tenant_id   text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  key_sealed  text NOT NULL,                                  -- مفتاح Anthropic مشفّرًا بمفتاح الخادم
  key_hint    text NOT NULL CHECK (key_hint ~ '^[A-Za-z0-9_-]{4}$'),   -- آخر 4 أحرف للتعرّف عليه فقط
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE school_ai ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_ai USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON school_ai TO midar_app;

CREATE TABLE school_sms_gateway (
  tenant_id     text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  enabled       boolean NOT NULL DEFAULT false,
  preset        text NOT NULL DEFAULT 'android' CHECK (preset IN ('android', 'custom')),
  url           text NOT NULL DEFAULT '' CHECK (url = '' OR (url ~ '^https://' AND char_length(url) <= 500)),
  method        text NOT NULL DEFAULT 'POST' CHECK (method IN ('GET', 'POST')),
  content_type  text NOT NULL DEFAULT 'json' CHECK (content_type IN ('json', 'form')),
  body_template text NOT NULL DEFAULT '' CHECK (char_length(body_template) <= 2000),
  headers_sealed text,                                        -- بيانات الدخول مشفّرة
  sender        text NOT NULL DEFAULT '' CHECK (char_length(sender) <= 20),
  success_match text NOT NULL DEFAULT '' CHECK (char_length(success_match) <= 100),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE school_sms_gateway ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_sms_gateway USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON school_sms_gateway TO midar_app;

-- من أي بوابة خرجت الرسالة: بوابة المنصة (برصيد) أو بوابة المدرسة (مجانًا على المنصة)
ALTER TABLE sms_messages ADD COLUMN via text NOT NULL DEFAULT 'platform' CHECK (via IN ('platform', 'school'));

CREATE TABLE wa_outbox (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id  bigint,
  phone       text NOT NULL CHECK (phone ~ '^[0-9]{8,15}$'),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1500),
  kind        text NOT NULL CHECK (kind ~ '^[a-z_]{2,30}$'),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_by     text,
  done_at     timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX wa_outbox_pending ON wa_outbox (tenant_id, status, id);
ALTER TABLE wa_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wa_outbox USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON wa_outbox TO midar_app;
