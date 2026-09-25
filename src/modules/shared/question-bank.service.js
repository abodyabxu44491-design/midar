// بنك الأسئلة: حفظ الأسئلة وإعادة استخدامها، والسحب التلقائي حسب النوع والصعوبة
// ومخطط التحقق من السؤال (مشترك مع ورقة الاختبار)
import crypto from "node:crypto";
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, forbidden } from "../../core/http/errors.js";
import { QTYPE_KEYS, QTYPES } from "../../../public/shared/js/exam/engine.js";

/* ---------- مخطط السؤال ---------- */
const itemId = z.string().regex(/^[a-z]_[a-z0-9]{3,20}$/, "معرّف عنصر غير صالح");
const txt = (max) => z.string().max(max, "النص طويل جدًا").default("");
const marks = z.coerce.number().positive("درجة السؤال يجب أن تكون أكبر من صفر").max(1000)
  .transform((v) => Math.round(v * 100) / 100);

export const imageRef = z.object({
  id: t.id,
  width: z.coerce.number().int().min(10).max(100).default(60),      // نسبة من عرض الورقة
  align: z.enum(["start", "center", "end"]).default("center"),
  position: z.enum(["before", "after"]).default("after"),          // قبل نص السؤال أو بعده
});
const cell = z.object({
  t: txt(500),
  cs: z.coerce.number().int().min(1).max(10).optional(),          // دمج أعمدة
  rs: z.coerce.number().int().min(1).max(30).optional(),          // دمج صفوف
  hide: z.boolean().optional(),                                   // خلية مغطاة بدمج
});
export const tableSchema = z.object({
  header: z.boolean().default(true),
  rows: z.array(z.array(cell).min(1).max(10)).min(1).max(30),
});

export const questionFields = {
  type: z.enum(QTYPE_KEYS, { errorMap: () => ({ message: "نوع السؤال غير معروف" }) }),
  marks,
  text: txt(4000),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  options: z.array(z.object({ id: itemId, text: txt(1000) })).max(8).optional(),
  correct: z.union([z.array(itemId).max(8), z.boolean(), z.null()]).optional(),
  answers: z.array(z.string().max(300)).max(20).optional(),
  answer: txt(4000).optional(),
  pairs: z.array(z.object({ id: itemId, left: txt(500), right: txt(500) })).max(12).optional(),
  items: z.array(z.object({ id: itemId, text: txt(500) })).max(12).optional(),
  table: tableSchema.nullable().optional(),
  image: imageRef.nullable().optional(),
  space: z.enum(["none", "small", "medium", "large", "page", "auto"]).optional(),
  lined: z.boolean().optional(),
  cols: z.coerce.number().int().refine((v) => [1, 2, 4].includes(v)).optional(),   // أعمدة الخيارات
  solution: txt(6000).optional(),
  notes: txt(2000).optional(),
  bank_id: z.coerce.number().int().positive().nullable().optional(),
  unit: txt(120).optional(),
  lesson: txt(120).optional(),
};

// سؤال داخل ورقة: له معرّف ثابت (للسحب والإفلات والنماذج)
export const paperQuestion = z.object({ id: itemId, ...questionFields });

// قواعد منطقية لكل نوع (بعد التحقق من الشكل)
export function normalizeQuestion(q) {
  const out = { ...q };
  const def = QTYPES[q.type];
  if (def.options) {
    out.options = (q.options || []).slice(0, 8);
    const ids = new Set(out.options.map((o) => o.id));
    out.correct = (Array.isArray(q.correct) ? q.correct : []).filter((id) => ids.has(id));
    if (q.type === "mcq") out.correct = out.correct.slice(0, 1);
  } else if (q.type === "truefalse") {
    out.correct = typeof q.correct === "boolean" ? q.correct : null;
    delete out.options;
  } else {
    delete out.options; delete out.correct;
  }
  if (q.type !== "match") delete out.pairs;
  if (q.type !== "order") delete out.items;
  if (q.type !== "fill") delete out.answers;
  return out;
}

/* ---------- البنك ---------- */
const bankBody = z.object({
  subject_id: t.id,
  grade_id: t.optId,
  term_id: t.optId,
  is_shared: z.boolean().default(false),
  ...questionFields,
});
export const bankCreateSchema = bankBody;
export const bankUpdateSchema = bankBody.partial({ subject_id: true }).extend({ type: questionFields.type.optional(), marks: marks.optional() });

// الحقول التي تُخزن في body (والباقي أعمدة للبحث والتصفية)
const BODY_KEYS = ["text", "options", "correct", "answers", "answer", "pairs", "items", "table", "image", "space", "lined", "cols", "solution", "notes"];
const toBody = (q) => Object.fromEntries(BODY_KEYS.filter((k) => q[k] !== undefined).map((k) => [k, q[k]]));

const COLS = `b.id, b.teacher_id, b.subject_id, b.grade_id, b.term_id, b.unit, b.lesson, b.qtype AS type, b.difficulty, b.marks,
  b.body, b.is_shared, b.used_count, b.created_at, b.updated_at, s.name AS subject_name, g.name AS grade_name, te.full_name AS teacher_name`;
const FROM = `FROM question_bank b JOIN subjects s ON s.id = b.subject_id LEFT JOIN grades g ON g.id = b.grade_id
  LEFT JOIN teachers te ON te.id = b.teacher_id`;

// ما يراه المعلم: أسئلته، والأسئلة المشتركة في المواد التي يدرّسها
// المعامل $p يُمرَّر دائمًا (NULL للإدارة = كل أسئلة المدرسة)
const visibleTo = (teacherId, p) => `($${p}::bigint IS NULL OR b.teacher_id = $${p}
  OR (b.is_shared AND b.subject_id IN (SELECT subject_id FROM teacher_assignments WHERE teacher_id = $${p})))`;

export const listSchema = z.object({
  subject_id: t.optId, grade_id: t.optId, type: z.enum(QTYPE_KEYS).optional().or(z.literal("")),
  difficulty: z.enum(["easy", "medium", "hard"]).optional().or(z.literal("")),
  unit: z.string().trim().max(120).optional(), lesson: z.string().trim().max(120).optional(),
  q: z.string().trim().max(100).optional(), mine: z.enum(["1", "0"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const flat = (r) => ({ ...r.body, ...r, body: undefined });

export async function list(q, teacherId, f) {
  const params = [];
  const where = ["NOT b.is_archived"];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll("?", `$${params.length}`)); };
  params.push(teacherId || null); where.push(visibleTo(teacherId, params.length));
  if (f.mine === "1" && teacherId) add("b.teacher_id = ?", teacherId);
  if (f.subject_id) add("b.subject_id = ?", f.subject_id);
  if (f.grade_id) add("(b.grade_id = ? OR b.grade_id IS NULL)", f.grade_id);
  if (f.type) add("b.qtype = ?", f.type);
  if (f.difficulty) add("b.difficulty = ?", f.difficulty);
  if (f.unit) add("b.unit = ?", f.unit);
  if (f.lesson) add("b.lesson = ?", f.lesson);
  if (f.q) add("(b.body->>'text' ILIKE '%' || ? || '%' OR b.unit ILIKE '%' || ? || '%' OR b.lesson ILIKE '%' || ? || '%')", f.q);
  params.push(f.limit || 200);
  const rows = await q(`SELECT ${COLS} ${FROM} WHERE ${where.join(" AND ")} ORDER BY b.id DESC LIMIT $${params.length}`, params);
  return rows.map(flat);
}

// الوحدات والدروس الموجودة (لقوائم التصفية)
export const units = (q, teacherId, subjectId) => q(
  `SELECT b.unit, b.lesson, count(*)::int AS n FROM question_bank b
    WHERE NOT b.is_archived AND ${visibleTo(teacherId, 1)} AND ($2::bigint IS NULL OR b.subject_id = $2)
      AND (b.unit IS NOT NULL OR b.lesson IS NOT NULL)
    GROUP BY b.unit, b.lesson ORDER BY b.unit NULLS LAST, b.lesson NULLS LAST`, [teacherId || null, subjectId || null]);

export async function getOne(q, id, teacherId) {
  const [row] = await q(`SELECT ${COLS} ${FROM} WHERE b.id = $1 AND ${visibleTo(teacherId, 2)}`, [id, teacherId || null]);
  if (!row) throw notFound("السؤال غير موجود");
  return flat(row);
}

export async function create(q, teacherId, b) {
  const n = normalizeQuestion(b);
  const [row] = await q(
    `INSERT INTO question_bank (tenant_id, teacher_id, subject_id, grade_id, term_id, unit, lesson, qtype, difficulty, marks, body, is_shared)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [teacherId, b.subject_id, b.grade_id ?? null, b.term_id ?? null, b.unit || null, b.lesson || null,
     b.type, b.difficulty, b.marks, toBody(n), b.is_shared]);
  return row;
}

export async function update(q, id, teacherId, patch) {
  const [cur] = await q("SELECT * FROM question_bank WHERE id = $1 AND NOT is_archived", [id]);
  if (!cur) throw notFound("السؤال غير موجود");
  if (teacherId && Number(cur.teacher_id) !== Number(teacherId)) throw forbidden("لا تعدّل إلا أسئلتك. انسخ السؤال لبنكك ثم عدّله.");
  const merged = normalizeQuestion({ ...cur.body, type: cur.qtype, marks: cur.marks, ...patch, type: patch.type || cur.qtype });
  await q(
    `UPDATE question_bank SET subject_id = COALESCE($2, subject_id), grade_id = $3, term_id = $4, unit = $5, lesson = $6,
            qtype = $7, difficulty = $8, marks = $9, body = $10, is_shared = $11 WHERE id = $1`,
    [id, patch.subject_id ?? null,
     patch.grade_id !== undefined ? patch.grade_id : cur.grade_id, patch.term_id !== undefined ? patch.term_id : cur.term_id,
     patch.unit !== undefined ? patch.unit || null : cur.unit, patch.lesson !== undefined ? patch.lesson || null : cur.lesson,
     merged.type, patch.difficulty || cur.difficulty, patch.marks ?? cur.marks, toBody(merged),
     patch.is_shared ?? cur.is_shared]);
}

export async function archive(q, id, teacherId) {
  const [cur] = await q("SELECT teacher_id FROM question_bank WHERE id = $1 AND NOT is_archived", [id]);
  if (!cur) throw notFound("السؤال غير موجود");
  if (teacherId && Number(cur.teacher_id) !== Number(teacherId)) throw forbidden("لا تحذف إلا أسئلتك");
  await q("UPDATE question_bank SET is_archived = true WHERE id = $1", [id]);
}

// تحويل سؤال البنك إلى سؤال داخل ورقة (نسخة مستقلة: تعديل البنك لاحقًا لا يغيّر الاختبار)
export const newItemId = (p = "q") => `${p}_${crypto.randomBytes(6).toString("hex")}`;
export function toPaperQuestion(row) {
  const body = row.body || {};
  return {
    ...body, id: newItemId("q"), type: row.type || row.qtype, marks: Number(row.marks), difficulty: row.difficulty,
    bank_id: Number(row.id), unit: row.unit || "", lesson: row.lesson || "",
  };
}

/* ---------- السحب التلقائي ---------- */
export const pickSchema = z.object({
  subject_id: t.id,
  grade_id: t.optId,
  unit: z.string().trim().max(120).optional().nullable(),
  lesson: z.string().trim().max(120).optional().nullable(),
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
  spec: z.array(z.object({ type: z.enum(QTYPE_KEYS), count: z.coerce.number().int().min(1).max(100) })).min(1).max(12),
  exclude: z.array(z.coerce.number().int().positive()).max(1000).default([]),
});

/**
 * يسحب أسئلة عشوائية من البنك حسب المواصفات.
 * «مختلط» يوزّع العدد على السهل والمتوسط والصعب قدر الإمكان، ثم يكمل الناقص من أي مستوى.
 * يعيد الأسئلة المسحوبة والعجز لكل نوع (إن لم يكفِ البنك).
 */
export async function pick(q, teacherId, p) {
  const out = [];
  const shortages = [];
  const taken = new Set(p.exclude);
  const fetch = async (type, difficulty, limit) => {
    if (limit <= 0) return [];
    const params = [];
    const where = ["NOT b.is_archived"];
    const add = (sql, v) => { params.push(v); where.push(sql.replaceAll("?", `$${params.length}`)); };
    params.push(teacherId || null); where.push(visibleTo(teacherId, params.length));
    add("b.subject_id = ?", p.subject_id);
    add("b.qtype = ?", type);
    add("NOT (b.id = ANY(?::bigint[]))", [...taken]);
    if (difficulty) add("b.difficulty = ?", difficulty);
    if (p.grade_id) add("(b.grade_id = ? OR b.grade_id IS NULL)", p.grade_id);
    if (p.unit) add("b.unit = ?", p.unit);
    if (p.lesson) add("b.lesson = ?", p.lesson);
    params.push(limit);
    const rows = await q(`SELECT ${COLS} ${FROM} WHERE ${where.join(" AND ")} ORDER BY random() LIMIT $${params.length}`, params);
    for (const r of rows) taken.add(Number(r.id));
    return rows;
  };
  for (const { type, count } of p.spec) {
    const rows = [];
    if (p.difficulty === "mixed") {
      const per = Math.ceil(count / 3);
      for (const d of ["easy", "medium", "hard"]) rows.push(...(await fetch(type, d, Math.min(per, count - rows.length))));
      rows.push(...(await fetch(type, null, count - rows.length)));
    } else {
      rows.push(...(await fetch(type, p.difficulty, count)));
    }
    if (rows.length < count) shortages.push({ type, wanted: count, found: rows.length });
    out.push(...rows.map(toPaperQuestion));
  }
  return { questions: out, shortages };
}

// حفظ أسئلة من ورقة في البنك (يتخطى الأسئلة المأخوذة من البنك أصلًا)
export async function saveFromPaper(q, teacherId, paper, questionIds) {
  const want = new Set(questionIds);
  let saved = 0;
  for (const s of paper.content.sections || []) for (const qq of s.questions || []) {
    if (!want.has(qq.id) || qq.bank_id) continue;
    if (!String(qq.text || "").trim() && !["match", "order"].includes(qq.type)) continue;
    await create(q, teacherId, { ...qq, subject_id: paper.subject_id, grade_id: paper.grade_id, term_id: paper.term_id, is_shared: false });
    saved++;
  }
  if (!saved && want.size) throw badRequest("لا توجد أسئلة جديدة للحفظ (الأسئلة المأخوذة من البنك موجودة فيه أصلًا)");
  return saved;
}

export async function stats(q, teacherId) {
  const vis = visibleTo(teacherId, 1);
  const p = [teacherId || null];
  const [total] = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE b.teacher_id = $1)::int AS mine FROM question_bank b WHERE NOT b.is_archived AND ${vis}`, p);
  const bySubject = await q(
    `SELECT s.name AS subject, COALESCE(b.unit, 'بدون وحدة') AS unit, count(*)::int AS n FROM question_bank b JOIN subjects s ON s.id = b.subject_id
      WHERE NOT b.is_archived AND ${vis} GROUP BY s.name, b.unit ORDER BY s.name, n DESC`, p);
  const byDifficulty = await q(`SELECT b.difficulty, count(*)::int AS n FROM question_bank b WHERE NOT b.is_archived AND ${vis} GROUP BY b.difficulty`, p);
  const byType = await q(`SELECT b.qtype AS type, count(*)::int AS n FROM question_bank b WHERE NOT b.is_archived AND ${vis} GROUP BY b.qtype ORDER BY n DESC`, p);
  return { total: total.n, mine: total.mine, bySubject, byDifficulty, byType };
}
