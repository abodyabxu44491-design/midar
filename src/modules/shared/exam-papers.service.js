// ورقة الاختبار: الإنشاء، الحفظ التلقائي، الحالات والاعتماد، النسخ والقوالب، الاستيراد، والصلاحيات
//
// الصلاحيات تُحسب هنا في مكان واحد ويستخدمها الخادم قبل كل عملية، والواجهة تعرض الأزرار حسبها فقط.
// نموذج الإجابة لا يخرج من الخادم إلا لمن يملك صلاحيته، ولا يوجد أي مسار عام يصل إليه.
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, forbidden, conflict } from "../../core/http/errors.js";
import { matchesMime } from "./attachments.service.js";
import {
  totals, checkPaper, stripAnswers, DEFAULT_EXAM_TYPES, ORDINALS, QTYPES, newQuestion, withLayoutDefaults,
} from "../../../public/shared/js/exam/engine.js";
import { paperQuestion, normalizeQuestion, newItemId, pick } from "./question-bank.service.js";

/* ---------- المخططات ---------- */
const sectionSchema = z.object({
  id: z.string().regex(/^s_[a-z0-9]{3,20}$/, "معرّف قسم غير صالح"),
  title: z.string().max(150).default(""),
  instructions: z.string().max(1500).default(""),
  questions: z.array(paperQuestion).max(200),
});
export const contentSchema = z.object({ sections: z.array(sectionSchema).max(20) })
  .refine((c) => c.sections.reduce((a, s) => a + s.questions.length, 0) <= 300, "الحد الأقصى 300 سؤال في الاختبار الواحد");

export const layoutSchema = z.object({
  template: z.enum(["formal", "modern", "simple", "academic", "custom"]),
  paper: z.enum(["A4", "A5", "Letter"]),
  orientation: z.enum(["portrait", "landscape"]),
  margins: z.coerce.number().min(5).max(30),
  font: z.enum(["plex", "naskh", "kufi"]),
  heading_font: z.enum(["same", "plex", "naskh", "kufi"]),
  fontSize: z.coerce.number().min(9).max(20),
  spacing: z.enum(["compact", "normal", "relaxed"]),
  color: z.boolean(), show_logo: z.boolean(), show_school: z.boolean(), show_teacher: z.boolean(),
  show_marks: z.boolean(), show_version: z.boolean(), page_numbers: z.boolean(), show_duration: z.boolean(),
  show_date: z.boolean(), show_signature: z.boolean(), show_instructions: z.boolean(),
  numbering: z.enum(["continuous", "per_section"]),
  header_note: z.string().max(200), footer_text: z.string().max(200),
  student_fields: z.array(z.enum(["name", "grade", "section", "number", "date", "score"])).max(6),
  extra_fields: z.array(z.string().trim().min(1).max(40)).max(4),
}).partial();

const meta = {
  title: t.shortText("اسم الاختبار", 150),
  subject_id: t.id,
  class_id: t.optId,
  grade_id: t.optId,
  term_id: t.optId,
  exam_type: t.shortText("نوع الاختبار", 60).default("اختبار قصير"),
  exam_date: t.optDate,
  duration_min: z.union([z.coerce.number().int().min(1).max(600), z.literal(""), z.null()]).optional()
    .transform((v) => (v === undefined ? undefined : v === "" ? null : v)),
  total_marks: z.union([z.coerce.number().positive().max(10000), z.literal(""), z.null()]).optional()
    .transform((v) => (v === undefined ? undefined : v === "" ? null : v)),
  instructions: t.optText(3000),
  expected_pages: z.union([z.coerce.number().int().min(1).max(50), z.literal(""), z.null()]).optional()
    .transform((v) => (v === undefined ? undefined : v === "" ? null : v)),
  versions: z.coerce.number().int().min(1).max(4).optional(),
  shuffle_questions: z.boolean().optional(),
  shuffle_options: z.boolean().optional(),
};
export const createSchema = z.object({ ...meta, content: contentSchema.optional(), layout: layoutSchema.optional() });
export const saveSchema = z.object({
  version: z.coerce.number().int().positive(),
  meta: z.object(meta).partial().optional(),
  content: contentSchema.optional(),
  layout: layoutSchema.optional(),
});
export const statusSchema = z.object({ action: z.enum(["ready", "approve", "reopen", "archive", "unarchive", "printed"]) });

export const settingsSchema = z.object({
  require_approval: z.boolean(), teacher_can_reopen: z.boolean(), teacher_answer_keys: z.boolean(), show_logo: z.boolean(),
  default_instructions: t.optText(2000), footer_text: t.optText(200),
}).partial();

/* ---------- إعدادات المدرسة ---------- */
export async function getSettings(q) {
  const [row] = await q("SELECT * FROM exam_paper_settings WHERE tenant_id = app_tenant()");
  if (row) return row;
  await q("INSERT INTO exam_paper_settings (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  return (await q("SELECT * FROM exam_paper_settings WHERE tenant_id = app_tenant()"))[0];
}
export async function updateSettings(q, patch) {
  await getSettings(q);
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (keys.length) {
    await q(`UPDATE exam_paper_settings SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")} WHERE tenant_id = app_tenant()`,
      keys.map((k) => patch[k]));
  }
  return getSettings(q);
}
const publicSettings = (s) => ({
  require_approval: s.require_approval, teacher_can_reopen: s.teacher_can_reopen, teacher_answer_keys: s.teacher_answer_keys,
  show_logo: s.show_logo, logo_image_id: s.show_logo ? s.logo_image_id : null,
  default_instructions: s.default_instructions, footer_text: s.footer_text,
});

/* ---------- الصلاحيات ---------- */
// who: { role: "admin" } أو { role: "teacher", teacherId }
export function permissions(who, paper, settings) {
  const admin = who.role === "admin";
  const author = !admin && paper.teacher_id != null && Number(paper.teacher_id) === Number(who.teacherId);
  const owner = admin || author;
  const s = paper.status;
  const editable = s === "draft" || s === "ready";
  return {
    view: owner,
    edit: owner && editable,
    submit: author && s === "draft" && settings.require_approval,                       // إرسال للإدارة
    approve: editable && (admin || (author && !settings.require_approval)),
    reopen: (s === "approved" || s === "printed") && (admin || (author && !settings.require_approval && settings.teacher_can_reopen)),
    print: owner && (s === "approved" || s === "printed"),                             // الطباعة الرسمية بعد الاعتماد فقط
    preview: owner,
    answer_key: admin || (author && settings.teacher_answer_keys),
    archive: owner && s !== "archived",
    unarchive: owner && s === "archived",
    delete: owner && s === "draft",
  };
}

function need(perm, message) { if (!perm) throw forbidden(message); }

/* ---------- القراءة ---------- */
const LIST_COLS = `p.id, p.teacher_id, p.subject_id, p.class_id, p.grade_id, p.term_id, p.title, p.exam_type, p.exam_date,
  p.duration_min, p.total_marks, p.computed_marks, p.question_count, p.status, p.versions, p.is_template, p.template_name,
  p.print_count, p.printed_at, p.approved_by, p.approved_at, p.created_at, p.updated_at, p.version,
  s.name AS subject_name, c.name AS class_name, g.name AS grade_name, te.full_name AS teacher_name`;
const LIST_FROM = `FROM exam_papers p JOIN subjects s ON s.id = p.subject_id LEFT JOIN classes c ON c.id = p.class_id
  LEFT JOIN grades g ON g.id = p.grade_id LEFT JOIN teachers te ON te.id = p.teacher_id`;

export const listFilter = z.object({
  status: z.enum(["draft", "ready", "approved", "printed", "archived", "active", "all"]).default("active"),
  templates: z.enum(["0", "1"]).default("0"),
  teacher_id: t.optId,
});

export async function list(q, who, f) {
  const params = [f.templates === "1"];
  const where = ["p.is_template = $1"];
  if (who.role === "teacher") { params.push(who.teacherId); where.push(`p.teacher_id = $${params.length}`); }
  else if (f.teacher_id) { params.push(f.teacher_id); where.push(`p.teacher_id = $${params.length}`); }
  if (f.status === "active") where.push("p.status <> 'archived'");
  else if (f.status !== "all") { params.push(f.status); where.push(`p.status = $${params.length}`); }
  return q(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE ${where.join(" AND ")} ORDER BY p.updated_at DESC LIMIT 500`, params);
}

export async function counts(q, who) {
  const params = [];
  let mine = "TRUE";
  if (who.role === "teacher") { params.push(who.teacherId); mine = "teacher_id = $1"; }
  const [c] = await q(
    `SELECT count(*) FILTER (WHERE status <> 'archived')::int AS total,
            count(*) FILTER (WHERE status = 'draft')::int AS draft,
            count(*) FILTER (WHERE status = 'ready')::int AS ready,
            count(*) FILTER (WHERE status = 'approved')::int AS approved,
            count(*) FILTER (WHERE status = 'printed')::int AS printed,
            count(*) FILTER (WHERE status = 'archived')::int AS archived,
            count(*) FILTER (WHERE exam_date >= CURRENT_DATE AND status <> 'archived')::int AS scheduled,
            count(*) FILTER (WHERE exam_date < CURRENT_DATE AND status <> 'archived')::int AS past
       FROM exam_papers WHERE NOT is_template AND ${mine}`, params);
  const [tpl] = await q(`SELECT count(*)::int AS n FROM exam_papers WHERE is_template AND ${mine}`, params);
  return { ...c, templates: tpl.n };
}

async function load(q, id) {
  const [p] = await q(`SELECT ${LIST_COLS}, p.content, p.layout, p.instructions, p.expected_pages, p.shuffle_questions,
    p.shuffle_options, p.seed, p.archived_from, p.source_paper_id ${LIST_FROM} WHERE p.id = $1`, [id]);
  return p || null;
}

/**
 * قراءة الاختبار مع التحقق من الصلاحية.
 * غير المسموح له يتلقى «غير موجود» حتى لا يعرف أن الاختبار موجود أصلًا.
 */
export async function getFor(q, who, id) {
  const paper = await load(q, id);
  const settings = await getSettings(q);
  if (!paper) throw notFound("الاختبار غير موجود");
  const perms = permissions(who, paper, settings);
  if (!perms.view) throw notFound("الاختبار غير موجود");
  return { paper, perms, settings };
}

// ما يُرسل للواجهة: المحتوى كاملًا لمن يملك التعديل أو نموذج الإجابة، وبدون إجابات لغيره
export function present({ paper, perms }) {
  const { seed, ...rest } = paper;
  return { ...rest, seed, layout: withLayoutDefaults(paper.layout), perms, check: checkPaper(paper) };
}

/* ---------- نطاق المعلم ---------- */
// المعلم لا ينشئ اختبارًا إلا لمادة يدرّسها، وفي شعبة أو صف أُسند له فيه
export async function assertTeacherScope(q, who, { subject_id, class_id, grade_id }) {
  if (who.role !== "teacher") return;
  const params = [who.teacherId, subject_id];
  let extra = "";
  if (class_id) { params.push(class_id); extra = ` AND a.class_id = $${params.length}`; }
  else if (grade_id) { params.push(grade_id); extra = ` AND c.grade_id = $${params.length}`; }
  const rows = await q(
    `SELECT 1 FROM teacher_assignments a JOIN classes c ON c.id = a.class_id
      WHERE a.teacher_id = $1 AND a.subject_id = $2${extra} LIMIT 1`, params);
  if (!rows.length) throw forbidden("هذه المادة غير مسندة لك في هذا الصف أو الشعبة");
}

// الصف يُستنتج من الشعبة إن لم يُحدد، والفصل الدراسي الحالي إن لم يُحدد
async function fillDerived(q, b) {
  const out = { ...b };
  if (b.class_id) {
    const [c] = await q("SELECT grade_id FROM classes WHERE id = $1", [b.class_id]);
    if (!c) throw badRequest("الشعبة غير موجودة");
    if (!out.grade_id) out.grade_id = c.grade_id;
  }
  if (out.term_id === undefined || out.term_id === null) {
    const [term] = await q("SELECT id FROM terms WHERE is_current ORDER BY id DESC LIMIT 1");
    out.term_id = term?.id ?? null;
  }
  return out;
}

/* ---------- الصور ---------- */
export const imageSchema = z.object({
  mime: z.enum(["image/png", "image/jpeg", "image/webp"], { errorMap: () => ({ message: "الصور المسموحة: PNG أو JPG أو WEBP" }) }),
  data: z.string().min(16).max(Math.ceil(2 * 1024 * 1024 * 1.4)),
  // صورة مصغرة اختيارية يولّدها المتصفح (للمعاينات والقوائم)
  thumb: z.object({ mime: z.enum(["image/png", "image/jpeg", "image/webp"]), data: z.string().min(16).max(360_000) }).optional(),
});
export async function saveImage(q, { kind = "question", teacherId = null, file, actor }) {
  const buffer = Buffer.from(file.data, "base64");
  if (!buffer.length) throw badRequest("الصورة فارغة");
  if (buffer.length > 2 * 1024 * 1024) throw badRequest("حجم الصورة أكبر من 2 ميجابايت. صغّرها ثم أعد المحاولة");
  if (!matchesMime(buffer, file.mime)) throw badRequest("محتوى الملف لا يطابق نوعه. ارفع صورة PNG أو JPG أو WEBP سليمة");
  let thumb = null;
  if (file.thumb) {
    thumb = Buffer.from(file.thumb.data, "base64");
    // المصغرة تُفحص بمحتواها مثل الأصلية، وإن لم تصح تُتجاهل (الأصلية تكفي)
    if (!thumb.length || thumb.length > 262144 || !matchesMime(thumb, file.thumb.mime)) thumb = null;
  }
  const [row] = await q(
    `INSERT INTO exam_images (tenant_id, kind, teacher_id, mime, size_bytes, data, uploaded_by, thumb, thumb_mime)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, mime, size_bytes, (thumb IS NOT NULL) AS has_thumb`,
    [kind, teacherId, file.mime, buffer.length, buffer, actor, thumb, thumb ? file.thumb.mime : null]);
  return row;
}
// size = thumb: المصغرة إن وُجدت (وإلا الأصلية). لا تُقرأ الأصلية من القاعدة عند طلب المصغرة.
export async function readImage(q, id, size = "full") {
  const [row] = size === "thumb"
    ? await q("SELECT COALESCE(thumb_mime, mime) AS mime, COALESCE(thumb, data) AS data FROM exam_images WHERE id = $1", [id])
    : await q("SELECT mime, data FROM exam_images WHERE id = $1", [id]);
  if (!row) throw notFound("الصورة غير موجودة");
  return row;
}

// الصور المشار إليها في المحتوى يجب أن تكون صور هذه المدرسة (RLS يضمن ذلك عند الاستعلام)
async function dropForeignImages(q, content) {
  const ids = new Set();
  for (const s of content.sections) for (const qq of s.questions) if (qq.image?.id) ids.add(Number(qq.image.id));
  if (!ids.size) return content;
  const ok = new Set((await q("SELECT id FROM exam_images WHERE id = ANY($1::bigint[])", [[...ids]])).map((r) => Number(r.id)));
  for (const s of content.sections) for (const qq of s.questions) if (qq.image && !ok.has(Number(qq.image.id))) qq.image = null;
  return content;
}

function normalizeContent(content) {
  return {
    sections: content.sections.map((s) => ({ ...s, questions: s.questions.map(normalizeQuestion) })),
  };
}

/* ---------- الإنشاء والحفظ ---------- */
export async function create(q, who, b, actor, extra = {}) {
  await assertTeacherScope(q, who, b);
  const d = await fillDerived(q, b);
  const settings = await getSettings(q);
  const content = await dropForeignImages(q, normalizeContent(b.content || { sections: [] }));
  const tt = totals(content);
  const instructions = d.instructions ?? settings.default_instructions ?? null;
  const [row] = await q(
    `INSERT INTO exam_papers (tenant_id, teacher_id, subject_id, class_id, grade_id, term_id, title, exam_type, exam_date,
        duration_min, total_marks, instructions, expected_pages, versions, shuffle_questions, shuffle_options,
        content, layout, computed_marks, question_count, created_by, is_template, template_name, source_paper_id)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
     RETURNING id`,
    [who.role === "teacher" ? who.teacherId : (extra.teacher_id ?? null), d.subject_id, d.class_id ?? null, d.grade_id ?? null,
     d.term_id ?? null, d.title, d.exam_type || "اختبار قصير", d.exam_date ?? null, d.duration_min ?? null,
     d.total_marks ?? null, instructions, d.expected_pages ?? null, d.versions ?? 1, d.shuffle_questions ?? true,
     d.shuffle_options ?? true, content, { ...(b.layout || {}), show_logo: b.layout?.show_logo ?? settings.show_logo },
     tt.total, tt.count, actor, !!extra.is_template, extra.template_name ?? null, extra.source_paper_id ?? null]);
  return row;
}

/**
 * الحفظ التلقائي: يرسل المتصفح رقم النسخة التي يعدّلها.
 * إن عُدّل الاختبار من جهاز آخر بعدها يُرفض الحفظ بدل أن يمسح أحدهما عمل الآخر.
 */
export async function save(q, who, id, b) {
  const { paper, perms } = await getFor(q, who, id);
  need(perms.edit, paper.status === "approved" || paper.status === "printed"
    ? "الاختبار معتمد ومقفل. أعد فتحه للتعديل أولًا." : "لا يمكن تعديل هذا الاختبار");
  if (Number(b.version) !== Number(paper.version)) throw conflict("عُدّل هذا الاختبار من جهاز أو نافذة أخرى. أعد تحميل الصفحة لرؤية آخر نسخة.");
  const m = b.meta || {};
  const next = { subject_id: m.subject_id ?? paper.subject_id, class_id: m.class_id !== undefined ? m.class_id : paper.class_id,
    grade_id: m.grade_id !== undefined ? m.grade_id : paper.grade_id };
  if (m.subject_id !== undefined || m.class_id !== undefined || m.grade_id !== undefined) {
    await assertTeacherScope(q, who, next);
    if (m.class_id && m.grade_id === undefined) next.grade_id = (await fillDerived(q, { class_id: m.class_id, term_id: 0 })).grade_id;
  }
  const content = b.content ? await dropForeignImages(q, normalizeContent(b.content)) : paper.content;
  const layout = b.layout ? { ...paper.layout, ...b.layout } : paper.layout;
  const tt = totals(content);
  const val = (k) => (m[k] !== undefined ? m[k] : paper[k]);
  const [row] = await q(
    `UPDATE exam_papers SET title = $2, subject_id = $3, class_id = $4, grade_id = $5, term_id = $6, exam_type = $7,
        exam_date = $8, duration_min = $9, total_marks = $10, instructions = $11, expected_pages = $12, versions = $13,
        shuffle_questions = $14, shuffle_options = $15, content = $16, layout = $17, computed_marks = $18, question_count = $19
      WHERE id = $1 AND version = $20
      RETURNING version, computed_marks, question_count, updated_at, status`,
    [id, val("title"), next.subject_id, next.class_id, next.grade_id, val("term_id"), val("exam_type"), val("exam_date"),
     val("duration_min"), val("total_marks"), val("instructions"), val("expected_pages"), val("versions"),
     val("shuffle_questions"), val("shuffle_options"), content, layout, tt.total, tt.count, paper.version]);
  if (!row) throw conflict("عُدّل هذا الاختبار من جهاز أو نافذة أخرى. أعد تحميل الصفحة لرؤية آخر نسخة.");
  return { ...row, check: checkPaper({ ...paper, content, total_marks: val("total_marks") }) };
}

/* ---------- الحالات ---------- */
export async function setStatus(q, who, id, action, actor) {
  const { paper, perms } = await getFor(q, who, id);
  if (paper.is_template) throw badRequest("القالب لا يُعتمد ولا يُطبع. أنشئ منه اختبارًا أولًا.");
  const check = checkPaper(paper);
  switch (action) {
    case "ready":
      need(perms.submit || (perms.edit && paper.status === "draft"), "لا يمكن تغيير حالة هذا الاختبار");
      if (check.blocking) throw badRequest(`أكمل الاختبار أولًا: ${check.issues.find((i) => i.level === "error").text}`);
      await q("UPDATE exam_papers SET status = 'ready' WHERE id = $1", [id]);
      break;
    case "approve":
      need(perms.approve, paper.status === "draft" || paper.status === "ready"
        ? "اعتماد الاختبارات من صلاحية إدارة المدرسة. أرسله للاعتماد." : "لا يمكن اعتماد هذا الاختبار");
      if (check.blocking) throw badRequest(`لا يمكن اعتماد الاختبار: ${check.issues.find((i) => i.level === "error").text}`);
      await q("UPDATE exam_papers SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1", [id, actor]);
      // إحصاء استخدام أسئلة البنك
      {
        const bankIds = [];
        for (const s of paper.content.sections || []) for (const qq of s.questions || []) if (qq.bank_id) bankIds.push(Number(qq.bank_id));
        if (bankIds.length) await q("UPDATE question_bank SET used_count = used_count + 1 WHERE id = ANY($1::bigint[])", [bankIds]);
      }
      break;
    case "reopen":
      need(perms.reopen, "إعادة فتح الاختبار المعتمد من صلاحية إدارة المدرسة");
      await q("UPDATE exam_papers SET status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = $1", [id]);
      break;
    case "printed":
      need(perms.print, "الطباعة الرسمية بعد اعتماد الاختبار");
      await q("UPDATE exam_papers SET status = 'printed', printed_at = now(), print_count = print_count + 1 WHERE id = $1", [id]);
      break;
    case "archive":
      need(perms.archive, "لا يمكن أرشفة هذا الاختبار");
      await q("UPDATE exam_papers SET archived_from = status, status = 'archived' WHERE id = $1", [id]);
      break;
    case "unarchive":
      need(perms.unarchive, "لا يمكن استعادة هذا الاختبار");
      await q("UPDATE exam_papers SET status = archived_from, archived_from = NULL WHERE id = $1", [id]);
      break;
    default: throw badRequest("إجراء غير معروف");
  }
  return (await getFor(q, who, id)).paper.status;
}

export async function remove(q, who, id) {
  const { perms } = await getFor(q, who, id);
  need(perms.delete, "لا يُحذف إلا الاختبار المسودة. الاختبار المعتمد أو المطبوع يُؤرشف.");
  await q("DELETE FROM exam_papers WHERE id = $1", [id]);
}

/* ---------- النسخ والقوالب ---------- */
export const copySchema = z.object({
  title: z.string().trim().min(2).max(150).optional(),
  mode: z.enum(["same", "bank"]).default("same"),       // نفس الأسئلة، أو أسئلة جديدة من البنك من النوع نفسه
  shuffle: z.boolean().default(false),                 // تغيير ترتيب الأسئلة داخل كل قسم
  total_marks: z.union([z.coerce.number().positive().max(10000), z.literal(""), z.null()]).optional(),   // توزيع الدرجات على مجموع جديد
  exam_date: t.optDate,
  class_id: t.optId,
});

// أسئلة جديدة بمعرّفات جديدة (حتى لا تتشارك النسخة والأصل أي عنصر)
function cloneContent(content) {
  return {
    sections: content.sections.map((s) => ({
      ...s, id: newItemId("s"),
      questions: s.questions.map((qq) => ({ ...qq, id: newItemId("q") })),
    })),
  };
}

// توزيع الدرجات على مجموع جديد بالتناسب (لأقرب ربع درجة)، والفرق يُضاف لآخر سؤال
function scaleMarks(content, target) {
  const tt = totals(content);
  if (!tt.total || !target) return content;
  const f = target / tt.total;
  let sum = 0;
  const all = content.sections.flatMap((s) => s.questions);
  for (const qq of all) { qq.marks = Math.max(0.25, Math.round(qq.marks * f * 4) / 4); sum += qq.marks; }
  const last = all[all.length - 1];
  if (last) last.marks = Math.max(0.25, Math.round((last.marks + (target - sum)) * 100) / 100);
  return content;
}

export async function copy(q, who, id, b, actor) {
  const { paper } = await getFor(q, who, id);
  let content = cloneContent(paper.content);
  const notes = [];
  if (b.mode === "bank") {
    let replaced = 0;
    const exclude = [];
    for (const s of content.sections) for (const qq of s.questions) if (qq.bank_id) exclude.push(Number(qq.bank_id));
    for (const s of content.sections) {
      for (let i = 0; i < s.questions.length; i++) {
        const old = s.questions[i];
        const r = await pick(q, who.role === "teacher" ? who.teacherId : null, {
          subject_id: paper.subject_id, grade_id: paper.grade_id, difficulty: old.difficulty || "medium",
          spec: [{ type: old.type, count: 1 }], exclude,
        });
        const alt = r.questions[0] || (await pick(q, who.role === "teacher" ? who.teacherId : null, {
          subject_id: paper.subject_id, grade_id: paper.grade_id, difficulty: "mixed", spec: [{ type: old.type, count: 1 }], exclude,
        })).questions[0];
        if (alt) { exclude.push(alt.bank_id); s.questions[i] = { ...alt, marks: old.marks }; replaced++; }
      }
    }
    notes.push(`استُبدل ${replaced} سؤالًا من بنك الأسئلة`);
  }
  if (b.shuffle) for (const s of content.sections) s.questions.sort(() => Math.random() - 0.5);
  if (b.total_marks) content = scaleMarks(content, Number(b.total_marks));
  const row = await create(q, who, {
    title: b.title || `${paper.title} (نسخة)`, subject_id: paper.subject_id,
    class_id: b.class_id !== undefined ? b.class_id : paper.class_id, grade_id: b.class_id ? undefined : paper.grade_id,
    term_id: undefined, exam_type: paper.exam_type, exam_date: b.exam_date ?? null, duration_min: paper.duration_min,
    total_marks: b.total_marks ? Number(b.total_marks) : paper.total_marks, instructions: paper.instructions,
    expected_pages: paper.expected_pages, versions: paper.versions, shuffle_questions: paper.shuffle_questions,
    shuffle_options: paper.shuffle_options, content, layout: paper.layout,
  }, actor, { source_paper_id: paper.id, teacher_id: paper.teacher_id });
  return { ...row, notes };
}

export async function saveTemplate(q, who, id, name, actor) {
  const { paper } = await getFor(q, who, id);
  return create(q, who, {
    title: paper.title, subject_id: paper.subject_id, class_id: null, grade_id: paper.grade_id, term_id: paper.term_id,
    exam_type: paper.exam_type, duration_min: paper.duration_min, total_marks: paper.total_marks,
    instructions: paper.instructions, expected_pages: paper.expected_pages, versions: paper.versions,
    shuffle_questions: paper.shuffle_questions, shuffle_options: paper.shuffle_options,
    content: cloneContent(paper.content), layout: paper.layout,
  }, actor, { is_template: true, template_name: name, source_paper_id: paper.id, teacher_id: paper.teacher_id });
}

/* ---------- التصدير والاستيراد (ملف JSON بين المعلمين أو المدارس) ---------- */
export function exportPaper(paper, withAnswers) {
  return {
    midar_exam: 1, exported_at: new Date().toISOString(),
    title: paper.title, exam_type: paper.exam_type, duration_min: paper.duration_min, total_marks: paper.total_marks,
    instructions: paper.instructions, expected_pages: paper.expected_pages, versions: paper.versions,
    shuffle_questions: paper.shuffle_questions, shuffle_options: paper.shuffle_options,
    content: withAnswers ? paper.content : stripAnswers(paper.content), layout: paper.layout,
    subject_name: paper.subject_name,
  };
}
export const importSchema = z.object({
  subject_id: t.id, class_id: t.optId, grade_id: t.optId,
  data: z.object({
    midar_exam: z.literal(1, { errorMap: () => ({ message: "الملف ليس اختبارًا مصدّرًا من مدار" }) }),
    title: t.shortText("اسم الاختبار", 150),
    exam_type: z.string().trim().min(2).max(60).optional(),
    duration_min: z.coerce.number().int().min(1).max(600).nullable().optional(),
    total_marks: z.coerce.number().positive().max(10000).nullable().optional(),
    instructions: z.string().max(3000).nullable().optional(),
    expected_pages: z.coerce.number().int().min(1).max(50).nullable().optional(),
    versions: z.coerce.number().int().min(1).max(4).optional(),
    shuffle_questions: z.boolean().optional(), shuffle_options: z.boolean().optional(),
    content: contentSchema, layout: layoutSchema.optional(),
  }),
});
export async function importPaper(q, who, b, actor) {
  return create(q, who, {
    ...b.data, subject_id: b.subject_id, class_id: b.class_id ?? null, grade_id: b.grade_id ?? null,
    term_id: undefined, exam_date: null, content: cloneContent(b.data.content),
  }, actor);
}

/* ---------- الإنشاء السريع ومن البنك ---------- */
export const SECTION_TITLES = {
  mcq: "اختر الإجابة الصحيحة", multi: "اختر جميع الإجابات الصحيحة", truefalse: "ضع كلمة (صح) أمام العبارة الصحيحة وكلمة (خطأ) أمام الخاطئة",
  fill: "أكمل الفراغات التالية", short: "أجب عن الأسئلة التالية بإيجاز", essay: "أجب عمّا يلي", match: "صِل العمود (أ) بما يناسبه من العمود (ب)",
  order: "رتّب ما يلي ترتيبًا صحيحًا", image: "تأمل الشكل ثم أجب", table: "أجب مستعينًا بالجدول", math: "حل المسائل التالية", custom: "أجب عمّا يلي",
};
const sectionTitle = (i, type) => `السؤال ${ORDINALS[i] || i + 1}: ${SECTION_TITLES[type] || QTYPES[type].label}`;

// توزيع مجموع الدرجات على عدد الأسئلة لأقرب ربع درجة
function spread(total, n) {
  if (!n) return [];
  const each = Math.max(0.25, Math.floor((total / n) * 4) / 4);
  const out = Array(n).fill(each);
  out[n - 1] = Math.max(0.25, Math.round((total - each * (n - 1)) * 100) / 100);
  return out;
}

export const fromBankSchema = z.object({
  title: z.string().trim().min(2).max(150).optional(),
  subject_id: t.id, class_id: t.optId, grade_id: t.optId,
  exam_type: z.string().trim().min(2).max(60).default("اختبار قصير"),
  total_marks: z.union([z.coerce.number().positive().max(10000), z.literal(""), z.null()]).optional(),
  exam_date: t.optDate,
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
  unit: z.string().trim().max(120).optional().nullable(),
  lesson: z.string().trim().max(120).optional().nullable(),
  spec: z.array(z.object({ type: z.enum(Object.keys(QTYPES)), count: z.coerce.number().int().min(1).max(100) })).min(1).max(12),
  fill_missing: z.boolean().default(true),        // إكمال النقص بأسئلة فارغة يكتبها المعلم
});

export const quickSchema = z.object({
  subject_id: t.id, class_id: t.optId, grade_id: t.optId,
  exam_type: z.string().trim().min(2).max(60).default("اختبار قصير"),
  total_marks: z.coerce.number().positive().max(10000),
  count: z.coerce.number().int().min(1).max(100),
  title: z.string().trim().min(2).max(150).optional(),
});

// الإنشاء السريع: توزيع افتراضي للأنواع ثم نفس مسار «من البنك» مع إكمال النقص
export function quickSpec(count) {
  if (count <= 3) return [{ type: "mcq", count }];
  const tf = Math.max(1, Math.round(count * 0.2));
  const fill = Math.max(1, Math.round(count * 0.2));
  const short = Math.max(1, Math.round(count * 0.2));
  const mcq = count - tf - fill - short;
  return [{ type: "mcq", count: mcq }, { type: "truefalse", count: tf }, { type: "fill", count: fill }, { type: "short", count: short }]
    .filter((s) => s.count > 0);
}

export async function createFromSpec(q, who, b, actor) {
  const teacherId = who.role === "teacher" ? who.teacherId : null;
  await assertTeacherScope(q, who, b);
  const d = await fillDerived(q, { grade_id: b.grade_id, class_id: b.class_id });
  const r = await pick(q, teacherId, {
    subject_id: b.subject_id, grade_id: d.grade_id, unit: b.unit, lesson: b.lesson, difficulty: b.difficulty || "mixed",
    spec: b.spec, exclude: [],
  });
  const byType = new Map();
  for (const qq of r.questions) byType.set(qq.type, [...(byType.get(qq.type) || []), qq]);
  const total = b.spec.reduce((a, s) => a + s.count, 0);
  const marks = b.total_marks ? spread(Number(b.total_marks), total) : null;
  let mi = 0;
  const sections = [];
  let filled = 0;
  for (const [i, s] of b.spec.entries()) {
    const got = (byType.get(s.type) || []).splice(0, s.count);
    while (b.fill_missing !== false && got.length < s.count) { got.push({ ...newQuestion(s.type), id: newItemId("q") }); filled++; }
    if (!got.length) continue;
    for (const qq of got) {
      if (marks) qq.marks = marks[mi];
      mi++;
      // معرّفات الخيارات من محرك الواجهة: توحيدها لصيغة الخادم
      if (qq.options) qq.options = qq.options.map((o) => ({ ...o, id: /^o_[a-z0-9]{3,20}$/.test(o.id) ? o.id : newItemId("o") }));
      if (qq.pairs) qq.pairs = qq.pairs.map((p) => ({ ...p, id: /^p_[a-z0-9]{3,20}$/.test(p.id) ? p.id : newItemId("p") }));
      if (qq.items) qq.items = qq.items.map((p) => ({ ...p, id: /^i_[a-z0-9]{3,20}$/.test(p.id) ? p.id : newItemId("i") }));
      if (!/^q_[a-z0-9]{3,20}$/.test(qq.id)) qq.id = newItemId("q");
    }
    sections.push({ id: newItemId("s"), title: sectionTitle(sections.length, s.type), instructions: "", questions: got });
  }
  const content = contentSchema.parse({ sections });
  const [subject] = await q("SELECT name FROM subjects WHERE id = $1", [b.subject_id]);
  const row = await create(q, who, {
    title: b.title || `${b.exam_type} — ${subject?.name || ""}`.trim(), subject_id: b.subject_id, class_id: b.class_id ?? null,
    grade_id: d.grade_id ?? null, exam_type: b.exam_type, exam_date: b.exam_date ?? null,
    total_marks: b.total_marks ? Number(b.total_marks) : totals(content).total || null, content,
  }, actor);
  return { ...row, from_bank: r.questions.length, filled, shortages: r.shortages };
}

/* ---------- الأنواع والتعليمات ---------- */
export async function examTypes(q) {
  const custom = await q("SELECT id, name, is_active FROM exam_types ORDER BY name");
  return { defaults: DEFAULT_EXAM_TYPES, custom };
}
export const typeSchema = z.object({ name: t.shortText("اسم النوع", 60) });
export async function addType(q, name, actor) {
  if (DEFAULT_EXAM_TYPES.includes(name)) throw badRequest("هذا النوع موجود في الأنواع الأساسية");
  const [row] = await q(
    `INSERT INTO exam_types (tenant_id, name, created_by) VALUES (app_tenant(), $1, $2)
     ON CONFLICT (tenant_id, name) DO UPDATE SET is_active = true RETURNING id, name, is_active`, [name, actor]);
  return row;
}

export const presetSchema = z.object({ title: t.shortText("عنوان التعليمات", 80), body: t.shortText("التعليمات", 3000), is_default: z.boolean().default(false) });
export const presets = (q, teacherId) => q("SELECT id, title, body, is_default FROM exam_instruction_presets WHERE teacher_id = $1 ORDER BY is_default DESC, id DESC", [teacherId]);
export async function addPreset(q, teacherId, b) {
  if (b.is_default) await q("UPDATE exam_instruction_presets SET is_default = false WHERE teacher_id = $1", [teacherId]);
  const [row] = await q(
    `INSERT INTO exam_instruction_presets (tenant_id, teacher_id, title, body, is_default) VALUES (app_tenant(), $1, $2, $3, $4)
     RETURNING id, title, body, is_default`, [teacherId, b.title, b.body, b.is_default]);
  return row;
}
export async function removePreset(q, teacherId, id) {
  const rows = await q("DELETE FROM exam_instruction_presets WHERE id = $1 AND teacher_id = $2 RETURNING id", [id, teacherId]);
  if (!rows.length) throw notFound("التعليمات غير موجودة");
}

/* ---------- سياق الإنشاء: كل ما يلزم لتعبئة النموذج تلقائيًا ---------- */
export async function context(q, who) {
  const settings = await getSettings(q);
  const load = who.role === "teacher" ? await q(
    `SELECT a.class_id, a.subject_id, c.name AS class_name, s.name AS subject_name, c.grade_id, g.name AS grade_name,
            g.stage_id, st.name AS stage_name
       FROM teacher_assignments a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id
       LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN stages st ON st.id = g.stage_id
      WHERE a.teacher_id = $1 ORDER BY st.sort_order NULLS LAST, g.sort_order NULLS LAST, c.sort_order, c.id, s.sort_order, s.id`, [who.teacherId]) : await q(
    `SELECT c.id AS class_id, s.id AS subject_id, c.name AS class_name, s.name AS subject_name, c.grade_id, g.name AS grade_name,
            g.stage_id, st.name AS stage_name
       FROM classes c CROSS JOIN subjects s LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN stages st ON st.id = g.stage_id
      WHERE s.is_active AND (c.grade_id IS NULL OR NOT EXISTS (SELECT 1 FROM subject_grades sg WHERE sg.subject_id = s.id)
            OR EXISTS (SELECT 1 FROM subject_grades sg WHERE sg.subject_id = s.id AND sg.grade_id = c.grade_id))
      ORDER BY st.sort_order NULLS LAST, g.sort_order NULLS LAST, c.sort_order, c.id, s.sort_order, s.id LIMIT 2000`);
  const terms = await q(
    `SELECT t.id, t.name, t.is_current, y.name AS year_name FROM terms t JOIN academic_years y ON y.id = t.year_id
      WHERE y.is_current ORDER BY t.ordinal`);
  const [school] = await q("SELECT name FROM tenants WHERE id = app_tenant()");
  return {
    load, terms, types: await examTypes(q), settings: publicSettings(settings), school: school?.name,
    presets: who.role === "teacher" ? await presets(q, who.teacherId) : [],
  };
}

/* ---------- قائمة طلاب الشعبة (للطباعة بأسماء الطلاب) ---------- */
export async function roster(q, paper) {
  if (!paper.class_id) throw badRequest("حدد الشعبة في بيانات الاختبار أولًا لطباعة أوراق بأسماء الطلاب");
  const rows = await q(
    `SELECT s.full_name AS name FROM students s WHERE s.class_id = $1 AND s.status = 'active' ORDER BY s.full_name`, [paper.class_id]);
  // رقم الطالب = ترتيبه في كشف الشعبة (معرّف الطالب السري لا يُطبع على الأوراق إطلاقًا)
  return rows.map((r, i) => ({ number: i + 1, name: r.name, class_name: paper.class_name, grade_name: paper.grade_name }));
}
