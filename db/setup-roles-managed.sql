-- Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.
CREATE ROLE midar_app LOGIN PASSWORD 'ضع-كلمة-مرور-قوية-هنا' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE current_database() TO midar_app;
GRANT USAGE ON SCHEMA public TO midar_app;

