// الهيكل الأكاديمي: المراحل ← الصفوف ← الشعب ← المواد، وملف المدرسة ومعالج الإعداد.
// كل ما يولّده القالب قابل للتعديل والحذف والإضافة بعد ذلك.
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";
import { STAGES, TEMPLATES, SUBJECT_LIBRARY, sectionName, gradeNames, catalog } from "./academic-catalog.js";

export { catalog };

/* ---------- المخططات ---------- */
export const profileSchema = z.object({
  name: t.shortText("اسم المدرسة", 150).optional(),
  school_type: z.enum(["private", "public", "international", "quran", "other"]).optional(),
  gender: z.enum(["boys", "girls", "mixed"]).optional(),
  country: t.optText(60),
  city: t.optText(60),
  address: t.optText(200),
  email: z.string().trim().email("البريد غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
  phone: z.string().trim().regex(/^[0-9+ ]{0,20}$/, "رقم غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
});

export const stageSchema = z.object({ name: t.shortText("اسم المرحلة", 60), sort_order: z.coerce.number().int().min(0).max(99).optional() });
export const gradeSchema = z.object({
  stage_id: t.id,
  name: t.shortText("اسم الصف", 60),
  sort_order: z.coerce.number().int().min(0).max(99).optional(),
});
export const sectionsSchema = z.object({
  count: z.coerce.number().int().min(1).max(20),
  naming: z.enum(["arabic", "english", "numeric"]).default("arabic"),
});
export const subjectSchema = z.object({
  name: t.shortText("اسم المادة", 60),
  code: t.optText(20),
  weekly_periods: z.coerce.number().int().min(0).max(40).optional().nullable(),
  grade_ids: z.array(t.id).max(200).optional(),
  is_active: z.boolean().optional(),
});
export const templateSchema = z.object({
  template: z.enum(Object.keys(TEMPLATES)),
  sections_per_grade: z.coerce.number().int().min(0).max(20).default(1),
  naming: z.enum(["arabic", "english", "numeric"]).default("arabic"),
  grade_set: z.enum(["arabic_full", "arabic_short", "yemen", "international"]).default("arabic_full"),
  subjects: z.array(z.string().max(60)).max(120).optional(),    // أسماء المواد المختارة، فارغ = كل المقترح
  stages: z.array(z.string().max(30)).max(10).optional(),       // تخصيص المراحل بدل القالب
});

/* ---------- القراءة ---------- */
export async function getProfile(q) {
  const [row] = await q(
    `SELECT t.name, t.currency, p.school_type, p.gender, p.country, p.city, p.address, p.email, p.phone,
            p.template, p.setup_completed_at
       FROM tenants t LEFT JOIN school_profile p ON p.tenant_id = t.id
      WHERE t.id = app_tenant()`);
  return row;
}

export async function structure(q) {
  const stages = await q("SELECT id, name, code, sort_order FROM stages ORDER BY sort_order, id");
  const grades = await q("SELECT id, stage_id, name, sort_order FROM grades ORDER BY sort_order, id");
  const classes = await q(
    `SELECT c.id, c.name, c.grade_id, c.sort_order,
            (SELECT count(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active')::int AS students
       FROM classes c ORDER BY c.sort_order, c.id`);
  const subjects = await q(
    `SELECT s.id, s.name, s.code, s.weekly_periods, s.is_active, s.sort_order,
            COALESCE(array_agg(sg.grade_id) FILTER (WHERE sg.grade_id IS NOT NULL), '{}') AS grade_ids
       FROM subjects s LEFT JOIN subject_grades sg ON sg.subject_id = s.id
      GROUP BY s.id ORDER BY s.sort_order, s.id`);
  return {
    stages: stages.map((st) => ({
      ...st,
      grades: grades.filter((g) => Number(g.stage_id) === Number(st.id)).map((g) => ({
        ...g,
        sections: classes.filter((c) => Number(c.grade_id) === Number(g.id)),
      })),
    })),
    unassigned: classes.filter((c) => !c.grade_id),
    subjects: subjects.map((s) => ({ ...s, grade_ids: s.grade_ids.map(Number) })),
  };
}

/* ---------- ملف المدرسة ---------- */
export async function updateProfile(q, b) {
  await q("INSERT INTO school_profile (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  if (b.name) await q("UPDATE tenants SET name = $1 WHERE id = app_tenant()", [b.name]);
  await q(
    `UPDATE school_profile SET
       school_type = COALESCE($1, school_type), gender = COALESCE($2, gender),
       country = COALESCE($3, country), city = COALESCE($4, city), address = COALESCE($5, address),
       email = COALESCE($6, email), phone = COALESCE($7, phone)
     WHERE tenant_id = app_tenant()`,
    [b.school_type ?? null, b.gender ?? null, b.country ?? null, b.city ?? null, b.address ?? null,
     b.email ?? null, b.phone ?? null]);
  return getProfile(q);
}

export async function completeSetup(q) {
  await q("INSERT INTO school_profile (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  await q("UPDATE school_profile SET setup_completed_at = COALESCE(setup_completed_at, now()) WHERE tenant_id = app_tenant()");
}

/* ---------- المراحل ---------- */
export async function addStage(q, b) {
  const [dup] = await q("SELECT 1 FROM stages WHERE name = $1", [b.name]);
  if (dup) throw conflict("المرحلة موجودة مسبقًا");
  const [order] = await q("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM stages");
  const [row] = await q(
    "INSERT INTO stages (tenant_id, name, sort_order) VALUES (app_tenant(), $1, $2) RETURNING id, name, sort_order",
    [b.name, b.sort_order ?? order.next]);
  return row;
}

export async function updateStage(q, id, b) {
  const rows = await q(
    "UPDATE stages SET name = $2, sort_order = COALESCE($3, sort_order) WHERE id = $1 RETURNING id",
    [id, b.name, b.sort_order ?? null]);
  if (!rows.length) throw notFound("المرحلة غير موجودة");
}

export async function deleteStage(q, id) {
  const [used] = await q(
    `SELECT 1 FROM classes c JOIN grades g ON g.id = c.grade_id
      WHERE g.stage_id = $1 AND EXISTS (SELECT 1 FROM students s WHERE s.class_id = c.id)`, [id]);
  if (used) throw badRequest("لا يمكن حذف مرحلة فيها طلاب. انقلهم أولًا.");
  const rows = await q("DELETE FROM stages WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("المرحلة غير موجودة");
}

/* ---------- الصفوف ---------- */
export async function addGrade(q, b) {
  const [stage] = await q("SELECT id FROM stages WHERE id = $1", [b.stage_id]);
  if (!stage) throw notFound("المرحلة غير موجودة");
  const [dup] = await q("SELECT 1 FROM grades WHERE stage_id = $1 AND name = $2", [b.stage_id, b.name]);
  if (dup) throw conflict("الصف موجود في هذه المرحلة");
  const [order] = await q("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM grades WHERE stage_id = $1", [b.stage_id]);
  const [row] = await q(
    `INSERT INTO grades (tenant_id, stage_id, name, sort_order) VALUES (app_tenant(), $1, $2, $3)
     RETURNING id, stage_id, name, sort_order`, [b.stage_id, b.name, b.sort_order ?? order.next]);
  return row;
}

export async function updateGrade(q, id, b) {
  const rows = await q(
    "UPDATE grades SET name = COALESCE($2, name), sort_order = COALESCE($3, sort_order) WHERE id = $1 RETURNING id",
    [id, b.name ?? null, b.sort_order ?? null]);
  if (!rows.length) throw notFound("الصف غير موجود");
}

export async function deleteGrade(q, id) {
  const [used] = await q(
    `SELECT 1 FROM classes c WHERE c.grade_id = $1
       AND EXISTS (SELECT 1 FROM students s WHERE s.class_id = c.id)`, [id]);
  if (used) throw badRequest("لا يمكن حذف صف فيه طلاب. انقلهم أولًا.");
  const rows = await q("DELETE FROM grades WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("الصف غير موجود");
}

// ترتيب الصفوف داخل مرحلة
export async function reorderGrades(q, stageId, ids) {
  for (const [i, id] of ids.entries()) {
    await q("UPDATE grades SET sort_order = $2 WHERE id = $1 AND stage_id = $3", [id, i + 1, stageId]);
  }
}

/* ---------- الشعب ---------- */
/**
 * إنشاء شعب لصف.
 *   mode = "add"    : أضف هذا العدد من الشعب الجديدة (الزر اليدوي)
 *   mode = "ensure" : اجعل عدد شعب الصف هذا العدد (القالب، فلا يتكرر عند إعادة تطبيقه)
 */
export async function createSections(q, gradeId, { count, naming, mode = "add" }) {
  const [grade] = await q("SELECT id, name FROM grades WHERE id = $1", [gradeId]);
  if (!grade) throw notFound("الصف غير موجود");
  const existing = await q("SELECT name FROM classes WHERE grade_id = $1", [gradeId]);
  const taken = new Set(existing.map((c) => c.name));
  const target = mode === "ensure" ? Math.max(0, count - existing.length) : count;
  const created = [];
  let index = 0;
  while (created.length < target && index < 40) {
    const name = sectionName(grade.name, index, naming);
    index++;
    if (taken.has(name)) continue;
    const [row] = await q(
      `INSERT INTO classes (tenant_id, name, grade_id, sort_order) VALUES (app_tenant(), $1, $2, $3)
       ON CONFLICT (tenant_id, name) DO NOTHING RETURNING id, name`,
      [name, gradeId, created.length + existing.length + 1]);
    if (row) created.push(row);
  }
  return created;
}

export async function updateSection(q, id, { name, grade_id, sort_order }) {
  const rows = await q(
    `UPDATE classes SET name = COALESCE($2, name), grade_id = COALESCE($3, grade_id),
        sort_order = COALESCE($4, sort_order) WHERE id = $1 RETURNING id`,
    [id, name ?? null, grade_id ?? null, sort_order ?? null]);
  if (!rows.length) throw notFound("الشعبة غير موجودة");
}

/* ---------- المواد ---------- */
export async function addSubject(q, b) {
  const [dup] = await q("SELECT 1 FROM subjects WHERE name = $1", [b.name]);
  if (dup) throw conflict("المادة موجودة مسبقًا");
  const [order] = await q("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM subjects");
  const [row] = await q(
    `INSERT INTO subjects (tenant_id, name, code, weekly_periods, sort_order)
     VALUES (app_tenant(), $1, $2, $3, $4) RETURNING id, name`,
    [b.name, b.code ?? null, b.weekly_periods ?? null, order.next]);
  await setSubjectGrades(q, row.id, b.grade_ids);
  return row;
}

export async function updateSubject(q, id, b) {
  const rows = await q(
    `UPDATE subjects SET name = COALESCE($2, name), code = $3, weekly_periods = $4,
        is_active = COALESCE($5, is_active) WHERE id = $1 RETURNING id`,
    [id, b.name ?? null, b.code ?? null, b.weekly_periods ?? null, b.is_active ?? null]);
  if (!rows.length) throw notFound("المادة غير موجودة");
  await setSubjectGrades(q, id, b.grade_ids);
}

async function setSubjectGrades(q, subjectId, gradeIds) {
  if (!gradeIds) return;
  await q("DELETE FROM subject_grades WHERE subject_id = $1", [subjectId]);
  for (const gradeId of gradeIds) {
    await q(
      `INSERT INTO subject_grades (tenant_id, subject_id, grade_id) VALUES (app_tenant(), $1, $2)
       ON CONFLICT DO NOTHING`, [subjectId, gradeId]);
  }
}

/**
 * تطبيق قالب مدرسة: ينشئ المراحل وصفوفها وشعبها وموادها دفعة واحدة.
 * لا يحذف شيئًا قائمًا، ويتخطى المكرر، وكل ما يُنشأ قابل للتعديل بعدها.
 */
export async function applyTemplate(q, b) {
  const keys = b.stages?.length ? b.stages : TEMPLATES[b.template].stages;
  if (!keys.length) {
    await completeSetup(q);
    return { stages: 0, grades: 0, sections: 0, subjects: 0 };
  }
  const summary = { stages: 0, grades: 0, sections: 0, subjects: 0 };
  const gradeIdsByStage = {};

  for (const [i, key] of keys.entries()) {
    const def = STAGES[key];
    if (!def) throw badRequest("مرحلة غير معروفة");
    let [stage] = await q("SELECT id FROM stages WHERE name = $1", [def.name]);
    if (!stage) {
      [stage] = await q(
        "INSERT INTO stages (tenant_id, name, code, sort_order) VALUES (app_tenant(), $1, $2, $3) RETURNING id",
        [def.name, key, i + 1]);
      summary.stages++;
    }
    gradeIdsByStage[key] = [];

    const names = gradeNames(key, b.grade_set);
    for (const [gi, gradeName] of names.entries()) {
      let [grade] = await q("SELECT id FROM grades WHERE stage_id = $1 AND name = $2", [stage.id, gradeName]);
      if (!grade) {
        [grade] = await q(
          "INSERT INTO grades (tenant_id, stage_id, name, sort_order) VALUES (app_tenant(), $1, $2, $3) RETURNING id",
          [stage.id, gradeName, gi + 1]);
        summary.grades++;
      }
      gradeIdsByStage[key].push(grade.id);
      if (b.sections_per_grade > 0) {
        const made = await createSections(q, grade.id, { count: b.sections_per_grade, naming: b.naming, mode: "ensure" });
        summary.sections += made.length;
      }
    }
  }

  // المواد: المختارة من المكتبة الكاملة، أو المقترح الافتراضي للمراحل
  const library = new Map(SUBJECT_LIBRARY.flatMap((g) => g.items.map((x) => [x.name, x])));
  const chosen = b.subjects?.length
    ? b.subjects.map((name) => library.get(name) || { name, code: null, weekly: null })
    : null;

  for (const key of keys) {
    for (const s of chosen ?? STAGES[key].subjects) {
      let [subject] = await q("SELECT id FROM subjects WHERE name = $1", [s.name]);
      if (!subject) {
        const [order] = await q("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM subjects");
        [subject] = await q(
          `INSERT INTO subjects (tenant_id, name, code, weekly_periods, sort_order)
           VALUES (app_tenant(), $1, $2, $3, $4) RETURNING id`, [s.name, s.code, s.weekly, order.next]);
        summary.subjects++;
      }
      for (const gradeId of gradeIdsByStage[key]) {
        await q(
          `INSERT INTO subject_grades (tenant_id, subject_id, grade_id) VALUES (app_tenant(), $1, $2)
           ON CONFLICT DO NOTHING`, [subject.id, gradeId]);
      }
    }
  }

  await q("INSERT INTO school_profile (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  await q("UPDATE school_profile SET template = $1 WHERE tenant_id = app_tenant()", [b.template]);
  return summary;
}
