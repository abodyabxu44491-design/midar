// مراسلة المعلمين: ولي الأمر يراسل معلمي فصل ابنه فقط، والمعلم يرد على أولياء أمور طلاب فصوله فقط
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, uid, endPool } from "./helpers.js";
import { transaction } from "../src/core/db/pool.js";

let srv, S, other;
const pub = (path, body) => client(srv.base).post(`/api/public/${S.id}${path}`, body);

before(async () => {
  srv = await startServer();
  S = await readySchool(srv.base, { prefix: "chat", students: 2 });
  // معلم ثانٍ يدرّس الشعبة «ب» فقط (طلاب الاختبار في «أ»)
  const t = await S.admin.post("/api/admin/teachers", { name: "أ. ناصر علي", username: `tch${uid()}`.slice(0, 18),
    load: [{ class_id: S.c2.id, subject_id: S.math.id }] });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  other = client(srv.base);
  await other.post("/api/staff/login", { school: S.id, username: t.data.credentials.username, password: t.data.credentials.password });
  await transaction({ tenantId: S.id }, (q) => q("UPDATE users SET must_change_password = false WHERE role = 'teacher'"));
  S.otherId = (await S.admin.get("/api/admin/teachers/")).data.find((x) => x.name === "أ. ناصر علي").id;
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

  // المعلم: المحادثة في قائمته بغير مقروء، ووصله إشعار
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
  // ولي أمر الطالب الثاني: محادثته مع نفس المعلم فارغة (لا يرى محادثة غيره)
  assert.deepEqual((await pub("/student/chat/thread", { ...p2, teacher_id: S.teacherId })).data.messages, []);
  // معرّف خاطئ
  assert.equal((await pub("/student/chat", { student_id: S.students[0].id, key: "ZZZZ-ZZZZ" })).status, 401);
  // رسالة فارغة
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
