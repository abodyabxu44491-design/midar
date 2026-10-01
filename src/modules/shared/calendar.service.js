// التقويم المدرسي: فعاليات تضيفها الإدارة، ويُجمع معها تلقائيًا: الإجازات، والاختبارات، والاختبارات الإلكترونية، وبداية الفصول ونهايتها
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";
import { notify } from "./notify.service.js";

export const KINDS = { event: "فعالية", exam: "اختبارات", meeting: "اجتماع", activity: "نشاط", trip: "رحلة", deadline: "موعد نهائي", other: "أخرى" };
export const eventSchema = z.object({
  title: t.shortText("عنوان الفعالية", 120),
  kind: z.enum(Object.keys(KINDS)).default("event"),
  starts_on: t.date, ends_on: t.optDate,
  time_text: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  audience: z.enum(["all", "staff", "parents"]).default("all"),
  class_id: t.optId,
  description: t.optText(1000),
  notify: z.boolean().default(false),
});
export const rangeSchema = z.object({ from: t.date, to: t.date });

export async function add(q, b, actor) {
  const ends = b.ends_on || b.starts_on;
  if (ends < b.starts_on) throw badRequest("تاريخ النهاية قبل البداية");
  const [row] = await q(`INSERT INTO calendar_events (tenant_id, title, kind, starts_on, ends_on, time_text, audience, class_id, description, created_by)
    VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [b.title, b.kind, b.starts_on, ends, b.time_text, b.audience, b.class_id ?? null, b.description ?? null, actor]);
  if (b.notify) {
    const body = `${b.starts_on}${ends !== b.starts_on ? ` إلى ${ends}` : ""}${b.time_text ? ` — ${b.time_text}` : ""}`;
    if (b.audience !== "staff") {
      const st = await q("SELECT id FROM students WHERE archived_at IS NULL AND ($1::bigint IS NULL OR class_id = $1)", [b.class_id ?? null]);
      await notify(q, { event: "calendar", students: st.map((s) => s.id), title: b.title, body });
    }
    if (b.audience !== "parents") {
      const us = await q("SELECT id FROM users WHERE is_active AND role IN ('teacher', 'accountant')");
      await notify(q, { event: "calendar", users: us.map((u) => u.id), title: b.title, body });
    }
  }
  return row;
}

export async function update(q, id, b) {
  const ends = b.ends_on || b.starts_on;
  const rows = await q(`UPDATE calendar_events SET title = $2, kind = $3, starts_on = $4, ends_on = $5, time_text = $6, audience = $7, class_id = $8, description = $9
    WHERE id = $1 RETURNING id`, [id, b.title, b.kind, b.starts_on, ends, b.time_text, b.audience, b.class_id ?? null, b.description ?? null]);
  if (!rows.length) throw notFound("الفعالية غير موجودة");
}
export async function remove(q, id) {
  const rows = await q("DELETE FROM calendar_events WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("الفعالية غير موجودة");
}

/**
 * عناصر التقويم في فترة.
 * @param {{ view: "admin"|"staff"|"parent", classIds?: number[]|null }} who
 */
export async function feed(q, { from, to }, { view, classIds = null }) {
  const aud = view === "parent" ? ["all", "parents"] : view === "staff" ? ["all", "staff"] : ["all", "staff", "parents"];
  const events = await q(`SELECT id, title, kind, starts_on::text AS start, ends_on::text AS end, time_text, audience, class_id, description
      FROM calendar_events WHERE ends_on >= $1 AND starts_on <= $2 AND audience = ANY($3)
       AND (class_id IS NULL OR $4::bigint[] IS NULL OR class_id = ANY($4)) ORDER BY starts_on`, [from, to, aud, classIds]);
  const holidays = await q(`SELECT id, name AS title, start_date::text AS start, end_date::text AS end FROM holidays
      WHERE show_in_calendar AND end_date >= $1 AND start_date <= $2 ORDER BY start_date`, [from, to]);
  const exams = await q(`SELECT e.id, e.title, sub.name AS subject, c.name AS class_name, e.exam_date::text AS start, e.class_id
      FROM exams e JOIN subjects sub ON sub.id = e.subject_id JOIN classes c ON c.id = e.class_id
      WHERE e.exam_date BETWEEN $1 AND $2 AND ($3::bigint[] IS NULL OR e.class_id = ANY($3)) ORDER BY e.exam_date`, [from, to, classIds]);
  const terms = await q(`SELECT t.id, t.name, t.start_date::text AS start, t.end_date::text AS end FROM terms t
      WHERE (t.start_date BETWEEN $1 AND $2) OR (t.end_date BETWEEN $1 AND $2)`, [from, to]);
  const items = [
    ...events.map((e) => ({ type: "event", id: e.id, title: e.title, kind: e.kind, start: e.start, end: e.end, time: e.time_text, audience: e.audience, class_id: e.class_id, description: e.description })),
    ...holidays.map((h) => ({ type: "holiday", id: h.id, title: h.title, kind: "holiday", start: h.start, end: h.end })),
    ...exams.map((e) => ({ type: "exam", id: e.id, title: `${e.subject}: ${e.title}`, kind: "exam", start: e.start, end: e.start, class_name: e.class_name })),
    ...terms.flatMap((tm) => [
      tm.start >= from && tm.start <= to ? { type: "term", id: tm.id, title: `بداية ${tm.name}`, kind: "term", start: tm.start, end: tm.start } : null,
      tm.end >= from && tm.end <= to ? { type: "term", id: tm.id, title: `نهاية ${tm.name}`, kind: "term", start: tm.end, end: tm.end } : null]).filter(Boolean),
  ];
  return items.sort((a, b) => a.start.localeCompare(b.start) || a.type.localeCompare(b.type));
}
