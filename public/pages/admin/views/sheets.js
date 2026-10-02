// أوراق للطباعة: بطاقات معرّفات الطلاب، وسجل الحضور الشهري
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, input, btn, empty, sub, notice, docLogo, sectionMenu } from "../../shared/js/ui.js";
import { ATTENDANCE, fmtDate } from "../../shared/js/format.js";
import { A, loadClasses } from "./common.js";
import { cardWithActions } from "../../shared/js/parent-card.js";

const monthNow = () => new Date().toISOString().slice(0, 7);

export default function sheets(ctx) {
  return sectionMenu({
    title: "أوراق للطباعة",
    items: [
      { key: "cards", name: "بطاقات ولي الأمر", note: "بطاقة لكل طالب: تُطبع أو تُرسل وحدها بالواتساب" },
      { key: "attendance", name: "سجل الحضور الشهري", note: "جدول الشهر كاملًا لكل صف" },
    ],
    render: (key) => (key === "cards" ? cardsView(ctx) : attendanceView(ctx)),
  });
}

/* ---------- بطاقات ولي الأمر ---------- */
async function cardsView() {
  const classes = await loadClasses();
  const pick = select([["", "كل الفصول"], ...classes.map((c) => [c.id, c.name])]);
  const out = h("div");

  const load = async () => {
    mount(out, empty("جارٍ التجهيز…"));
    const d = await api(`${A}/sheets/cards${pick.value ? `?class_id=${pick.value}` : ""}`);
    if (!d.students.length) return mount(out, empty("لا يوجد طلاب في هذا الفصل."));
    mount(out,
      h("div", { class: "toolbar no-print" }, btn("طباعة كل البطاقات", () => window.print()), sub(`${d.students.length} بطاقة — أرسل كل بطاقة لولي أمرها من الأزرار تحتها`)),
      h("div", { class: "pc-sheet" }, d.students.map((s) => cardWithActions(d, s))));
  };
  pick.addEventListener("change", load);
  await load();

  return [panel("بطاقات ولي الأمر", null,
    sub("بطاقة لكل طالب فيها اسمه وصفه وولي أمره ومعرّفه ورمز QR يفتح ملفه مباشرة. اطبعها كلها، أو أرسل كل بطاقة وحدها بالواتساب أو كصورة."),
    field("الفصل", pick)), out];
}

/* ---------- سجل الحضور الشهري ---------- */
async function attendanceView() {
  const classes = await loadClasses();
  if (!classes.length) return panel("سجل الحضور الشهري", null, empty("أضف الفصول أولًا."));
  const pick = select(classes.map((c) => [c.id, c.name]));
  const month = input({ type: "month", value: monthNow() });
  const out = h("div");

  const SIGN = { present: "✓", absent: "غ", late: "ت", excused: "ع" };

  const load = async () => {
    mount(out, empty("جارٍ التجهيز…"));
    try {
      const d = await api(`${A}/sheets/attendance-month?class_id=${pick.value}&month=${month.value}`);
      const days = Array.from({ length: d.days }, (_, i) => i + 1);
      mount(out,
        h("div", { class: "toolbar" }, btn("طباعة السجل", () => window.print())),
        h("article", { class: "report wide" },
          h("header", {}, h("div", {}, h("h2", {}, d.school),
            sub(`سجل الحضور — ${d.class_name} — ${fmtDate(`${d.month}-01`).replace(/^\d+\s/, "")}`)), docLogo("print-logo")),
          h("div", { class: "scroll" }, h("table", { class: "grid month-sheet" },
            h("thead", {}, h("tr", {}, h("th", {}, "الطالب"), days.map((n) => h("th", {}, n)),
              h("th", {}, "حاضر"), h("th", {}, "غائب"), h("th", {}, "متأخر"), h("th", {}, "بعذر"), h("th", {}, "النسبة"))),
            h("tbody", {}, d.students.map((s) => h("tr", {},
              h("th", {}, s.name),
              days.map((n) => h("td", { class: s.days[n] ? `mark-${s.days[n]}` : "" }, s.days[n] ? SIGN[s.days[n]] : "")),
              h("td", {}, s.present), h("td", {}, s.absent), h("td", {}, s.late), h("td", {}, s.excused),
              h("td", {}, s.rate === null ? "—" : `${s.rate}%`))))),
          ),
          h("div", { class: "sign" }, h("span", {}, "المعلم: ......................"), h("span", {}, "مدير المدرسة: ......................"))),
        sub(`الرموز: ✓ حاضر — غ غائب — ت متأخر — ع بعذر`));
    } catch (e) { mount(out, notice(e.message, "err")); }
  };
  pick.addEventListener("change", load);
  month.addEventListener("change", load);
  await load();

  return [panel("اختر الفصل والشهر", null, h("div", { class: "row" }, field("الفصل", pick), field("الشهر", month))), out];
}
