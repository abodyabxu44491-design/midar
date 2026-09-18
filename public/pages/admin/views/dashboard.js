// الرئيسية: الملخص، التنبيهات، والبحث السريع
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { stats, panel, notice, line, keyText, sub, input, empty, badge, btn } from "/shared/js/ui.js";
import { money, fmtDate } from "/shared/js/format.js";
import { waButton, messageVars } from "/shared/js/whatsapp.js";
import { A, directoryLink, staffLink } from "./common.js";

export default async function dashboard({ me }) {
  const [d, alerts, templates] = await Promise.all([
    api(`${A}/dashboard`), api(`${A}/analytics/alerts`), api(`${A}/messaging/templates`)]);
  const c = alerts.counts;

  const alert = (label, value, tone = "") => (value ? h("div", { class: `alert-card ${tone}` }, h("span", {}, label), h("b", {}, value)) : null);
  const cards = [
    alert("اختبارات تنتظر اعتمادك", c.pending_exams, "warn"),
    alert("تحويلات بانتظار التأكيد", c.pending_claims, "warn"),
    alert("طلبات تسجيل جديدة", c.new_admissions, "warn"),
    alert("فواتير تجاوزت موعد السداد", c.overdue_invoices, "bad"),
    alert("طلاب غابوا 3 أيام فأكثر", c.frequent_absentees, "bad"),
    alert("معلمون بدون إسناد", c.teachers_without_load),
    alert("صفوف بدون جدول", c.classes_without_timetable),
    alert("طلاب بدون فصل", c.students_without_class),
  ].filter(Boolean);

  return [
    d.academic ? notice(`السنة الدراسية: ${d.academic.year_name} — الفصل الحالي: ${d.academic.term_name || "غير محدد"}`, "") : null,

    stats([
      ["طالب", d.students, `حد الباقة ${me.school.max_students}`], ["معلم", d.teachers], ["فصل", d.classes],
      ["غائب اليوم", d.absent_today, d.recorded_today ? `سُجل ${d.recorded_today} طالب` : "لم يُسجل الحضور بعد"],
      ["رسوم غير محصّلة", money(d.fees_remaining), `المحصّل ${money(d.fees_paid)}`],
    ]),

    cards.length
      ? panel("يحتاج انتباهك", null, h("div", { class: "alert-grid" }, cards))
      : panel("يحتاج انتباهك", null, notice("لا يوجد شيء معلّق. كل شيء محدّث.", "")),

    quickSearch(),

    alerts.absentees.length ? panel("غياب متكرر (آخر 30 يومًا)", null,
      alerts.absentees.map((s) => line(
        h("div", {}, h("b", {}, s.name), sub(`${s.class_name || "—"} — ${s.absences} أيام غياب`)),
        waButton({ phone: s.guardian_phone, template: templates.absence, countryCode: templates.country_code,
          vars: messageVars({ student: s, school: me.school.name }), label: "تنبيه ولي الأمر" })))) : null,

    alerts.overdue.length ? panel("فواتير متأخرة", null,
      alerts.overdue.map((i) => line(
        h("div", {}, h("b", {}, `${i.student_name} — ${money(i.remaining)}`),
          sub(`${i.title} — استحقت ${fmtDate(i.due_date)}${i.class_name ? ` — ${i.class_name}` : ""}`)),
        waButton({ phone: i.guardian_phone, template: templates.fees, countryCode: templates.country_code,
          vars: messageVars({ student: { name: i.student_name, class_name: i.class_name }, school: me.school.name,
            fees: { remaining: i.remaining }, link: directoryLink(me) }), label: "تذكير واتساب" })))) : null,

    panel("روابط مدرستك", null,
      line(h("span", {}, "صفحة الطلاب وأولياء الأمور"), keyText(directoryLink(me))),
      line(h("span", {}, "رمز فتح صفحة الطلاب"), keyText(me.school.directory_code)),
      line(h("span", {}, "دخول المدير والمعلمين"), keyText(staffLink(me))),
      sub("وزّع رابط صفحة الطلاب ورمزها على الأهالي. كل طالب يفتح ملفه بمعرّفه الخاص (من تبويب الطلاب).")),
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
