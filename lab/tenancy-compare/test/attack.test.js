// Adversarial tests, run identically against each backend (LAB_BACKENDS, default d1,do,pg).
// Every test states the secure behaviour; a failure means that backend allowed something it must not.
// Tests 22-24 simulate a developer mistake (the school filter forgotten in a query): they show which backends stay
// safe when the application code is wrong, not only when it is right.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.LAB_URL || "http://127.0.0.1:8790";
const KEY = "lab-only-secret-not-for-production";
const BACKENDS = (process.env.LAB_BACKENDS || "d1,do,pg").split(",");
const run = Math.random().toString(36).slice(2, 7);
let nextBase = Math.floor(Math.random() * 1e6) * 100;   // distinct ids per school, so A's ids never exist in B

async function call(b, method, path, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(`${BASE}/${b}${path}`, {
    method, body: raw ?? (body ? JSON.stringify(body) : undefined),
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  const text = await res.text();
  let data = text; try { data = JSON.parse(text); } catch { /* binary or text */ }
  return { status: res.status, data };
}
async function school(b, name) {
  const base = (nextBase += 100);
  const tenant = `${name}-${run}-${b}`;
  assert.equal((await call(b, "POST", "/seed", { body: { tenant, base }, headers: { "x-lab-key": KEY } })).status, 201);
  const login = async (u) => (await call(b, "POST", "/login", { body: { tenant, username: u, password: `lab:${tenant}:${u}` } })).data.token;
  const tok = {};
  for (const u of ["admin", "teacher1", "teacher2", "accountant", "parent1", "parent2"]) tok[u] = await login(u);
  return { tenant, base, tok, s1: base + 1, s2: base + 2, inv: base + 1 };
}
const idem = () => `idem-${crypto.randomUUID()}`;

for (const b of BACKENDS) {
  describe(`[${b}]`, () => {
    let A, B;
    before(async () => { A = await school(b, "a"); B = await school(b, "b"); });

    // ---- A. another school's data, with correct application code ----
    test(`${b} | 01 school B admin cannot read school A student by id`, async () => {
      assert.equal((await call(b, "GET", `/students/${A.s1}`, { token: B.tok.admin })).status, 404);
    });
    test(`${b} | 02 school B admin cannot rename school A student`, async () => {
      assert.equal((await call(b, "PATCH", `/students/${A.s1}`, { token: B.tok.admin, body: { name: "مخترق" } })).status, 404);
      assert.equal((await call(b, "GET", `/students/${A.s1}`, { token: A.tok.admin })).data.name, "طالب تجريبي 1");
    });
    test(`${b} | 03 school B teacher cannot grade school A student`, async () => {
      assert.equal((await call(b, "PUT", "/grades", { token: B.tok.teacher1, body: { student_id: A.s1, subject: "math", score: 0 } })).status, 404);
      assert.deepEqual((await call(b, "GET", `/grades/${A.s1}`, { token: A.tok.admin })).data, []);
    });
    test(`${b} | 04 school B accountant cannot pay into school A invoice`, async () => {
      assert.equal((await call(b, "POST", "/payments", { token: B.tok.accountant, body: { invoice_id: A.inv, amount: 1, idem_key: idem() } })).status, 404);
      assert.equal((await call(b, "GET", `/invoices/${A.inv}`, { token: A.tok.accountant })).data.paid, 0);
    });
    test(`${b} | 05 school B accountant cannot read school A invoice or its payments`, async () => {
      assert.equal((await call(b, "GET", `/invoices/${A.inv}`, { token: B.tok.accountant })).status, 404);
      assert.deepEqual((await call(b, "GET", `/invoices/${A.inv}/payments`, { token: B.tok.accountant })).data, []);
    });
    test(`${b} | 06 school B student list contains nothing of school A`, async () => {
      const ids = (await call(b, "GET", "/students", { token: B.tok.admin })).data.map((s) => s.id);
      assert.deepEqual(ids.sort(), [B.s1, B.s2].sort());
    });
    test(`${b} | 07 naming school A in the body or headers does not switch school`, async () => {
      const r = await call(b, "GET", "/students", { token: B.tok.admin, headers: { "x-tenant": A.tenant, "x-tenant-id": A.tenant } });
      assert.ok(r.data.every((s) => s.id !== A.s1));
      const p = await call(b, "PATCH", `/students/${A.s1}`, { token: B.tok.admin, body: { name: "x", tenant: A.tenant, tenant_id: A.tenant } });
      assert.equal(p.status, 404);
    });
    test(`${b} | 08 a token edited to say school A is rejected`, async () => {
      const [body, sig] = B.tok.admin.split(".");
      const claims = JSON.parse(Buffer.from(body, "base64url").toString());
      const forged = `${Buffer.from(JSON.stringify({ ...claims, t: A.tenant })).toString("base64url")}.${sig}`;
      assert.equal((await call(b, "GET", "/students", { token: forged })).status, 401);
    });
    test(`${b} | 09 school B cannot fetch school A files, by id or by path tricks`, async () => {
      const up = await call(b, "PUT", "/files", { token: A.tok.admin, raw: "شهادة سرية للمدرسة أ" });
      assert.equal(up.status, 201);
      assert.equal((await call(b, "GET", `/files/${up.data.id}`, { token: A.tok.admin })).status, 200);
      assert.equal((await call(b, "GET", `/files/${up.data.id}`, { token: B.tok.admin })).status, 404);
      for (const trick of [`..%2F..%2Ft%2F${A.tenant}%2F${up.data.id}`, `../${A.tenant}/${up.data.id}`, `%2e%2e/${A.tenant}/${up.data.id}`]) {
        assert.equal((await call(b, "GET", `/files/${trick}`, { token: B.tok.admin })).status, 404, trick);
      }
    });

    // ---- B. roles inside one school ----
    test(`${b} | 10 a teacher cannot grade a student outside their class`, async () => {
      assert.equal((await call(b, "PUT", "/grades", { token: A.tok.teacher1, body: { student_id: A.s2, subject: "math", score: 50 } })).status, 404);
    });
    test(`${b} | 11 a score outside 0-100 is refused`, async () => {
      assert.equal((await call(b, "PUT", "/grades", { token: A.tok.teacher1, body: { student_id: A.s1, subject: "math", score: 101 } })).status, 400);
    });
    test(`${b} | 12 the accountant cannot enter grades`, async () => {
      assert.equal((await call(b, "PUT", "/grades", { token: A.tok.accountant, body: { student_id: A.s1, subject: "math", score: 90 } })).status, 403);
    });
    test(`${b} | 13 a teacher cannot record payments`, async () => {
      assert.equal((await call(b, "POST", "/payments", { token: A.tok.teacher1, body: { invoice_id: A.inv, amount: 10, idem_key: idem() } })).status, 403);
    });
    test(`${b} | 14 a parent sees only their own child's grades`, async () => {
      await call(b, "PUT", "/grades", { token: A.tok.teacher2, body: { student_id: A.s2, subject: "math", score: 77 } });
      assert.equal((await call(b, "GET", `/grades/${A.s2}`, { token: A.tok.parent1 })).status, 404);
      assert.equal((await call(b, "GET", `/grades/${A.s2}`, { token: A.tok.parent2 })).status, 200);
    });
    test(`${b} | 15 a parent sees only their own child's invoice`, async () => {
      assert.equal((await call(b, "GET", `/invoices/${A.inv}`, { token: A.tok.parent1 })).status, 200);
      assert.equal((await call(b, "GET", `/invoices/${A.inv}`, { token: A.tok.parent2 })).status, 404);
    });
    test(`${b} | 16 nobody can delete a payment through the API`, async () => {
      const p = await call(b, "POST", "/payments", { token: A.tok.accountant, body: { invoice_id: A.inv, amount: 5, idem_key: idem() } });
      assert.equal(p.status, 201);
      assert.equal((await call(b, "DELETE", `/payments/${p.data.payment.id}`, { token: A.tok.admin })).status, 403);
    });

    // ---- C. money and concurrency ----
    test(`${b} | 17 forty simultaneous retries of one payment record it exactly once`, async () => {
      const S = await school(b, "pay1");
      const key = idem();
      const rs = await Promise.all(Array.from({ length: 40 }, () =>
        call(b, "POST", "/payments", { token: S.tok.accountant, body: { invoice_id: S.inv, amount: 100, idem_key: key } })));
      assert.equal(rs.filter((r) => r.status === 201).length, 1, JSON.stringify(rs.map((r) => r.status)));
      assert.equal(rs.filter((r) => r.status === 200).length, 39);
      assert.equal(new Set(rs.map((r) => r.data.payment?.id)).size, 1, "every retry returns the same payment");
      assert.equal((await call(b, "GET", `/invoices/${S.inv}`, { token: S.tok.accountant })).data.paid, 100);
      assert.equal((await call(b, "GET", "/audit/payments", { token: S.tok.admin })).data.n, 1, "audited once");
    });
    test(`${b} | 18 thirty simultaneous payments can never exceed the invoice`, async () => {
      const S = await school(b, "pay2");
      const rs = await Promise.all(Array.from({ length: 30 }, () =>
        call(b, "POST", "/payments", { token: S.tok.accountant, body: { invoice_id: S.inv, amount: 100, idem_key: idem() } })));
      assert.equal(rs.filter((r) => r.status === 201).length, 10, JSON.stringify(rs.map((r) => r.status)));
      assert.equal(rs.filter((r) => r.status === 409).length, 20);
      assert.equal((await call(b, "GET", `/invoices/${S.inv}`, { token: S.tok.accountant })).data.paid, 1000);
    });
    test(`${b} | 19 reusing a payment key with another amount is refused`, async () => {
      const key = idem();
      assert.equal((await call(b, "POST", "/payments", { token: A.tok.accountant, body: { invoice_id: A.inv, amount: 7, idem_key: key } })).status, 201);
      assert.equal((await call(b, "POST", "/payments", { token: A.tok.accountant, body: { invoice_id: A.inv, amount: 8, idem_key: key } })).status, 409);
    });
    test(`${b} | 20 fifty simultaneous grade writes lose none (one row, version 50)`, async () => {
      const S = await school(b, "grade");
      await Promise.all(Array.from({ length: 50 }, (_, i) =>
        call(b, "PUT", "/grades", { token: S.tok.teacher1, body: { student_id: S.s1, subject: "science", score: i } })));
      const g = (await call(b, "GET", `/grades/${S.s1}`, { token: S.tok.admin })).data;
      assert.equal(g.length, 1);
      assert.equal(g[0].version, 50);
    });
    test(`${b} | 21 fifty simultaneous attendance marks give one record`, async () => {
      const S = await school(b, "att");
      const rs = await Promise.all(Array.from({ length: 50 }, (_, i) =>
        call(b, "POST", "/attendance", { token: S.tok.teacher1, body: { student_id: S.s1, day: "2026-11-05", status: i % 2 ? "present" : "absent" } })));
      assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.status)));
      assert.equal((await call(b, "GET", `/attendance/${S.s1}/2026-11-05/count`, { token: S.tok.admin })).data.n, 1);
    });

    // ---- D. when the application code is wrong ----
    test(`${b} | 22 BUG SIMULATION: a query without the school filter still shows no other school`, async () => {
      const rows = (await call(b, "GET", "/unsafe/students", { token: B.tok.teacher1 })).data;
      const foreign = rows.filter((r) => r.tenant_id !== B.tenant);
      assert.equal(foreign.length, 0, `leaked ${foreign.length} students of other schools`);
    });
    test(`${b} | 23 BUG SIMULATION: an update by id without the school filter cannot touch another school`, async () => {
      await call(b, "POST", `/unsafe/students/${A.s2}/rename`, { token: B.tok.teacher1, body: { name: "عُدّل من مدرسة أخرى" } });
      assert.equal((await call(b, "GET", `/students/${A.s2}`, { token: A.tok.admin })).data.name, "طالب تجريبي 2");
    });
    test(`${b} | 24 BUG SIMULATION: a raw DELETE cannot remove a payment, in any school`, async () => {
      const p = await call(b, "POST", "/payments", { token: A.tok.accountant, body: { invoice_id: A.inv, amount: 3, idem_key: idem() } });
      const id = p.data.payment.id;
      await call(b, "DELETE", `/unsafe/payments/${id}`, { token: B.tok.admin });
      await call(b, "DELETE", `/unsafe/payments/${id}`, { token: A.tok.admin });
      const list = (await call(b, "GET", `/invoices/${A.inv}/payments`, { token: A.tok.accountant })).data;
      assert.ok(list.some((x) => x.id === id), "the payment still exists");
    });
  });
}

// PostgreSQL only: the isolation depends on configuration, so the configuration itself is tested. This is the check
// that would run in CI against every migration: no school table without forced RLS, and an application role that
// cannot bypass it.
if (BACKENDS.includes("pg")) {
  test("pg | 25 every table with tenant_id has forced row-level security, and the app role cannot bypass it", async () => {
    const { execFileSync } = await import("node:child_process");
    const q = (sql) => execFileSync("psql", ["-h", "127.0.0.1", "-U", "postgres", "-d", "midar_lab", "-At", "-c", sql], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();
    const unprotected = q(`SELECT string_agg(c.relname, ',') FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
                            WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    assert.equal(unprotected, "", `tables without forced RLS: ${unprotected}`);
    assert.equal(q("SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = 'lab_app'"), "f");
  });
}
