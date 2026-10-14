-- Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.
CREATE ROLE midar_owner LOGIN PASSWORD :owner_pw;
CREATE ROLE midar_app LOGIN PASSWORD :app_pw NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT midar_owner TO CURRENT_USER;
CREATE DATABASE midar OWNER midar_owner ENCODING 'UTF8' TEMPLATE template0;
\connect midar
REVOKE ALL ON DATABASE midar FROM PUBLIC;
GRANT CONNECT ON DATABASE midar TO midar_app;
ALTER SCHEMA public OWNER TO midar_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
