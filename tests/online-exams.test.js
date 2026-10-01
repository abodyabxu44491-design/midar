// الاختبارات الإلكترونية: النشر من ورقة معتمدة، الحل من ملف الطالب بلا كشف الإجابات، الوقت، التصحيح الآلي واليدوي، الرصد
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B, paperId, online;
const content = { sections: [{ id: "s_main1", title: "", instructions: "", questions: [
  { id: "q_mcq1", type: "mcq", marks: 2, text: "عاصمة اليمن؟", options: [{ id: "o_sana", text: "صنعاء" }, { id: "o_aden", text: "عدن" }, { id: "o_taiz", text: "تعز" }], correct: ["o_sana"] },
  { id: "q_tf01", type: "truefalse", marks: 1, text: "الماء يغلي عند 100 درجة", correct: true },
  { id: "q_fil1", type: "fill", marks: 2, text: "أكبر كوكب هو ____ وأقربها للشمس ____", answers: ["المشتري", "عطارد"] },
  { id: "q_mat1", type: "match", marks: 2, text: "صل", pairs: [{ id: "p_one1", left: "2+2", right: "4" }, { id: "p_two1", left: "3+3", right: "6" }] },
  { id: "q_ord1", type: "order", marks: 1, text: "رتب", items: [{ id: "i_aaa1", text: "واحد" }, { id: "i_bbb1", text: "اثنان" }, { id: "i_ccc1", text: "ثلاثة" }] },
  { id: "q_ess1", type: "essay", marks: 2, text: "اكتب فقرة عن الوطن", answer: "إجابة نموذجية" },
] }] };
const who = (s) => A.parent(s);
const pub = (path, body) => client(srv.base).post(`/api/public/${A.id}${path}`, body);

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "oe", students: 3 });
  B = await readySchool(srv.base, { prefix: "ob", students: 1 });
  const p = await A.teacher.post("/api/teacher/papers", { title: "اختبار قصير إلكتروني", subject_id: A.math.id, class_id: A.c1.id, content });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  paperId = p.data.id;
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("النشر يحتاج ورقة معتمدة، ويُنشئ اختبار رصد مرتبطًا، ولا يُنشر لشعبة لا يدرسها المعلم", async () => {
  const opens = new Date(Date.now() - 60_000).toISOString(), closes = new Date(Date.now() + 3600_000).toISOString();
  const body = { paper_id: paperId, opens_at: opens, closes_at: closes, duration_min: 20, show_result: "answers" };
  assert.equal((await A.teacher.post("/api/teacher/online-exams", body)).status, 400, "غير معتمد");
  const ap = await A.teacher.post(`/api/teacher/papers/${paperId}/status`, { action: "approve" });
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  const classes = (await A.admin.get("/api/admin/structure/classes")).data;
  const other = classes.find((c) => c.name === "الثاني - أ");
  assert.equal((await A.teacher.post("/api/teacher/online-exams", { ...body, class_id: other.id })).status, 403);
  const r = await A.teacher.post("/api/teacher/online-exams", body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.max_score, 10);
  assert.ok(r.data.exam_id);
  online = r.data;
});

test("الطالب يبدأ: لا إجابات صحيحة في ما يصله، ومعرّفات التوصيل مشفّرة، ويستأنف بنفس الترتيب", async () => {
  const [s1] = A.students;
  const list = (await pub("/student/online-exams", who(s1))).data;
  assert.equal(list[0].state, "open");
  const st = await pub(`/student/online-exams/${online.id}/start`, who(s1));
  assert.equal(st.status, 200, JSON.stringify(st.data));
  const raw = JSON.stringify(st.data.content);
  for (const leak of ["correct", "\"answers\"", "إجابة نموذجية", "p_one1\",\"text\":\"4"]) assert.ok(!raw.includes(leak), `تسريب: ${leak}`);
  const qs = st.data.content.sections[0].questions;
  const mat = qs.find((q) => q.id === "q_mat1");
  assert.ok(mat.right.every((r) => !r.id.startsWith("p_")), "معرّفات العمود الأيمن ليست معرّفات الأزواج");
  assert.equal(qs.find((q) => q.id === "q_fil1").blanks, 2);
  const again = await pub(`/student/online-exams/${online.id}/start`, who(s1));
  assert.deepEqual(again.data.content, st.data.content, "نفس الترتيب عند الاستئناف");
  // إجابات: كلها صحيحة عدا الترتيب جزئيًا، والمقالي يحتاج المعلم
  const right = Object.fromEntries(mat.left.map((l, i) => [l.id, mat.right.find((r) => r.text === (i === 0 ? "4" : "6")).id]));
  const answers = { q_mcq1: "o_sana", q_tf01: true, q_fil1: ["المشترى", " عطارد "], q_mat1: right, q_ord1: ["i_aaa1", "i_ccc1", "i_bbb1"], q_ess1: "اليمن بلد جميل" };
  assert.equal((await pub(`/student/online-exams/${online.id}/save`, { ...who(s1), answers })).status, 200);
  const sub = await pub(`/student/online-exams/${online.id}/submit`, { ...who(s1), answers });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  assert.equal(sub.data.pending, true, "المقالي ينتظر التصحيح");
  assert.equal(sub.data.score, null);
  assert.equal((await pub(`/student/online-exams/${online.id}/submit`, { ...who(s1), answers })).status, 400, "لا تسليم مرتين");
  assert.equal((await pub(`/student/online-exams/${online.id}/start`, who(s1))).status, 400, "لا بدء بعد التسليم");
});

test("التصحيح: الآلي صحيح (مع التشكيل والهمزات)، والمعلم يصحح المقالي، والدرجة ترصد في الاختبار", async () => {
  const res = (await A.teacher.get(`/api/teacher/online-exams/${online.id}`)).data;
  const row = res.students.find((s) => s.attempt_id);
  // 2 + 1 + 2 (الفراغان مع «المشترى» = «المشتري») + 2 + 1/3 من الترتيب = 7.33
  assert.equal(row.auto_score, 7.33);
  assert.equal(row.needs_grading, true);
  const d = (await A.teacher.get(`/api/teacher/online-exams/${online.id}/attempts/${row.attempt_id}`)).data;
  assert.equal(d.questions.find((q) => q.id === "q_ess1").answer, "اليمن بلد جميل");
  const m = await A.teacher.put(`/api/teacher/online-exams/${online.id}/attempts/${row.attempt_id}/marks`, { marks: { q_ess1: 1.5 } });
  assert.equal(m.status, 200);
  assert.equal(m.data.score, 8.83);
  assert.equal(m.data.needs_grading, false);
  // درجة أكبر من درجة السؤال تُقصّ
  assert.equal((await A.teacher.put(`/api/teacher/online-exams/${online.id}/attempts/${row.attempt_id}/marks`, { marks: { q_ess1: 50 } })).data.score, 9.33);
  const sync = await A.teacher.post(`/api/teacher/online-exams/${online.id}/sync`, {});
  assert.equal(sync.data.synced, 1);
  const [sc] = await transaction({ tenantId: A.id }, (q) => q("SELECT score FROM scores WHERE exam_id = $1", [online.exam_id]));
  assert.equal(Number(sc.score), 9.33);
});

test("الوقت: محاولة تجاوزت مدتها تُسلَّم بما حُفظ، والإجابات المتأخرة لا تُقبل، والمراجعة بعد الإغلاق فقط", async () => {
  const [, s2] = A.students;
  assert.equal((await pub(`/student/online-exams/${online.id}/start`, who(s2))).status, 200);
  await pub(`/student/online-exams/${online.id}/save`, { ...who(s2), answers: { q_mcq1: "o_sana" } });
  await transaction({ tenantId: A.id }, (q) => q("UPDATE online_attempts SET deadline_at = now() - interval '5 minutes' WHERE student_id = $1", [s2.id]));
  const late = await pub(`/student/online-exams/${online.id}/submit`, { ...who(s2), answers: { q_mcq1: "o_sana", q_tf01: true } });
  assert.equal(late.data.late, true);
  const d = (await A.teacher.get(`/api/teacher/online-exams/${online.id}`)).data.students.find((s) => s.student_id === s2.id);
  assert.equal(d.auto_score, 2, "فقط ما حُفظ قبل انتهاء الوقت");
  assert.equal((await pub(`/student/online-exams/${online.id}/review`, who(s2))).status, 400, "قبل الإغلاق");
  assert.equal((await A.teacher.post(`/api/teacher/online-exams/${online.id}/close`, {})).status, 200);
  const rv = await pub(`/student/online-exams/${online.id}/review`, who(s2));
  assert.equal(rv.status, 200);
  assert.deepEqual(rv.data.questions.find((q) => q.id === "q_mcq1").correct, ["o_sana"]);
  // طالب لم يبدأ: لا يبدأ بعد الإغلاق
  assert.equal((await pub(`/student/online-exams/${online.id}/start`, who(A.students[2]))).status, 400);
});

test("العزل والصلاحيات وإيقاف القسم", async () => {
  assert.equal((await B.admin.get(`/api/admin/online-exams/${online.id}`)).status, 404);
  assert.equal((await client(srv.base).post(`/api/public/${B.id}/student/online-exams/${online.id}/start`, A.parent(A.students[0]))).status, 401);
  assert.equal((await client(srv.base).post(`/api/public/${B.id}/student/online-exams/${online.id}/start`, B.parent(B.students[0]))).status, 404);
  assert.ok((await A.admin.get("/api/admin/online-exams")).data.some((x) => x.id === online.id), "الإدارة ترى الكل");
  assert.equal((await A.admin.del(`/api/admin/online-exams/${online.id}`)).status, 409, "بدأه طلاب");
  await A.admin.put("/api/admin/settings/modules", { exam_papers: false });
  const m = (await A.admin.get("/api/admin/settings/modules")).data;
  assert.equal(m.online_exams, false, "إيقاف مصمم الاختبارات يوقفه");
  assert.equal((await A.teacher.get("/api/teacher/online-exams")).status, 404);
  assert.equal((await pub("/student/online-exams", who(A.students[0]))).status, 400);
  await A.admin.put("/api/admin/settings/modules", { exam_papers: true, online_exams: true });
});
