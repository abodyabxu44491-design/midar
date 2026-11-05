/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// School isolation is enforced by row-level security in the database, so its configuration is tested on its own:
// a new table that holds a school's data without a policy, or an application role able to bypass the policies, would
// let a single query with a forgotten school filter read every school (docs/cloudflare/ARCHITECTURE-DECISION.md).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { transaction } from "../src/core/db/pool.js";
import { endPool } from "./helpers.js";

after(() => endPool());
const q = (sql) => transaction({ platform: true }, (run) => run(sql));

test("كل جدول فيه بيانات مدرسة (tenant_id) عليه سياسة عزل مفعّلة", async () => {
  const rows = await q(`
    SELECT c.relname AS name, c.relrowsecurity AS rls,
           EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS has_policy
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relkind IN ('r', 'p') AND c.relnamespace = 'public'::regnamespace`);
  assert.ok(rows.length > 100, "الجداول موجودة");
  const unprotected = rows.filter((r) => !r.rls || !r.has_policy).map((r) => r.name);
  assert.deepEqual(unprotected, [], `جداول بلا عزل: ${unprotected.join(", ")}`);
});

test("دور التطبيق لا يتجاوز العزل ولا يملك الجداول", async () => {
  const [me] = await q("SELECT current_user AS name, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user");
  assert.equal(me.rolsuper, false, "دور التطبيق ليس مديرًا عامًا");
  assert.equal(me.rolbypassrls, false, "دور التطبيق لا يتجاوز سياسات العزل");
  // A table owner is exempt from its policies unless FORCE is set; the application role must own none.
  const [{ n }] = await q("SELECT count(*)::int AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)");
  assert.equal(n, 0, "دور التطبيق لا يملك أي جدول");
});

test("استعلام بلا شرط المدرسة لا يرى إلا مدرسته (محاكاة خطأ مبرمج)", async () => {
  const tenants = await q("SELECT id FROM tenants ORDER BY created_at LIMIT 2");
  if (tenants.length < 2) return;   // a fresh database without schools: covered by the isolation matrix instead
  const [a] = tenants;
  const seen = await transaction({ tenantId: a.id }, (run) => run("SELECT DISTINCT tenant_id FROM students"));
  assert.ok(seen.every((r) => r.tenant_id === a.id), `ظهرت مدارس أخرى: ${seen.map((r) => r.tenant_id).join(", ")}`);
});
