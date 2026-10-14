/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool, activateSchool, randomPhone } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";
import { setTransport } from "../src/modules/shared/notify.service.js";

let srv, owner, pub, smsWas = { enabled: false, url: "" };
before(async () => {
  srv = await startServer();
  owner = client(srv.base); pub = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await transaction({ platform: true }, (q) => q("DELETE FROM leads WHERE ip = '127.0.0.1' AND created_at > now() - interval '1 day'"));
  smsWas = (await transaction({ platform: true }, (q) => q("SELECT enabled, url FROM sms_gateway WHERE id = 1")))[0] || smsWas;
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
  const body = { name: "مدارس الريادة الأهلية", admin_name: "ماجد سالم", subscription: { kind: "trial", plan_id: plans[0].id, force_trial: true } };
  const [a, b] = await Promise.all([owner.post(`/api/owner/requests/${lead.data.id}/convert`, body), owner.post(`/api/owner/requests/${lead.data.id}/convert`, body)]);
  const ok = [a, b].filter((x) => x.status === 201);
  assert.equal(ok.length, 1, `مدرسة واحدة فقط: ${a.status} ${b.status} ${JSON.stringify(a.data)} ${JSON.stringify(b.data)}`);
  const again = await owner.post(`/api/owner/requests/${lead.data.id}/convert`, body);
  assert.equal(again.status, 409, "إعادة الاعتماد لا تنشئ مدرسة ثانية");
  const [{ n }] = await transaction({ platform: true }, (q) => q("SELECT count(*)::int AS n FROM tenants WHERE lead_id = $1", [lead.data.id]));
  assert.equal(n, 1);
  const first = ok[0].data;
  const id = first.tenant_id;
  assert.match(id, /^alreeada(-\d+)?$/, "رمز المدرسة يُشتق من اسمها تلقائيًا");
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
  const token = tokenOf(second.url);
  const chk = await pub.get(`/api/public/activation/check?token=${token}`);
  assert.equal(chk.status, 200);
  assert.equal(chk.data.manager_name, "ماجد سالم");
  assert.equal(chk.data.phone, null, "لا يظهر أي رقم قبل أن يكتبه المدير");
  assert.equal(chk.data.username, undefined, "لا اسم مستخدم يُعرض");
  assert.equal((await pub.post("/api/public/activation", { token, password: "Riyada-School-2026" })).status, 403, "لا كلمة مرور قبل التحقق من الجوال");

  // SMS gateway off: the failure is reported, never shown as sent.
  await transaction({ platform: true }, (q) => q("UPDATE sms_gateway SET enabled = false WHERE id = 1"));
  const mgr = randomPhone();
  assert.equal((await pub.post("/api/public/activation/send-code", { token, phone: "12" })).status, 400, "رقم غير صحيح");
  assert.equal((await pub.post("/api/public/activation/send-code", { token, phone: "+967612345678" })).status, 400, "رقم يمني ليس جوالًا");
  const off = await pub.post("/api/public/activation/send-code", { token, phone: mgr });
  assert.equal(off.status, 503);
  // SMS gateway on: the code reaches the number the manager typed.
  const sent = [];
  setTransport({ sms: async (g, m) => { sent.push(m); } });
  await transaction({ platform: true }, (q) => q("UPDATE sms_gateway SET enabled = true, url = CASE WHEN url = '' THEN 'https://sms.example/send' ELSE url END WHERE id = 1"));
  try {
    const ok1 = await pub.post("/api/public/activation/send-code", { token, phone: mgr });
    assert.equal(ok1.status, 200, JSON.stringify(ok1.data));
    assert.equal(sent.length, 1);
    assert.ok(sent[0].to.endsWith(mgr.slice(-9)), "الرمز يذهب للرقم الذي كتبه المدير");
    assert.match(sent[0].message, /^رمز التحقق في مدار: \d{6}\n/, "الرمز في أول سطر لتعبئة تلقائية");
    assert.equal((await pub.post("/api/public/activation/send-code", { token, phone: mgr })).status, 429, "لا طلب رمز متكرر خلال دقيقة");
    const code = sent[0].message.match(/(\d{6})/)[1];
    const wrong = await pub.post("/api/public/activation/verify", { token, code: code === "111111" ? "222222" : "111111" });
    assert.equal(wrong.status, 400);
    assert.match(wrong.data.error, /متبقٍ/);
    assert.equal((await pub.post("/api/public/activation/verify", { token, code })).status, 200);
  } finally {
    setTransport(null);
    await transaction({ platform: true }, (q) => q("UPDATE sms_gateway SET enabled = $1, url = $2 WHERE id = 1", [smsWas.enabled, smsWas.url]));
  }
  const fileMid = (await owner.get(`/api/owner/files/${id}`)).data;
  assert.equal(fileMid.activation_state, "phone_verified");
  const school = client(srv.base);
  const done = await school.post("/api/public/activation", { token, password: "Riyada-School-2026" });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal((await school.get("/api/admin/me")).status, 200, "يدخل لوحة المدرسة مباشرة بعد التفعيل");
  assert.equal((await pub.post("/api/public/activation", { token, password: "Another-Pass-2026" })).status, 404, "يُستخدم مرة واحدة");
  const byPhone = client(srv.base);
  assert.equal((await byPhone.post("/api/staff/login", { school: id, username: mgr, password: "Riyada-School-2026" })).status, 200, "الدخول برقم الجوال");
  file = (await owner.get(`/api/owner/files/${id}`)).data;
  assert.equal(file.stage, "first_login");
  assert.equal(file.activation_state, "activated");
  assert.equal(file.profile.city, "جدة", "الملف باقٍ بعد دخول المدرسة");
  assert.ok(!JSON.stringify(file.events).includes(token), "لا روابط سرية في السجل");

  // Lost password: a new link goes through the same phone check; the old password stops on completion.
  const reset = (await owner.post(`/api/owner/files/${id}/link`)).data;
  assert.equal((await owner.post(`/api/owner/files/${id}/link/revoke`)).data.revoked, 1);
  assert.equal((await pub.get(`/api/public/activation/check?token=${tokenOf(reset.url)}`)).status, 404, "الرابط الملغى لا يعمل");
  const reset2 = (await owner.post(`/api/owner/files/${id}/link`)).data;
  await activateSchool(srv.base, id, reset2.url, "Riyada-New-2026", mgr);
  const old = client(srv.base);
  assert.equal((await old.post("/api/staff/login", { school: id, username: mgr, password: "Riyada-School-2026" })).status, 401, "كلمة المرور القديمة تتوقف");
  assert.equal((await old.post("/api/staff/login", { school: id, username: mgr, password: "Riyada-New-2026" })).status, 200);

  assert.equal((await owner.patch(`/api/owner/files/${id}`, { phone2: "0500000001", city: "الرياض" })).data.changed, 2);
  await owner.post(`/api/owner/files/${id}/notes`, { body: "تواصلنا مع المدير وطلب مهلة أسبوع" });
  file = (await owner.get(`/api/owner/files/${id}`)).data;
  const change = file.events.find((e) => e.kind === "change");
  assert.ok(change.meta.changes.some((c) => c.field === "city" && c.from === "جدة" && c.to === "الرياض"), "التعديل يحفظ القيمة السابقة");
  assert.ok(file.events.some((e) => e.kind === "note"));
  assert.ok(!JSON.stringify(file.events).includes("Riyada-School-2026") && !JSON.stringify(file.events).includes("Riyada-New-2026"), "لا كلمات مرور في السجل");

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

test("التفعيل: انتهاء الرمز، حد المحاولات، وانتهاء الرابط تُرفض من الخادم", async () => {
  const phone = `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const lead = await pub.post("/api/public/leads", { kind: "trial", school_name: "مدرسة النور", contact_name: "سعيد علي", phone, city: "مكة",
    details: { org_type: "private", country: "عُمان", stages: ["primary"], manager: { first: "سعيد", family: "علي" } } });
  assert.equal(lead.status, 201, JSON.stringify(lead.data));
  const plans = (await owner.get("/api/owner/plans")).data;
  const made = await owner.post(`/api/owner/requests/${lead.data.id}/convert`, { name: "مدرسة النور", admin_name: "سعيد علي",
    subscription: { kind: "trial", plan_id: plans[0].id, force_trial: true } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.tenant_id;
  assert.match(id, /^alnoor(-\d+)?$/);
  const token = tokenOf(made.data.activation.url);
  const verify = (code) => pub.post("/api/public/activation/verify", { token, code });

  const mgr = randomPhone();
  const smsCode = async () => {
    const sent = [];
    setTransport({ sms: async (g, m) => { sent.push(m); } });
    await transaction({ platform: true }, (q) => q("UPDATE sms_gateway SET enabled = true, url = CASE WHEN url = '' THEN 'https://sms.example/send' ELSE url END WHERE id = 1"));
    await transaction({ platform: true }, (q) => q("UPDATE school_activations SET otp_last_sent_at = NULL WHERE tenant_id = $1", [id]));
    try { assert.equal((await pub.post("/api/public/activation/send-code", { token, phone: mgr })).status, 200); }
    finally { setTransport(null); await transaction({ platform: true }, (q) => q("UPDATE sms_gateway SET enabled = $1, url = $2 WHERE id = 1", [smsWas.enabled, smsWas.url])); }
    return sent[0].message.match(/(\d{6})/)[1];
  };
  const c1 = await smsCode();
  await transaction({ platform: true }, (q) => q("UPDATE school_activations SET otp_expires_at = now() - interval '1 minute' WHERE tenant_id = $1", [id]));
  assert.equal((await verify(c1)).status, 410, "الرمز المنتهي مرفوض");

  const c2 = await smsCode();
  const bad = c2 === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) assert.equal((await verify(bad)).status, 400);
  assert.equal((await verify(c2)).status, 429, "بعد خمس محاولات خاطئة يتوقف حتى الرمز الصحيح");
  assert.equal((await pub.post("/api/public/activation", { token, password: "Noor-School-2026" })).status, 403);

  await transaction({ platform: true }, (q) => q("UPDATE school_activations SET expires_at = now() - interval '1 minute' WHERE tenant_id = $1", [id]));
  assert.equal((await pub.get(`/api/public/activation/check?token=${token}`)).status, 410, "الرابط المنتهي مرفوض");
  assert.equal((await owner.get(`/api/owner/files/${id}`)).data.activation_state, "expired");
  assert.equal((await client(srv.base).post("/api/staff/login", { school: id, username: mgr, password: "Noor-School-2026" })).status, 401, "لا دخول قبل إكمال التحقق");
});

test("التفعيل يقبل أرقام الدول العربية، والدخول يقبل الرقم مع رمز الدولة أو بدونه", async () => {
  const plans = (await owner.get("/api/owner/plans")).data;
  const r9 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  const cases = [
    { full: `+96777${r9()}`, local: (f) => `0${f.slice(4)}`, sms: (f) => f.slice(1) },
    { full: `+20100${r9().slice(0, 7)}${Math.floor(Math.random() * 10)}`, local: (f) => `0${f.slice(3)}`, sms: (f) => f.slice(1) },
    { full: `+96477${r9()}${Math.floor(Math.random() * 10)}`, local: (f) => `0${f.slice(4)}`, sms: (f) => f.slice(1) },
  ];
  for (const [i, c] of cases.entries()) {
    const lead = await pub.post("/api/public/leads", { kind: "trial", school_name: `مدرسة الضياء ${i + 1}`, contact_name: "هاني عمر", phone: randomPhone(), city: "المدينة",
      details: { org_type: "private", country: "أخرى", stages: ["primary"], manager: { first: "هاني", family: "عمر" } } });
    assert.equal(lead.status, 201, JSON.stringify(lead.data));
    const made = await owner.post(`/api/owner/requests/${lead.data.id}/convert`, { name: `مدرسة الضياء ${i + 1}`, admin_name: "هاني عمر",
      subscription: { kind: "trial", plan_id: plans[0].id, force_trial: true } });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const id = made.data.tenant_id;
    await activateSchool(srv.base, id, made.data.activation.url, "Diyaa-School-2026", c.full);
    for (const username of [c.full, c.local(c.full)]) {
      const r = await client(srv.base).post("/api/staff/login", { school: id, username, password: "Diyaa-School-2026" });
      assert.equal(r.status, 200, `${c.full} ← ${username}`);
    }
  }
});
