// الطلاب: إضافة، استيراد، تعديل، أرشفة، معرّفات، تفعيل الرسوم
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as students from "../shared/students.service.js";
import { studentSummaries } from "../shared/finance.service.js";

const r = Router();

// قائمة الطلاب.
//   بدون limit: القائمة كاملة (للتوافق مع التصدير والواجهات القديمة)
//   مع limit: صفحة واحدة مع التصفية والبحث في الخادم، والعدد الكلي في X-Total-Count
//   summary=1: أعداد الطلاب لكل شعبة فقط (بطاقات المراحل والصفوف) بدل تنزيل القائمة كلها
//   fields=basic: الاسم والشعبة فقط (قوائم الاختيار في الحضور والكشوف)
const listQuery = z.object({
  status: z.enum(["active", "inactive", "all"]).default("active"),
  class_id: t.optId,
  class_ids: z.string().regex(/^\d+(,\d+)*$/).max(4000).optional(),
  q: z.string().trim().max(80).optional(),
  fees: z.enum(["paid", "unpaid", "off"]).optional().or(z.literal("")),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  summary: z.enum(["1"]).optional(),
  fields: z.enum(["basic"]).optional(),
});
// حالة الرسوم محسوبة في قاعدة البيانات (للتصفية في الخادم)
const FEE_BALANCE = `(SELECT COALESCE(SUM(i.amount - invoice_net_paid(i.id)), 0) FROM invoices i WHERE i.student_id = s.id AND i.status = 'open')`;
const FEE_TOTAL = `(SELECT COALESCE(SUM(i.amount), 0) FROM invoices i WHERE i.student_id = s.id AND i.status = 'open')`;

r.get("/", handle(async (req, res) => {
  const f = parse(listQuery, req.query);
  res.json(await inTenant(req, async (q) => {
    const params = [f.status];
    const where = ["($1 = 'all' OR ($1 = 'active') = (s.status = 'active'))"];
    const add = (sql, v) => { params.push(v); where.push(sql.replaceAll("?", `$${params.length}`)); };
    if (f.summary) {
      return q(`SELECT s.class_id, count(*)::int AS n FROM students s WHERE ${where[0]} GROUP BY s.class_id`, params);
    }
    if (f.class_id) add("s.class_id = ?", f.class_id);
    if (f.class_ids) add("s.class_id = ANY(?::bigint[])", f.class_ids.split(",").map(Number));
    if (f.q) {
      add(`(s.full_name ILIKE '%' || ? || '%' OR s.access_key = upper(?) OR s.guardian_phone LIKE '%' || ? || '%'
            OR s.guardian_name ILIKE '%' || ? || '%')`, f.q);
    }
    if (f.fees === "off") where.push("NOT s.fees_enabled");
    if (f.fees === "paid") where.push(`s.fees_enabled AND ${FEE_TOTAL} > 0 AND ${FEE_BALANCE} <= 0`);
    if (f.fees === "unpaid") where.push(`s.fees_enabled AND ${FEE_BALANCE} > 0`);
    const cols = f.fields === "basic" ? "s.id, s.full_name AS name, s.class_id, c.name AS class_name"
      : `s.id, s.full_name AS name, s.class_id, c.name AS class_name, s.guardian_name, s.guardian_phone,
         s.access_key, s.fees_enabled, s.version, s.status, s.status_note, s.status_changed_at, s.created_at`;
    const paging = f.limit ? `LIMIT ${f.limit} OFFSET ${f.offset}` : "";
    const rows = await q(
      `SELECT ${cols}${f.limit ? ", count(*) OVER ()::int AS _total" : ""}
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE ${where.join(" AND ")}
        ORDER BY c.sort_order NULLS LAST, c.id NULLS LAST, s.full_name ${paging}`, params);
    if (f.limit) {
      res.set("X-Total-Count", String(rows[0]?._total ?? (f.offset ? -1 : 0)));
      for (const x of rows) delete x._total;
    }
    if (f.fields !== "basic") {
      // ملخص الرسوم للصفحة المعروضة فقط (وليس لكل طلاب المدرسة)
      const summaries = await studentSummaries(q, rows.filter((x) => x.fees_enabled).map((x) => x.id));
      for (const x of rows) x.fees = x.fees_enabled ? summaries.get(Number(x.id)) : null;
    }
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
