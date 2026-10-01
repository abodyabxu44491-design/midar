// الاستبيانات ومواعيد أولياء الأمور: الإنشاء والإجابة مرة واحدة والتحقق والنتائج، والحجز ومنع التضارب والإلغاء، والعزل
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";

let srv, A, B, survey;
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Aden" });
const pub = (S, path, s, body = {}) => client(srv.base).post(`/api/public/${S.id}${path}`, { ...S.parent(s), ...body });

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "en", students: 3 });
  B = await readySchool(srv.base, { prefix: "eb", students: 1 });
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("استبيان لأولياء الأمور: إشعار، إجابة واحدة، تحقق من الإجابات، ونتائج مجمعة", async () => {
  const r = await A.admin.post("/api/admin/engagement/surveys", { title: "رضا أولياء الأمور", audience: "parents", anonymous: false, questions: [
    { type: "rating", text: "ما تقييمك للمدرسة؟" }, { type: "choice", text: "أفضل وسيلة تواصل؟", options: ["واتساب", "رسالة نصية", "التطبيق"] },
    { type: "text", text: "اقتراحاتك", required: false }] });
  assert.ok(r.data.id, JSON.stringify(r.data));
  survey = r.data.id;
  const [s1, s2] = A.students;
  const list = (await pub(A, "/student/surveys", s1)).data;
  assert.equal(list[0].open, true);
  const qs = list[0].questions;
  assert.ok((await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(s1))).data.items.some((n) => n.kind === "survey"));
  assert.equal((await pub(A, `/student/surveys/${survey}`, s1, { answers: { [qs[0].id]: 9, [qs[1].id]: 0 } })).status, 400, "التقييم 1-5");
  assert.equal((await pub(A, `/student/surveys/${survey}`, s1, { answers: { [qs[1].id]: 0 } })).status, 400, "سؤال مطلوب");
  assert.equal((await pub(A, `/student/surveys/${survey}`, s1, { answers: { [qs[0].id]: 5, [qs[1].id]: 2, [qs[2].id]: "ممتازة" } })).status, 200);
  assert.equal((await pub(A, `/student/surveys/${survey}`, s1, { answers: { [qs[0].id]: 5, [qs[1].id]: 2 } })).status, 409, "مرة واحدة");
  await pub(A, `/student/surveys/${survey}`, s2, { answers: { [qs[0].id]: 4, [qs[1].id]: 2 } });
  const res = (await A.admin.get(`/api/admin/engagement/surveys/${survey}`)).data;
  assert.equal(res.responses, 2);
  assert.equal(res.questions[0].average, 4.5);
  assert.equal(res.questions[1].options[2].count, 2);
  assert.equal(res.questions[2].texts[0].who, `ولي أمر ${s1.name}`);
  // المعلم لا يرى استبيان أولياء الأمور، ولا يجيب عنه
  assert.equal((await A.teacher.get("/api/teacher/surveys")).data.length, 0);
  assert.equal((await A.teacher.post(`/api/teacher/surveys/${survey}`, { answers: {} })).status, 404);
  // الإغلاق
  await A.admin.post(`/api/admin/engagement/surveys/${survey}/status`, { status: "closed" });
  assert.equal((await pub(A, `/student/surveys/${survey}`, A.students[2], { answers: { [qs[0].id]: 3, [qs[1].id]: 0 } })).status, 400);
});

test("استبيان المنسوبين المجهول: المعلم يجيب، والنتائج بلا أسماء", async () => {
  const r = await A.admin.post("/api/admin/engagement/surveys", { title: "بيئة العمل", audience: "staff", questions: [{ type: "yesno", text: "هل الجدول مناسب؟" }] });
  const list = (await A.teacher.get("/api/teacher/surveys")).data;
  const sq = list.find((x) => x.id === r.data.id);
  assert.equal((await A.teacher.post(`/api/teacher/surveys/${r.data.id}`, { answers: { [sq.questions[0].id]: true } })).status, 200);
  assert.equal((await pub(A, "/student/surveys", A.students[0])).data.some((x) => x.id === r.data.id), false, "لا يظهر لأولياء الأمور");
  const res = (await A.admin.get(`/api/admin/engagement/surveys/${r.data.id}`)).data;
  assert.equal(res.questions[0].counts.yes, 1);
});

test("المواعيد: المعلم ينشئ فترات، ولي الأمر يحجز، ومنع الحجز المزدوج، والإلغاء والإشعارات", async () => {
  const c = await A.teacher.post("/api/teacher/meetings", { day: day(2), from: "09:00", to: "10:00", minutes: 15, location: "غرفة المعلمين" });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(c.data.created, 4);
  assert.equal((await A.teacher.post("/api/teacher/meetings", { day: day(2), from: "09:30", to: "10:30" })).status, 409, "تداخل");
  const [s1, s2] = A.students;
  const slots = (await pub(A, "/student/meetings", s1)).data;
  assert.equal(slots.length, 4);
  assert.equal((await pub(A, "/student/meetings/book", s1, { slot_id: slots[0].id, topic: "مستوى الرياضيات" })).status, 200);
  assert.equal((await pub(A, "/student/meetings/book", s2, { slot_id: slots[0].id })).status, 409, "محجوز لغيره");
  assert.equal((await pub(A, "/student/meetings/book", s1, { slot_id: slots[1].id })).status, 409, "موعد واحد مع نفس المعلم في اليوم");
  assert.equal((await pub(A, "/student/meetings", s2)).data.length, 3, "المحجوز لا يظهر لغيره");
  const mine = (await A.teacher.get("/api/teacher/meetings")).data.find((x) => x.booking_id);
  assert.equal(mine.topic, "مستوى الرياضيات");
  assert.ok((await A.teacher.get("/api/teacher/notifications")).data.items.some((n) => n.kind === "meeting"));
  assert.equal((await A.teacher.del(`/api/teacher/meetings/${mine.id}`)).status, 409, "محجوز");
  assert.equal((await pub(A, `/student/meetings/${slots[0].id}/cancel`, s1)).status, 200);
  assert.equal((await A.teacher.del(`/api/teacher/meetings/${mine.id}`)).status, 200);
  // الإدارة: مواعيد لمعلم محدد ومواعيدها الخاصة
  assert.equal((await A.admin.post("/api/admin/engagement/meetings", { day: day(3), from: "10:00", to: "10:30", minutes: 30 })).data.created, 1);
  assert.ok((await A.admin.get("/api/admin/engagement/meetings")).data.some((x) => x.host_name === "إدارة المدرسة"));
});

test("العزل والإيقاف", async () => {
  assert.equal((await B.admin.get(`/api/admin/engagement/surveys/${survey}`)).status, 404);
  assert.equal((await pub(B, `/student/surveys/${survey}`, B.students[0], { answers: {} })).status, 404);
  assert.equal((await pub(B, "/student/meetings", B.students[0])).data.length, 0);
  await A.admin.put("/api/admin/settings/modules", { surveys: false, meetings: false });
  assert.equal((await A.admin.get("/api/admin/engagement/surveys")).status, 404);
  assert.equal((await A.teacher.get("/api/teacher/meetings")).status, 404);
  assert.equal((await pub(A, "/student/meetings", A.students[0])).status, 400);
  await A.admin.put("/api/admin/settings/modules", { surveys: true, meetings: true });
});
