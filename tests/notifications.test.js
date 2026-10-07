// مركز الإشعارات: صندوق الإشعارات، الإشعار الفوري، الرسائل النصية برصيد، وإيقاف القسم، والعزل بين المدارس
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport, smsSegments } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B;
const pushes = [], smses = [];
let smsFails = false;
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };
const sub = (n) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });

before(async () => {
  srv = await startServer();
  setTransport({
    push: async (s, payload) => { pushes.push({ endpoint: s.endpoint, ...payload }); },
    sms: async (g, m) => { if (smsFails) throw new Error("رفض المزوّد"); smses.push(m); },
  });
  A = await readySchool(srv.base, { prefix: "nt", students: 3 });
  B = await readySchool(srv.base, { prefix: "nb", students: 1 });
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("غياب جديد: يصل إشعار في صندوق ولي الأمر وعلى جهازه المسجّل، ولا يتكرر عند الحفظ مرة ثانية", async () => {
  const [s1] = A.students;
  const anon = client(srv.base);
  const reg = await anon.post(`/api/public/${A.id}/student/push`, { ...A.parent(s1), subscription: sub("p1") });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  const mark = () => A.admin.post("/api/admin/attendance", { date: today, entries: [{ student_id: s1.id, status: "absent", excuse: "مرض" }] });
  assert.equal((await mark()).status, 200);
  assert.ok(await waitFor(() => pushes.some((p) => p.endpoint.endsWith("/p1"))), "وصل الإشعار الفوري");
  const p = pushes.find((x) => x.endpoint.endsWith("/p1"));
  assert.match(p.title, /غياب/);
  assert.ok(p.url.startsWith(`/${A.id}/student`));
  const inbox = await anon.post(`/api/public/${A.id}/student/inbox`, A.parent(s1));
  assert.equal(inbox.status, 200);
  assert.equal(inbox.data.unread, 1);
  assert.match(inbox.data.items[0].body, /مرض/);
  // الحفظ مرة ثانية بنفس الحالة لا يرسل شيئًا
  pushes.length = 0;
  await mark();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(pushes.length, 0);
  assert.equal((await anon.post(`/api/public/${A.id}/student/inbox/read`, { ...A.parent(s1), all: true })).status, 200);
  assert.equal((await anon.post(`/api/public/${A.id}/student/inbox`, A.parent(s1))).data.unread, 0);
});

test("المدرسة تختار الأحداث: إيقاف الإشعار الفوري للغياب يبقي الصندوق ولا يرسل للجهاز", async () => {
  const [, s2] = A.students;
  await client(srv.base).post(`/api/public/${A.id}/student/push`, { ...A.parent(s2), subscription: sub("p2") });
  assert.equal((await A.admin.put("/api/admin/communication/notify", { late: { push: false } })).status, 200);
  pushes.length = 0;
  await A.admin.post("/api/admin/attendance", { date: today, entries: [{ student_id: s2.id, status: "late" }] });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(pushes.length, 0);
  const inbox = await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(s2));
  assert.ok(inbox.data.items.some((i) => i.kind === "late"), "في صندوق الإشعارات");
  await A.admin.put("/api/admin/communication/notify", { late: { push: true } });
});

test("الرسائل النصية: بلا رصيد لا تُرسل، والمالك يضيف رصيدًا ويضبط المزوّد، والفشل يعيد الرصيد", async () => {
  const [s1, , s3] = A.students;
  await A.admin.put("/api/admin/communication/notify", { absence: { sms: true } });
  await A.admin.post("/api/admin/attendance", { date: today, entries: [{ student_id: s3.id, status: "absent" }] });
  let sms = (await A.admin.get("/api/admin/communication/sms")).data;
  assert.equal(sms.balance, 0);
  assert.equal(sms.messages[0].status, "no_credit");

  // المالك: المزوّد والرصيد. المفتاح السري لا يعود أبدًا في الردود
  assert.equal((await A.owner.put("/api/owner/sms/gateway", { enabled: true, provider_name: "مزوّد تجريبي", url: "https://sms.example.com/send",
    method: "POST", content_type: "json", body_template: "{\"to\":\"{to}\",\"text\":\"{message}\"}", headers: "{\"Authorization\":\"Bearer SECRET-123\"}" })).status, 200);
  const g = await A.owner.get("/api/owner/sms");
  assert.equal(g.data.gateway.has_headers, true);
  assert.ok(!JSON.stringify(g.data).includes("SECRET-123"), "المفتاح لا يظهر");
  const [{ headers_sealed }] = await transaction({ platform: true }, (q) => q("SELECT headers_sealed FROM sms_gateway"));
  assert.ok(!headers_sealed.includes("SECRET"), "مشفّر في القاعدة");
  assert.equal((await A.owner.post("/api/owner/sms/credits", { tenant_id: A.id, delta: 5, reason: "باقة تجريبية" })).data.balance, 5);
  assert.equal((await A.admin.post("/api/owner/sms/credits", { tenant_id: A.id, delta: 500, reason: "x" })).status, 401, "المدرسة لا تضيف لنفسها");

  smses.length = 0;
  // غياب جديد في يوم آخر (نفس الغياب لنفس اليوم لا يتكرر: منع التكرار)
  assert.equal((await A.admin.post("/api/admin/attendance", { date: yesterday, entries: [{ student_id: s1.id, status: "present" }] })).status, 200);
  await A.admin.post("/api/admin/attendance", { date: yesterday, reason: "تصحيح", entries: [{ student_id: s1.id, status: "absent" }] });
  assert.ok(await waitFor(() => smses.length === 1), "أُرسلت رسالة");
  assert.match(smses[0].to, /^967/);
  sms = (await A.admin.get("/api/admin/communication/sms")).data;
  assert.equal(sms.balance, 5 - smsSegments(smses[0].message));

  // فشل المزوّد: الحالة «فشل» ويعود الرصيد
  smsFails = true;
  const before = sms.balance;
  const [, s2] = A.students;
  await A.admin.post("/api/admin/attendance", { date: yesterday, entries: [{ student_id: s2.id, status: "absent" }] });
  await new Promise((r) => setTimeout(r, 700));
  sms = (await A.admin.get("/api/admin/communication/sms")).data;
  assert.equal(sms.messages[0].status, "failed");
  assert.equal(sms.balance, before, "الرصيد عاد");
  smsFails = false;

  // إرسال يدوي: معاينة التكلفة ثم الإرسال، والرصيد غير الكافي يُرفض
  const dry = await A.admin.post("/api/admin/communication/sms/send", { target: "class", class_id: A.c1.id, message: "اجتماع أولياء الأمور غدًا", dry_run: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.data.recipients, 3);
  const big = await A.admin.post("/api/admin/communication/sms/send", { target: "all", message: "ا".repeat(500) });
  assert.equal(big.status, 400);
  assert.match(big.data.error, /الرصيد لا يكفي/);
});

test("إيقاف قسم الإشعارات من الإعدادات: لا صندوق ولا إرسال، ولا تسجيل أجهزة", async () => {
  const [s1] = A.students;
  assert.equal((await A.admin.put("/api/admin/settings/modules", { notifications: false, sms: false })).status, 200);
  const before = (await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(s1))).data.items.length;
  await A.admin.post("/api/admin/attendance", { date: today, reason: "تصحيح", entries: [{ student_id: s1.id, status: "late" }] });
  const after = (await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(s1))).data;
  assert.equal(after.items.length, before);
  assert.equal(after.push.key, null);
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/student/push`, { ...A.parent(s1), subscription: sub("p9") })).status, 400);
  await A.admin.put("/api/admin/settings/modules", { notifications: true, sms: true });
});

test("إشعارات المنسوبين وصناديقهم منفصلة، ولا تُقرأ إشعارات مدرسة من أخرى", async () => {
  assert.equal((await A.admin.post("/api/admin/notifications/push", sub("admin1"))).status, 200);
  pushes.length = 0;
  assert.equal((await A.admin.post("/api/admin/communication/notify/test", {})).status, 200);
  assert.ok(await waitFor(() => pushes.some((p) => p.endpoint.endsWith("/admin1"))));
  assert.equal((await A.admin.get("/api/admin/notifications")).data.unread, 1);
  assert.equal((await A.teacher.get("/api/teacher/notifications")).data.unread, 0, "المعلم لا يرى إشعار المدير");
  // معرّف طالب من مدرسة أ على مدرسة ب
  const [s1] = A.students;
  assert.equal((await client(srv.base).post(`/api/public/${B.id}/student/inbox`, A.parent(s1))).status, 401);
  const leak = await transaction({ tenantId: B.id }, (q) => q("SELECT count(*)::int AS n FROM notifications"));
  assert.equal(leak[0].n, 0);
});

test("الأقسام المعتمدة على غيرها: إيقاف الرسوم يوقف الأقساط، وتشغيل الأقساط يحتاج الرسوم", async () => {
  assert.equal((await B.admin.put("/api/admin/settings/modules", { fees: false })).status, 200);
  const m = (await B.admin.get("/api/admin/settings/modules")).data;
  assert.equal(m.installments, false);
  const r = await B.admin.put("/api/admin/settings/modules", { installments: true });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /الرسوم/);
  assert.equal((await B.admin.put("/api/admin/settings/modules", { fees: true, installments: true })).status, 200);
});

test("منطقة الحذر: رصيد الرسائل فوترة لا تُحذف، والأجهزة مؤقتة", async () => {
  const rows = await transaction({ platform: true }, (q) => q("SELECT name, kind FROM danger_tables() WHERE name IN ('sms_ledger', 'push_subscriptions', 'sms_messages', 'notifications')"));
  const kind = Object.fromEntries(rows.map((r) => [r.name, r.kind]));
  assert.deepEqual(kind, { sms_ledger: "billing", push_subscriptions: "transient", sms_messages: "log", notifications: "data" });
});
