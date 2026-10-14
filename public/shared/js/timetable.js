/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h } from "./dom.js";

export const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const WORK_DAYS = [0, 1, 2, 3, 4];
export const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];
export const todayIndex = () => new Date().getDay() % 7;

export function timetableGrid(slots, { periods = PERIODS, days = WORK_DAYS, cell, highlightToday = true } = {}) {
  const at = (d, p) => slots.find((s) => s.day === d && s.period === p);
  const today = todayIndex();
  return h("div", { class: "scroll" },
    h("table", { class: "grid timetable" },
      h("thead", {}, h("tr", {}, h("th", {}, "اليوم"), periods.map((p) => h("th", {}, `الحصة ${p}`)))),
      h("tbody", {}, days.map((d) => h("tr", { class: highlightToday && d === today ? "today" : "" },
        h("th", {}, DAYS[d]),
        periods.map((p) => {
          const s = at(d, p);
          return h("td", {}, cell ? cell(d, p, s) : (s
            ? [h("b", {}, s.subject), s.teacher ? h("div", { class: "small muted" }, s.teacher) : null,
               s.room ? h("div", { class: "small muted" }, s.room) : null]
            : h("span", { class: "muted" }, "—")));
        })))))); 
}
