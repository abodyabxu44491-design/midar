-- =====================================================================
-- مِدار | MIDAR — الترحيل 0006: اشتراكات المدارس وفواتيرها
--   - سعر سنوي لكل مدرسة ومدة سماح بعد الانتهاء
--   - فواتير اشتراك يصدرها المالك ويسجل سدادها
--   - إيقاف تلقائي بعد انتهاء مدة السماح
-- =====================================================================

ALTER TABLE tenants
  ADD COLUMN subscription_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (subscription_price >= 0),
  ADD COLUMN grace_days integer NOT NULL DEFAULT 14 CHECK (grace_days BETWEEN 0 AND 120),
  ADD COLUMN auto_suspended_at timestamptz;

CREATE TABLE subscription_invoices (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  amount        numeric(12,2) NOT NULL CHECK (amount >= 0),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  paid_at       timestamptz,
  method        text CHECK (method IN ('cash', 'transfer', 'card', 'online')),
  note          text CHECK (char_length(note) <= 300),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL)),
  UNIQUE (tenant_id, period_start)
);
CREATE INDEX subscription_invoices_tenant ON subscription_invoices (tenant_id, id DESC);
CREATE TRIGGER subscription_invoices_touch BEFORE UPDATE ON subscription_invoices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- فواتير الاشتراك تخص المنصة، فلا تراها المدارس
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_platform ON subscription_invoices USING (current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE ON subscription_invoices TO midar_app;

-- إيقاف المدارس التي انتهى اشتراكها ومدة السماح، وإرجاع ما أُوقف
CREATE FUNCTION suspend_expired_tenants() RETURNS TABLE (tenant_id text, name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH expired AS (
    UPDATE tenants SET status = 'suspended', auto_suspended_at = now()
     WHERE status = 'active' AND subscription_end IS NOT NULL
       AND subscription_end + make_interval(days => grace_days) < CURRENT_DATE
    RETURNING id, name
  ), kicked AS (
    DELETE FROM sessions WHERE tenant_id IN (SELECT id FROM expired)
  )
  SELECT id, name FROM expired;
$$;
GRANT EXECUTE ON FUNCTION suspend_expired_tenants() TO midar_app;
