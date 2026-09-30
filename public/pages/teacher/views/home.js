import { h } from "../../shared/js/dom.js";
import { stats, panel, empty, line, notice } from "../../shared/js/ui.js";

export const myClasses = (me) => [...new Map(me.load.map((l) => [l.class_id, { id: l.class_id, name: l.class_name }])).values()];

export default function home({ me }) {
  // بطاقة الترحيب: صورة المعلم (يرفعها المدير من ملف المعلم) أو أول حرف من اسمه
  const initial = String(me.name || "؟").replace(/^(أ\.|د\.|م\.)\s*/, "").trim().charAt(0);
  return [
    h("div", { class: "welcome-card" },
      me.photo ? h("img", { class: "t-avatar lg", src: me.photo, alt: "" }) : h("span", { class: "t-avatar lg ph", "aria-hidden": "true" }, initial),
      h("div", { class: "t-info" }, h("b", {}, `أهلًا، ${me.name}`),
        h("small", {}, me.academic ? `${me.academic.year_name} — ${me.academic.term_name || "لم يُحدد فصل دراسي"}` : me.school.name))),
    stats([["فصولي", myClasses(me).length], ["موادي", new Set(me.load.map((l) => l.subject_id)).size]]),
    panel("الفصول والمواد المسندة لي", null, me.load.length
      ? me.load.map((l) => line(h("b", {}, l.subject_name), h("span", {}, l.class_name)))
      : empty("لم تُسند لك فصول بعد. تواصل مع إدارة المدرسة.")),
  ];
}
