// جدول المعلم وحصص اليوم
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, empty, line, sub, btn } from "/shared/js/ui.js";
import { timetableGrid, DAYS, todayIndex } from "/shared/js/timetable.js";

export default async function timetable({ goTo } = {}) {
  const { week, today } = await api("/api/teacher/timetable");
  return [
    panel(`حصص اليوم — ${DAYS[todayIndex()]}`, null,
      today.length ? today.map((s) => line(
        h("div", {}, h("b", {}, `الحصة ${s.period}`), sub(`${s.class_name} — ${s.subject}${s.room ? ` — ${s.room}` : ""}`)),
        goTo ? btn("تسجيل الحضور", () => goTo("attendance", { classId: s.class_id }), "soft sm") : null))
        : empty("لا توجد حصص لك اليوم.")),
    panel("جدولي الأسبوعي", null,
      week.length ? timetableGrid(week, { cell: (d, p, s) => (s
        ? [h("b", {}, s.subject), h("div", { class: "small muted" }, s.class_name)]
        : h("span", { class: "muted" }, "—")) })
        : empty("لم يُسجل لك جدول بعد.")),
  ];
}
