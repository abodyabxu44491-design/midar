import { api } from "/shared/js/api.js";
import { panel, empty, line, sub } from "/shared/js/ui.js";
import { h } from "/shared/js/dom.js";
import { fmtDateTime } from "/shared/js/format.js";

const OPS = { insert: "إضافة", update: "تعديل", delete: "حذف" };
const TABLES = { tenants: "مدرسة", plans: "باقة", features: "ميزة" };
const STATUS = { active: "مفعّلة", suspended: "موقوفة", archived: "مؤرشفة" };
const PLAN = { basic: "الأساسية", pro: "الاحترافية", enterprise: "المؤسسات" };
export default async function audit() {
  const rows = await api("/api/owner/audit");
  return panel("سجل عمليات المنصة", null, rows.length ? rows.map((a) => line(
    h("div", {}, h("span", {}, a.table_name ? `${OPS[a.action] || a.action} ${TABLES[a.table_name] || "سجل"} ${a.record_id ?? ""}` : a.action),
      a.details && sub([a.details.name, a.details.status && `الحالة: ${STATUS[a.details.status] || a.details.status}`, a.details.plan && `الباقة: ${PLAN[a.details.plan] || a.details.plan}`,
        a.details.max_students != null && `حد الطلاب: ${a.details.max_students}`].filter(Boolean).join(" — "))),
    sub([a.actor === "system" ? "النظام" : a.actor, a.ip, fmtDateTime(a.created_at)].filter(Boolean).join(" — ")))) : empty("لا توجد عمليات."));
}
