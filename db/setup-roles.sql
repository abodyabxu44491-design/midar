-- =====================================================================
-- إعداد قاعدة البيانات لأول مرة (يُشغَّل مرة واحدة بحساب postgres)
--   sudo -u postgres psql -v owner_pw="'كلمة-قوية-1'" -v app_pw="'كلمة-قوية-2'" -f db/setup-roles.sql
--
-- midar_owner : يملك الجداول ويشغّل الترحيلات فقط
-- midar_app   : يستخدمه التطبيق، صلاحياته محدودة ويخضع لعزل المدارس
-- =====================================================================
CREATE ROLE midar_owner LOGIN PASSWORD :owner_pw;
CREATE ROLE midar_app LOGIN PASSWORD :app_pw NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
-- في Cloud SQL يجب أن يكون المستخدم الحالي عضوًا في الدور ليجعله مالك القاعدة
GRANT midar_owner TO CURRENT_USER;
CREATE DATABASE midar OWNER midar_owner ENCODING 'UTF8' TEMPLATE template0;
\connect midar
REVOKE ALL ON DATABASE midar FROM PUBLIC;
GRANT CONNECT ON DATABASE midar TO midar_app;
ALTER SCHEMA public OWNER TO midar_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
