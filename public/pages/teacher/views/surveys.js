// الاستبيانات (المعلم)
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, btn, empty, badge, line, sub } from "../../shared/js/ui.js";
import { surveyForm } from "../../shared/js/engagement-ui.js";

export default async function surveys({ refresh }) {
  const list = await api("/api/teacher/surveys");
  const box = h("div");
  return [panel("الاستبيانات", null, list.length ? list.map((s) => line(
    h("div", {}, h("b", {}, s.title), " ", s.answered ? badge("أجبت") : s.open ? badge("متاح", "amber") : badge("مغلق", "gray"), s.description ? sub(s.description) : null),
    s.open ? btn("أجب", () => mount(box, panel(s.title, null, surveyForm(s, (answers) => api(`/api/teacher/surveys/${s.id}`, { answers }), refresh))), "sm") : null))
    : empty("لا توجد استبيانات.")), box];
}
