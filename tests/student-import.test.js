// استيراد الطلاب: مطابقة الصف الذكية، قواعد التحليل، القالب. بلا قاعدة بيانات (q مزيّف).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, matchGrade, pickSection, norm } from "../src/modules/shared/grade-match.js";
import { analyze, commit, buildTemplate } from "../src/modules/shared/import-students.service.js";
import { buildXlsx, crc32 } from "../src/core/xlsx.js";

const stages = [{ id: 1, name: "المرحلة الابتدائية" }, { id: 2, name: "المرحلة المتوسطة" }];
const grades = [{ id: 11, stage_id: 1, name: "الأول" }, { id: 12, stage_id: 1, name: "الثاني" }, { id: 21, stage_id: 2, name: "الأول المتوسط" }];
const classes = [{ id: 111, name: "الأول - أ", grade_id: 11 }, { id: 112, name: "الأول - ب", grade_id: 11 },
  { id: 121, name: "الثاني", grade_id: 12 }, { id: 211, name: "الأول المتوسط", grade_id: 21 }];
const struct = { stages: stages.map((s) => ({ ...s, grades: grades.filter((g) => g.stage_id === s.id).map((g) => ({ ...g, sections: classes.filter((c) => c.grade_id === g.id) })) })) };
const index = buildIndex(struct);

test("norm يوحّد الهمزات والأرقام الهندية", () => {
  assert.equal(norm("الأَوّل"), norm("الاول"));
  assert.equal(norm("١"), "1");
});

test("«الأول» و«1» و«Grade 1» ملتبسة بين المراحل: لا تخمين", () => {
  for (const t of ["الأول", "الصف الأول", "1", "١", "Grade 1"]) {
    const m = matchGrade(index, { grade: t });
    assert.equal(m.status, "ambiguous", t);
    assert.deepEqual(m.candidates.map((c) => c.grade_id).sort(), [11, 21]);
  }
});

test("ذكر المرحلة يحسم الالتباس", () => {
  assert.equal(matchGrade(index, { grade: "أول ابتدائي" }).grade.grade_id, 11);
  assert.equal(matchGrade(index, { grade: "اول متوسط" }).grade.grade_id, 21);
  assert.equal(matchGrade(index, { grade: "1", stage: "متوسط" }).grade.grade_id, 21);
});

test("رقم فريد في المدرسة يُطابق مباشرة، وصف غير موجود لا يُخمَّن", () => {
  assert.equal(matchGrade(index, { grade: "Grade 2" }).grade.grade_id, 12);
  assert.equal(matchGrade(index, { grade: "خامس" }).status, "none");
  assert.equal(matchGrade(index, { grade: "1", stage: "ثانوي" }).status, "none");
});

test("الشعبة من نص الصف أو من عمود مستقل", () => {
  const a = matchGrade(index, { grade: "الأول - أ" });
  assert.equal(a.class_id, 111);
  const b = matchGrade(index, { grade: "أول ابتدائي", section: "ب" });
  assert.equal(pickSection(b.grade, b.section_text, true).class_id, 112);
  assert.equal(pickSection(b.grade, "", true).status, "need_section");
});

/* ---------- التحليل بقاعدة مزيّفة ---------- */
const existing = [{ id: 900, student_no: "1001", full_name: "سالم أحمد", class_id: 111, guardian_name: "أحمد", guardian_phone: "0500000001",
  birth_date: null, gender: null, student_phone: null, fees_enabled: false, status: "active", access_key: "ABCD-EFGH" }];
function fakeDb() {
  const writes = [];
  const q = async (sql, p) => {
    if (sql.includes("FROM school_profile")) return [{ sections_enabled: true }];
    if (sql.includes("FROM stages")) return stages;
    if (sql.includes("FROM grades")) return grades;
    if (sql.includes("FROM classes")) return classes;
    if (sql.startsWith("SELECT student_no FROM")) return [];
    if (sql.includes("student_no = ANY")) return existing;
    if (sql.includes("guardian_phone = ANY")) return [{ ...existing[0], id: 901, student_no: null }];
    if (sql.includes("count(*)::int AS n")) return [{ n: 5 }];
    if (sql.startsWith("SELECT now()")) return [{ t: "2026-09-28T10:00:00Z" }];
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push({ sql: sql.replace(/\s+/g, " "), p });
    if (sql.includes("INSERT INTO students")) return [{ id: 1000 + writes.length, name: "x", access_key: "K" }];
    return [];
  };
  return { q, writes };
}
const tenant = { max_students: 100 };
const rows = [
  { "رقم الطالب": "1001", "اسم الطالب": "سالم أحمد", "الصف": "الأول", "المرحلة": "ابتدائي", "الشعبة": "أ", "جوال ولي الأمر": "0500000001", "تاريخ الميلاد": "2015-03-28" },
  { "رقم الطالب": "2002", "اسم الطالب": "ريم", "الصف": "Grade 2", "الجنس": "أنثى" },
  { "اسم الطالب": "خالد", "الصف": "الأول" },
  { "اسم الطالب": "سالم أحمد", "الصف": "الثاني", "جوال ولي الأمر": "0500000001" },
  { "اسم الطالب": "", "الصف": "سابع" },
  { "رقم الطالب": "2002", "اسم الطالب": "مكرر", "الصف": "الثاني" },
  { "اسم الطالب": "عمر", "تاريخ الميلاد": "31/02/2015" },
];

test("analyze: تصنيف الصحيح والمراجعة والخطأ بلا أي كتابة", async () => {
  const { q, writes } = fakeDb();
  const a = await analyze(q, tenant, rows);
  assert.deepEqual([a.summary.total, a.summary.valid, a.summary.review, a.summary.errors], [7, 2, 2, 3]);
  assert.equal(a.rows[0].action, "update");           // رقم الطالب 1001 موجود: تحديث لا تكرار
  assert.equal(a.rows[1].action, "create");
  assert.equal(a.rows[2].review, "grade");            // «الأول» ملتبس
  assert.equal(a.ambiguities.length, 1);
  assert.equal(a.rows[3].review, "duplicate");        // نفس الاسم وجوال ولي الأمر بلا رقم طالب
  assert.match(a.rows[5].errors[0], /مكرر/);          // رقم طالب مكرر داخل الملف
  assert.match(a.rows[6].errors[0], /غير موجود في التقويم/);
  assert.equal(writes.length, 0);
});

test("اختيار المستخدم للصف الملتبس يحوّل السطر إلى صحيح", async () => {
  const { q } = fakeDb();
  const key = "الاول|";
  const a = await analyze(q, tenant, rows, { gradeMap: { [key]: 21 } });
  assert.equal(a.rows[2].status, "ok");
  assert.equal(a.rows[2].grade_label, "الأول المتوسط");
  assert.equal(a.ambiguities.length, 0);
});

test("commit: يكتب الصحيح فقط ويتجاوز الباقي مع تقرير", async () => {
  const { q, writes } = fakeDb();
  const r = await commit(q, tenant, rows, { gradeMap: {} });
  assert.equal(r.created, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.skipped, 5);
  assert.equal(r.problems.length, 5);
  assert.ok(writes.some((w) => w.sql.startsWith("UPDATE students SET") && w.p[0] === 900));
  // لا يمسح ما لم يُرسَل: الاسم والصف غير مغيّرين فلا يظهران في التحديث
  const upd = writes.find((w) => w.sql.startsWith("UPDATE students SET"));
  assert.ok(!upd.sql.includes("full_name"));
});

test("commit: يرفض تجاوز حد الباقة", async () => {
  const { q } = fakeDb();
  await assert.rejects(commit(q, { max_students: 5 }, rows), /حد الباقة/);
});

/* ---------- Excel ---------- */
test("buildXlsx: حزمة ZIP سليمة و CRC صحيح", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const buf = buildXlsx([{ name: "الطلاب", headers: ["اسم"], rows: [["أ"]] }]);
  assert.equal(buf.subarray(0, 2).toString(), "PK");
});

test("buildTemplate: عام أو حسب الصف", async () => {
  const { q } = fakeDb();
  assert.equal((await buildTemplate(q, {})).filename, "قالب-الطلاب.xlsx");
  const t = await buildTemplate(q, { grade_id: 11 });
  assert.match(t.filename, /الأول/);
  await assert.rejects(buildTemplate(q, { grade_id: 999 }), /غير موجود/);
});
