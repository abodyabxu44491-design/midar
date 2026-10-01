// الهيكل الأكاديمي: المراحل ← الصفوف ← الشعب ← المواد، وملف المدرسة ومعالج الإعداد.
// كل ما يولّده القالب قابل للتعديل والحذف والإضافة بعد ذلك.
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";
import { STAGES, TEMPLATES, SUBJECT_LIBRARY, GRADE_SETS, COUNTRIES, sectionName, gradeNames, stageName, countryKey, catalog } from "./academic-catalog.js";

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

export const sectionsModeSchema = z.object({ sections_enabled: z.boolean(), confirm: z.boolean().optional() });

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
  grade_set: z.enum(["arabic_full", "arabic_short", "arabic_basic", "yemen", "international", "international_en"]).default("arabic_full"),
  subjects: z.array(z.string().max(60)).max(120).optional(),    // أسماء المواد المختارة، فارغ = كل المقترح
  stages: z.array(z.string().max(30)).max(10).optional(),       // تخصيص المراحل بدل القالب
  // أسماء صفوف معدَّلة يدويًا في المعاينة: { primary: ["..."], middle: [...] } وتتقدم على النمط
  custom_grades: z.record(z.string().max(30), z.array(z.string().trim().min(1, "اسم الصف فارغ").max(60)).max(20)).optional(),
  // مراحل خاصة بالمدرسة غير الموجودة في الكتالوج (مثل: تحفيظ، تمهيدي خاص، دبلوم)
  custom_stages: z.array(z.object({
    name: t.shortText("اسم المرحلة", 60),
    grades: z.array(z.string().trim().min(1, "اسم الصف فارغ").max(60)).min(1, "أضف صفًا واحدًا على الأقل للمرحلة").max(20),
  })).max(5).optional(),
});

/* ---------- القراءة ---------- */
export async function getProfile(q) {
  const [row] = await q(
    `SELECT t.name, t.currency, p.school_type, p.gender, p.country, p.city, p.address, p.email, p.phone,
            p.template, p.setup_completed_at, COALESCE(p.sections_enabled, true) AS sections_enabled, p.logo_image_id
       FROM tenants t LEFT JOIN school_profile p ON p.tenant_id = t.id
      WHERE t.id = app_tenant()`);
  return row;
}

export async function structure(q) {
  const [profile] = await q("SELECT COALESCE(sections_enabled, true) AS sections_enabled FROM school_profile WHERE tenant_id = app_tenant()");
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
    sections_enabled: profile?.sections_enabled ?? true,
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
  const [before] = await q("SELECT country FROM school_profile WHERE tenant_id = app_tenant()");
  if (b.name) await q("UPDATE tenants SET name = $1 WHERE id = app_tenant()", [b.name]);
  await q(
    `UPDATE school_profile SET
       school_type = COALESCE($1, school_type), gender = COALESCE($2, gender),
       country = COALESCE($3, country), city = COALESCE($4, city), address = COALESCE($5, address),
       email = COALESCE($6, email), phone = COALESCE($7, phone)
     WHERE tenant_id = app_tenant()`,
    [b.school_type ?? null, b.gender ?? null, b.country ?? null, b.city ?? null, b.address ?? null,
     b.email ?? null, b.phone ?? null]);
  // تغيير الدولة يضبط ما يتبعها: رمز الاتصال لرسائل واتساب، والعملة (ما لم تُسجَّل حركات مالية)
  if (b.country && countryKey(b.country) !== countryKey(before?.country)) await applyCountry(q, countryKey(b.country));
  return getProfile(q);
}

export async function applyCountry(q, key) {
  const c = COUNTRIES[key];
  if (!c) return;
  if (c.dial) {
    await q("INSERT INTO school_messages (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
    await q("UPDATE school_messages SET country_code = $1 WHERE tenant_id = app_tenant()", [c.dial]);
  }
  const [used] = c.currency ? await q("SELECT 1 FROM finance_entries LIMIT 1") : [true];
  if (!used) {
    await q("UPDATE tenants SET currency = $1 WHERE id = app_tenant() AND currency <> $1", [c.currency]);
    await q("UPDATE finance_accounts SET currency = $1 WHERE currency <> $1", [c.currency]);
  }
}

/* ---------- شعار المدرسة ---------- */
// صورة واحدة تُحفظ في جدول الصور نفسه (نفس فحص المحتوى والحجم)، ويُشار إليها من ملف المدرسة
export async function setLogo(q, file, actor, saveImage) {
  const img = await saveImage(q, { kind: "school_logo", file, actor });
  await q("INSERT INTO school_profile (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  const [old] = await q("SELECT logo_image_id FROM school_profile WHERE tenant_id = app_tenant()");
  await q("UPDATE school_profile SET logo_image_id = $1 WHERE tenant_id = app_tenant()", [img.id]);
  // الشعار القديم يُحذف إن لم يكن مستخدمًا في مكان آخر (شعار الاختبارات أو صورة سؤال)
  if (old?.logo_image_id) await q(
    `DELETE FROM exam_images WHERE id = $1 AND kind = 'school_logo'
       AND NOT EXISTS (SELECT 1 FROM exam_paper_settings WHERE logo_image_id = $1)`, [old.logo_image_id]);
  return { logo_image_id: img.id };
}
export async function removeLogo(q) {
  const [old] = await q("SELECT logo_image_id FROM school_profile WHERE tenant_id = app_tenant()");
  await q("UPDATE school_profile SET logo_image_id = NULL WHERE tenant_id = app_tenant()");
  if (old?.logo_image_id) await q(
    `DELETE FROM exam_images WHERE id = $1 AND kind = 'school_logo'
       AND NOT EXISTS (SELECT 1 FROM exam_paper_settings WHERE logo_image_id = $1)`, [old.logo_image_id]);
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
  const [old] = await q("SELECT name FROM grades WHERE id = $1", [id]);
  if (!old) throw notFound("الصف غير موجود");
  const rows = await q(
    "UPDATE grades SET name = COALESCE($2, name), sort_order = COALESCE($3, sort_order) WHERE id = $1 RETURNING id, name",
    [id, b.name ?? null, b.sort_order ?? null]);
  if (!rows.length) throw notFound("الصف غير موجود");
  const next = rows[0].name;
  if (next !== old.name) await cascadeGradeRename(q, id, old.name, next);
}

/**
 * اسم الشعبة مخزّن كنص مركّب («أول ابتدائي - أ») ويُقرأ في كل الأقسام (الطلاب، الحضور، الدرجات،
 * التقارير...). عند تغيير اسم الصف نعيد تركيب أسماء شعبه بحيث يتغيّر الاسم في النظام كله دفعة واحدة.
 * الربط يبقى بالمعرّف (class_id/grade_id) فلا تتأثر أي بيانات مرتبطة.
 */
async function cascadeGradeRename(q, gradeId, oldName, newName) {
  const sections = await q("SELECT id, name FROM classes WHERE grade_id = $1 ORDER BY sort_order, id", [gradeId]);
  for (const c of sections) {
    let renamed = null;
    if (c.name === oldName) renamed = newName;                              // شعبة افتراضية (وضع بدون شعب)
    else if (c.name.startsWith(`${oldName} - `)) renamed = `${newName}${c.name.slice(oldName.length)}`;
    if (!renamed) continue;                                                  // اسم مخصص يدويًا: نتركه كما وضعه المدير
    const [clash] = await q("SELECT 1 FROM classes WHERE name = $1 AND id <> $2", [renamed, c.id]);
    if (clash) throw conflict(`لا يمكن إعادة التسمية: يوجد فصل باسم «${renamed}» مسبقًا`);
    await q("UPDATE classes SET name = $2 WHERE id = $1", [c.id, renamed]);
  }
}

/**
 * تغيير نمط تسمية الصفوف دفعة واحدة (سعودي/خليجي، رقمي، دولي…) للمراحل المبنية من الكتالوج.
 * الصف يبقى نفسه (نفس المعرّف): يتغير اسم العرض فقط، وتتبعه أسماء شعبه، ولا يتأثر أي طالب أو درجة.
 * المراحل المخصصة والصفوف الزائدة عن النمط تبقى بأسمائها.
 */
export const renamePatternSchema = z.object({ grade_set: z.enum(Object.keys(GRADE_SETS)) });
export async function renameGradesByPattern(q, gradeSet) {
  const stages = (await q("SELECT id, code FROM stages WHERE code IS NOT NULL ORDER BY sort_order, id")).filter((st) => STAGES[st.code]);
  const changes = [];
  for (const st of stages) {
    const names = GRADE_SETS[gradeSet][st.code];
    if (!names) continue;
    const grades = await q("SELECT id, name FROM grades WHERE stage_id = $1 ORDER BY sort_order, id", [st.id]);
    grades.forEach((g, i) => { if (names[i] && names[i] !== g.name) changes.push({ id: g.id, stage: st.id, old: g.name, next: names[i] }); });
  }
  // أسماء متبادلة داخل المرحلة (أ ← ب و ب ← أ): اسم مؤقت أولًا حتى لا يصطدم القيد الفريد
  for (const c of changes) {
    const [clash] = await q("SELECT id FROM grades WHERE stage_id = $1 AND name = $2 AND id <> $3", [c.stage, c.next, c.id]);
    if (clash && !changes.some((x) => Number(x.id) === Number(clash.id))) throw conflict(`يوجد صف باسم «${c.next}» في المرحلة نفسها`);
  }
  // الاسم المؤقت فقط للصف الذي يأخذ اسمًا يحمله صف آخر قبل تغييره، حتى يبقى سجل التدقيق نظيفًا
  const taken = new Set(changes.map((c) => `${c.stage}:${c.old}`));
  for (const c of changes) if (taken.has(`${c.stage}:${c.next}`)) {
    const holder = changes.find((x) => x.stage === c.stage && x.old === c.next);
    await q("UPDATE grades SET name = $2 WHERE id = $1", [holder.id, `~${holder.id}`]);
  }
  for (const c of changes) {
    await q("UPDATE grades SET name = $2 WHERE id = $1", [c.id, c.next]);
    await cascadeGradeRename(q, c.id, c.old, c.next);
  }
  // اسم المرحلة يتبع النمط (اليمن: الأساسي والثانوي) فقط إن كان ما يزال اسمًا افتراضيًا لم يغيّره المدير
  let stagesRenamed = 0;
  for (const st of stages) {
    const [cur] = await q("SELECT name FROM stages WHERE id = $1", [st.id]);
    const defaults = new Set([STAGES[st.code]?.name, ...Object.keys(GRADE_SETS).map((k) => stageName(st.code, k))].filter(Boolean));
    const next = stageName(st.code, gradeSet);
    if (cur && defaults.has(cur.name) && cur.name !== next) {
      const [clash] = await q("SELECT 1 FROM stages WHERE name = $1 AND id <> $2", [next, st.id]);
      if (!clash) { await q("UPDATE stages SET name = $2 WHERE id = $1", [st.id, next]); stagesRenamed++; }
    }
  }
  return { renamed: changes.length, stages: stagesRenamed };
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

/* ---------- تفعيل/تعطيل نظام الشعب ---------- */
/**
 * تبديل وضع الشعب لهذي المدرسة. لا يحذف أي بيانات مطلقًا:
 *  - عند التفعيل (enabled=true): لا شيء إضافي، الشعب الموجودة تظهر كما هي.
 *  - عند التعطيل (enabled=false): لا حذف، فقط الواجهة تتوقف عن عرض/طلب الشعبة،
 *    وأي صف بدون شعبة إطلاقًا يُنشأ له تلقائيًا "شعبة افتراضية" بنفس اسم الصف
 *    ليبقى لكل طالب class_id صالح (البنية التحتية لا تتغيّر).
 */
export async function setSectionsMode(q, enabled, { confirm = false } = {}) {
  if (!enabled && !confirm) {
    // تحذير قبل الإيقاف: صفوف فيها أكثر من شعبة بها طلاب (تبقى البيانات، لكن تُخفى الشعب من الواجهة)
    const [risk] = await q(
      `SELECT count(*)::int AS grades, COALESCE(sum(students), 0)::int AS students FROM (
         SELECT c.grade_id, count(DISTINCT c.id) AS sections, count(s.id) AS students
           FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.archived_at IS NULL
          WHERE c.grade_id IS NOT NULL GROUP BY c.grade_id HAVING count(DISTINCT c.id) > 1 AND count(s.id) > 0) x`);
    if (risk.grades) throw conflict(
      `يوجد ${risk.grades} صفًا فيه أكثر من شعبة، و${risk.students} طالبًا موزعين عليها. عند إيقاف الشعب ستُخفى من الواجهة وتبقى بياناتها محفوظة، ويمكن إعادة تفعيلها في أي وقت.`);
  }
  await q("INSERT INTO school_profile (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  await q("UPDATE school_profile SET sections_enabled = $1 WHERE tenant_id = app_tenant()", [enabled]);
  if (!enabled) {
    const grades = await q(
      `SELECT g.id, g.name FROM grades g
        WHERE NOT EXISTS (SELECT 1 FROM classes c WHERE c.grade_id = g.id)`);
    for (const g of grades) await ensureDefaultSection(q, g.id, g.name);
  }
  return { sections_enabled: enabled };
}

/** ينشئ شعبة افتراضية لصف لا شعب له إطلاقًا (تُستخدم في وضع "بدون شعب") */
async function ensureDefaultSection(q, gradeId, gradeName) {
  const [row] = await q(
    `INSERT INTO classes (tenant_id, name, grade_id, sort_order) VALUES (app_tenant(), $1, $2, 1)
     ON CONFLICT (tenant_id, name) DO UPDATE SET grade_id = EXCLUDED.grade_id
     RETURNING id`, [gradeName, gradeId]);
  return row.id;
}

/**
 * يحلّ grade_id إلى class_id صالح للاستخدام (الطلاب، الاستيراد...) في وضع "بدون شعب":
 * يرجّع الشعبة الوحيدة للصف إن وُجدت، وإلا ينشئها تلقائيًا بنفس اسم الصف.
 * يُستخدم فقط لما sections_enabled = false؛ في وضع "بشعب" يُطلب class_id مباشرة من الواجهة.
 */
export async function resolveClassForGrade(q, gradeId) {
  const [existing] = await q("SELECT id FROM classes WHERE grade_id = $1 ORDER BY id LIMIT 1", [gradeId]);
  if (existing) return existing.id;
  const [grade] = await q("SELECT name FROM grades WHERE id = $1", [gradeId]);
  if (!grade) throw notFound("الصف غير موجود");
  return ensureDefaultSection(q, gradeId, grade.name);
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

// الفرق فقط: يُحذف ما أُزيل ويُضاف الجديد (سجل التدقيق يعكس التغيير الحقيقي لا حذفًا وإعادة إضافة)
async function setSubjectGrades(q, subjectId, gradeIds) {
  if (!gradeIds) return;
  const want = [...new Set(gradeIds.map(Number))];
  await q("DELETE FROM subject_grades WHERE subject_id = $1 AND NOT (grade_id = ANY($2::bigint[]))", [subjectId, want]);
  for (const gradeId of want) {
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
  const [profile] = await q("SELECT COALESCE(sections_enabled, true) AS sections_enabled FROM school_profile WHERE tenant_id = app_tenant()");
  const sectionsEnabled = profile?.sections_enabled ?? true;
  const keys = b.stages?.length ? b.stages : TEMPLATES[b.template].stages;
  const custom = b.custom_stages || [];
  if (!keys.length && !custom.length) {
    await completeSetup(q);
    return { stages: 0, grades: 0, sections: 0, subjects: 0 };
  }
  for (const key of keys) if (!STAGES[key]) throw badRequest("مرحلة غير معروفة");
  const summary = { stages: 0, grades: 0, sections: 0, subjects: 0 };
  const seenNames = new Set();

  // مراحل الكتالوج (بالمفتاح) ثم المراحل المخصصة (بالاسم)، كلها بنفس المسار
  const defs = [
    ...keys.map((key) => ({ key, name: stageName(key, b.grade_set), code: key,
      grades: b.custom_grades?.[key]?.length ? b.custom_grades[key] : gradeNames(key, b.grade_set) })),
    ...custom.map((c, i) => ({ key: `custom_${i}`, name: c.name.trim(), code: null, grades: c.grades })),
  ];
  const [base] = await q("SELECT COALESCE(MAX(sort_order), 0) AS n FROM stages");
  const gradeIdsByStage = {};

  for (const [i, def] of defs.entries()) {
    let [stage] = await q("SELECT id FROM stages WHERE name = $1", [def.name]);
    if (!stage) {
      [stage] = await q(
        "INSERT INTO stages (tenant_id, name, code, sort_order) VALUES (app_tenant(), $1, $2, $3) RETURNING id",
        [def.name, def.code, Number(base.n) + i + 1]);
      summary.stages++;
    }
    gradeIdsByStage[def.key] = [];

    for (const [gi, raw] of def.grades.entries()) {
      const gradeName = raw.trim();
      if (seenNames.has(gradeName)) throw badRequest(`اسم الصف «${gradeName}» مكرر. لكل صف اسم مختلف.`);
      seenNames.add(gradeName);
      let [grade] = await q("SELECT id FROM grades WHERE stage_id = $1 AND name = $2", [stage.id, gradeName]);
      if (!grade) {
        [grade] = await q(
          "INSERT INTO grades (tenant_id, stage_id, name, sort_order) VALUES (app_tenant(), $1, $2, $3) RETURNING id",
          [stage.id, gradeName, gi + 1]);
        summary.grades++;
      }
      gradeIdsByStage[def.key].push(grade.id);
      if (!sectionsEnabled) {
        const [hasSection] = await q("SELECT 1 FROM classes WHERE grade_id = $1", [grade.id]);
        if (!hasSection) { await ensureDefaultSection(q, grade.id, gradeName); summary.sections++; }
      } else if (b.sections_per_grade > 0) {
        const made = await createSections(q, grade.id, { count: b.sections_per_grade, naming: b.naming, mode: "ensure" });
        summary.sections += made.length;
      }
    }
  }

  // المواد: المختارة من المكتبة الكاملة، أو المقترح الافتراضي للمراحل.
  // المادة المختارة تُربط بصفوف المراحل التي تقترحها فقط (الفيزياء للثانوي لا للابتدائي)؛
  // المادة التي لا تقترحها أي مرحلة مختارة (أو المراحل المخصصة) تُربط بكل الصفوف، ويعدّلها المدير لاحقًا.
  const library = new Map(SUBJECT_LIBRARY.flatMap((g) => g.items.map((x) => [x.name, x])));
  const suggestedIn = (name) => keys.filter((key) => STAGES[key].subjects.some((x) => x.name === name));
  const plan = b.subjects?.length
    ? b.subjects.map((name) => {
        const where = suggestedIn(name);
        return { s: library.get(name) || { name, code: null, weekly: null },
          stages: [...(where.length ? where : keys), ...custom.map((_, i) => `custom_${i}`)] };
      })
    : [...new Map(keys.flatMap((key) => STAGES[key].subjects.map((x) => [x.name, x]))).values()]
        .map((x) => ({ s: x, stages: suggestedIn(x.name) }));

  for (const { s, stages } of plan) {
    let [subject] = await q("SELECT id FROM subjects WHERE name = $1", [s.name]);
    if (!subject) {
      const [order] = await q("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM subjects");
      [subject] = await q(
        `INSERT INTO subjects (tenant_id, name, code, weekly_periods, sort_order)
         VALUES (app_tenant(), $1, $2, $3, $4) RETURNING id`, [s.name, s.code, s.weekly, order.next]);
      summary.subjects++;
    }
    for (const key of stages) for (const gradeId of gradeIdsByStage[key] || []) {
      await q(
        `INSERT INTO subject_grades (tenant_id, subject_id, grade_id) VALUES (app_tenant(), $1, $2)
         ON CONFLICT DO NOTHING`, [subject.id, gradeId]);
    }
  }

  await q("INSERT INTO school_profile (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  await q("UPDATE school_profile SET template = $1 WHERE tenant_id = app_tenant()", [b.template]);
  return summary;
}
