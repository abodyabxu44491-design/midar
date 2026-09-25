// التحليلات: أرقام وأداء ومؤشرات تُحسب آليًا
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, empty, line, sub, stats, badge } from "../../shared/js/ui.js";
import { barChart, percentRow } from "../../shared/js/charts.js";
import { money } from "../../shared/js/format.js";
import { A } from "./common.js";

const monthName = (ym) => new Date(`${ym}-15`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { month: "short", year: "2-digit" });

export default async function analytics() {
  // بيانات السنة والتحليلات تُطلب معًا (الفصل الحالي يحدده الخادم)
  const firstData = api(`${A}/analytics?months=6&term_id=current`);
  const academic = await api(`${A}/academic`);
  let first = true;
  const termsOfYear = academic.terms.filter((t) => t.year_id === academic.current?.year_id);
  const term = select([["", "السنة كاملة"], ...termsOfYear.map((t) => [t.id, t.name])], { value: academic.current?.term_id ?? "" });
  const months = select([[3, "آخر 3 أشهر"], [6, "آخر 6 أشهر"], [12, "آخر سنة"]], { value: 6 });
  const box = h("div");

  const load = async () => {
    mount(box, empty("جارٍ الحساب…"));
    const useFirst = first && String(months.value) === "6" && String(term.value) === String(academic.current?.term_id ?? "");
    first = false;
    const d = useFirst ? await firstData : await api(`${A}/analytics?months=${months.value}${term.value ? `&term_id=${term.value}` : ""}`);
    mount(box,
      stats([
        ["نسبة الحضور", d.attendance_by_month.length ? `${avg(d.attendance_by_month.map((m) => m.rate))}%` : "—", `آخر ${d.months} أشهر`],
        ["متوسط الدرجات", d.grades_by_class.length ? `${avg(d.grades_by_class.map((c) => c.average))}%` : "—", "الاختبارات المنشورة"],
        ["المحصّل من الرسوم", money(d.fees.collected), `المتبقي ${money(d.fees.remaining)}`],
      ]),

      panel("نسبة الحضور شهريًا", null,
        barChart(d.attendance_by_month.map((m) => ({ label: monthName(m.month), value: m.rate ?? 0 })), { max: 100, suffix: "%" }),
        sub("الحاضرون والمتأخرون من إجمالي السجلات.")),

      panel("الغياب شهريًا", null,
        barChart(d.attendance_by_month.map((m) => ({ label: monthName(m.month), value: m.absent, color: "var(--red)" })))),

      panel("الحضور حسب الصف", null,
        d.attendance_by_class.length
          ? d.attendance_by_class.map((c) => percentRow(c.class_name, c.rate, `${c.records} سجل`))
          : empty("لا توجد سجلات حضور.")),

      panel("متوسط الدرجات حسب الصف", null,
        d.grades_by_class.length
          ? d.grades_by_class.map((c) => percentRow(c.class_name, Number(c.average), `${c.students} طالب`))
          : empty("لا توجد درجات منشورة.")),

      panel("متوسط الدرجات حسب المادة", null,
        d.grades_by_subject.length
          ? barChart(d.grades_by_subject.map((s) => ({ label: s.subject, value: Number(s.average) ?? 0 })), { max: 100, suffix: "%" })
          : empty("لا توجد درجات منشورة.")),

      panel("الأوائل", null,
        d.top_students.length ? d.top_students.map((s, i) => line(
          h("div", {}, h("b", {}, `${i + 1}. ${s.name}`), sub(s.class_name || "—")),
          badge(`${s.average}%`))) : empty("لا توجد درجات كافية.")),

      panel("طلاب يحتاجون متابعة", null,
        d.needs_attention.length ? d.needs_attention.map((s) => line(
          h("div", {}, h("b", {}, s.name), sub(s.class_name || "—")),
          badge(`${s.average}%`, "red"))) : empty("لا يوجد طالب تحت 60%.")),

      panel("التحصيل المالي شهريًا", null,
        barChart(d.fees_by_month.map((m) => ({ label: monthName(m.month), value: Math.round(Number(m.collected)), color: "var(--navy)" })))),
    );
  };
  term.addEventListener("change", load);
  months.addEventListener("change", load);
  await load();

  return [
    panel("نطاق التحليل", null, h("div", { class: "row" }, field("الفصل الدراسي", term), field("المدة", months))),
    box,
  ];
}

const avg = (arr) => {
  const v = arr.map(Number).filter((x) => !Number.isNaN(x));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : "—";
};
