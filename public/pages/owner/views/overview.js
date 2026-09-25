import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { stats, panel, empty, notice } from "/shared/js/ui.js";

export default async function overview() {
  const [s, list] = await Promise.all([api("/api/owner/tenants/stats"), api("/api/owner/tenants")]);
  return [
    stats([["مدرسة مفعّلة", s.active, `من ${s.tenants} مدارس`], ["طالب على المنصة", s.students], ["اشتراك ينتهي خلال 45 يومًا", s.expiring]]),
    panel("الاستخدام مقابل حد الباقة", null, list.length ? list.map((x) => h("div", { style: "padding:6px 0" },
      h("div", { class: "row", style: "justify-content:space-between" }, h("span", {}, x.name), h("span", { style: "flex:none" }, `${x.students} / ${x.max_students}`)),
      h("div", { class: "bar" }, h("i", { style: `width:${Math.min(100, (x.students / x.max_students) * 100)}%` })))) : empty("لا توجد مدارس بعد.")),
  ];
}
