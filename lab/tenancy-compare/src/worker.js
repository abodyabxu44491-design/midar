// Tenancy comparison lab: one API, one set of business rules, three storage backends.
//   /d1/...  Cloudflare D1, one database shared by all schools (isolation by tenant_id in every query)
//   /do/...  a Durable Object with its own SQLite database per school (physical isolation)
//   /pg/...  PostgreSQL behind Hyperdrive with row-level security (isolation enforced by the database)
// Test data only. The school always comes from the signed token, never from the request body or headers.
import { DurableObject } from "cloudflare:workers";
import schemaSql from "../sql/sqlite-schema.sql";
import { sqliteOps } from "./sqlite-ops.js";
import { pgOps } from "./pg-ops.js";

const SCHEMA = schemaSql.replace(/^PRAGMA.*$/m, "");

// ---------- Durable Object: one per school ----------
export class SchoolDB extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => { sql.exec(SCHEMA); });
    this.ops = sqliteOps(async (q, p) => sql.exec(q, ...p).toArray());
  }
  // The Worker passes the school name only to find this object; inside, the data can only be this school's.
  async call(op, args) { return this.ops[op](...args); }

  // Backup of one school: there is no built-in export for Durable Objects, so it is code we would own and test.
  async exportAll() {
    const sql = this.ctx.storage.sql;
    const out = {};
    for (const t of ["users", "classes", "students", "grades", "attendance", "invoices", "payments", "audit_log"]) out[t] = sql.exec(`SELECT * FROM ${t}`).toArray();
    return out;
  }
  // Restore into an empty object. The append-only triggers would refuse or duplicate rows, so they are dropped for the
  // load and recreated afterwards, all inside one transaction.
  async importAll(data) {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      for (const tr of ["payments_no_update", "payments_no_delete", "audit_no_update", "audit_no_delete", "payments_audit"]) sql.exec(`DROP TRIGGER IF EXISTS ${tr}`);
      for (const [table, rows] of Object.entries(data)) {
        for (const row of rows) {
          const cols = Object.keys(row);
          sql.exec(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, ...cols.map((c) => row[c]));
        }
      }
      sql.exec(SCHEMA);
    });
    return { ok: true };
  }
}

// ---------- backends ----------
function backend(env, name) {
  if (name === "d1") return sqliteOps(async (q, p) => (await env.DB.prepare(q).bind(...p).all()).results);
  if (name === "pg") return pgOps(env.PG.connectionString);
  if (name === "do") {
    return new Proxy({}, { get: (_, op) => (t, ...args) => env.SCHOOL.get(env.SCHOOL.idFromName(t)).call(op, [t, ...args]) });
  }
  return null;
}

// ---------- helpers ----------
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = new TextEncoder();
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function issueToken(env, payload) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(env.LAB_SECRET, body)}`;
}
async function readToken(env, req) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const [body, sig] = tok.split(".");
  if (!body || !sig || sig !== await hmac(env.LAB_SECRET, body)) throw new HttpError(401, "unauthorized");
  return JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
}
const int = (v) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, "bad_id"); return n; };
const need = (who, ...roles) => { if (!roles.includes(who.r)) throw new HttpError(403, "forbidden"); };
// Who may see a student: the administration, the accountant, the class teacher, the student's own parent.
const canSee = (who, s) => s && (who.r === "admin" || who.r === "accountant" || (who.r === "teacher" && s.teacher_id === who.u) || (who.r === "parent" && s.parent_id === who.u));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function handle(req, env) {
  const url = new URL(req.url);
  const [, b, ...parts] = url.pathname.split("/");
  const path = `/${parts.join("/")}`;
  const store = backend(env, b);
  if (!store) throw new HttpError(404, "no_backend");
  const body = req.method === "GET" || req.method === "DELETE" || req.method === "PUT" && path === "/files" ? null : await req.json().catch(() => ({}));

  if (req.method === "POST" && path === "/seed") {
    if (req.headers.get("x-lab-key") !== env.LAB_SECRET) throw new HttpError(403, "forbidden");
    await store.seed(String(body.tenant), Number(body.base));
    return json(201, { ok: true });
  }
  if (b === "do" && req.method === "POST" && (path === "/admin/export" || path === "/admin/import")) {
    if (req.headers.get("x-lab-key") !== env.LAB_SECRET) throw new HttpError(403, "forbidden");
    const stub = env.SCHOOL.get(env.SCHOOL.idFromName(String(body.tenant)));
    return json(200, path === "/admin/export" ? await stub.exportAll() : await stub.importAll(body.data));
  }
  // Platform-wide figure (the owner's dashboard): one query on a shared database, one call per school on Durable Objects.
  if (req.method === "POST" && path === "/admin/count-students") {
    if (req.headers.get("x-lab-key") !== env.LAB_SECRET) throw new HttpError(403, "forbidden");
    if (b === "d1") return json(200, { n: (await env.DB.prepare("SELECT count(*) AS n FROM students").first()).n });
    if (b === "do") {
      const counts = await Promise.all(body.tenants.map((t) => env.SCHOOL.get(env.SCHOOL.idFromName(t)).call("listStudents", [t])));
      return json(200, { n: counts.reduce((a, r) => a + r.length, 0) });
    }
    throw new HttpError(404, "not_found");
  }
  // Raw table read for the backup drill (lab key only): the live data to compare a restored copy against.
  if (b === "d1" && req.method === "POST" && path === "/admin/table") {
    if (req.headers.get("x-lab-key") !== env.LAB_SECRET) throw new HttpError(403, "forbidden");
    if (!/^[a-z_]+$/.test(String(body.table))) throw new HttpError(400, "bad_table");
    return json(200, (await env.DB.prepare(`SELECT * FROM ${body.table}`).all()).results);
  }
  if (req.method === "POST" && path === "/login") {
    const t = String(body.tenant || "");
    const user = await store.findUser(t, String(body.username || ""));
    if (!user || user.pw_hash !== String(body.password || "")) throw new HttpError(401, "bad_credentials");
    return json(200, { token: await issueToken(env, { t, u: user.id, r: user.role }) });
  }

  const who = await readToken(env, req);   // { t: school, u: user id, r: role }
  const t = who.t;
  let m;

  if (req.method === "GET" && path === "/students") {
    return json(200, (await store.listStudents(t)).filter((s) => canSee(who, s)));
  }
  if ((m = path.match(/^\/students\/([^/]+)$/))) {
    const s = await store.getStudent(t, int(m[1]));
    if (!canSee(who, s)) throw new HttpError(404, "not_found");
    if (req.method === "GET") return json(200, s);
    if (req.method === "PATCH") { need(who, "admin"); return json(200, await store.renameStudent(t, s.id, String(body.name || "").slice(0, 120))); }
  }
  if (req.method === "PUT" && path === "/grades") {
    need(who, "admin", "teacher");
    const s = await store.getStudent(t, int(body.student_id));
    if (!canSee(who, s)) throw new HttpError(404, "not_found");
    const score = Number(body.score);
    if (!Number.isInteger(score) || score < 0 || score > 100) throw new HttpError(400, "bad_score");
    return json(200, await store.setGrade(t, s.id, String(body.subject || "").slice(0, 40), score, who.u));
  }
  if (req.method === "GET" && (m = path.match(/^\/grades\/([^/]+)$/))) {
    need(who, "admin", "teacher", "parent");
    const s = await store.getStudent(t, int(m[1]));
    if (!canSee(who, s)) throw new HttpError(404, "not_found");
    return json(200, await store.getGrades(t, s.id));
  }
  if (req.method === "POST" && path === "/attendance") {
    need(who, "admin", "teacher");
    const s = await store.getStudent(t, int(body.student_id));
    if (!canSee(who, s)) throw new HttpError(404, "not_found");
    if (!["present", "absent", "late"].includes(body.status) || !/^\d{4}-\d{2}-\d{2}$/.test(body.day || "")) throw new HttpError(400, "bad_input");
    return json(200, await store.markAttendance(t, s.id, body.day, body.status));
  }
  if (req.method === "GET" && (m = path.match(/^\/attendance\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/count$/))) {
    need(who, "admin");
    return json(200, { n: await store.attendanceCount(t, int(m[1]), m[2]) });
  }
  if (req.method === "GET" && (m = path.match(/^\/invoices\/([^/]+)$/))) {
    need(who, "admin", "accountant", "parent");
    const inv = await store.getInvoice(t, int(m[1]));
    if (!inv || (who.r === "parent" && inv.parent_id !== who.u)) throw new HttpError(404, "not_found");
    return json(200, inv);
  }
  if (req.method === "GET" && (m = path.match(/^\/invoices\/([^/]+)\/payments$/))) {
    need(who, "admin", "accountant");
    return json(200, await store.listPayments(t, int(m[1])));
  }
  if (req.method === "POST" && path === "/payments") {
    need(who, "admin", "accountant");
    const amount = Number(body.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, "bad_amount");
    const idem = String(body.idem_key || "");
    if (idem.length < 8 || idem.length > 80) throw new HttpError(400, "bad_idem_key");
    const r = await store.pay(t, int(body.invoice_id), amount, idem, who.u);
    if (r.error === "not_found") throw new HttpError(404, "not_found");
    if (r.error) throw new HttpError(409, r.error);
    return json(r.status === "created" ? 201 : 200, r);
  }
  if (req.method === "DELETE" && path.startsWith("/payments/")) throw new HttpError(403, "payments_are_final");
  if (req.method === "GET" && path === "/audit/payments") { need(who, "admin"); return json(200, { n: await store.auditCount(t) }); }

  // Files: the key always starts with the school from the token; the client only ever names a random id.
  if (req.method === "PUT" && path === "/files") {
    need(who, "admin", "teacher");
    const id = crypto.randomUUID();
    await env.FILES.put(`t/${t}/${id}`, req.body, { httpMetadata: { contentType: "application/octet-stream" } });
    return json(201, { id });
  }
  if (req.method === "GET" && (m = path.match(/^\/files\/(.+)$/))) {
    const id = decodeURIComponent(m[1]);
    if (!UUID.test(id)) throw new HttpError(404, "not_found");
    const obj = await env.FILES.get(`t/${t}/${id}`);
    if (!obj) throw new HttpError(404, "not_found");
    return new Response(obj.body, { headers: { "content-type": "application/octet-stream" } });
  }

  // Simulated developer mistakes (the school filter forgotten). Present only so the tests can show what each
  // backend does when the application code is wrong. Enabled by LAB_UNSAFE.
  if (env.LAB_UNSAFE === "1") {
    if (req.method === "GET" && path === "/unsafe/students") return json(200, await store.unsafeListStudents(t));
    if (req.method === "POST" && (m = path.match(/^\/unsafe\/students\/(\d+)\/rename$/))) return json(200, await store.unsafeUpdateStudentById(t, Number(m[1]), String(body.name)));
    if (req.method === "DELETE" && (m = path.match(/^\/unsafe\/payments\/(\d+)$/))) return json(200, await store.unsafeDeletePayment(t, Number(m[1])));
  }
  throw new HttpError(404, "not_found");
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env); } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code });
      // Database refusals (immutable rows, constraints) surface as a generic error code, never the message.
      return json(500, { error: "server_error", db: /immutable|append-only|constraint|FOREIGN KEY|CHECK|violates/i.test(String(e.message)) ? "rejected_by_database" : undefined });
    }
  },
};
