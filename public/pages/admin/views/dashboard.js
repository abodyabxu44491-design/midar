// الرئيسية: الملخص، التنبيهات، والبحث السريع
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { stats, panel, notice, line, keyText, sub, input, empty, badge, btn } from "../../shared/js/ui.js";
import { money, fmtDate } from "../../shared/js/format.js";
import { waButton, messageVars } from "../../shared/js/whatsapp.js";
import { A, directoryLink, staffLink, optional } from "./common.js";

export default async function dashboard({ me, goTo }) {
  const [d, alerts, notifications, templates] = await Promise.all([
    api(`${A}/dashboard`),
    optional(api(`${A}/analytics/alerts`), { counts: {}, absentees: [], overdue: [] }),
    optional(api(`${A}/analytics/notifications`), { items: [], counts: {} }),
    optional(api(`${A}/messaging/templates`), null)]);
  const canMessage = Boolean(templates);
  const c = alerts.counts;

  const LEVELS = {
    urgent: { name: "عاجل", dot: "🔴", cls: "bad" },
    action: { name: "يحتاج إجراء", dot: "🟠", cls: "warn" },
    info: { name: "معلومات", dot: "🟢", cls: "" },
  };

  // مركز التنبيهات: مرتبة بالأهمية، والضغط ينقلك للقسم
  const center = (data, goTo) => {
    if (!data.items.length) return null;
    return panel("مركز التنبيهات", null,
      ["urgent", "action", "info"].map((level) => {
        const rows = data.items.filter((x) => x.level === level);
        if (!rows.length) return null;
        return h("div", { class: "notif-group" },
          h("h3", { class: "sec-title" }, `${LEVELS[level].dot} ${LEVELS[level].name}`),
          rows.map((x) => h("button", { class: `notif ${LEVELS[level].cls}`, type: "button",
            onclick: () => goTo(x.tab) },
            h("span", { class: "notif-count" }, x.count),
            h("span", { class: "notif-text" }, h("b", {}, x.text), x.hint ? sub(x.hint) : null))));
      }));
  };

  return [
    d.academic ? notice(`السنة الدراسية: ${d.academic.year_name} — الفصل الحالي: ${d.academic.term_name || "غير محدد"}`, "") : null,

    stats([
      ["طالب", d.students, `حد الباقة ${me.school.max_students}`], ["معلم", d.teachers], ["فصل", d.classes],
      ["غائب اليوم", d.absent_today, d.recorded_today ? `سُجل ${d.recorded_today} طالب` : "لم يُسجل الحضور بعد"],
      ["رسوم غير محصّلة", money(d.fees_remaining), `المحصّل ${money(d.fees_paid)}`],
    ]),

    center(notifications, goTo || (() => {})),

    quickSearch(),

    alerts.absentees.length ? panel("غياب متكرر (آخر 30 يومًا)", null,
      alerts.absentees.map((s) => line(
        h("div", {}, h("b", {}, s.name), sub(`${s.class_name || "—"} — ${s.absences} أيام غياب`)),
        canMessage ? waButton({ phone: s.guardian_phone, template: templates.absence, countryCode: templates.country_code,
          vars: messageVars({ student: s, school: me.school.name }), label: "تنبيه ولي الأمر" }) : null))) : null,

    alerts.overdue.length ? panel("فواتير متأخرة", null,
      alerts.overdue.map((i) => line(
        h("div", {}, h("b", {}, `${i.student_name} — ${money(i.remaining)}`),
          sub(`${i.title} — استحقت ${fmtDate(i.due_date)}${i.class_name ? ` — ${i.class_name}` : ""}`)),
        canMessage ? waButton({ phone: i.guardian_phone, template: templates.fees, countryCode: templates.country_code,
          vars: messageVars({ student: { name: i.student_name, class_name: i.class_name }, school: me.school.name,
            fees: { remaining: i.remaining }, link: directoryLink(me) }), label: "تذكير واتساب" }) : null))) : null,

    panel("روابط مدرستك", null,
      line(h("span", {}, "صفحة الطلاب وأولياء الأمور"), keyText(directoryLink(me))),
      line(h("span", {}, "رمز فتح صفحة الطلاب"), keyText(me.school.directory_code)),
      line(h("span", {}, "دخول المدير والمعلمين"), keyText(staffLink(me))),
      sub("وزّع الرابط والرمز على الأهالي، ومعرّف كل طالب من تبويب الطلاب.")),
  ];
}

// بحث سريع في الطلاب والمعلمين والفواتير
function quickSearch() {
  const box = h("div");
  const q = input({ type: "search", placeholder: "ابحث عن طالب أو معلم أو فاتورة أو معرّف طالب" });
  let timer;
  const run = async () => {
    const term = q.value.trim();
    if (term.length < 2) return mount(box);
    mount(box, empty("جارٍ البحث…"));
    try {
      const r = await api(`${A}/analytics/search?q=${encodeURIComponent(term)}`);
      const rows = [
        ...r.students.map((s) => ({ kind: "طالب", main: s.name, note: `${s.class_name || "بدون فصل"}${s.archived_at ? " — مؤرشف" : ""}`, key: s.access_key })),
        ...r.teachers.map((t) => ({ kind: "معلم", main: t.name, note: t.username ? `اسم المستخدم: ${t.username}` : "" })),
        ...r.invoices.map((i) => ({ kind: "فاتورة", main: `${i.student_name} — ${money(i.amount)}`, note: `${i.title} — المدفوع ${money(i.paid)}` })),
      ];
      mount(box, rows.length ? rows.map((x) => h("div", { class: "search-result" },
        h("div", { class: "pill" }, badge(x.kind, "gray"), h("b", {}, x.main)),
        x.note ? sub(x.note) : null,
        x.key ? h("div", { class: "sub pill" }, "المعرّف: ", keyText(x.key)) : null)) : empty("لا توجد نتائج."));
    } catch (e) { mount(box, notice(e.message, "err")); }
  };
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  return panel("بحث سريع", null, q, box);
}
