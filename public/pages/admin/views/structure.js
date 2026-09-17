// تبويب الفصول والمواد
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, input, select, btn, empty, line, sub, toast, confirmAction } from "/shared/js/ui.js";
import { A, loadClasses, loadSubjects, classOptions } from "./common.js";

function block(title, list, path, placeholder, refresh) {
  const name = input({ placeholder });
  return panel(title, null,
    h("div", { class: "row" }, name, btn("إضافة", async () => { await api(`${A}/structure/${path}`, { name: name.value }); refresh(); })),
    list.length ? list.map((x) => line(
      h("span", {}, x.name, x.students !== undefined ? h("span", { class: "sub" }, ` — ${x.students} طالب`) : null),
      btn("حذف", async () => {
        if (!confirmAction(`حذف «${x.name}»؟`)) return;
        await api(`${A}/structure/${path}/${x.id}`, undefined, "DELETE"); toast("تم الحذف"); refresh();
      }, "danger sm"))) : empty("لا يوجد."),
    path === "classes" ? sub("لا يمكن حذف فصل فيه طلاب أو اختبارات. انقلهم أولًا.") : null);
}

export default async function structure({ refresh }) {
  const [classes, subjects] = await Promise.all([loadClasses(), loadSubjects()]);
  const from = select(classOptions(classes, "من فصل")), to = select(classOptions(classes, "إلى فصل"));
  return [
    block("الفصول", classes, "classes", "مثال: الرابع - أ", refresh),
    block("المواد", subjects, "subjects", "مثال: الرياضيات", refresh),
    panel("ترحيل الطلاب لسنة جديدة", null,
      sub("ينقل كل طلاب فصل إلى فصل آخر في عملية واحدة، وتُسجَّل في السجل."),
      h("div", { class: "row spaced" }, from, to, btn("ترحيل", async () => {
        if (!confirmAction("تأكيد ترحيل جميع طلاب الفصل؟")) return;
        const r = await api(`${A}/structure/promote`, { from: from.value, to: to.value });
        toast(`تم ترحيل ${r.moved} طالب`); refresh();
      }, "soft"))),
  ];
}
