/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool, uid, mailOn, lastCode, randomEmail } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";

let srv, owner;

before(async () => {
  srv = await startServer();
  await mailOn();
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
  assert.equal((await g.post("/api/group/schools", { id: a, name: "مدرسة النخبة - البنين", admin_name: "علي سالم" })).status, 400, "بريد المدير مطلوب");
  const wrong = randomEmail("typo"), mail = randomEmail("grp");
  const s1 = await g.post("/api/group/schools", { id: a, name: "مدرسة النخبة - البنين", admin_name: "علي سالم", manager_email: wrong });
  assert.equal(s1.status, 201, JSON.stringify(s1.data));
  assert.equal(s1.data.setup, null, "لا رابط إعداد منفصل: يكفي رابط المدرسة");
  assert.equal(s1.data.manager_email, wrong);
  assert.equal(s1.data.credentials, undefined, "لا كلمة مرور");
  assert.match(s1.data.links.staff.admin, new RegExp(`/${a}/idara`));
  assert.equal((await g.post("/api/group/schools", { id: b, name: "مدرسة النخبة - البنات", admin_name: "فاطمة علي", manager_email: randomEmail("grp") })).status, 201);
  const over = await g.post("/api/group/schools", { id: `${id}-c`, name: "مدرسة ثالثة", admin_name: "محمد", manager_email: randomEmail("grp") });
  assert.equal(over.status, 409, "لا تتجاوز المجموعة حدها");

  const list = await g.get("/api/group/schools");
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.schools.map((s) => s.id).sort(), [a, b].sort());
  assert.equal(list.data.totals.schools, 2);
  assert.equal(list.data.schools[0].subscription_end?.slice(0, 10), "2027-12-31", "المدارس على اشتراك المجموعة");

  assert.equal(list.data.schools.find((s) => s.id === a).manager_linked, false);

  const before = await g.post(`/api/group/schools/${a}/reset-admin`);
  assert.equal(before.status, 200);
  assert.equal(before.data.setup, null, "قبل أول دخول: التسليم برابط المدرسة نفسه");
  assert.equal((await g.put(`/api/group/schools/${a}/manager-email`, { email: mail })).data.manager_email, mail, "تصحيح البريد قبل أول دخول");

  // First entry from the school link with the recorded email, exactly as for owner-created schools.
  const manager = client(srv.base);
  assert.equal((await manager.post("/api/account/signup", { email: mail, password: "Manager-Pass-2026", name: "علي سالم" })).status, 200);
  assert.equal((await manager.post("/api/account/signup/verify", { email: mail, code: lastCode(mail) })).status, 200);
  const claim = await manager.post("/api/account/claim", { school: a, via: "email" });
  assert.equal(claim.status, 200, JSON.stringify(claim.data));
  assert.equal((await manager.get("/api/admin/me")).status, 200, "لكل مدرسة إدارتها الخاصة");
  assert.equal((await g.put(`/api/group/schools/${a}/manager-email`, { email: randomEmail() })).status, 400, "بعد الربط لا يُغيَّر البريد من هنا");

  const reset = await g.post(`/api/group/schools/${a}/reset-admin`);
  assert.equal(reset.status, 200);
  assert.match(reset.data.setup.url, /\/activate\?token=/, "بعد الربط: رابط استعادة");

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
