// توزيع الدرجات: أنواع الدرجات وأوزانها، وحساب نتيجة المادة الموزونة
import { z, t } from "../../core/http/validate.js";
import { badRequest } from "../../core/http/errors.js";

// قوالب جاهزة يبدأ منها المدير ثم يعدّلها
export const TEMPLATES = {
  standard: { name: "مشاركة وواجبات واختبارات", items: [
    ["المشاركة والأنشطة", 10], ["الواجبات", 10], ["الاختبارات القصيرة", 10], ["الاختبار الشهري", 20], ["الاختبار النهائي", 50, true]] },
  simple: { name: "أعمال السنة والنهائي", items: [["أعمال السنة", 40], ["الاختبار النهائي", 60, true]] },
  monthly: { name: "شهري ونهائي", items: [["المشاركة والسلوك", 10], ["الشهري الأول", 15], ["الشهري الثاني", 15], ["الاختبار النهائي", 60, true]] },
};

export const saveSchema = z.object({
  grade_id: t.id.nullable().optional(),
  items: z.array(z.object({
    id: t.id.optional(),
    name: z.string().trim().min(2, "اسم النوع قصير").max(40, "اسم النوع طويل"),
    weight: z.coerce.number().positive("الوزن غير صحيح").max(100).multipleOf(0.5),
    is_default: z.boolean().optional(),
  })).max(15, "عدد الأنواع كبير"),
});

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// كل التوزيعات: العام وتوزيعات الصفوف، مع عدد الدرجات المرصودة على كل نوع
export async function list(q) {
  const rows = await q(
    `SELECT gc.id, gc.grade_id, gc.name, gc.weight, gc.is_default, gc.sort_order, g.name AS grade_name,
            (SELECT count(*) FROM exams e WHERE e.component_id = gc.id)::int AS used
       FROM grade_components gc LEFT JOIN grades g ON g.id = gc.grade_id
      ORDER BY gc.grade_id NULLS FIRST, gc.sort_order, gc.id`);
  return rows.map((r) => ({ ...r, weight: Number(r.weight) }));
}

// التوزيع الذي ينطبق على صف: الخاص به إن وُجد، وإلا العام
export async function forGrade(q, gradeId) {
  const rows = await q(
    `SELECT id, grade_id, name, weight, is_default, sort_order FROM grade_components
      WHERE grade_id = $1 OR (grade_id IS NULL AND NOT EXISTS (SELECT 1 FROM grade_components x WHERE x.grade_id = $1))
      ORDER BY sort_order, id`, [gradeId ?? null]);
  return rows.map((r) => ({ ...r, weight: Number(r.weight) }));
}

export async function forClass(q, classId) {
  const [c] = await q("SELECT grade_id FROM classes WHERE id = $1", [classId]);
  return c ? forGrade(q, c.grade_id) : [];
}

// النوع الذي يُسجَّل عليه «اختبار» جديد: المختار إن كان ضمن توزيع صفه، وإلا الافتراضي، وإلا بلا نوع
export async function resolveForExam(q, classId, componentId) {
  const comps = await forClass(q, classId);
  if (!comps.length) {
    if (componentId) throw badRequest("لم يُحدَّد توزيع درجات لهذا الصف");
    return null;
  }
  if (componentId) {
    if (!comps.some((c) => Number(c.id) === Number(componentId))) throw badRequest("نوع الدرجة لا يتبع توزيع هذا الصف");
    return Number(componentId);
  }
  return Number((comps.find((c) => c.is_default) || comps[comps.length - 1]).id);
}

// حفظ توزيع نطاق واحد (عام أو صف): الأوزان مجموعها 100، ونوع افتراضي واحد، ولا يُحذف نوع عليه درجات
export async function save(q, b) {
  const scope = b.grade_id ?? null;
  if (scope) {
    const [g] = await q("SELECT id FROM grades WHERE id = $1", [scope]);
    if (!g) throw badRequest("الصف غير موجود");
  }
  const items = b.items;
  const names = new Set();
  for (const it of items) {
    if (names.has(it.name)) throw badRequest(`النوع «${it.name}» مكرر`);
    names.add(it.name);
  }
  if (items.length) {
    const sum = round(items.reduce((a, it) => a + it.weight, 0));
    if (sum !== 100) throw badRequest(`مجموع الأوزان ${sum} ويجب أن يكون 100`);
  }
  const defaults = items.filter((it) => it.is_default).length;
  if (defaults > 1) throw badRequest("اختر نوعًا افتراضيًا واحدًا فقط");
  if (items.length && !defaults) items[items.length - 1].is_default = true;

  const current = await q(
    `SELECT gc.id, (SELECT count(*) FROM exams e WHERE e.component_id = gc.id)::int AS used
       FROM grade_components gc WHERE gc.grade_id IS NOT DISTINCT FROM $1`, [scope]);
  const keep = new Set(items.filter((it) => it.id).map((it) => Number(it.id)));
  for (const it of items) {
    if (it.id && !current.some((c) => Number(c.id) === Number(it.id))) throw badRequest("نوع غير موجود في هذا التوزيع");
  }
  for (const c of current) {
    if (keep.has(Number(c.id))) continue;
    if (c.used) throw badRequest("لا يمكن حذف نوع عليه درجات مرصودة. عدّل اسمه أو وزنه بدل حذفه.");
  }
  // الحذف أولًا، ثم إلغاء الافتراضي والأسماء مؤقتًا حتى لا تتعارض القيود الفريدة أثناء التبديل
  await q(`DELETE FROM grade_components WHERE grade_id IS NOT DISTINCT FROM $1 AND NOT (id = ANY($2::bigint[]))`, [scope, [...keep]]);
  await q(`UPDATE grade_components SET is_default = false, name = '~' || id WHERE grade_id IS NOT DISTINCT FROM $1`, [scope]);
  let order = 0;
  for (const it of items) {
    order++;
    if (it.id) {
      await q("UPDATE grade_components SET name = $2, weight = $3, is_default = $4, sort_order = $5 WHERE id = $1",
        [it.id, it.name, it.weight, !!it.is_default, order]);
    } else {
      await q(`INSERT INTO grade_components (tenant_id, grade_id, name, weight, is_default, sort_order)
               VALUES (app_tenant(), $1, $2, $3, $4, $5)`, [scope, it.name, it.weight, !!it.is_default, order]);
    }
  }
  return list(q);
}

/**
 * نتيجة مادة واحدة من صفوف درجاتها.
 * rows: [{ score, max_score, component_id }]، comps: توزيع صف الطالب.
 * بلا توزيع: مجموع الدرجات ÷ مجموع القصوى. مع توزيع: لكل نوع نسبته × وزنه، والأنواع التي لم تُرصد بعد
 * لا تُحسب صفرًا بل يُعاد توزيع الوزن على المرصود (partial = true حتى تكتمل).
 */
export function subjectResult(rows, comps) {
  const raw = rows.reduce((a, r) => ({ s: a.s + Number(r.score), m: a.m + Number(r.max_score) }), { s: 0, m: 0 });
  if (!comps?.length) {
    return { score: round(raw.s), max: round(raw.m), percent: raw.m ? round((raw.s / raw.m) * 100, 1) : null, components: null, partial: false };
  }
  const def = comps.find((c) => c.is_default) || comps[comps.length - 1];
  const byId = new Map(comps.map((c) => [Number(c.id), { id: Number(c.id), name: c.name, weight: Number(c.weight), score: 0, max: 0, count: 0 }]));
  for (const r of rows) {
    const c = byId.get(Number(r.component_id)) || byId.get(Number(def.id));
    c.score += Number(r.score); c.max += Number(r.max_score); c.count++;
  }
  const parts = [...byId.values()].map((c) => ({
    name: c.name, weight: c.weight, score: round(c.score), max: round(c.max), count: c.count,
    percent: c.max ? round((c.score / c.max) * 100, 1) : null,
    earned: c.max ? round((c.score / c.max) * c.weight) : null,
  }));
  const done = parts.filter((p) => p.max > 0);
  const wSum = done.reduce((a, p) => a + p.weight, 0);
  const earned = done.reduce((a, p) => a + (p.score / p.max) * p.weight, 0);
  return {
    score: round(earned), max: round(wSum),
    percent: wSum ? round((earned / wSum) * 100, 1) : null,
    components: parts, partial: done.length < parts.length,
  };
}
