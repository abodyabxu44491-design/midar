/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, uid, endPool } from "./helpers.js";
import { transaction } from "../src/core/db/pool.js";

let srv, S, other;
const pub = (path, body) => client(srv.base).post(`/api/public/${S.id}${path}`, body);

before(async () => {
  srv = await startServer();
  S = await readySchool(srv.base, { prefix: "chat", students: 2 });
  const t = await S.admin.post("/api/admin/teachers", { name: "أ. ناصر علي", username: `tch${uid()}`.slice(0, 18),
    load: [{ class_id: S.c2.id, subject_id: S.math.id }] });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  other = client(srv.base);
  await other.post("/api/staff/login", { school: S.id, username: t.data.credentials.username, password: t.data.credentials.password });
  await transaction({ tenantId: S.id }, (q) => q("UPDATE users SET must_change_password = false WHERE role = 'teacher'"));
  S.otherId = (await S.admin.get("/api/admin/teachers/")).data.find((x) => x.name === "أ. ناصر علي").id;
  // المراسلة مغلقة افتراضيًا لكل معلم حتى تفعّلها الإدارة
  const p0 = S.parent(S.students[0]);
  const blocked = await pub("/student/chat/send", { ...p0, teacher_id: S.teacherId, text: "مرحبا" });
  assert.equal(blocked.status, 403, "قبل تفعيل الإدارة لا مراسلة");
  assert.equal((await S.admin.put("/api/admin/chat/teachers", { enabled: true })).status, 200);
});
after(async () => { await srv.close(); await endPool(); });

test("ولي الأمر يرى معلمي فصل ابنه ويراسلهم، والمعلم يرد، وغير المقروء يتحدث للطرفين", async () => {
  const p1 = S.parent(S.students[0]);
  const list = await pub("/student/chat", p1);
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.deepEqual(list.data.teachers.map((x) => x.id), [S.teacherId], "معلم الشعبة «أ» فقط");
  assert.deepEqual(list.data.teachers[0].subjects, ["الرياضيات"]);

  const sent = await pub("/student/chat/send", { ...p1, teacher_id: S.teacherId, text: "السلام عليكم، كيف مستوى أحمد في الرياضيات؟" });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));

  const inbox = await S.teacher.get("/api/teacher/chat");
  assert.equal(inbox.status, 200);
  const th = inbox.data.threads.find((x) => x.student_id === S.students[0].id);
  assert.equal(th.unread, 1);
  assert.match(th.last_preview, /مستوى أحمد/);
  const [n] = await transaction({ tenantId: S.id }, (q) => q("SELECT count(*)::int AS n FROM notifications WHERE kind = 'chat' AND user_id IS NOT NULL"));
  assert.equal(n.n, 1, "إشعار للمعلم");

  const open = await S.teacher.get(`/api/teacher/chat/${th.id}`);
  assert.equal(open.data.messages.length, 1);
  assert.ok(open.data.thread.student_name);
  assert.equal((await S.teacher.get("/api/teacher/chat")).data.unread, 0, "فتح المحادثة يصفّر غير المقروء");

  const reply = await S.teacher.post(`/api/teacher/chat/${th.id}`, { text: "وعليكم السلام، مستواه ممتاز ويحتاج مراجعة الكسور." });
  assert.equal(reply.status, 201);
  const after1 = await pub("/student/chat", p1);
  assert.equal(after1.data.teachers[0].unread, 1, "رد المعلم غير مقروء عند ولي الأمر");
  const thread = await pub("/student/chat/thread", { ...p1, teacher_id: S.teacherId });
  assert.deepEqual(thread.data.messages.map((m) => m.sender), ["parent", "teacher"]);
  assert.equal((await pub("/student/chat", p1)).data.teachers[0].unread, 0);
  const [pn] = await transaction({ tenantId: S.id }, (q) => q("SELECT count(*)::int AS n FROM notifications WHERE kind = 'chat' AND student_id = $1", [S.students[0].id]));
  assert.equal(pn.n, 1, "إشعار لولي الأمر");
});

test("العزل: لا مراسلة لمعلم خارج فصل الطالب، ولا يقرأ معلم آخر المحادثة، ولا ولي أمر آخر", async () => {
  const p1 = S.parent(S.students[0]), p2 = S.parent(S.students[1]);
  const wrong = await pub("/student/chat/send", { ...p1, teacher_id: S.otherId, text: "مرحبا" });
  assert.equal(wrong.status, 403);
  assert.equal((await pub("/student/chat/thread", { ...p1, teacher_id: S.otherId })).status, 404);
  const th = (await S.teacher.get("/api/teacher/chat")).data.threads[0];
  assert.equal((await other.get(`/api/teacher/chat/${th.id}`)).status, 403, "المعلم الآخر لا يقرأ");
  assert.equal((await other.post(`/api/teacher/chat/${th.id}`, { text: "تدخل" })).status, 403);
  assert.equal((await other.post("/api/teacher/chat/start", { student_id: S.students[0].id, text: "مرحبا" })).status, 403);
  assert.deepEqual((await pub("/student/chat/thread", { ...p2, teacher_id: S.teacherId })).data.messages, []);
  assert.equal((await pub("/student/chat", { student_id: S.students[0].id, key: "ZZZZ-ZZZZ" })).status, 401);
  assert.equal((await pub("/student/chat/send", { ...p1, teacher_id: S.teacherId, text: "   " })).status, 400);
});

test("المعلم يبدأ محادثة مع ولي أمر طالب من فصله، وإيقاف القسم يغلق المراسلة", async () => {
  const start = await S.teacher.post("/api/teacher/chat/start", { student_id: S.students[1].id, text: "نرجو متابعة واجبات سالم." });
  assert.equal(start.status, 201, JSON.stringify(start.data));
  const p2 = S.parent(S.students[1]);
  assert.equal((await pub("/student/chat", p2)).data.teachers[0].unread, 1);

  assert.equal((await S.admin.put("/api/admin/settings/modules", { chat: false })).status, 200);
  assert.equal((await pub("/student/chat", p2)).status, 404);
  assert.equal((await S.teacher.get("/api/teacher/chat")).status, 404, "القسم الموقوف غير متاح للمعلم");
  await S.admin.put("/api/admin/settings/modules", { chat: true });
  assert.equal((await pub("/student/chat", p2)).status, 200);
});

test("ضوابط الإدارة: إيقاف معلم، الرصد التلقائي، الاطلاع المسجّل، إغلاق المحادثة وإعادة فتحها", async () => {
  const p1 = S.parent(S.students[0]);
  // إيقاف المعلم: لا يرسل ولا يُراسَل، ويظهر لولي الأمر أن المراسلة غير متاحة
  assert.equal((await S.admin.put(`/api/admin/chat/teachers/${S.teacherId}`, { enabled: false })).status, 200);
  assert.equal((await pub("/student/chat/send", { ...p1, teacher_id: S.teacherId, text: "سؤال" })).status, 403);
  assert.equal((await pub("/student/chat", p1)).data.teachers[0].can_send, false);
  assert.equal((await S.teacher.get("/api/teacher/chat")).data.enabled, false);
  assert.equal((await S.teacher.post("/api/teacher/chat/start", { student_id: S.students[0].id, text: "مرحبا" })).status, 403);
  await S.admin.put(`/api/admin/chat/teachers/${S.teacherId}`, { enabled: true });

  // رسالة تذكر مالًا: تُعلَّم للمراجعة ويصل للإدارة إشعار
  assert.equal((await pub("/student/chat/send", { ...p1, teacher_id: S.teacherId, text: "أقدر أحوّل لك مبلغ عشان تهتم بالولد؟" })).status, 201);
  const flagged = await S.admin.get("/api/admin/chat/threads?flagged=1");
  assert.equal(flagged.status, 200, JSON.stringify(flagged.data));
  const th = flagged.data.find((x) => x.student_id === S.students[0].id);
  assert.ok(th?.flagged_at, "المحادثة معلَّمة");
  const [n] = await transaction({ tenantId: S.id }, (q) => q("SELECT count(*)::int AS n FROM notifications WHERE kind = 'chat_review'"));
  assert.ok(n.n >= 1, "إشعار للإدارة");

  // اطلاع الإدارة: للقراءة، ويُسجَّل في سجل المدرسة
  const view = await S.admin.get(`/api/admin/chat/threads/${th.id}`);
  assert.equal(view.status, 200);
  assert.ok(view.data.messages.some((m) => m.flagged), "الرسالة المعلَّمة ظاهرة للإدارة");
  const [log] = await transaction({ tenantId: S.id }, (q) => q("SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'اطلاع على محادثة%'"));
  assert.ok(log.n >= 1, "الاطلاع مسجّل");
  assert.equal((await S.teacher.get(`/api/admin/chat/threads/${th.id}`)).status >= 400, true, "المعلم لا يصل لشاشة الإدارة");

  // مراجعة بلا مخالفة تزيل العلامة
  await S.admin.post(`/api/admin/chat/threads/${th.id}/reviewed`, {});
  assert.equal((await S.admin.get("/api/admin/chat/threads?flagged=1")).data.some((x) => x.id === th.id), false);

  // إغلاق المحادثة: لا إرسال من الطرفين، ثم إعادة الفتح
  assert.equal((await S.admin.post(`/api/admin/chat/threads/${th.id}/close`, { closed: true, reason: "تجاوز الضوابط" })).status, 200);
  assert.equal((await pub("/student/chat/send", { ...p1, teacher_id: S.teacherId, text: "مرحبا" })).status, 403);
  assert.equal((await S.teacher.post(`/api/teacher/chat/${th.id}`, { text: "مرحبا" })).status, 403);
  assert.equal((await pub("/student/chat", p1)).data.teachers[0].closed, true);
  await S.admin.post(`/api/admin/chat/threads/${th.id}/close`, { closed: false });
  assert.equal((await pub("/student/chat/send", { ...p1, teacher_id: S.teacherId, text: "شكرًا" })).status, 201);
});

test("أوقات المراسلة: يحددها المعلم، وخارجها لا يستطيع ولي الأمر الإرسال، ويستطيع المعلم الرد", async () => {
  const p1 = S.parent(S.students[0]);
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Aden" }));
  const other = (now.getDay() + 3) % 7;
  const bad = await S.teacher.put("/api/teacher/chat/hours", { hours: { days: [other], from: "10:00", to: "09:00" } });
  assert.equal(bad.status, 400, "النهاية قبل البداية مرفوضة");
  assert.equal((await S.teacher.put("/api/teacher/chat/hours", { hours: { days: [other], from: "07:00", to: "14:00" } })).status, 200);
  const list = await pub("/student/chat", p1);
  const t = list.data.teachers.find((x) => x.id === S.teacherId);
  assert.equal(t.available_now, false);
  assert.match(t.hours, /من 7:00 ص إلى 2:00 م/);
  const r = await pub("/student/chat/send", { ...p1, teacher_id: S.teacherId, text: "مرحبا" });
  assert.equal(r.status, 400);
  assert.match(r.data.error || r.data.message || "", /أوقات/);
  const th = (await S.teacher.get("/api/teacher/chat")).data.threads.find((x) => x.student_id === S.students[0].id);
  assert.equal((await S.teacher.post(`/api/teacher/chat/${th.id}`, { text: "سأرد غدًا إن شاء الله" })).status, 201, "المعلم يرد في أي وقت");
  assert.equal((await S.teacher.put("/api/teacher/chat/hours", { hours: null })).status, 200);
  assert.equal((await pub("/student/chat/send", { ...p1, teacher_id: S.teacherId, text: "شكرًا" })).status, 201);
});
