// استيراد المعلمين: مطابقة الأعمدة، التعرّف على الموجود، الإسناد من الهيكل المركزي، وكلمات المرور المؤقتة. بلا قاعدة بيانات.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestMapping, analyze, commit, buildTemplate, exportXlsx, gradeKey } from "../src/modules/shared/import-teachers.service.js";

const stages = [{ id: 1, name: "المرحلة الابتدائية" }, { id: 2, name: "المرحلة المتوسطة" }];
const grades = [{ id: 11, stage_id: 1, name: "الأول" }, { id: 21, stage_id: 2, name: "الأول المتوسط" }];
const classes = [{ id: 111, name: "الأول - أ", grade_id: 11 }, { id: 112, name: "الأول - ب", grade_id: 11 }, { id: 211, name: "الأول المتوسط", grade_id: 21 }];
const subjects = [{ id: 5, name: "رياضيات" }, { id: 6, name: "علوم" }];
const existing = [{ id: 900, full_name: "سعد علي", employee_no: "100", phone: "0500000009", email: null, national_id: null, specialty: "رياضيات", department: null,
  job_title: null, qualification: null, gender: null, birth_date: null, hire_date: null, employment_type: null, username: "saad" }];

function fakeDb() {
  const writes = [];
  const q = async (sql, p) => {
    if (sql.includes("FROM school_profile")) return [{ sections_enabled: true }];
    if (sql.includes("FROM stages")) return stages;
    if (sql.includes("FROM grades")) return grades;
    if (sql.includes("FROM classes")) return classes;
    if (sql.includes("FROM subjects")) return subjects.map((s) => ({ ...s, grade_ids: [] }));
    if (sql.includes("FROM teachers t JOIN users u") && sql.includes("ANY")) return existing;
    if (sql.includes("SELECT username FROM users WHERE username = ANY")) return [{ username: "taken1" }];
    if (sql.includes("count(*)::int AS n FROM teachers")) return [{ n: 3 }];
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) { writes.push({ sql: sql.replace(/\s+/g, " "), p }); if (sql.includes("INSERT INTO teachers")) return [{ id: 1000 + writes.length }]; return []; }
    return [];
  };
  return { q, writes };
}

test("suggestMapping: يتعرف على العناوين العربية والإنجليزية ولا يكرر الحقل", () => {
  const m = suggestMapping(["اسم المعلم *", "Employee ID", "الجوال", "مادة", "المادة", "عمود غريب", "Full Name"]);
  assert.equal(m["اسم المعلم *"], "name");
  assert.equal(m["Employee ID"], "employee_no");
  assert.equal(m["الجوال"], "phone");
  assert.equal(m["المادة"], "subject");
  assert.equal(m["عمود غريب"], "");
  assert.equal(m["Full Name"], "");       // الحقل name مأخوذ من عمود سابق
});

const rows = [
  { employee_no: "100", name: "سعد علي", phone: "0500000009", subject: "رياضيات", grade: "الأول", stage: "ابتدائي", section: "أ" },   // موجود: تحديث + إسناد
  { employee_no: "200", name: "منى ناصر", subject: "علوم، رياضيات", grade: "الأول", stage: "ابتدائي" },                                // جديد: كل شعب الصف
  { name: "خالد", username: "khaled1", subject: "علوم", grade: "الأول" },                                                             // صف ملتبس
  { name: "فهد", username: "taken1" },                                                                                                // اسم مستخدم مأخوذ
  { name: "بلا مفتاح" },                                                                                                              // لا اسم مستخدم ولا رقم وظيفي
  { employee_no: "200", name: "مكرر", username: "dupe1" },                                                                            // رقم مكرر داخل الملف
  { employee_no: "300", name: "ليلى", subject: "فيزياء", grade: "الأول", stage: "ابتدائي" },                                          // مادة غير موجودة
  { employee_no: "400", name: "نورة", birth_date: "31/02/1990" },
];

test("analyze: تصنيف الأسطر بلا كتابة", async () => {
  const { q, writes } = fakeDb();
  const a = await analyze(q, rows);
  assert.deepEqual([a.summary.total, a.summary.valid, a.summary.review, a.summary.errors], [8, 2, 1, 5]);
  assert.equal(a.rows[0].action, "update");
  assert.equal(a.rows[0].load.length, 1);                  // أ فقط
  assert.equal(a.rows[1].action, "create");
  assert.equal(a.rows[1].username, "t200");                // مُنشأ من الرقم الوظيفي
  assert.equal(a.rows[1].load.length, 4);                  // مادتان × شعبتان
  assert.ok(a.rows[1].notes.some((n) => /كل شعب/.test(n)));
  assert.equal(a.rows[2].review, "grade");
  assert.equal(a.ambiguities.length, 1);
  assert.match(a.rows[3].errors[0], /مستخدم مسبقًا/);
  assert.match(a.rows[4].errors[0], /اسم المستخدم مطلوب/);
  assert.match(a.rows[5].errors[0], /مكرر/);
  assert.match(a.rows[6].errors[0], /المادة «فيزياء»/);
  assert.equal(writes.length, 0);
});

test("اختيار المستخدم للصف الملتبس", async () => {
  const { q } = fakeDb();
  const a = await analyze(q, rows, { gradeMap: { [gradeKey("الأول", "")]: 21 } });
  assert.equal(a.rows[2].status, "ok");
  assert.equal(a.rows[2].load[0].class_id, 211);
});

test("حد الباقة", async () => {
  const { q } = fakeDb();
  const a = await analyze(q, rows, { maxTeachers: 3 });
  assert.equal(a.capacity.exceeded, true);
  await assert.rejects(commit(q, "school1", rows, { maxTeachers: 3 }), /حد المعلمين/);
});

test("commit: ينشئ الحسابات بكلمات مؤقتة مُجزّأة ويضيف الإسناد على الموجود", async () => {
  const { q, writes } = fakeDb();
  const r = await commit(q, "school1", rows, { gradeMap: {} });
  assert.equal(r.created, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.skipped, 6);
  assert.equal(r.credentials.length, 1);
  assert.match(r.credentials[0].password, /^[A-Z0-9]{4}-[A-Z0-9]{4}-\d{2}$/);
  const user = writes.find((w) => w.sql.includes("INSERT INTO users"));
  assert.match(user.p[2], /^scrypt\$/);                      // مُجزّأة، لا نص صريح
  assert.ok(!JSON.stringify(writes).includes(r.credentials[0].password));
  assert.equal(writes.filter((w) => w.sql.includes("INSERT INTO teacher_assignments")).length, 5);   // 4 للجديد + 1 للموجود
  // لم يتغير أي حقل للمعلم الموجود (الاسم والجوال كما هما): لا UPDATE بلا داعٍ، ولا مساس بالاسم
  assert.ok(!writes.some((w) => w.sql.startsWith("UPDATE teachers") && w.sql.includes("full_name")));
  assert.ok(!writes.some((w) => w.sql.startsWith("DELETE")));// لا حذف إسناد قائم
});

test("القالب والتصدير: xlsx صالح بلا أي سر", async () => {
  const { q } = fakeDb();
  const t = await buildTemplate(q, { stage_id: 1, subject_id: 5, existing: true });
  assert.match(t.filename, /ابتدائية|معلمين/);
  assert.equal(t.buffer.subarray(0, 2).toString(), "PK");
  await assert.rejects(buildTemplate(q, { stage_id: 99 }), /المرحلة غير موجودة/);
  const x = await exportXlsx(q);
  assert.equal(x.subarray(0, 2).toString(), "PK");
});
