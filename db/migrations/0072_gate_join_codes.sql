-- =====================================================================
-- مِدار | MIDAR — الترحيل 0072: ربط أي جوال بالبوابة برمز قصير
--   الإدارة تُظهر رمزًا من 6 أرقام (ورمز QR) صالحًا لمدة محددة ولعدد محدد من الجوالات.
--   الحارس يفتح صفحة البوابة ويكتب الرمز (أو يمسح QR) ← يصير جواله جهاز بوابة:
--   مفعّلًا فورًا إن اختارت الإدارة ذلك، وإلا بانتظار موافقتها.
--   الرمز يُحفظ كبصمة للبحث، ونسخة مشفرة ليبقى ظاهرًا للإدارة طوال صلاحيته.
-- =====================================================================
CREATE TABLE gate_join_codes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  gate_id       bigint NOT NULL,
  code_hash     bytea NOT NULL,
  code_enc      text NOT NULL,
  expires_at    timestamptz NOT NULL,
  max_devices   integer NOT NULL DEFAULT 1 CHECK (max_devices BETWEEN 1 AND 50),
  used_count    integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  auto_approve  boolean NOT NULL DEFAULT false,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, gate_id) REFERENCES gates (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX gate_join_codes_lookup ON gate_join_codes (tenant_id, code_hash) WHERE revoked_at IS NULL;
ALTER TABLE gate_join_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gate_join_codes USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON gate_join_codes TO midar_app;

-- من أين جاء الجهاز: رابط لمرة واحدة (link) أو رمز الربط (code)
ALTER TABLE gate_devices ADD COLUMN join_code_id bigint;
ALTER TABLE gate_devices ADD CONSTRAINT gate_devices_join_code_fk FOREIGN KEY (tenant_id, join_code_id)
  REFERENCES gate_join_codes (tenant_id, id) ON DELETE SET NULL (join_code_id);
