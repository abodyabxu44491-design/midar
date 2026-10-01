// الاختبارات والامتحانات: مصمم الاختبارات الورقية (بنك الأسئلة، الإنشاء، التصميم، الطباعة)، والاختبارات الإلكترونية
import { h, mount } from "../../shared/js/dom.js";
import { examSection } from "../../shared/js/exam/home.js";

export default async function papers({ me }) {
  const base = "/api/teacher/papers";
  if (!me.modules?.online_exams) return examSection({ base, me: { ...me, role: "teacher" } });
  const box = h("div");
  const chips = h("div", { class: "xb-chips" });
  const views = [["list", "الاختبارات"], ["online", "الاختبارات الإلكترونية"]];
  const show = async (k) => {
    mount(chips, views.map(([key, label]) => h("button", { type: "button", class: `xb-chip${key === k ? " on" : ""}`, onclick: () => show(key) }, label)));
    mount(box, k === "list" ? await examSection({ base, me: { ...me, role: "teacher" } })
      : await (await import("../../shared/js/online-exams-staff.js")).onlineExamsPanel({ base: "/api/teacher/online-exams" }));
  };
  await show("list");
  return [chips, box];
}
