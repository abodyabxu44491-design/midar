// Backup and restore drill for each backend: back up, restore into a separate copy, compare every row.
// A backup only counts if its restore was verified, so the comparison is on content (a hash of all rows per table),
// not on the export finishing without an error.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8790", KEY = "lab-only-secret-not-for-production";
const OUT = process.env.DRILL_DIR || "/tmp/lab-drill";
fs.mkdirSync(OUT, { recursive: true });
const TABLES = ["users", "classes", "students", "grades", "attendance", "invoices", "payments", "audit_log"];
const digest = (rows) => createHash("sha256").update(JSON.stringify(rows.map((r) => Object.values(r).map(String)).sort())).digest("hex").slice(0, 16);
const post = async (b, p, body, headers = {}) => (await fetch(`${BASE}/${b}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })).json();
const time = (fn) => { const t = performance.now(); const r = fn(); return [r, Math.round(performance.now() - t)]; };
const report = [];

// Some activity first, so payments, grades, attendance and audit rows exist.
async function activity(b, tenant, base) {
  await post(b, "/seed", { tenant, base }, { "x-lab-key": KEY });
  const tok = async (u) => (await post(b, "/login", { tenant, username: u, password: `lab:${tenant}:${u}` })).token;
  const acc = await tok("accountant"), tch = await tok("teacher1");
  for (let i = 0; i < 5; i++) await post(b, "/payments", { invoice_id: base + 1, amount: 50, idem_key: `drill-${tenant}-${i}` }, { authorization: `Bearer ${acc}` });
  await fetch(`${BASE}/${b}/grades`, { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${tch}` }, body: JSON.stringify({ student_id: base + 1, subject: "math", score: 88 }) });
  await post(b, "/attendance", { student_id: base + 1, day: "2026-11-05", status: "present" }, { authorization: `Bearer ${tch}` });
}

// ---- PostgreSQL: pg_dump of the whole database, pg_restore into a new one ----
{
  const tenant = `drill-pg-${Date.now()}`;
  await activity("pg", tenant, 880000);
  const env = { ...process.env, PGPASSWORD: "postgres" };
  const file = path.join(OUT, "pg.dump");
  const [, tDump] = time(() => execFileSync("pg_dump", ["-h", "127.0.0.1", "-U", "postgres", "-Fc", "-f", file, "midar_lab"], { env }));
  execFileSync("psql", ["-h", "127.0.0.1", "-U", "postgres", "-q", "-c", "DROP DATABASE IF EXISTS midar_lab_restore", "-c", "CREATE DATABASE midar_lab_restore OWNER lab_owner"], { env });
  const [, tRestore] = time(() => execFileSync("pg_restore", ["-h", "127.0.0.1", "-U", "postgres", "-d", "midar_lab_restore", "--no-owner", "--role=lab_owner", file], { env }));
  const rows = (db, t) => JSON.parse(execFileSync("psql", ["-h", "127.0.0.1", "-U", "postgres", "-d", db, "-At", "-c", `SELECT coalesce(json_agg(x), '[]') FROM ${t} x`], { env }).toString());
  const tables = TABLES.map((t) => { const a = rows("midar_lab", t), r = rows("midar_lab_restore", t); return { t, rows: a.length, same: digest(a) === digest(r) }; });
  // RLS must survive the restore: the restored copy still hides other schools from the application role.
  const rls = execFileSync("psql", ["-h", "127.0.0.1", "-U", "postgres", "-d", "midar_lab_restore", "-At", "-c", "SELECT count(*) FROM pg_policies WHERE policyname = 'tenant_isolation'"], { env }).toString().trim();
  report.push({ backend: "pg", scope: "whole database (every school)", backup_ms: tDump, restore_ms: tRestore, bytes: fs.statSync(file).size, tables, extra: `RLS policies after restore: ${rls}/8` });
}

// ---- D1: wrangler d1 export (SQL), loaded into a fresh SQLite database ----
{
  const tenant = `drill-d1-${Date.now()}`;
  await activity("d1", tenant, 890000);
  const file = path.join(OUT, "d1.sql");
  const [, tDump] = time(() => execFileSync("npx", ["wrangler", "d1", "export", "midar-lab", "--local", "--output", file], { stdio: "pipe" }));
  const restored = new DatabaseSync(":memory:");
  const [, tRestore] = time(() => restored.exec(fs.readFileSync(file, "utf8")));
  const tables = [];
  for (const t of TABLES) {
    const live = await post("d1", "/admin/table", { table: t }, { "x-lab-key": KEY });
    const r = restored.prepare(`SELECT * FROM ${t}`).all();
    tables.push({ t, rows: r.length, same: r.length === live.length && digest(r) === digest(live) });
  }
  const triggers = restored.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'").get().n;
  report.push({ backend: "d1", scope: "whole database (every school)", backup_ms: tDump, restore_ms: tRestore, bytes: fs.statSync(file).size, tables, extra: `triggers after restore: ${triggers}/5` });
}

// ---- Durable Object per school: custom export of one school, import into a new object ----
{
  const tenant = `drill-do-${Date.now()}`;
  await activity("do", tenant, 900000);
  const t0 = performance.now();
  const data = await post("do", "/admin/export", { tenant }, { "x-lab-key": KEY });
  const tDump = Math.round(performance.now() - t0);
  fs.writeFileSync(path.join(OUT, "do.json"), JSON.stringify(data));
  const t1 = performance.now();
  await post("do", "/admin/import", { tenant: `${tenant}#restore`, data }, { "x-lab-key": KEY });
  const tRestore = Math.round(performance.now() - t1);
  const back = await post("do", "/admin/export", { tenant: `${tenant}#restore` }, { "x-lab-key": KEY });
  const tables = TABLES.map((t) => ({ t, rows: data[t].length, same: digest(data[t]) === digest(back[t]) }));
  report.push({ backend: "do", scope: "one school (repeat for every school)", backup_ms: tDump, restore_ms: tRestore, bytes: fs.statSync(path.join(OUT, "do.json")).size, tables, extra: "export/import is code written for this lab" });
}

for (const r of report) {
  const ok = r.tables.every((x) => x.same);
  console.log(`\n[${r.backend}] ${r.scope}: backup ${r.backup_ms} ms, restore ${r.restore_ms} ms, ${r.bytes} bytes, ${ok ? "ALL TABLES IDENTICAL" : "MISMATCH"} | ${r.extra}`);
  console.log("  " + r.tables.map((x) => `${x.t}:${x.rows}${x.same ? "" : "✗"}`).join("  "));
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
