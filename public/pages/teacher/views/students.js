// طلابي: طلاب كل فصل مسند للمعلم مع حالة اليوم وملخص الغياب والتأخر في السنة الحالية.
// بدون اتصال: الأسماء وحالة اليوم من نسخة الجهاز.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, input, btn, empty, notice, sub } from "../../shared/js/ui.js";
import { ATTENDANCE, today } from "../../shared/js/format.js";
import { myClasses } from "./home.js";
import { attendanceSource } from "../offline.js";
import { alertDialog, alertCard } from "../../shared/js/student-alerts.js";
import { dialog, toast } from "../../shared/js/ui.js";

let remembered = null;   // يبقى الفصل المختار عند التنقل بين الصفحات

export default function students({ me, params, goTo }) {
  const classes = myClasses(me);
  if (!classes.length) return panel("طلابي", null, empty("لم تُسند لك فصول بعد. تواصل مع إدارة المدرسة."));
  let classId = String(params?.classId ?? remembered ?? classes[0].id);
  if (!classes.some((c) => String(c.id) === classId)) classId = String(classes[0].id);

  const chips = h("div", { class: "xb-chips", role: "tablist" });
  const search = input({ type: "search", placeholder: "بحث باسم الطالب أو رقمه", "aria-label": "بحث" });
  const head = h("div", { class: "stu-head" });
  const list = h("div", { class: "stu-list" });
  let rows = [], offline = false;

  const subjectsOf = (id) => me.load.filter((l) => String(l.class_id) === String(id)).map((l) => l.subject_name);
  const paintChips = () => mount(chips, classes.map((c) => h("button", {
    type: "button", role: "tab", "aria-selected": String(String(c.id) === classId), class: `xb-chip${String(c.id) === classId ? " on" : ""}`,
    onclick: () => { classId = String(c.id); remembered = classId; paintChips(); load(); },
  }, c.name)));

  const paint = () => {
    const term = search.value.trim();
    const shown = rows.filter((r) => !term || r.name.includes(term) || String(r.student_no || "").includes(term));
    const marked = rows.filter((r) => r.today).length;
    const absent = rows.filter((r) => r.today === "absent").length;
    mount(head,
      h("div", {}, h("b", {}, classes.find((c) => String(c.id) === classId)?.name), sub(`${subjectsOf(classId).join("، ")} · ${rows.length} طالب`)),
      h("div", { class: "row", style: "flex:none;gap:6px" },
        me.modules?.attendance ? btn(marked ? `الحضور اليوم (${marked}/${rows.length})` : "تسجيل حضور اليوم",
          () => goTo("attendance", { classId }), marked === rows.length && rows.length ? "soft sm" : "sm") : null));
    mount(list,
      marked && absent ? notice(`غائبون اليوم: ${rows.filter((r) => r.today === "absent").map((r) => r.name).join("، ")}`, "warn") : null,
      shown.length ? shown.map((r, i) => h("div", { class: "stu-row" },
        h("span", { class: "att-no" }, i + 1),
        h("div", { class: "stu-main" }, h("b", {}, r.name),
          h("small", {}, [r.student_no ? `رقم ${r.student_no}` : null, offline ? null : r.days ? `سُجّل ${r.days} يومًا` : "لا حضور مسجّل بعد"].filter(Boolean).join(" · "))),
        offline ? null : h("div", { class: "stu-stats" },
          r.absent ? h("span", { class: "att-count s-absent", title: "أيام الغياب" }, h("b", {}, r.absent), "غياب") : null,
          r.late ? h("span", { class: "att-count s-late", title: "مرات التأخر" }, h("b", {}, r.late), "تأخر") : null,
          r.excused ? h("span", { class: "att-count s-excused" }, h("b", {}, r.excused), "بعذر") : null),
        h("span", { class: `stu-today${r.today ? ` s-${r.today}` : ""}` }, r.today ? ATTENDANCE[r.today][0] : "لم يُسجّل"),
        offline ? null : h("div", { class: "stu-acts" },
          btn(r.alerts ? `التنبيهات (${r.alerts})` : "تنبيه", () => alertsOf(r), "ghost sm"))))
        : empty(rows.length ? "لا يوجد طالب بهذا الاسم." : "لا يوجد طلاب في هذا الفصل."));
  };
  search.addEventListener("input", paint);

  // تنبيهات الطالب: يرى المعلم كل التنبيهات ويضيف ويحذف ما كتبه
  async function alertsOf(r) {
    let list;
    try { list = await api(`/api/teacher/students/${r.id}/alerts`); } catch (e) { return toast(e.message, true); }
    const add = () => { d.close(); alertDialog(r.name, async (b) => { await api(`/api/teacher/students/${r.id}/alerts`, b); r.alerts = (r.alerts || 0) + 1; paint(); }); };
    const d = dialog(`تنبيهات: ${r.name}`, h("div", { class: "sa-list" },
      list.length ? list.map((a) => alertCard(a, { staff: true })) : empty("لا توجد تنبيهات لهذا الطالب."),
      sub("التنبيه الظاهر لولي الأمر يصل لملف الطالب فورًا، ويظهر لك إن اطّلع عليه.")),
    [btn("+ تنبيه جديد", add)]);
  }

  async function load() {
    mount(list, empty("جارٍ التحميل…"));
    try {
      rows = await api(`/api/teacher/students?class_id=${classId}`); offline = false;
    } catch (e) {
      if (e.code !== "network" && e.code !== "timeout") return mount(list, notice(e.message, "err"));
      try {
        rows = (await attendanceSource.list(classId, today())).map((r) => ({ ...r, today: r.status }));
        offline = true;
      } catch (e2) { return mount(list, notice(e2.message, "err")); }
    }
    paint();
  }

  paintChips(); load();
  return panel("طلابي", null,
    classes.length > 1 ? chips : null, head,
    h("div", { class: "search-row" }, search),
    list,
    sub("الغياب والتأخر محسوبان من بداية السنة الدراسية الحالية."));
}
