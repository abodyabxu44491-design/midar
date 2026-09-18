// السنة الدراسية والفصول الدراسية، وبدء سنة جديدة
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, dialog, notice, confirmAction, stats } from "/shared/js/ui.js";
import { fmtDate } from "/shared/js/format.js";
import { A, loadClasses, classOptions } from "./common.js";

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

    notice("الاختبارات والفواتير والواجبات تُربط تلقائيًا بالفصل الحالي، وكشوف الدرجات تُحسب لكل فصل على حدة.", ""),

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
      sub("تغيير الفصل الحالي يحدد أين تُسجَّل الاختبارات والفواتير الجديدة. البيانات القديمة تبقى في فصلها.")),

    panel("السنوات الدراسية", btn("بدء سنة دراسية جديدة", () => startYear(classes, current, refresh), "sm"),
      years.map((y) => line(
        h("div", { class: y.is_current ? "" : "muted-row" },
          h("b", {}, y.name), " ", y.is_current ? badge("الحالية") : badge("مؤرشفة", "gray"),
          sub(`${fmtDate(y.start_date)} إلى ${fmtDate(y.end_date)}${y.archived_students ? ` — ${y.archived_students} طالب في سجلها` : ""}`)))),
      sub("«بدء سنة جديدة» يحفظ سجل كل طالب في السنة المنتهية، ثم ينقل الطلاب للصفوف التالية.")),
  ];
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

// معالج بدء السنة: بيانات السنة + خريطة نقل الصفوف
function startYear(classes, current, refresh) {
  const nextName = current?.year_name?.includes("/")
    ? current.year_name.split("/").map((n) => Number(n) + 1).join("/") : "";
  const name = input({ value: nextName, placeholder: "مثال: 2027/2028" });
  const start = input({ type: "date", value: current ? addYear(current.year_end) : "" });
  const end = input({ type: "date", value: current ? addYear(current.year_end, 366) : "" });
  const count = select([[2, "فصلان"], [3, "ثلاثة فصول"]], { value: 2 });
  const archive = input({ type: "checkbox", checked: true });

  // لكل صف: ماذا يحدث لطلابه
  const rows = classes.map((c) => {
    const action = select([["promote", "ترفيع إلى صف"], ["stay", "بقاء في نفس الصف"], ["graduate", "تخرّج"]]);
    const to = select(classOptions(classes, "اختر الصف"));
    const toWrap = h("div", { style: "flex:1;min-width:150px" }, to);
    action.addEventListener("change", () => { toWrap.classList.toggle("hidden", action.value !== "promote"); });
    return { c, action, to, el: h("div", { class: "row", style: "align-items:center" },
      h("div", { style: "flex:1;min-width:120px" }, h("b", {}, c.name), sub(`${c.students ?? 0} طالب`)), action, toWrap) };
  });

  const msg = h("div");
  const d = dialog("بدء سنة دراسية جديدة", h("div", {},
    notice("كل شيء يتم في خطوة واحدة: حفظ سجل السنة المنتهية، ونقل الطلاب، وإنشاء السنة وفصولها. لا تُحذف أي درجة أو فاتورة قديمة.", "warn"),
    field("اسم السنة الجديدة", name),
    h("div", { class: "row" }, field("تبدأ في", start), field("تنتهي في", end)),
    field("عدد الفصول الدراسية", count),
    h("h3", { class: "sec-title" }, "نقل الطلاب"),
    classes.length ? rows.map((r) => r.el) : empty("لا توجد صفوف."),
    h("label", { class: "f pill" }, archive, "أرشفة الطلاب المتخرجين (تبقى سجلاتهم محفوظة)"),
    msg),
  [btn("تنفيذ بدء السنة", async () => {
    if (!confirmAction("تأكيد بدء السنة الجديدة؟ لا يمكن التراجع عن نقل الطلاب إلا يدويًا.")) return;
    mount(msg);
    try {
      const r = await api(`${A}/academic/start-year`, {
        year: { name: name.value, start_date: start.value, end_date: end.value, terms: Number(count.value), make_current: true },
        moves: rows.map((x) => ({ from_class_id: x.c.id, action: x.action.value, to_class_id: x.action.value === "promote" ? x.to.value || null : null })),
        archive_graduates: archive.checked,
      });
      d.close();
      toast(`تمت السنة الجديدة: رُفّع ${r.promoted}، بقي ${r.stayed}، تخرّج ${r.graduated}`);
      refresh();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  })]);
}

function addYear(dateStr, days = 1) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
