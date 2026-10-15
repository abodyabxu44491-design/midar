/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool, uid, setupAdmin } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";

let srv, owner;

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
});
after(async () => { await srv.close(); await endPool(); });

async function groupLogin(id, password) {
  const g = client(srv.base);
  const r = await g.post("/api/group/login", { group: id, username: "admin", password });
  return { g, r };
}

test("مجموعة المدارس: دخول الإدارة العامة، إنشاء مدارس ضمن الحد، وإدارة مستقلة لكل مدرسة", async () => {
  const id = `grp-${uid()}`;
  const made = await owner.post("/api/owner/groups", { id, name: "مجموعة مدارس النخبة", manager_name: "سالم أحمد", max_schools: 2, ends_on: "2027-12-31" });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.match(made.data.link, /\/group$/);

  assert.equal((await groupLogin(id, "wrong-password-1")).r.status, 401);
  const { g, r } = await groupLogin(id, made.data.credentials.password);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await g.get("/api/group/schools")).status, 403, "كلمة المرور المؤقتة تُغيَّر أولًا");
  assert.equal((await g.post("/api/group/password", { current: made.data.credentials.password, next: "Nokhba-Group-2027" })).status, 200);

  const me = await g.get("/api/group/me");
  assert.equal(me.data.max_schools, 2);
  const a = `${id}-a`, b = `${id}-b`;
  const s1 = await g.post("/api/group/schools", { id: a, name: "مدرسة النخبة - البنين", admin_name: "علي سالم" });
  assert.equal(s1.status, 201, JSON.stringify(s1.data));
  assert.match(s1.data.setup.url, /\/activate\?token=/, "رابط إعداد حساب مدير المدرسة يُعطى للإدارة العامة");
  assert.equal(s1.data.credentials, undefined, "لا كلمة مرور");
  assert.match(s1.data.links.staff.admin, new RegExp(`/${a}/idara`));
  assert.equal((await g.post("/api/group/schools", { id: b, name: "مدرسة النخبة - البنات", admin_name: "فاطمة علي" })).status, 201);
  const over = await g.post("/api/group/schools", { id: `${id}-c`, name: "مدرسة ثالثة", admin_name: "محمد" });
  assert.equal(over.status, 409, "لا تتجاوز المجموعة حدها");

  const list = await g.get("/api/group/schools");
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.schools.map((s) => s.id).sort(), [a, b].sort());
  assert.equal(list.data.totals.schools, 2);
  assert.equal(list.data.schools[0].subscription_end?.slice(0, 10), "2027-12-31", "المدارس على اشتراك المجموعة");

  const admin = await setupAdmin(client(srv.base), s1.data.setup.url);
  assert.equal((await admin.get("/api/admin/me")).status, 200, "لكل مدرسة إدارتها الخاصة");

  const reset = await g.post(`/api/group/schools/${a}/reset-admin`);
  assert.equal(reset.status, 200);
  assert.notEqual(reset.data.setup.url, s1.data.setup.url);

  const outsider = `iso-${uid()}`;
  assert.equal((await owner.post("/api/owner/tenants", { id: outsider, name: "مدرسة خارج المجموعة" })).status, 201);
  assert.equal((await g.post(`/api/group/schools/${outsider}/reset-admin`)).status, 404, "لا تصل المجموعة لمدرسة ليست منها");
  assert.equal((await owner.post(`/api/owner/groups/${id}/schools`, { tenant_id: outsider })).status, 409, "الضم يحترم الحد");
  assert.equal((await owner.patch(`/api/owner/groups/${id}`, { max_schools: 1 })).status, 400, "لا يقل الحد عن عدد المدارس الحالية");
  assert.equal((await owner.patch(`/api/owner/groups/${id}`, { max_schools: 3, ends_on: "2028-06-30", apply_to_schools: true })).data.synced, 2);
  assert.equal((await owner.post(`/api/owner/groups/${id}/schools`, { tenant_id: outsider })).status, 200);
  const after3 = await g.get("/api/group/schools");
  assert.equal(after3.data.schools.length, 3);
  assert.ok(after3.data.schools.every((s) => s.subscription_end.slice(0, 10) === "2028-06-30"));

  const groups = await owner.get("/api/owner/groups");
  assert.equal(groups.data.find((x) => x.id === id).schools.length, 3);

  assert.equal((await owner.patch(`/api/owner/groups/${id}`, { status: "suspended" })).status, 200);
  assert.equal((await g.get("/api/group/me")).status, 401, "إيقاف المجموعة ينهي جلساتها");
  assert.equal((await groupLogin(id, "Nokhba-Group-2027")).r.status, 403);
});

test("جلسة المجموعة لا تفتح لوحات المدارس ولا لوحة المالك", async () => {
  const id = `grp-${uid()}`;
  const made = await owner.post("/api/owner/groups", { id, name: "مجموعة الاختبار", manager_name: "مدير عام" });
  const { g } = await groupLogin(id, made.data.credentials.password);
  assert.equal((await g.get("/api/admin/me")).status, 401);
  assert.equal((await g.get("/api/owner/groups")).status, 401);
  const anon = client(srv.base);
  assert.equal((await anon.get("/api/group/schools")).status, 401);
});
