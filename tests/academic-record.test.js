// السجل الأكاديمي: مصدر واحد لمعالج أول دخول وللإعدادات — مراحل مخصصة، ربط المواد بمراحلها،
// تغيير نمط تسمية الصفوف دون إنشاء صفوف جديدة، حالات السنة، التدقيق، والعزل بين المدارس
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";

let srv, owner, A, B;
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function makeSchool(name) {
  const id = `ac-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id, name, max_students: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: id, username: "admin", password: r.data.credentials.password })).status, 200);
  return { id, admin };
}

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  A = await makeSchool("مدرسة السجل أ");
  B = await makeSchool("مدرسة السجل ب");
});
after(async () => { await srv.close(); await endPool(); });

const structure = async (school) => (await school.admin.get("/api/admin/setup")).data.structure;
const gradesOf = (st) => st.stages.flatMap((x) => x.grades);

test("معالج أول دخول: مراحل مختارة + مرحلة مخصصة، بدون شعب، نمط دولي، والمواد مرتبطة بمراحلها فقط", async () => {
  const r = await A.admin.post("/api/admin/setup/finish", {
    sections_enabled: false,
    template: {
      template: "empty", stages: ["middle", "secondary"], grade_set: "international", sections_per_grade: 0, naming: "arabic",
      subjects: ["الرياضيات", "الفيزياء", "البرمجة"],
      custom_stages: [{ name: "مرحلة التحفيظ", grades: ["الحلقة الأولى", "الحلقة الثانية"] }],
    },
    year: { name: "سنة الاختبار", start_date: day(-30), end_date: day(240), terms: 3 },
    days: [0, 1, 2, 3, 4],
    holidays: [{ name: "إجازة منتصف الفصل", kind: "mid_term", start_date: day(20), end_date: day(24) }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.stages, r.data.grades, r.data.sections], [3, 8, 8], "3 مراحل، 3+3+2 صفوف، شعبة افتراضية لكل صف");

  const st = await structure(A);
  assert.equal(st.sections_enabled, false);
  assert.deepEqual(st.stages.map((x) => x.name), ["المرحلة المتوسطة", "المرحلة الثانوية", "مرحلة التحفيظ"]);
  assert.deepEqual(st.stages[0].grades.map((g) => g.name), ["الصف 7", "الصف 8", "الصف 9"]);
  assert.ok(gradesOf(st).every((g) => g.sections.length === 1 && g.sections[0].name === g.name), "بدون شعب: كل صف وحدة واحدة باسمه");

  const idsOf = (stageName) => st.stages.find((x) => x.name === stageName).grades.map((g) => Number(g.id)).sort();
  const linked = (name) => st.subjects.find((x) => x.name === name).grade_ids.slice().sort();
  assert.deepEqual(linked("الفيزياء"), [...idsOf("المرحلة الثانوية"), ...idsOf("مرحلة التحفيظ")].sort(), "الفيزياء لا تُربط بالمتوسط");
  assert.equal(linked("الرياضيات").length, 8);
  assert.equal(linked("البرمجة").length, 8, "مادة لا تقترحها أي مرحلة تُربط بكل الصفوف");

  const ac = (await A.admin.get("/api/admin/academic")).data;
  assert.equal(ac.current.year_name, "سنة الاختبار");
  assert.equal(ac.terms.filter((t) => t.year_id === ac.current.year_id).length, 3);
  assert.equal(ac.years.find((y) => y.is_current).state, "active");
  assert.equal((await A.admin.get("/api/admin/academic/holidays")).data.holidays.length, 1);
  assert.ok((await A.admin.get("/api/admin/me")).data.setup_completed, "المعالج انتهى");
});

test("تغيير نمط التسمية: نفس الصفوف بأسماء جديدة، والشعب والطلاب يتبعونها، وسجل العمليات يحفظ القديم والجديد", async () => {
  const before = await structure(A);
  const g7 = before.stages[0].grades[0];
  const student = await A.admin.post("/api/admin/students", { name: "طالب السجل", class_id: g7.sections[0].id });
  assert.equal(student.status, 201, JSON.stringify(student.data));

  const r = await A.admin.post("/api/admin/setup/rename-grades", { grade_set: "arabic_full" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.renamed, 6, "صفوف المتوسط والثانوي فقط؛ المرحلة المخصصة كما هي");

  const after = await structure(A);
  assert.deepEqual(after.stages[0].grades.map((g) => g.name), ["أول متوسط", "ثاني متوسط", "ثالث متوسط"]);
  assert.deepEqual(gradesOf(after).map((g) => Number(g.id)), gradesOf(before).map((g) => Number(g.id)), "لم يُنشأ أي صف جديد");
  assert.equal(after.stages[0].grades[0].sections[0].name, "أول متوسط", "اسم الشعبة الافتراضية يتبع الصف");
  assert.deepEqual(after.stages[2].grades.map((g) => g.name), ["الحلقة الأولى", "الحلقة الثانية"]);

  const list = (await A.admin.get("/api/admin/students?fields=basic")).data;
  assert.equal(list.find((x) => x.name === "طالب السجل").class_name, "أول متوسط", "الطالب على نفس الصف بالاسم الجديد");

  const audit = (await A.admin.get("/api/admin/audit?table=grades&action=update")).data;
  const change = audit.find((x) => x.summary.endsWith(`#${g7.id}`));
  assert.ok(change, "تغيير الصف مسجل");
  assert.match(change.summary, /الصفوف/);
  assert.deepEqual(change.changes, [{ field: "name", from: "الصف 7", to: "أول متوسط" }], "القيمة القديمة والجديدة");
  assert.ok(!audit.some((x) => x.changes?.some((c) => /^~/.test(String(c.to)))), "لا أسماء مؤقتة بلا داعٍ");

  // الرجوع للنمط الأول يعمل أيضًا، وأسماء متبادلة لا تصطدم بالقيد الفريد
  assert.equal((await A.admin.post("/api/admin/setup/rename-grades", { grade_set: "international" })).data.renamed, 6);
  assert.equal((await A.admin.post("/api/admin/setup/rename-grades", { grade_set: "nope" })).status, 400);
});

test("ربط المواد بالصفوف: التعديل يسجل الفرق فقط", async () => {
  const st = await structure(A);
  const physics = st.subjects.find((x) => x.name === "الفيزياء");
  const keep = physics.grade_ids.slice(1);
  assert.equal((await A.admin.patch(`/api/admin/setup/subjects/${physics.id}`, { name: physics.name, grade_ids: keep })).status, 200);
  const mine = async (action) => (await A.admin.get(`/api/admin/audit?table=subject_grades&action=${action}`)).data
    .filter((x) => x.summary.includes(`#${physics.id}:`));
  assert.equal((await mine("delete")).length, 1, "حذف رابط واحد فقط");
  assert.equal((await mine("insert")).length, physics.grade_ids.length, "إضافات المعالج فقط، بلا إعادة إضافة للروابط الباقية");
});

test("السنوات الدراسية: قادمة ونشطة ومؤرشفة، ولا تُؤرشف السنة الحالية", async () => {
  const add = await A.admin.post("/api/admin/academic/years", { name: "السنة القادمة", start_date: day(300), end_date: day(600), terms: 2, make_current: false });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  let ac = (await A.admin.get("/api/admin/academic")).data;
  const next = ac.years.find((y) => y.name === "السنة القادمة");
  assert.equal(next.state, "upcoming");
  assert.equal(ac.current.year_name, "سنة الاختبار", "السنة الحالية لم تتغير");
  assert.equal(ac.states.upcoming, "قادمة");
  assert.ok(ac.terms.filter((t) => t.year_id === next.id).every((t) => t.state === "upcoming"));

  assert.equal((await A.admin.patch(`/api/admin/academic/years/${next.id}/status`, { status: "archived" })).status, 200);
  ac = (await A.admin.get("/api/admin/academic")).data;
  assert.equal(ac.years.find((y) => y.id === next.id).state, "archived");
  const cur = ac.years.find((y) => y.is_current);
  assert.equal((await A.admin.patch(`/api/admin/academic/years/${cur.id}/status`, { status: "archived" })).status, 400);
});

test("العزل: مدرسة أخرى لا ترى هيكل المدرسة ولا تعدّله", async () => {
  const st = await structure(A);
  const g = gradesOf(st)[0];
  assert.equal((await structure(B)).stages.length, 0);
  assert.equal((await B.admin.patch(`/api/admin/setup/grades/${g.id}`, { name: "اختراق" })).status, 404);
  assert.equal((await B.admin.post("/api/admin/setup/rename-grades", { grade_set: "arabic_full" })).data.renamed, 0);
  assert.equal(gradesOf(await structure(A))[0].name, g.name, "لم يتغير شيء في المدرسة الأولى");
  const anon = client(srv.base);
  assert.equal((await anon.post("/api/admin/setup/rename-grades", { grade_set: "arabic_full" })).status, 401);
});
