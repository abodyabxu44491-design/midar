-- Midar (مدار) - School Management Platform
-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.

-- The link between a manager's account and the school is access, not school data: a backup never carries it,
-- a restore never brings an old link back, and resetting the school keeps its manager. Deleting the school
-- removes it with the school (foreign key).
CREATE OR REPLACE FUNCTION danger_tables() RETURNS TABLE (name text, depth int, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE t AS (
    SELECT c.table_name::text AS name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name NOT IN ('danger_operations', 'tenant_backups')
  ), fk AS (
    SELECT DISTINCT k.conrelid::regclass::text AS child, k.confrelid::regclass::text AS parent
      FROM pg_constraint k WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace
       AND k.conrelid <> k.confrelid
       AND k.conrelid::regclass::text IN (SELECT name FROM t) AND k.confrelid::regclass::text IN (SELECT name FROM t)
  ), d AS (
    SELECT name, 0 AS depth FROM t
    UNION ALL
    SELECT fk.child, d.depth + 1 FROM d JOIN fk ON fk.parent = d.name WHERE d.depth < 50
  )
  SELECT name, max(depth)::int,
         CASE WHEN name IN ('account_schools') THEN 'access'
              WHEN name IN ('audit_log', 'security_events', 'sms_messages', 'ai_queries', 'notification_deliveries',
                            'attendance_events', 'attendance_audit') THEN 'log'
              WHEN name IN ('sessions', 'sync_changes', 'sync_devices', 'sync_operations', 'password_requests', 'push_subscriptions',
                            'notification_prefs', 'gate_devices') THEN 'transient'
              WHEN name IN ('subscriptions', 'subscription_events', 'subscription_invoices', 'tenant_prices', 'renewal_requests', 'leads', 'sms_ledger') THEN 'billing'
              ELSE 'data' END
    FROM d GROUP BY name;
$$;
-- A restore deletes and re-inserts the school's users with the same ids; the link to the manager's account
-- must survive it, so it refers to the admin user by id without a cascading key. Every entry to the school
-- checks on the server that this admin user still exists and is active.
ALTER TABLE account_schools DROP CONSTRAINT account_schools_user_id_fkey;
