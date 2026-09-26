import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { stats, panel, empty, sub } from "/shared/js/ui.js";
import { limitText } from "./sub-form.js";

export default async function overview() {
  const [s, sub7, list] = await Promise.all([api("/api/owner/tenants/stats"), api("/api/owner/subscriptions/stats"), api("/api/owner/tenants")]);
  return [
    stats([["إجمالي المدارس", sub7.schools], ["اشتراكات فعّالة", sub7.active], ["تجارب مجانية", sub7.trials], ["منتهية", sub7.expired],
      ["تنتهي خلال 7 أيام", sub7.expiring_7], ["طالب على المنصة", s.students]]),
    sub7.by_plan.length ? panel("المدارس حسب الباقة", null, h("div", { class: "row", style: "flex-wrap:wrap;gap:22px" },
      sub7.by_plan.map((p) => h("div", {}, sub(p.plan), h("b", { style: "font-size:22px" }, p.schools))))) : null,
    panel("الاستخدام مقابل حد الباقة", null, list.length ? list.map((x) => h("div", { style: "padding:6px 0" },
      h("div", { class: "row", style: "justify-content:space-between" }, h("span", {}, x.name), h("span", { style: "flex:none" }, `${x.students} / ${limitText(x.max_students)}`)),
      h("div", { class: "bar" }, h("i", { style: `width:${x.max_students >= 100000 ? 0 : Math.min(100, (x.students / x.max_students) * 100)}%` })))) : empty("لا توجد مدارس بعد.")),
  ];
}
