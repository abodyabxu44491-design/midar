// الإعلانات والرسائل الجماعية: لكل أولياء الأمور، أو مرحلة، أو صف، أو شعبة، أو طلاب محددين، أو المعلمين، أو كل المنسوبين.
// الإرسال يمر بخطوتين: معاينة (كم مستلمًا) ثم تأكيد بنفس العدد، فلا يُرسل شيء بالخطأ أو لفئة تغيّرت بعد المعاينة.
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound, conflict, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { notify } from "../shared/notify.service.js";

const r = Router();
const TYPES = ["all", "stage", "grade", "class", "students", "teachers", "staff"];
const schema = z.object({
  title: t.shortText("العنوان"),
  body: t.optText(2000),
  kind: z.enum(["announcement", "message"]).default("announcement"),   // إعلان (يبقى في صفحة الإعلانات) أو رسالة (إشعار فقط)
  class_id: t.optId,                                                    // الطريقة القديمة: شعبة واحدة
  target: z.object({ type: z.enum(TYPES), ids: z.array(t.id).max(2000).default([]) }).optional(),
  dry_run: z.boolean().default(false),
  expected: z.number().int().min(0).optional(),                         // العدد الذي رآه المرسل في المعاينة
});
const STAFF_TYPES = new Set(["teachers", "staff"]);

/** المستلمون حسب الفئة. @returns {{ students: number[], users: number[] }} */
async function recipients(q, target) {
  const { type, ids } = target;
  if (type !== "all" && !STAFF_TYPES.has(type) && !ids.length) throw badRequest("اختر من يصله الإرسال");
  if (type === "teachers" || type === "staff") {
    const users = await q(`SELECT id FROM users WHERE is_active AND ($1 OR role = 'teacher')`, [type === "staff"]);
    return { students: [], users: users.map((u) => u.id) };
  }
  const rows = await q(
    `SELECT s.id FROM students s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN grades g ON g.id = c.grade_id
      WHERE s.archived_at IS NULL AND CASE $1
        WHEN 'all' THEN true
        WHEN 'stage' THEN g.stage_id = ANY($2)
        WHEN 'grade' THEN c.grade_id = ANY($2)
        WHEN 'class' THEN s.class_id = ANY($2)
        WHEN 'students' THEN s.id = ANY($2) END`, [type, ids]);
  return { students: rows.map((s) => s.id), users: [] };
}

r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => q(`SELECT a.id, a.title, a.body, a.class_id, c.name AS class_name, a.target, a.recipients, a.created_by, a.created_at
    FROM announcements a LEFT JOIN classes c ON c.id = a.class_id ORDER BY a.id DESC LIMIT 200`)));
}));

// الفئات المتاحة للإرسال: المراحل والصفوف والشعب والطلاب
r.get("/targets", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({
    stages: await q("SELECT id, name FROM stages ORDER BY sort_order, id"),
    grades: await q("SELECT g.id, g.name, s.name AS stage FROM grades g JOIN stages s ON s.id = g.stage_id ORDER BY s.sort_order, g.sort_order, g.id"),
    classes: await q("SELECT id, name FROM classes ORDER BY sort_order, id"),
    students: await q("SELECT id, full_name AS name, class_id FROM students WHERE archived_at IS NULL ORDER BY full_name LIMIT 5000"),
  })));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(schema, req.body);
  const target = b.target ?? (b.class_id ? { type: "class", ids: [b.class_id] } : { type: "all", ids: [] });
  const out = await inTenant(req, async (q) => {
    const to = await recipients(q, target);
    const count = { parents: to.students.length, staff: to.users.length, total: to.students.length + to.users.length };
    if (b.dry_run) return { recipients: count };
    if (!count.total) throw badRequest("لا يوجد مستلمون في هذه الفئة");
    if (b.expected !== undefined && b.expected !== count.total) throw conflict(`تغيّر عدد المستلمين (${count.total} بدل ${b.expected}). راجع ثم أرسل مرة أخرى.`);
    let id = null;
    if (b.kind === "announcement") {
      const single = target.type === "class" && target.ids.length === 1;
      [{ id }] = await q(
        `INSERT INTO announcements (tenant_id, class_id, title, body, created_by, target, recipients)
         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING id`,
        [single ? target.ids[0] : null, b.title, b.body, req.actor, target.type === "all" || single ? null : JSON.stringify(target), count.total]);
    }
    const event = b.kind === "message" ? "message" : "announcement";
    const title = b.kind === "message" ? b.title : `إعلان: ${b.title}`;
    const sent = await notify(q, { event, students: to.students, users: to.users, title, body: b.body,
      link: b.kind === "message" ? null : (to.users.length ? "announcements" : "news"), dedupKey: `bulk-${id ?? Date.now()}` });
    return { id, recipients: count, push: sent.push };
  });
  res.status(b.dry_run ? 200 : 201).json(out);
}));

r.delete("/:id", handle(async (req, res) => {
  const rows = await inTenant(req, (q) => q("DELETE FROM announcements WHERE id = $1 RETURNING id", [parse(t.id, req.params.id)]));
  if (!rows.length) throw notFound();
  res.json({ ok: true });
}));

export default r;
