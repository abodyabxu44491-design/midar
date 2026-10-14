/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool, uid } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner, pub;
before(async () => {
  srv = await startServer();
  owner = client(srv.base); pub = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await transaction({ platform: true }, (q) => q("DELETE FROM leads WHERE ip = '127.0.0.1' AND created_at > now() - interval '1 day'"));
});
after(async () => { await srv.close(); await endPool(); });

const tokenOf = (url) => new URL(url).searchParams.get("token");

test("من الطلب إلى أول دخول: ملف دائم، اعتماد مرة واحدة، رابط تفعيل يعود في أي وقت، وسجل تسليم صادق", async () => {
  const phone = `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const lead = await pub.post("/api/public/leads", { kind: "trial", school_name: "مدارس الريادة الأهلية", contact_name: "ماجد سالم", phone, city: "جدة",
    details: { org_type: "private", country: "الإمارات", region: "الشمال", stages: ["primary"], school_email: "info@riyada.example",
      manager: { first: "ماجد", family: "سالم", title: "مدير المدرسة", preferred: "whatsapp" } } });
  assert.equal(lead.status, 201, JSON.stringify(lead.data));
  const plans = (await owner.get("/api/owner/plans")).data;
  const id = `ry-${uid()}`;
  const body = { id, name: "مدارس الريادة الأهلية", admin_name: "ماجد سالم", subscription: { kind: "trial", plan_id: plans[0].id, force_trial: true } };
  const [a, b] = await Promise.all([owner.post(`/api/owner/requests/${lead.data.id}/convert`, body), owner.post(`/api/owner/requests/${lead.data.id}/convert`, body)]);
  const ok = [a, b].filter((x) => x.status === 201);
  assert.equal(ok.length, 1, `مدرسة واحدة فقط: ${a.status} ${b.status} ${JSON.stringify(a.data)} ${JSON.stringify(b.data)}`);
  const again = await owner.post(`/api/owner/requests/${lead.data.id}/convert`, body);
  assert.equal(again.status, 409, "إعادة الاعتماد لا تنشئ مدرسة ثانية");
  const [{ n }] = await transaction({ platform: true }, (q) => q("SELECT count(*)::int AS n FROM tenants WHERE lead_id = $1", [lead.data.id]));
  assert.equal(n, 1);
  const first = ok[0].data;
  assert.ok(first.activation.url.includes("/activate?token="), "لا تُسلَّم كلمة مرور، بل رابط تفعيل");
  assert.equal(first.credentials, undefined);

  let file = (await owner.get(`/api/owner/files/${id}`)).data;
  assert.equal(file.profile.country, "الإمارات", "بيانات التسجيل محفوظة في ملف المدرسة");
  assert.equal(file.profile.phone, phone);
  assert.equal(file.stage, "account");
  assert.equal(file.activation.url, first.activation.url, "شاشة التسليم تعود بنفس الرابط الصالح بعد إغلاقها");
  assert.ok(file.events.some((e) => e.kind === "approved"));

  const failed = await owner.post(`/api/owner/files/${id}/deliveries`, { channel: "email", recipient: "info@riyada.example" });
  assert.equal(failed.status, 409, "البريد غير مهيأ فلا يُسجل كمرسل");
  const wa = await owner.post(`/api/owner/files/${id}/deliveries`, { channel: "whatsapp", recipient: phone });
  assert.equal(wa.data.status, "pending");
  file = (await owner.get(`/api/owner/files/${id}`)).data;
  assert.notEqual(file.stage, "delivered", "لا يُعد مُسلَّمًا قبل التأكيد");
  await owner.post(`/api/owner/files/${id}/deliveries/${wa.data.event_id}`, { status: "sent" });
  file = (await owner.get(`/api/owner/files/${id}`)).data;
  assert.equal(file.stage, "delivered");
  assert.equal(file.events.find((e) => e.channel === "email").status, "failed");

  const second = (await owner.post(`/api/owner/files/${id}/link`)).data;
  assert.equal((await pub.get(`/api/public/activation/check?token=${tokenOf(first.activation.url)}`)).status, 404, "الرابط القديم يتوقف عند إصدار جديد");
  const chk = await pub.get(`/api/public/activation/check?token=${tokenOf(second.url)}`);
  assert.equal(chk.status, 200);
  assert.equal(chk.data.username, "admin");
  assert.equal((await pub.post("/api/public/activation", { token: tokenOf(second.url), password: "Riyada-School-2026" })).status, 200);
  assert.equal((await pub.post("/api/public/activation", { token: tokenOf(second.url), password: "Another-Pass-2026" })).status, 404, "يُستخدم مرة واحدة");
  const school = client(srv.base);
  assert.equal((await school.post("/api/staff/login", { school: id, username: "admin", password: "Riyada-School-2026" })).status, 200);
  assert.equal((await school.get("/api/admin/me")).status, 200, "لا يُطلب تغيير كلمة المرور بعد التفعيل");
  file = (await owner.get(`/api/owner/files/${id}`)).data;
  assert.equal(file.stage, "first_login");
  assert.equal(file.profile.city, "جدة", "الملف باقٍ بعد دخول المدرسة");

  const temp = (await owner.post(`/api/owner/files/${id}/temp-password`)).data.credentials;
  const old = client(srv.base);
  assert.equal((await old.post("/api/staff/login", { school: id, username: "admin", password: "Riyada-School-2026" })).status, 401, "كلمة المرور القديمة تتوقف");
  assert.equal((await old.post("/api/staff/login", { school: id, username: "admin", password: temp.password })).status, 200);

  assert.equal((await owner.patch(`/api/owner/files/${id}`, { phone2: "0500000001", city: "الرياض" })).data.changed, 2);
  await owner.post(`/api/owner/files/${id}/notes`, { body: "تواصلنا مع المدير وطلب مهلة أسبوع" });
  file = (await owner.get(`/api/owner/files/${id}`)).data;
  const change = file.events.find((e) => e.kind === "change");
  assert.ok(change.meta.changes.some((c) => c.field === "city" && c.from === "جدة" && c.to === "الرياض"), "التعديل يحفظ القيمة السابقة");
  assert.ok(file.events.some((e) => e.kind === "note"));
  assert.ok(!JSON.stringify(file.events).includes("Riyada-School-2026") && !JSON.stringify(file.events).includes(temp.password), "لا كلمات مرور في السجل");

  assert.equal((await owner.post(`/api/owner/files/${id}/status`, { status: "suspended", reason: "تأخر السداد" })).status, 200);
  assert.equal((await old.get("/api/admin/me")).status, 401, "الإيقاف ينهي الجلسات");
  await owner.post(`/api/owner/files/${id}/status`, { status: "active" });

  const list = (await owner.get(`/api/owner/files?q=${phone}`)).data;
  assert.deepEqual(list.items.map((x) => x.id), [id], "البحث برقم الجوال");
  assert.ok(list.counts.activated >= 1);
  const csv = await fetch(`${srv.base}/api/owner/files/export.csv?ids=${id}`, { headers: { Cookie: owner.cookie() } });
  assert.equal(csv.status, 200);
  assert.ok((await csv.text()).includes(id), "التصدير يشمل المدرسة المحددة");
});

test("ملفات المدارس لا تُفتح بدون دخول المالك، ورابط التفعيل لا يكشف شيئًا بدون رمز صحيح", async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get("/api/owner/files")).status, 401);
  assert.equal((await anon.post("/api/owner/files/abc/link")).status, 401);
  assert.equal((await anon.get(`/api/public/activation/check?token=${"0".repeat(64)}`)).status, 404);
  assert.equal((await anon.get("/api/public/activation/check?token=xyz")).status, 400);
});
