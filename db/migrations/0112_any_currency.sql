-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.
--
-- Schools work in any currency, not only SAR, YER or USD. The list of currencies the platform offers lives in one
-- place (public/shared/js/currencies.js) and the server checks against it; the database only requires an ISO 4217
-- code, so adding a currency never needs a migration again.
ALTER TABLE tenants DROP CONSTRAINT tenants_currency_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_currency_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE finance_accounts DROP CONSTRAINT finance_accounts_currency_check;
ALTER TABLE finance_accounts ADD CONSTRAINT finance_accounts_currency_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE plans DROP CONSTRAINT plans_currency_check;
ALTER TABLE plans ADD CONSTRAINT plans_currency_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_currency_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_currency_check CHECK (currency ~ '^[A-Z]{3}$');
