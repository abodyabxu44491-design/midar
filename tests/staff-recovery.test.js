/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool, activateSchool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";
import { setTransport } from "../src/modules/shared/notify.service.js";

let srv, owner, pub, smsWas = { enabled: false, url: "" };
const sent = [];
before(async () => {
  srv = await startServer();
  owner = client(srv.base); pub = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await transaction({ platform: true }, (q) => q("DELETE FROM leads WHERE ip = '127.0.0.1' AND created_at > now() - interval '1 day'"));
  smsWas = (await transaction({ platform: true }, (q) => q("SELECT enabled, url FROM sms_gateway WHERE id = 1")))[0] || smsWas;
});
after(async () => {
  setTransport(null);
  await transaction({ platform: true }, (q) => q("UPDATE sms_gateway SET enabled = $1, url = $2 WHERE id = 1", [smsWas.enabled, smsWas.url]));
  await srv.close(); await endPool();
});

async function newSchool(name, phone) {
  const plans = (await owner.get("/api/owner/plans")).data;
  const lead = await pub.post("/api/public/leads", { kind: "trial", school_name: name, contact_name: "ياسر نبيل", phone: `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    city: "المكلا", details: { org_type: "private", country: "أخرى", stages: ["primary"], manager: { first: "ياسر", family: "نبيل" } } });
  assert.equal(lead.status, 201, JSON.stringify(lead.data));
  const made = await owner.post(`/api/owner/requests/${lead.data.id}/convert`, { name, admin_name: "ياسر نبيل",
    subscription: { kind: "trial", plan_id: plans[0].id, force_trial: true } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  await activateSchool(srv.base, made.data.tenant_id, made.data.activation.url, "Old-Password-2026", phone);
  return made.data.tenant_id;
}
const smsOn = async () => {
  setTransport({ sms: async (g, m) => { sent.push(m); } });
  await transaction({ platform: true }, (q) => q("UPDATE sms_gateway SET enabled = true, url = CASE WHEN url = '' THEN 'https://sms.example/send' ELSE url END WHERE id = 1"));
};

test("نسيت كلمة المرور: رمز برسالة نصية لرقم المدير المسجل ثم كلمة مرور جديدة", async () => {
  const tail = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  const phone = `+96773${tail}`, local = `073${tail}`;
  const id = await newSchool("مدرسة الإشراق", phone);
  const other = await newSchool("مدرسة الإشراق الثانية", `+96771${tail}`);
  await smsOn();
  const c = client(srv.base);

  // An unknown number gets the same answer, and nothing is sent.
  sent.length = 0;
  const unknown = await c.post("/api/staff/recover/start", { school: id, phone: `+96770${tail}` });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.sent, true);
  assert.equal(sent.length, 0, "لا رسالة لرقم غير مسجل");
  assert.equal((await c.post("/api/staff/recover/start", { school: other, phone })).status, 200);
  assert.equal(sent.length, 0, "رقم مدرسة أخرى لا يُرسل له");
  assert.equal((await c.post("/api/staff/recover/start", { school: id, phone: "+96712" })).status, 400);

  // The registered number, typed in local form, receives the code.
  const s1 = await c.post("/api/staff/recover/start", { school: id, phone: local });
  assert.equal(s1.status, 200, JSON.stringify(s1.data));
  assert.equal(sent.length, 1);
  assert.ok(sent[0].to.endsWith(`73${tail}`));
  assert.equal((await c.post("/api/staff/recover/start", { school: id, phone })).status, 429, "لا رمز متكرر خلال دقيقة");
  const code = sent[0].message.match(/(\d{6})/)[1];

  const wrong = await c.post("/api/staff/recover/verify", { school: id, phone, code: code === "111111" ? "222222" : "111111" });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /متبقٍ/);
  const ok = await c.post("/api/staff/recover/verify", { school: id, phone, code });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.match(ok.data.ticket, /^[0-9a-f]{64}$/);
  assert.equal((await c.post("/api/staff/recover/verify", { school: id, phone, code })).status, 400, "الرمز يُستخدم مرة واحدة");

  // An existing session elsewhere is ended by the reset.
  const old = client(srv.base);
  assert.equal((await old.post("/api/staff/login", { school: id, username: phone, password: "Old-Password-2026" })).status, 200);
  assert.equal((await c.post("/api/staff/recover/reset", { school: id, ticket: ok.data.ticket, password: "short" })).status, 400);
  const done = await c.post("/api/staff/recover/reset", { school: id, ticket: ok.data.ticket, password: "New-Password-2026" });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.role, "admin");
  assert.equal((await c.get("/api/admin/me")).status, 200, "يدخل لوحة المدرسة مباشرة");
  assert.equal((await old.get("/api/admin/me")).status, 401, "الجلسات السابقة انتهت");
  assert.equal((await c.post("/api/staff/recover/reset", { school: id, ticket: ok.data.ticket, password: "Another-Pass-2026" })).status, 410, "التذكرة مرة واحدة");

  const login = (password) => client(srv.base).post("/api/staff/login", { school: id, username: local, password });
  assert.equal((await login("Old-Password-2026")).status, 401);
  const fresh = await login("New-Password-2026");
  assert.equal(fresh.status, 200);
  assert.equal(fresh.data.name, "ياسر نبيل");
});

test("نسيت كلمة المرور: حد المحاولات وانتهاء الرمز", async () => {
  const tail = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  const phone = `+96777${tail}`;
  const id = await newSchool("مدرسة الرواد", phone);
  await smsOn();
  sent.length = 0;
  const c = client(srv.base);
  assert.equal((await c.post("/api/staff/recover/verify", { school: id, phone, code: "123456" })).status, 400, "لا تحقق قبل طلب الرمز");
  assert.equal((await c.post("/api/staff/recover/start", { school: id, phone })).status, 200);
  const code = sent[0].message.match(/(\d{6})/)[1];
  const bad = code === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) assert.equal((await c.post("/api/staff/recover/verify", { school: id, phone, code: bad })).status, 400);
  assert.equal((await c.post("/api/staff/recover/verify", { school: id, phone, code })).status, 429, "بعد خمس محاولات يتوقف حتى الرمز الصحيح");

  await transaction({ tenantId: id }, (q) => q("UPDATE staff_recovery SET otp_last_sent_at = NULL"));
  sent.length = 0;
  assert.equal((await c.post("/api/staff/recover/start", { school: id, phone })).status, 200);
  const c2 = sent[0].message.match(/(\d{6})/)[1];
  await transaction({ tenantId: id }, (q) => q("UPDATE staff_recovery SET otp_expires_at = now() - interval '1 minute' WHERE otp_hash IS NOT NULL"));
  assert.equal((await c.post("/api/staff/recover/verify", { school: id, phone, code: c2 })).status, 410, "الرمز المنتهي مرفوض");
  assert.equal((await c.post("/api/staff/recover/reset", { school: id, ticket: "0".repeat(64), password: "New-Password-2026" })).status, 410);
});
