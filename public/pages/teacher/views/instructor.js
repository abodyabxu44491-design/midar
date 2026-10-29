/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, btn, sub, badge, empty } from "../../shared/js/ui.js";
import { rosterDialog } from "../../shared/js/university-ui.js";

const B = "/api/teacher/university";
export async function sections({ refresh }) {
  const list = await api(`${B}/sections`);
  if (!list.length) return empty("لا توجد شعب مسندة لك. تواصل مع القبول والتسجيل.");
  const terms = [...new Map(list.map((s) => [s.term_id, s.term])).entries()];
  return terms.map(([id, name]) => panel(name, null, list.filter((s) => s.term_id === id).map((s) => h("div", { class: "uni-row" },
    h("div", {}, h("b", {}, `${s.course_code} ${s.course_name}`), " ", h("small", { class: "sub" }, `شعبة ${s.code}`),
      sub([`${s.registered} طالب`, `${s.credits} ساعات`, s.schedule, s.room].filter(Boolean).join(" · "))),
    h("div", { class: "row", style: "gap:6px" }, s.grades_submitted_at ? badge("سُلّمت الدرجات") : null,
      btn(s.grades_submitted_at ? "عرض الدرجات" : "رصد الدرجات", () => rosterDialog(s.id, refresh, { base: B, admin: false }), "sm"))))));
}
