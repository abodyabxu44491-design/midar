/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// How an online exam is taken: pages, no going back, an entry code, leaving the page, extra time, a fresh start, and
// the teacher's question analysis.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { pagesOf, analysis } from "../src/modules/shared/online-exams.service.js";

let srv, A, paperId, online;
const content = { sections: [
  { id: "s_one11", title: "الأول", instructions: "", questions: [
    { id: "q_mc111", type: "mcq", marks: 2, text: "اثنان زائد اثنان", options: [{ id: "o_four1", text: "4" }, { id: "o_five1", text: "5" }], correct: ["o_four1"] },
    { id: "q_tf111", type: "truefalse", marks: 1, text: "الشمس نجم", correct: true },
  ] },
  { id: "s_two11", title: "الثاني", instructions: "", questions: [
    { id: "q_tf222", type: "truefalse", marks: 1, text: "القمر كوكب", correct: false },
  ] },
] };
const who = (s) => A.parent(s);
const pub = (path, body) => client(srv.base).post(`/api/public/${A.id}${path}`, body);

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "ov", students: 3 });
  const p = await A.teacher.post("/api/teacher/papers", { title: "اختبار الصفحات", subject_id: A.math.id, class_id: A.c1.id, content });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  paperId = p.data.id;
  assert.equal((await A.teacher.post(`/api/teacher/papers/${paperId}/status`, { action: "approve" })).status, 200);
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("الصفحات: سؤال في كل صفحة، أو قسم، أو الكل", () => {
  assert.deepEqual(pagesOf(content, "one"), [["q_mc111"], ["q_tf111"], ["q_tf222"]]);
  assert.deepEqual(pagesOf(content, "section"), [["q_mc111", "q_tf111"], ["q_tf222"]]);
  assert.deepEqual(pagesOf(content, "all"), [["q_mc111", "q_tf111", "q_tf222"]]);
});

test("النشر بإعدادات العرض، والطالب يرى القواعد ويحتاج رمز الدخول", async () => {
  const body = { paper_id: paperId, opens_at: new Date(Date.now() - 60_000).toISOString(), closes_at: new Date(Date.now() + 3600_000).toISOString(),
    duration_min: 20, show_result: "score", shuffle: false, layout: "one", no_back: true, access_code: "ab12", max_leaves: 2 };
  assert.equal((await A.teacher.post("/api/teacher/online-exams", { ...body, access_code: "a b" })).status, 400, "رمز غير صالح");
  const r = await A.teacher.post("/api/teacher/online-exams", body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  online = r.data;
  const [s1] = A.students;
  const row = (await pub("/student/online-exams", who(s1))).data.find((x) => x.id === online.id);
  assert.deepEqual(row.settings, { layout: "one", no_back: true, needs_code: true, max_leaves: 2 });
  assert.equal(row.question_count, 3);
  assert.ok(!JSON.stringify(row).includes("AB12"), "الرمز لا يصل للطالب");
  const noCode = await pub(`/student/online-exams/${online.id}/start`, who(s1));
  assert.equal(noCode.status, 400);
  assert.equal(noCode.data.code, "access_code");
  assert.equal((await pub(`/student/online-exams/${online.id}/start`, { ...who(s1), access_code: "zz99" })).status, 400, "رمز خاطئ");
  const ok = await pub(`/student/online-exams/${online.id}/start`, { ...who(s1), access_code: "AB12" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.settings.layout, "one");
  assert.equal(ok.data.events.page, 0);
  assert.equal((await pub(`/student/online-exams/${online.id}/start`, who(s1))).status, 200, "الاستئناف لا يحتاج الرمز");
});

test("بلا رجوع: إجابات الصفحات السابقة لا تتغير بعد الانتقال منها", async () => {
  const [s1] = A.students;
  const save = (answers, page) => pub(`/student/online-exams/${online.id}/save`, { ...who(s1), answers, page, flags: ["q_tf111"] });
  assert.equal((await save({ q_mc111: "o_five1" }, 0)).status, 200);
  assert.equal((await save({ q_mc111: "o_five1", q_tf111: true }, 1)).status, 200);
  assert.equal((await save({ q_mc111: "o_four1", q_tf111: true }, 1)).status, 200, "محاولة تغيير صفحة سابقة");
  const st = (await pub(`/student/online-exams/${online.id}/start`, who(s1))).data;
  assert.equal(st.answers.q_mc111, "o_five1", "بقيت إجابة الصفحة الأولى كما كانت");
  assert.equal(st.events.page, 1);
  assert.deepEqual(st.events.flags, ["q_tf111"]);
});

test("الخروج من الصفحة يُحسب، وبعد الحد يُسلَّم الاختبار", async () => {
  const [s1] = A.students;
  const l1 = (await pub(`/student/online-exams/${online.id}/leave`, who(s1))).data;
  assert.deepEqual([l1.leaves, l1.max, !!l1.submitted], [1, 2, false]);
  await pub(`/student/online-exams/${online.id}/leave`, who(s1));
  const l3 = (await pub(`/student/online-exams/${online.id}/leave`, who(s1))).data;
  assert.equal(l3.submitted, true);
  assert.equal(l3.result.score, 1, "سُلّم بإجاباته المحفوظة");
  const res = (await A.teacher.get(`/api/teacher/online-exams/${online.id}`)).data;
  const row = res.students.find((s) => s.attempt_id);
  assert.equal(row.events.leaves, 3);
  assert.ok(row.submitted_at);
});

test("المعلم: إعادة فتح المحاولة بوقت إضافي، وبدء طالب من جديد، وتعديل الإعدادات، وتحليل الأسئلة", async () => {
  const [s1, s2] = A.students;
  let res = (await A.teacher.get(`/api/teacher/online-exams/${online.id}`)).data;
  const a1 = res.students.find((s) => s.attempt_id);
  const ex = await A.teacher.post(`/api/teacher/online-exams/${online.id}/attempts/${a1.attempt_id}/extend`, { minutes: 10 });
  assert.equal(ex.status, 200, JSON.stringify(ex.data));
  assert.equal(ex.data.reopened, true);
  const back = await pub(`/student/online-exams/${online.id}/start`, who(s1));
  assert.equal(back.status, 200, "يكمل بعد إعادة الفتح");
  assert.equal((await pub(`/student/online-exams/${online.id}/submit`, { ...who(s1), answers: back.data.answers, page: 2 })).status, 200);

  assert.equal((await pub(`/student/online-exams/${online.id}/start`, { ...who(s2), access_code: "ab12" })).status, 200, "الرمز لا يفرق بين الحروف");
  res = (await A.teacher.get(`/api/teacher/online-exams/${online.id}`)).data;
  const a2 = res.students.find((s) => s.name && s.attempt_id && !s.submitted_at);
  assert.equal((await A.teacher.del(`/api/teacher/online-exams/${online.id}/attempts/${a2.attempt_id}`)).status, 200);
  const list = (await pub("/student/online-exams", who(s2))).data.find((x) => x.id === online.id);
  assert.equal(list.state, "open", "يبدأ من جديد");

  const up = await A.teacher.patch(`/api/teacher/online-exams/${online.id}`, { layout: "section", access_code: "", max_leaves: 0, no_back: false });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const row = (await pub("/student/online-exams", who(s2))).data.find((x) => x.id === online.id);
  assert.deepEqual(row.settings, { layout: "section", no_back: false, needs_code: false, max_leaves: 0 });

  res = (await A.teacher.get(`/api/teacher/online-exams/${online.id}`)).data;
  const mc = res.analysis.find((q) => q.id === "q_mc111");
  assert.equal(mc.attempts, 1);
  assert.equal(mc.right_pct, 0);
  assert.deepEqual(mc.options.map((o) => [o.text, o.correct, o.picked]), [["4", true, 0], ["5", false, 1]]);
  assert.equal(res.analysis.find((q) => q.id === "q_tf111").right_pct, 100);
});

test("تحليل الأسئلة يعمل بلا محاولات", () => {
  const a = analysis(content, []);
  assert.equal(a.length, 3);
  assert.equal(a[0].right_pct, null);
});
