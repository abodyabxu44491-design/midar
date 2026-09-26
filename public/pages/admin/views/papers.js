// الاختبارات الورقية في لوحة الإدارة: مراجعة واعتماد اختبارات المعلمين، وسياسة المدرسة وشعارها
import { h, mount } from "../../shared/js/dom.js";
import { examSection, examSettingsPanel } from "../../shared/js/exam/home.js";

export default async function papers({ me }) {
  const box = h("div");
  const chips = h("div", { class: "xb-chips" });
  const views = [["list", "الاختبارات"], ["settings", "الإعدادات والصلاحيات"]];
  const show = async (k) => {
    mount(chips, views.map(([key, label]) => h("button", { type: "button", class: `xb-chip${key === k ? " on" : ""}`, onclick: () => show(key) }, label)));
    mount(box, k === "list" ? await examSection({ base: "/api/admin/papers", me: { ...me, role: "admin" }, admin: true }) : await examSettingsPanel());
  };
  await show("list");
  return [chips, box];
}
