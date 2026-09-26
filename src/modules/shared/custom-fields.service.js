// الحقول المخصصة: تعريفها وقيمها لكل طالب أو معلم
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";

export const TYPES = { text: "نص", number: "رقم", date: "تاريخ", select: "قائمة", boolean: "نعم / لا" };

export const fieldSchema = z.object({
  entity: z.enum(["student", "teacher", "staff"]).default("student"),
  label: t.shortText("اسم الحقل", 60),
  type: z.enum(["text", "number", "date", "select", "boolean"]),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  required: z.boolean().default(false),
  show_admin: z.boolean().default(true),
  show_parent: z.boolean().default(false),
  is_active: z.boolean().optional(),
});

export const valuesSchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

// مفتاح إنجليزي مستقر يُشتق من الاسم، فلا يطلبه المستخدم
const keyFrom = (label, taken) => {
  let base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  base = base.slice(0, 28) || "field";
  let key = base, i = 2;
  while (taken.has(key)) key = `${base}_${i++}`;
  return key;
};

export const list = (q, entity = null) => q(
  `SELECT id, entity, key, label, type, options, required, show_admin, show_parent, sort_order, is_active
     FROM custom_fields WHERE ($1::text IS NULL OR entity = $1) ORDER BY sort_order, id`, [entity]);

export async function addField(q, b) {
  if (b.type === "select" && !b.options?.length) throw badRequest("أضف خيارات القائمة");
  const existing = await q("SELECT key FROM custom_fields WHERE entity = $1", [b.entity]);
  const [dup] = await q("SELECT 1 FROM custom_fields WHERE entity = $1 AND label = $2", [b.entity, b.label]);
  if (dup) throw conflict("يوجد حقل بنفس الاسم");
  const [order] = await q("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM custom_fields WHERE entity = $1", [b.entity]);
  const [row] = await q(
    `INSERT INTO custom_fields (tenant_id, entity, key, label, type, options, required, show_admin, show_parent, sort_order)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, key, label`,
    [b.entity, keyFrom(b.label, new Set(existing.map((f) => f.key))), b.label, b.type,
     b.type === "select" ? b.options : null, b.required, b.show_admin, b.show_parent, order.next]);
  return row;
}

export async function updateField(q, id, b) {
  const rows = await q(
    `UPDATE custom_fields SET label = COALESCE($2, label), required = COALESCE($3, required),
        show_admin = COALESCE($4, show_admin), show_parent = COALESCE($5, show_parent),
        options = COALESCE($6, options), is_active = COALESCE($7, is_active)
      WHERE id = $1 RETURNING id`,
    [id, b.label ?? null, b.required ?? null, b.show_admin ?? null, b.show_parent ?? null,
     b.options?.length ? b.options : null, b.is_active ?? null]);
  if (!rows.length) throw notFound("الحقل غير موجود");
}

export async function removeField(q, id) {
  const rows = await q("DELETE FROM custom_fields WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("الحقل غير موجود");
}

/** قيم كيان واحد: { key: value } */
export async function valuesOf(q, entity, entityId) {
  const rows = await q(
    `SELECT f.key, v.value FROM custom_values v JOIN custom_fields f ON f.id = v.field_id
      WHERE f.entity = $1 AND v.entity_id = $2`, [entity, entityId]);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** قيم عدة كيانات دفعة واحدة (بدون استعلام لكل طالب) */
export async function valuesFor(q, entity, ids) {
  if (!ids.length) return new Map();
  const rows = await q(
    `SELECT v.entity_id, f.key, v.value FROM custom_values v JOIN custom_fields f ON f.id = v.field_id
      WHERE f.entity = $1 AND v.entity_id = ANY($2::bigint[])`, [entity, ids]);
  const out = new Map();
  for (const r of rows) {
    const key = Number(r.entity_id);
    out.set(key, { ...(out.get(key) || {}), [r.key]: r.value });
  }
  return out;
}

/** حفظ القيم مع التحقق من النوع والإلزامية */
export async function saveValues(q, entity, entityId, values) {
  const fields = await q("SELECT id, key, label, type, options, required FROM custom_fields WHERE entity = $1 AND is_active", [entity]);
  for (const f of fields) {
    const raw = values[f.key];
    const empty = raw === undefined || raw === null || String(raw).trim() === "";
    if (empty) {
      if (f.required) throw badRequest(`${f.label} مطلوب`);
      await q("DELETE FROM custom_values WHERE field_id = $1 AND entity_id = $2", [f.id, entityId]);
      continue;
    }
    let value = String(raw).trim();
    if (f.type === "number" && Number.isNaN(Number(value))) throw badRequest(`${f.label} يجب أن يكون رقمًا`);
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${f.label} يجب أن يكون تاريخًا`);
    if (f.type === "boolean") value = ["true", "1", "نعم"].includes(value) ? "نعم" : "لا";
    if (f.type === "select" && !f.options.includes(value)) throw badRequest(`${f.label}: قيمة غير موجودة في القائمة`);
    if (value.length > 400) throw badRequest(`${f.label} طويل جدًا`);
    await q(
      `INSERT INTO custom_values (tenant_id, field_id, entity_id, value) VALUES (app_tenant(), $1, $2, $3)
       ON CONFLICT (field_id, entity_id) DO UPDATE SET value = EXCLUDED.value`,
      [f.id, entityId, value]);
  }
}
