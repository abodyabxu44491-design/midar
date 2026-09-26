// السنة الدراسية والفصول الدراسية، وبدء سنة جديدة
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, dialog, notice, confirmAction, stats } from "../../shared/js/ui.js";
import { fmtDate } from "../../shared/js/format.js";
import { A, loadClasses, classOptions } from "./common.js";

const OUTCOME = { passed: ["ناجح", ""], failed: ["راسب", "red"], incomplete: ["غير مكتمل", "amber"] };
const ACTIONS = [["promote", "ترفيع للصف التالي"], ["repeat", "إعادة السنة"], ["graduate", "تخرّج"],
  ["transfer", "نقل لمدرسة أخرى"], ["withdraw", "انسحاب"]];

export default async function academic({ refresh }) {
  const [data, classes] = await Promise.all([api(`${A}/academic`), loadClasses()]);
  const { current, years, terms } = data;
  const currentYearTerms = terms.filter((t) => t.year_id === current?.year_id);

  return [
    stats([
      ["السنة الحالية", current?.year_name || "—", current ? `${fmtDate(current.year_start)} إلى ${fmtDate(current.year_end)}` : "لم تُنشأ بعد"],
      ["الفصل الحالي", current?.term_name || "—", current?.term_start ? `${fmtDate(current.term_start)} إلى ${fmtDate(current.term_end)}` : ""],
      ["عدد فصول السنة", currentYearTerms.length],
      ["السنوات المؤرشفة", years.filter((y) => y.status === "archived").length],
    ]),


    panel("فصول السنة الحالية", null,
      currentYearTerms.length ? currentYearTerms.map((t) => line(
        h("div", {}, h("b", {}, t.name), " ", t.is_current ? badge("الفصل الحالي") : null,
          sub(`${fmtDate(t.start_date)} إلى ${fmtDate(t.end_date)}`)),
        h("div", { class: "row", style: "flex:none" },
          t.is_current ? null : btn("اجعله الحالي", async () => {
            await api(`${A}/academic/terms/${t.id}/current`, {});
            toast(`الفصل الحالي الآن: ${t.name}`); refresh();
          }, "soft sm"),
          btn("تعديل التواريخ", () => editTerm(t, refresh), "ghost sm"))))
        : empty("لا توجد فصول. أنشئ سنة دراسية أولًا."),
      sub("الجديد يُسجَّل في الفصل الحالي، والقديم يبقى في فصله.")),

    passMarkPanel(current, years, refresh),

    panel("السنوات الدراسية", btn("بدء سنة دراسية جديدة", () => startYear(classes, current, refresh), "sm"),
      years.map((y) => line(
        h("div", { class: y.is_current ? "" : "muted-row" },
          h("b", {}, y.name), " ", y.is_current ? badge("الحالية") : badge("مؤرشفة", "gray"),
          sub(`${fmtDate(y.start_date)} إلى ${fmtDate(y.end_date)}${y.archived_students ? ` — ${y.archived_students} طالب في سجلها` : ""}`)))),
      sub("يحفظ سجل السنة المنتهية، ثم ينقل الطلاب.")),
  ];
}

// درجة النجاح المعتمدة للسنة الحالية
function passMarkPanel(current, years, refresh) {
  const year = years.find((y) => y.is_current);
  if (!year) return null;
  const mark = input({ type: "number", min: 0, max: 100, step: "0.5", value: year.pass_mark });
  return panel("درجة النجاح", null,
    sub("يُعتبر الطالب ناجحًا عند بلوغها."),
    h("div", { class: "row" }, field("النسبة المئوية", mark),
      btn("حفظ", async () => {
        await api(`${A}/academic/years/${year.id}/pass-mark`, { pass_mark: mark.value }, "PATCH");
        toast("تم حفظ درجة النجاح"); refresh();
      }, "soft")));
}

function editTerm(t, refresh) {
  const name = input({ value: t.name });
  const start = input({ type: "date", value: t.start_date });
  const end = input({ type: "date", value: t.end_date });
  const d = dialog(`تعديل ${t.name}`, h("div", {}, field("الاسم", name), field("من", start), field("إلى", end)),
    [btn("حفظ", async () => {
      await api(`${A}/academic/terms/${t.id}`, { name: name.value, start_date: start.value, end_date: end.value }, "PATCH");
      d.close(); toast("تم الحفظ"); refresh();
    })]);
}

// معالج بدء السنة: بيانات السنة، خريطة الصفوف، ثم مراجعة نتيجة كل طالب
function startYear(classes, current, refresh) {
  const nextName = current?.year_name?.includes("/")
    ? current.year_name.split("/").map((n) => Number(n) + 1).join("/") : "";
  const name = input({ value: nextName, placeholder: "اسم السنة" });
  const start = input({ type: "date", value: current ? addYear(current.year_end) : "" });
  const end = input({ type: "date", value: current ? addYear(current.year_end, 366) : "" });
  const count = select([[2, "فصلان"], [3, "ثلاثة فصول"]], { value: 2 });

  // خريطة الصفوف: إلى أي صف يُرفَّع كل صف
  const rows = classes.map((c) => {
    const action = select([["promote", "ترفيع إلى صف"], ["graduate", "تخرّج طلابه"], ["repeat", "إعادة الجميع"]]);
    const to = select(classOptions(classes, "اختر الصف"));
    const toWrap = h("div", { style: "flex:1;min-width:150px" }, to);
    action.addEventListener("change", () => toWrap.classList.toggle("hidden", action.value !== "promote"));
    return { c, action, to, el: h("div", { class: "row", style: "align-items:center" },
      h("div", { style: "flex:1;min-width:120px" }, h("b", {}, c.name), sub(`${c.students ?? 0} طالب`)), action, toWrap) };
  });
  const moves = () => rows.map((x) => ({
    from_class_id: x.c.id, action: x.action.value,
    to_class_id: x.action.value === "promote" ? x.to.value || null : null,
  }));

  const review = h("div");
  const msg = h("div");
  let overrides = new Map();

  const loadReview = async () => {
    mount(review, empty("جارٍ حساب النتائج…"));
    try {
      const data = await api(`${A}/academic/promotion-preview`, { moves: moves() });
      if (!data.students.length) return mount(review, empty("لا يوجد طلاب على رأس القيد."));
      const counts = data.students.reduce((a, s) => ({ ...a, [s.outcome]: (a[s.outcome] || 0) + 1 }), {});
      overrides = new Map();
      mount(review,
        notice(`درجة النجاح ${data.year.pass_mark}% — ناجح ${counts.passed || 0}، راسب ${counts.failed || 0}، غير مكتمل ${counts.incomplete || 0}. الراسب يُعاد تلقائيًا، ويمكنك تعديل أي طالب.`, ""),
        data.students.map((st) => {
          const action = select(ACTIONS, { value: st.suggested_action });
          action.addEventListener("change", () => overrides.set(st.id, { student_id: st.id, action: action.value, to_class_id: st.to_class_id }));
          return line(
            h("div", {}, h("b", {}, st.name), " ", badge(...OUTCOME[st.outcome]),
              sub(`${st.class_name || "بدون فصل"} — المعدل ${st.average === null ? "—" : `${st.average}%`} — الحضور ${st.attendance_rate === null ? "—" : `${st.attendance_rate}%`}`)),
            h("div", { style: "flex:none;min-width:190px" }, action));
        }));
    } catch (e) { mount(review, notice(e.message, "err")); }
  };
  for (const r of rows) r.action.addEventListener("change", loadReview);
  for (const r of rows) r.to.addEventListener("change", loadReview);

  const d = dialog("بدء سنة دراسية جديدة", h("div", {},
    notice("تُحفظ نتيجة كل طالب ومعدله وحضوره، ثم يُنفَّذ الإجراء. لا يُحذف شيء.", "warn"),
    field("اسم السنة الجديدة", name),
    h("div", { class: "row" }, field("تبدأ في", start), field("تنتهي في", end)),
    field("عدد الفصول الدراسية", count),
    h("h3", { class: "sec-title" }, "ترفيع الصفوف"),
    classes.length ? rows.map((r) => r.el) : empty("لا توجد صفوف."),
    h("h3", { class: "sec-title" }, "مراجعة نتائج الطلاب"),
    review, msg),
  [btn("تنفيذ بدء السنة", async () => {
    if (!confirmAction("تأكيد بدء السنة الجديدة؟ سيُنفَّذ الإجراء المحدد لكل طالب.")) return;
    mount(msg);
    try {
      const r = await api(`${A}/academic/start-year`, {
        year: { name: name.value, start_date: start.value, end_date: end.value, terms: Number(count.value), make_current: true },
        moves: moves(),
        overrides: [...overrides.values()],
        repeat_failed: true,
        expected_year_id: current?.year_id ?? null,
      });
      d.close();
      toast(`تمت السنة الجديدة: رُفّع ${r.promoted}، أعاد ${r.repeated}، تخرّج ${r.graduated}, نُقل ${r.transferred}, انسحب ${r.withdrawn}`);
      refresh();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  })]);
  loadReview();
}

function addYear(dateStr, days = 1) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
