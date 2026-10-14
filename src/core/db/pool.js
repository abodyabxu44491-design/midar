/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import pg from "pg";
import { env } from "../../config/env.js";
import { performance } from "node:perf_hooks";
import { recordQuery, recordTx } from "../perf.js";

pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));   // numeric
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

const common = {
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  application_name: "midar",
};

let poolPromise = null;

async function createPool() {
  const pool = new pg.Pool({ ...common, connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : false });
  pool.on("error", (err) => console.error("[db] خطأ في اتصال خامل:", err.message));
  return pool;
}

export function getPool() {
  poolPromise ??= createPool().catch((e) => { poolPromise = null; throw e; });
  return poolPromise;
}

export async function closePool() {
  if (!poolPromise) return;
  const p = await poolPromise;
  await p.end();
  poolPromise = null;
}

async function connect() {
  const pool = await getPool();
  try { return await pool.connect(); } catch (e) {
    await new Promise((r) => setTimeout(r, 800));
    return pool.connect();
  }
}

export async function transaction(ctx, fn) {
  const client = await connect();
  recordTx();
  const raw = client.query.bind(client);
  const timed = async (...a) => { const t = performance.now(); try { return await raw(...a); } finally { recordQuery(performance.now() - t); } };
  client.query = timed;
  try {
    const lit = (v) => client.escapeLiteral(String(v));
    await client.query(
      `BEGIN ISOLATION LEVEL READ COMMITTED;
       SELECT set_config('app.tenant_id', ${lit(ctx.tenantId || "")}, true), set_config('app.actor', ${lit(ctx.actor || "system")}, true),
              set_config('app.ip', ${lit(ctx.ip || "")}, true), set_config('app.platform', ${lit(ctx.platform ? "on" : "off")}, true),
              set_config('app.session_hash', ${lit(ctx.sessionHash || "")}, true)`);
    const q = async (sql, params = []) => (await client.query(sql, params)).rows;
    const after = [];
    q.afterCommit = (job) => after.push(job);
    const result = await fn(q, client);
    await client.query("COMMIT");
    for (const job of after) Promise.resolve().then(job).catch((e) => console.error("[after-commit]", e.message));
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.query = raw;
    client.release();
  }
}

export const inTenant = (req, fn) =>
  transaction({ tenantId: req.tenantId, actor: req.actor, ip: req.ip }, fn);

export async function healthCheck() {
  const r = await (await getPool()).query("SELECT 1 AS ok");
  return r.rows[0].ok === 1;
}
