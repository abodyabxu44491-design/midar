// القنوات المجانية: بوابة رسائل المدرسة (جوالها بشريحتها) بلا رصيد، وقائمة واتساب للإرسال المتتابع، والعزل
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B, smsFails = false;
const sent = [];
const C = "/api/admin/communication";
const today = new Date().toISOString().slice(0, 10);
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };
const q1 = (tid, sql, p = []) => transaction({ tenantId: tid }, async (q) => (await q(sql, p))[0]);

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async (g, m) => { if (smsFails) throw new Error("الجوال غير متصل"); sent.push({ g, m }); } });
  A = await readySchool(srv.base, { prefix: "fc", students: 3 });
  B = await readySchool(srv.base, { prefix: "fd", students: 1 });
  for (const S of [A, B]) await S.admin.put("/api/admin/settings/modules", { sms: true, messaging: true, notifications: true });
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("بوابة المدرسة (جوال أندرويد): تُحفظ بيانات الدخول مشفّرة ولا تُعاد، والإرسال بلا رصيد", async () => {
  // بلا بوابة ولا رصيد: الإرسال مرفوض برسالة تدل على الحل المجاني
  const no = await A.admin.post(`${C}/sms/send`, { target: "all", message: "تجربة" });
  assert.equal(no.status, 400);
  assert.equal((await A.admin.put(`${C}/sms/gateway`, { enabled: true, preset: "android" })).status, 400, "يلزم اسم المستخدم وكلمة المرور");
  const r = await A.admin.put(`${C}/sms/gateway`, { enabled: true, preset: "android", username: "SCHOOLPHONE", password: "s3cret-pass" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = await A.admin.get(`${C}/sms/gateway`);
  assert.equal(g.data.gateway.enabled, true);
  assert.equal(g.data.gateway.has_auth, true);
  assert.equal(JSON.stringify(g.data).includes("s3cret"), false, "كلمة المرور لا تعود");
  const row = await q1(A.id, "SELECT headers_sealed FROM school_sms_gateway");
  assert.equal(row.headers_sealed.includes("s3cret") || row.headers_sealed.includes(Buffer.from("SCHOOLPHONE:s3cret-pass").toString("base64")), false, "مشفّرة");
  const leak = await transaction({ platform: true }, async (q) => (await q("SELECT count(*)::int AS n FROM audit_log WHERE coalesce(new_data::text, '') || action ILIKE '%s3cret%'"))[0].n);
  assert.equal(leak, 0);

  const before = (await A.admin.get(`${C}/sms`)).data.balance;
  const dry = (await A.admin.post(`${C}/sms/send`, { target: "all", message: "اجتماع أولياء الأمور غدًا", dry_run: true })).data;
  assert.equal(dry.cost, 0);
  assert.equal(dry.own, true);
  const s = await A.admin.post(`${C}/sms/send`, { target: "all", message: "اجتماع أولياء الأمور غدًا" });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.ok(await waitFor(() => sent.length >= s.data.queued && s.data.queued > 0));
  const m = sent[0];
  assert.equal(m.g.url, "https://api.sms-gate.app/3rdparty/v1/message");
  assert.equal(JSON.parse(m.g.headers).Authorization, `Basic ${Buffer.from("SCHOOLPHONE:s3cret-pass").toString("base64")}`);
  const d = (await A.admin.get(`${C}/sms`)).data;
  assert.equal(d.balance, before, "لا خصم من الرصيد");
  assert.ok(d.messages.every((x) => x.via === "school" && x.status === "sent"));

  // فشل الجوال: تُسجل الرسالة فاشلة ولا يُضاف رصيد
  smsFails = true;
  await A.admin.post(`${C}/sms/send`, { target: "students", student_ids: [A.students[0].id], message: "رسالة ثانية" });
  await new Promise((r) => setTimeout(r, 400));
  smsFails = false;
  const after = (await A.admin.get(`${C}/sms`)).data;
  assert.equal(after.messages[0].status, "failed");
  assert.equal(after.balance, before);

  // B لا يرى بوابة A ولا يرسل عبرها
  assert.equal((await B.admin.get(`${C}/sms/gateway`)).data.gateway.enabled, false);
  assert.equal((await B.admin.post(`${C}/sms/send`, { target: "all", message: "تجربة" })).status, 400);
});

test("قائمة واتساب: تجهيز بمتغيرات، رقم واحد للإخوة، بلا تكرار، ثم إرسال متتابع", async () => {
  const r = await A.admin.post(`${C}/wa/compose`, { target: "all", message: "ولي أمر الطالب {الطالب} ({الفصل}): نذكّركم باجتماع الخميس." });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.added >= 1);
  const again = await A.admin.post(`${C}/wa/compose`, { target: "all", message: "ولي أمر الطالب {الطالب} ({الفصل}): نذكّركم باجتماع الخميس." });
  assert.equal(again.data.added, 0, "لا تكرار لرسالة منتظرة");
  let w = (await A.admin.get(`${C}/wa`)).data;
  assert.equal(w.counts.pending, r.data.added);
  const first = w.pending[0];
  assert.match(first.body, new RegExp(first.student));
  assert.match(first.body, /— /, "توقيع المدرسة");
  assert.match(first.phone, /^[0-9]{8,15}$/);
  assert.equal((await A.admin.post(`${C}/wa/${first.id}/done`, { status: "sent" })).status, 200);
  w = (await A.admin.get(`${C}/wa`)).data;
  assert.equal(w.counts.pending, r.data.added - 1);
  assert.equal(w.counts.sent_7d, 1);
  // B لا يرى قائمة A ولا يعدّلها
  assert.equal((await B.admin.get(`${C}/wa`)).data.pending.length, 0);
  assert.equal((await B.admin.post(`${C}/wa/${w.pending[0].id}/done`, { status: "sent" })).status, 404);
  assert.equal((await A.admin.post(`${C}/wa/clear`, { scope: "pending" })).data.removed, r.data.added - 1);
  assert.equal((await A.admin.post(`${C}/wa/compose`, { target: "absent_today", message: "غياب" })).status, 400, "لا غياب اليوم");
});

test("واتساب تلقائي من الأحداث: الغياب يضيف رسالة للقائمة عند تفعيله، والإيقاف يحجبه", async () => {
  const [s1] = A.students;
  assert.equal((await A.admin.put(`${C}/notify`, { absence: { wa: true } })).data.absence.wa, true);
  await A.admin.post("/api/admin/attendance", { date: today, entries: [{ student_id: s1.id, status: "absent" }] });
  let w = (await A.admin.get(`${C}/wa`)).data;
  assert.equal(w.pending.length, 1);
  assert.equal(w.pending[0].kind, "absence");
  // تذكير المتأخرين بالمبلغ
  assert.equal((await A.admin.post(`${C}/wa/compose`, { target: "absent_today", message: "ابنكم {الطالب} غائب اليوم" })).data.added, 1);
  await A.admin.put("/api/admin/settings/modules", { messaging: false });
  assert.equal((await A.admin.get(`${C}/wa`)).status, 400);
  await A.admin.put("/api/admin/settings/modules", { messaging: true });
});
