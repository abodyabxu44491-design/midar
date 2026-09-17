import { api } from "/shared/js/api.js";
import { panel, empty, line, sub } from "/shared/js/ui.js";
import { h } from "/shared/js/dom.js";
import { fmtDateTime } from "/shared/js/format.js";

const OPS = { insert: "إضافة", update: "تعديل", delete: "حذف" };
export default async function audit() {
  const rows = await api("/api/owner/audit");
  return panel("سجل عمليات المنصة", null, rows.length ? rows.map((a) => line(
    h("div", {}, h("span", {}, a.table_name ? `${OPS[a.action] || a.action} مدرسة ${a.record_id}` : a.action),
      a.details && sub(`الحالة: ${a.details.status} — الباقة: ${a.details.plan} — الحد: ${a.details.max_students}`)),
    sub(`${a.actor} — ${a.ip || ""} — ${fmtDateTime(a.created_at)}`))) : empty("لا توجد عمليات."));
}
