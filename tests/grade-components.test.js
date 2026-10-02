// توزيع الدرجات: الأوزان، نوع الدرجة لكل رصد، النتيجة الموزونة في الكشف والشهادة، والقيود والعزل
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { subjectResult } from "../src/modules/shared/grade-components.service.js";

let srv, A, B;

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "gc", students: 3 });
  B = await readySchool(srv.base, { prefix: "gx", students: 1 });
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

async function graded(S, { title, max, scores, component_id }) {
  const e = await S.teacher.post("/api/teacher/exams", { class_id: S.c1.id, subject_id: S.math.id, title, max_score: max, component_id });
  assert.equal(e.status, 201, JSON.stringify(e.data));
  await S.teacher.put(`/api/teacher/exams/${e.data.id}/scores`, { scores });
  await S.teacher.post(`/api/teacher/exams/${e.data.id}/submit`, {});
  assert.equal((await S.admin.post(`/api/admin/exams/${e.data.id}/status`, { status: "published" })).status, 200);
  return e.data;
}
const card = async (S, s) => (await S.admin.get(`/api/admin/reports/report-card/${s.id}`)).data;

test("الحساب الموزون: النسبة × الوزن، والأنواع غير المرصودة لا تُحسب صفرًا", () => {
  const comps = [{ id: 1, name: "مشاركة", weight: 20 }, { id: 2, name: "نهائي", weight: 80, is_default: true }];
  const full = subjectResult([{ score: 10, max_score: 10, component_id: 1 }, { score: 40, max_score: 50, component_id: 2 }], comps);
  assert.equal(full.percent, 84);
  assert.equal(full.partial, false);
  // درجة بلا نوع تُحسب على الافتراضي
  assert.equal(subjectResult([{ score: 5, max_score: 10, component_id: 1 }, { score: 25, max_score: 50, component_id: null }], comps).percent, 50);
  // نوع واحد فقط مرصود: النسبة من المرصود حتى الآن
  const part = subjectResult([{ score: 8, max_score: 10, component_id: 1 }], comps);
  assert.equal(part.percent, 80);
  assert.equal(part.partial, true);
  // بلا توزيع: الحساب القديم
  assert.equal(subjectResult([{ score: 18, max_score: 20 }, { score: 2, max_score: 20 }], []).percent, 50);
});

test("بلا توزيع درجات: الكشف بالمجموع كما كان", async () => {
  const [s1] = A.students;
  await graded(A, { title: "اختبار قبل التوزيع", max: 20, scores: { [s1.id]: 15 } });
  const c = await card(A, s1);
  assert.equal(c.weighted, false);
  assert.equal(c.subjects[0].percent, 75);
});

test("حفظ التوزيع: الأوزان مجموعها 100 ولا تكرار", async () => {
  const bad = await A.admin.put("/api/admin/grade-components", { items: [{ name: "مشاركة", weight: 30 }, { name: "نهائي", weight: 60 }] });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /100/);
  const dup = await A.admin.put("/api/admin/grade-components", { items: [{ name: "نهائي", weight: 50 }, { name: "نهائي", weight: 50 }] });
  assert.equal(dup.status, 400);
  const ok = await A.admin.put("/api/admin/grade-components", { items: [{ name: "المشاركة", weight: 20 }, { name: "الاختبار النهائي", weight: 80, is_default: true }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const g = (await A.admin.get("/api/admin/grade-components")).data;
  assert.equal(g.items.length, 2);
  assert.ok(g.templates.length >= 3);
  assert.equal(g.items.find((x) => x.is_default).name, "الاختبار النهائي");
});

test("المعلم يرصد كل أنواع الدرجات، والكشف والشهادة بالنتيجة الموزونة", async () => {
  const comps = (await A.teacher.get(`/api/teacher/exams/components?class_id=${A.c1.id}`)).data;
  assert.equal(comps.length, 2);
  const part = comps.find((c) => c.name === "المشاركة");
  const [, s2, s3] = A.students;
  await graded(A, { title: "مشاركة الشهر", max: 10, scores: { [s2.id]: 10, [s3.id]: 5 }, component_id: part.id });
  // بلا اختيار نوع: يُرصد على الافتراضي (النهائي)
  const fin = await graded(A, { title: "النهائي", max: 50, scores: { [s2.id]: 40, [s3.id]: 25 } });
  assert.equal(fin.component_id, comps.find((c) => c.is_default).id);

  const c2 = await card(A, s2);
  assert.equal(c2.weighted, true);
  const m = c2.subjects.find((x) => x.subject === "الرياضيات");
  assert.equal(m.percent, 84);
  assert.deepEqual(m.components.map((x) => [x.name, x.weight, x.percent]), [["المشاركة", 20, 100], ["الاختبار النهائي", 80, 80]]);
  assert.equal((await card(A, s3)).subjects[0].percent, 50);

  const p = await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term", dry_run: true });
  const by = Object.fromEntries(p.data.students.map((s) => [s.id, s]));
  assert.equal(by[s2.id].percent, 84);
  assert.equal(by[s3.id].percent, 50);

  const list = (await A.teacher.get("/api/teacher/exams")).data;
  assert.equal(list.find((e) => e.title === "مشاركة الشهر").component_name, "المشاركة");
});

test("توزيع خاص بصف يتقدم على العام، ولا يُقبل نوع من توزيع آخر", async () => {
  const g = (await A.admin.get("/api/admin/grade-components")).data;
  const gradeId = g.grades.find((x) => x.name === "الأول").id;   // صف الشعبة «الأول - أ»
  const r = await A.admin.put("/api/admin/grade-components", { grade_id: gradeId, items: [{ name: "أعمال السنة", weight: 40 }, { name: "النهائي", weight: 60, is_default: true }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const comps = (await A.teacher.get(`/api/teacher/exams/components?class_id=${A.c1.id}`)).data;
  assert.deepEqual(comps.map((c) => c.name), ["أعمال السنة", "النهائي"]);
  const general = g.items.find((x) => x.grade_id === null);
  const wrong = await A.teacher.post("/api/teacher/exams", { class_id: A.c1.id, subject_id: A.math.id, title: "خطأ", max_score: 10, component_id: general.id });
  assert.equal(wrong.status, 400);
  // نرجع للتوزيع العام لبقية الاختبارات
  assert.equal((await A.admin.put("/api/admin/grade-components", { grade_id: gradeId, items: [] })).status, 200);
});

test("لا يُحذف نوع عليه درجات مرصودة", async () => {
  const items = (await A.admin.get("/api/admin/grade-components")).data.items.filter((x) => x.grade_id === null);
  const keepOnly = items.filter((x) => x.name === "الاختبار النهائي").map((x) => ({ id: x.id, name: x.name, weight: 100, is_default: true }));
  const r = await A.admin.put("/api/admin/grade-components", { items: keepOnly });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /درجات مرصودة/);
  // تعديل الاسم والوزن مسموح
  const renamed = items.map((x) => ({ id: x.id, name: x.name === "المشاركة" ? "المشاركة والأنشطة" : x.name, weight: x.name === "المشاركة" ? 30 : 70, is_default: x.is_default }));
  assert.equal((await A.admin.put("/api/admin/grade-components", { items: renamed })).status, 200);
});

test("العزل: مدرسة أخرى لا ترى توزيع غيرها ولا تستخدم أنواعه", async () => {
  assert.equal((await B.admin.get("/api/admin/grade-components")).data.items.length, 0);
  const foreign = (await A.admin.get("/api/admin/grade-components")).data.items[0].id;
  const r = await B.teacher.post("/api/teacher/exams", { class_id: B.c1.id, subject_id: B.math.id, title: "تجربة", max_score: 10, component_id: foreign });
  assert.equal(r.status, 400);
  const other = await B.teacher.get(`/api/teacher/exams/components?class_id=${A.c1.id}`);
  assert.notEqual(other.status, 200);
});
