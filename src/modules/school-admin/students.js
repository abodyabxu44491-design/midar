// الطلاب: إضافة، استيراد، تعديل، أرشفة، معرّفات، تفعيل الرسوم
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as students from "../shared/students.service.js";
import { studentSummaries } from "../shared/finance.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  const scope = req.query.status || "active";     // active | inactive | all
  res.json(await inTenant(req, async (q) => {
    const rows = await q(
      `SELECT s.id, s.full_name AS name, s.class_id, c.name AS class_name, s.guardian_name, s.guardian_phone,
              s.access_key, s.fees_enabled, s.version, s.status, s.status_note, s.status_changed_at, s.created_at
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE ($1 = 'all' OR ($1 = 'active') = (s.status = 'active'))
        ORDER BY c.id NULLS LAST, s.full_name`, [scope]);
    const summaries = await studentSummaries(q, rows.filter((s) => s.fees_enabled).map((s) => s.id));
    for (const s of rows) s.fees = s.fees_enabled ? summaries.get(Number(s.id)) : null;
    return rows;
  }));
}));

// بحث بجوال ولي الأمر: يملأ الاسم ويكشف الإخوة المسجلين
r.get("/guardian", handle(async (req, res) => {
  const phone = parse(z.string().max(20), req.query.phone || "");
  res.json(await inTenant(req, (q) => students.guardianByPhone(q, phone)));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(students.studentSchema, req.body);
  const [created] = await inTenant(req, (q) => students.create(q, req.tenant, [b]));
  res.status(201).json(created);
}));

// الاستيراد يتم كاملًا أو لا يتم أبدًا (لا يبقى نصف الملف)
r.post("/import", handle(async (req, res) => {
  const b = parse(students.importSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => students.create(q, req.tenant, b.students)));
}));

r.patch("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(students.updateSchema, req.body);
  res.json(await inTenant(req, (q) => students.update(q, id, b)));
}));

r.post("/:id/regenerate-key", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json({ access_key: await inTenant(req, (q) => students.regenerateKey(q, id)) });
}));

// لا يوجد حذف نهائي: تتغير حالة الطالب فقط وتبقى سجلاته
r.post("/:id/status", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(students.statusSchema, req.body);
  res.json(await inTenant(req, (q) => students.setStatus(q, req.tenant, id, b)));
}));

/**
 * إجراء واحد على عدة طلاب: نقل لشعبة، تغيير الحالة، تفعيل/إيقاف الرسوم.
 * يتم كاملًا داخل معاملة واحدة، ويُسجَّل في سجل التدقيق لكل طالب.
 */
const bulkSchema = z.object({
  ids: z.array(t.id).min(1, "اختر طالبًا واحدًا على الأقل").max(2000),
  action: z.enum(["move_class", "status", "fees"]),
  class_id: t.optId,
  status: z.enum(students.STATUSES).optional(),
  fees_enabled: z.boolean().optional(),
  note: t.optText(300),
});

r.post("/bulk", handle(async (req, res) => {
  const b = parse(bulkSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    let done = 0;
    if (b.action === "move_class") {
      if (b.class_id) {
        const [cls] = await q("SELECT id FROM classes WHERE id = $1", [b.class_id]);
        if (!cls) throw notFound("الشعبة غير موجودة");
      }
      const rows = await q(
        "UPDATE students SET class_id = $2 WHERE id = ANY($1::bigint[]) AND status = 'active' RETURNING id",
        [b.ids, b.class_id ?? null]);
      done = rows.length;
    } else if (b.action === "status") {
      if (!b.status) throw badRequest("حدد الحالة");
      for (const id of b.ids) {
        await students.setStatus(q, req.tenant, id, { status: b.status, note: b.note ?? null });
        done++;
      }
    } else {
      if (b.fees_enabled === undefined) throw badRequest("حدد تفعيل الرسوم أو إيقافها");
      const rows = await q(
        "UPDATE students SET fees_enabled = $2 WHERE id = ANY($1::bigint[]) AND status = 'active' RETURNING id",
        [b.ids, b.fees_enabled]);
      done = rows.length;
    }
    return { done };
  }));
}));

export default r;
