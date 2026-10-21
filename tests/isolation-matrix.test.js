/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Every API route, read from the application itself (so a new route is covered the day it is added), is called:
//   1) with no session, 2) by a signed-in user of the wrong role, and 3) by school B's staff using school A's record
//      identifiers. None may succeed, none may crash, and school A's data must be unchanged afterwards.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, endPool, readySchool, uid } from "./helpers.js";
import { createApp } from "../src/app.js";
import { transaction } from "../src/core/db/pool.js";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); await endPool(); });

function routes() {
  const out = [];
  const rx = (layer) => {
    if (layer.regexp?.fast_slash) return "";
    const m = (layer.regexp?.source || "").replace("^\\", "").replace("\\/?(?=\\/|$)", "").replace(/\\\//g, "/")
      .replace("(?:/(?=$))?$", "").replace(/\$$/, "");
    return m.startsWith("/") ? m : `/${m}`;
  };
  const walk = (stack, prefix) => {
    for (const l of stack) {
      if (l.route) for (const m of Object.keys(l.route.methods)) out.push([m.toUpperCase(), `${prefix}${l.route.path}`]);
      else if (l.name === "router" && l.handle.stack) {
        walk(l.handle.stack, prefix + (l.keys?.length ? rx(l).replace(/\(\?:\(\[\^\/]\+\?\)\)/g, `:${l.keys[0].name}`) : rx(l)));
      }
    }
  };
  walk(createApp()._router.stack, "");
  return [...new Map(out.filter(([, p]) => p.startsWith("/api/")).map((r) => [r.join(" "), r])).values()];
}

const OPEN = /^\/api\/(public|staff|account|gate)\/|^\/api\/(site|version|analytics-config)$|^\/api\/owner\/(login|logout|config|enroll|me)$|^\/api\/group\/(login|logout|me)$/;
const SKIP = /logout|\/login$|\/enroll$/;
const ok = (s) => s >= 200 && s < 300;

test("مصفوفة العزل والصلاحيات على كل مسارات الـ API", { timeout: 600_000 }, async () => {
  const A = await readySchool(srv.base, { prefix: "isoa", name: "مدرسة العزل أ", students: 2 });
  const B = await readySchool(srv.base, { prefix: "isob", name: "مدرسة العزل ب", students: 0 });
  const accountant = async (s) => {
    const username = `acc${uid()}`;
    const r = await s.admin.post("/api/admin/users", { name: "محاسب الاختبار", username });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    await transaction({ tenantId: s.id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = $1", [username]));
    const c = client(srv.base);
    assert.equal((await c.post("/api/staff/login", { school: s.id, username, password: r.data.credentials.password })).status, 200);
    return c;
  };
  const accA = await accountant(A);

  const stA = A.students[0];
  const ids = { student: stA.id, students: stA.id, class: A.c1.id, classes: A.c1.id, class_id: A.c1.id, teacher: A.teacherId, teachers: A.teacherId,
    subject: A.math.id, subjects: A.math.id, id: stA.id, studentId: stA.id };
  const fill = (path) => path.replace(/\/([a-z-]+)\/:([a-zA-Z_]+)/g, (m, seg, name) => {
    if (name === "tenant" || name === "school" || name === "id" && seg === "schools") return `/${seg}/${A.id}`;
    return `/${seg}/${ids[seg] ?? ids[name] ?? ids[seg.replace(/s$/, "")] ?? stA.id}`;
  }).replace(/:([a-zA-Z_]+)/g, (m, n) => String(ids[n] ?? stA.id));

  const before = (await A.admin.get("/api/admin/students")).data;
  const anon = client(srv.base);
  const problems = [];
  const check = async (who, c, method, raw) => {
    const r = await c[{ GET: "get", POST: "post", PUT: "put", PATCH: "patch", DELETE: "del" }[method]](fill(raw), method === "GET" || method === "DELETE" ? undefined : {});
    const body = JSON.stringify(r.data ?? "");
    if (r.status >= 500) problems.push(`${who} ${method} ${raw} → ${r.status}`);
    else if (who.startsWith("B→A") ? ok(r.status) && (body.includes(stA.name) || body.includes(stA.access_key || "\u0000") || body.includes(A.id)) : ok(r.status)) {
      problems.push(`${who} ${method} ${raw} → ${r.status} ${body.slice(0, 120)}`);
    }
  };

  const list = routes().filter(([m, p]) => !SKIP.test(p) && ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m));
  assert.ok(list.length > 300, `عدد المسارات المكتشفة ${list.length}`);
  let calls = 0;
  for (const [method, raw] of list) {
    if (OPEN.test(raw)) continue;
    await check("بلا جلسة", anon, method, raw); calls++;
    if (raw.startsWith("/api/admin") || raw.startsWith("/api/owner") || raw.startsWith("/api/group")) { await check("معلم", A.teacher, method, raw); calls++; }
    if ((raw.startsWith("/api/admin") || raw.startsWith("/api/teacher") || raw.startsWith("/api/owner"))) { await check("محاسب", accA, method, raw); calls++; }
    if (raw.startsWith("/api/owner")) { await check("مدير مدرسة", A.admin, method, raw); calls++; }
    if (raw.includes("/:") && raw.startsWith("/api/admin")) { await check("B→A مدير", B.admin, method, raw); calls++; }
    if (raw.includes("/:") && raw.startsWith("/api/teacher")) { await check("B→A معلم", B.teacher, method, raw); calls++; }
  }
  const after = (await A.admin.get("/api/admin/students")).data;
  assert.deepEqual(after.map((s) => [s.id, s.name, s.class_id]), before.map((s) => [s.id, s.name, s.class_id]), "بيانات المدرسة أ لم تتغير");
  console.log(`# مسارات: ${list.length} — طلبات: ${calls}`);
  assert.deepEqual(problems, [], `ثغرات محتملة:\n${problems.join("\n")}`);
});
