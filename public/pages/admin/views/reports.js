// تبويب التقارير: كشف درجات الطالب أو الصف كامل، جاهز للطباعة أو الحفظ PDF
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, btn, empty, sub, notice, brandLogo } from "../../shared/js/ui.js";
import { fmtDate } from "../../shared/js/format.js";
import { A, loadClasses } from "./common.js";

export default async function reports({ me }) {
  const [classes, academic] = await Promise.all([loadClasses(), api(`${A}/academic`)]);
  const currentYearTerms = academic.terms.filter((t) => t.year_id === academic.current?.year_id);
  const termPicker = select([["", "السنة كاملة"], ...currentYearTerms.map((t) => [t.id, t.name])],
    { value: academic.current?.term_id ?? "" });
  const termQuery = () => (termPicker.value ? `?term_id=${termPicker.value}` : "");
  const classPicker = select([["", "اختر الصف"], ...classes.map((c) => [c.id, c.name])]);
  // الطالب يُختار بعد الصف: تُحمّل أسماء طلاب الصف المختار فقط
  const studentClass = select([["", "اختر الصف أولًا"], ...classes.map((c) => [c.id, c.name])]);
  const studentPicker = select([["", "اختر الطالب"]]);
  studentClass.addEventListener("change", async () => {
    mount(studentPicker, h("option", { value: "" }, studentClass.value ? "جارٍ التحميل…" : "اختر الطالب"));
    if (!studentClass.value) return;
    const list = await api(`${A}/students?class_id=${studentClass.value}&fields=basic&limit=500`);
    mount(studentPicker, h("option", { value: "" }, "اختر الطالب"), list.map((s) => h("option", { value: s.id }, s.name)));
  });
  const out = h("div");
  const msg = h("div");

  const show = async (loader) => {
    mount(msg); mount(out, empty("جارٍ التجهيز…"));
    try {
      const cards = await loader();
      mount(out, cards.length
        ? [h("div", { class: "toolbar" }, btn("طباعة / حفظ PDF", () => window.print())), cards.map((c) => reportCard(c, me))]
        : empty("لا توجد درجات منشورة."));
    } catch (e) { mount(out, null); mount(msg, notice(e.message, "err")); }
  };

  return [
    panel("كشف الدرجات", null,
      sub("من الاختبارات المنشورة فقط. للحفظ PDF: اضغط طباعة ثم «حفظ كـ PDF»."),
      field("الفصل الدراسي", termPicker),
      h("div", { class: "row" },
        field("صف الطالب", studentClass), field("طالب واحد", studentPicker),
        btn("عرض", () => studentPicker.value && show(async () => [await api(`${A}/reports/report-card/${studentPicker.value}${termQuery()}`)]), "soft")),
      h("div", { class: "row" },
        field("صف كامل", classPicker),
        btn("عرض الصف", () => classPicker.value && show(() => api(`${A}/reports/report-cards?class_id=${classPicker.value}${termQuery().replace("?", "&")}`)), "soft")),
      msg),
    out,
  ];
}

function reportCard(c, me) {
  return h("article", { class: "report" },
    h("header", {},
      h("div", {}, h("h2", {}, c.school), sub("كشف درجات")),
      brandLogo("print-logo", false)),
    h("div", { class: "meta" },
      h("div", {}, h("b", {}, "الطالب: "), c.student.name),
      h("div", {}, h("b", {}, "الصف: "), c.student.class_name || "—"),
      h("div", {}, h("b", {}, "ولي الأمر: "), c.student.guardian_name || "—"),
      h("div", {}, h("b", {}, "تاريخ الإصدار: "), fmtDate(c.issued_at.slice(0, 10))),
      c.rank ? h("div", {}, h("b", {}, "الترتيب في الصف: "), `${c.rank.position} من ${c.rank.of}`) : null),

    c.subjects.length ? h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, h("th", {}, "المادة"), h("th", {}, "الدرجة"), h("th", {}, "من"), h("th", {}, "النسبة"), h("th", {}, "التقدير"), h("th", {}, "الاختبارات"))),
      h("tbody", {}, c.subjects.map((s) => h("tr", {},
        h("td", {}, s.subject), h("td", {}, s.score), h("td", {}, s.max),
        h("td", {}, s.percent === null ? "—" : `${s.percent}%`), h("td", {}, s.grade),
        h("td", { class: "small muted" }, s.exams.map((e) => `${e.title}: ${e.score}/${e.max}`).join(" — "))))))
      : empty("لا توجد درجات منشورة لهذا الطالب."),

    h("div", { class: "total" },
      h("div", {}, h("b", {}, `${c.summary.total} / ${c.summary.max}`), "المجموع"),
      h("div", {}, h("b", {}, c.summary.percent === null ? "—" : `${c.summary.percent}%`), "النسبة"),
      h("div", {}, h("b", {}, c.summary.grade), "التقدير العام"),
      h("div", {}, h("b", {}, c.attendance.absent), "أيام الغياب"),
      h("div", {}, h("b", {}, c.attendance.rate === null ? "—" : `${c.attendance.rate}%`), "نسبة الحضور")),

    h("div", { class: "sign" }, h("span", {}, "توقيع ولي الأمر: ......................"), h("span", {}, `مدير المدرسة: ${me?.name || "......................"}`)));
}
