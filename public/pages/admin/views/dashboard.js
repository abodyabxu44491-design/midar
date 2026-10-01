// الرئيسية: الملخص، التنبيهات، والبحث السريع
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { stats, panel, notice, line, sub, input, empty, badge, btn, keyText, linkRow, copyRow, schoolLogoUrl } from "../../shared/js/ui.js";
import { money, fmtDate } from "../../shared/js/format.js";
import { waButton, messageVars } from "../../shared/js/whatsapp.js";
import { A, directoryLink, staffLink, optional } from "./common.js";

export default async function dashboard({ me, goTo }) {
  const [d, alerts, notifications, templates, completeness] = await Promise.all([
    api(`${A}/dashboard`),
    optional(api(`${A}/analytics/alerts`), { counts: {}, absentees: [], overdue: [] }),
    optional(api(`${A}/analytics/notifications`), { items: [], counts: {} }),
    optional(api(`${A}/messaging/templates`), null),
    me.modules?.data_assistant ? optional(api(`${A}/assistant/checklist`), null) : null]);
  const canMessage = Boolean(templates);
  const c = alerts.counts;

  const LEVELS = {
    urgent: { name: "عاجل", cls: "bad" },
    action: { name: "يحتاج إجراء", cls: "warn" },
    info: { name: "معلومات", cls: "" },
  };

  // مركز التنبيهات: مرتبة بالأهمية، والضغط ينقلك للقسم
  const center = (data, goTo) => {
    if (!data.items.length) return null;
    return panel("مركز التنبيهات", null,
      ["urgent", "action", "info"].map((level) => {
        const rows = data.items.filter((x) => x.level === level);
        if (!rows.length) return null;
        return h("div", { class: "notif-group" },
          h("h3", { class: "sec-title" }, h("span", { class: `lvl-dot ${level}`, "aria-hidden": "true" }), LEVELS[level].name),
          rows.map((x) => h("button", { class: `notif ${LEVELS[level].cls}`, type: "button",
            onclick: () => goTo(x.tab) },
            h("span", { class: "notif-count" }, x.count),
            h("span", { class: "notif-text" }, h("b", {}, x.text), x.hint ? sub(x.hint) : null))));
      }));
  };

  // حالة اليوم في سطر واحد تحت اسم المدرسة
  const todayText = d.today?.holiday ? `اليوم إجازة: ${d.today.holiday.name}`
    : d.today && !d.today.study_day ? "اليوم ليس يوم دراسة" : null;
  const logo = schoolLogoUrl(me.school.id, me.school.logo);
  const L = me.links;

  return [
    h("section", { class: "dash-hero" },
      logo ? h("img", { class: "dash-logo", src: logo, alt: "" })
        : h("span", { class: "dash-logo ph", "aria-hidden": "true" }, String(me.school.name || "م").trim().charAt(0)),
      h("div", { class: "dash-hero-text" },
        h("h2", {}, me.school.name),
        h("p", {}, [
          new Date().toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" }),
          d.academic ? `${d.academic.year_name} — ${d.academic.term_name || "لم يُحدد الفصل"}` : null,
          todayText,
        ].filter(Boolean).join(" · ")))),

    stats([
      ["طالب", d.students, `حد الباقة ${me.school.max_students}`], ["معلم", d.teachers], ["فصل", d.classes],
      me.modules?.attendance === false ? null
        : ["غائب اليوم", d.absent_today, d.recorded_today ? `سُجل ${d.recorded_today} طالب` : todayText || "لم يُسجل الحضور بعد"],
      me.modules?.fees === false ? null : ["رسوم غير محصّلة", money(d.fees_remaining), `المحصّل ${money(d.fees_paid)}`],
    ].filter(Boolean)),

    // اكتمال البيانات: يظهر فقط ما دامت ناقصة، ويفتح مساعد الإدخال
    completeness && completeness.score < 100 ? panel("اكتمال بيانات المدرسة", null,
      h("div", { class: "dash-complete" }, h("b", {}, `${completeness.score}%`), h("div", { class: "bar" }, h("i", { style: `width:${completeness.score}%` })),
        btn("أكمل البيانات", () => goTo?.("assistant"), "soft sm")),
      sub(completeness.items.filter((x) => x.level === "todo" || x.level === "warn").slice(0, 3).map((x) => x.hint || x.title).join(" · "))) : null,

    center(notifications, goTo || (() => {})),

    quickSearch(goTo || (() => {})),

    shortList("غياب متكرر (آخر 30 يومًا)", alerts.absentees, c.frequent_absentees, (s) => line(
        h("div", {}, h("b", {}, s.name), sub(`${s.class_name || "—"} — ${s.absences} أيام غياب`)),
        canMessage ? waButton({ phone: s.guardian_phone, template: templates.absence, countryCode: templates.country_code,
          vars: messageVars({ student: s, school: me.school.name }), label: "تنبيه ولي الأمر" }) : null),
      () => goTo?.("attendance"), "كل الغياب في قسم الحضور"),

    shortList("فواتير متأخرة", alerts.overdue, c.overdue_invoices, (i) => line(
        h("div", {}, h("b", {}, `${i.student_name} — ${money(i.remaining)}`),
          sub(`${i.title} — استحقت ${fmtDate(i.due_date)}${i.class_name ? ` — ${i.class_name}` : ""}`)),
        canMessage ? waButton({ phone: i.guardian_phone, template: templates.fees, countryCode: templates.country_code,
          vars: messageVars({ student: { name: i.student_name, class_name: i.class_name }, school: me.school.name,
            fees: { remaining: i.remaining }, link: directoryLink(me) }), label: "تذكير واتساب" }) : null),
      () => goTo?.("finance"), "كل الفواتير في قسم الرسوم"),

    // الروابط: كل رابط يُفتح بالضغط ويُنسخ بزر واحد
    panel("روابط مدرستك", null,
      linkRow("صفحة الطلاب وأولياء الأمور", L?.public?.home || directoryLink(me), { note: "شاركها مع الأهالي" }),
      linkRow("دخول الإدارة والمعلمين والمحاسبين", staffLink(me), { note: "خاص بمنسوبي المدرسة" }),
      sub("معرّف كل طالب (لفتح ملفه) تجده في تبويب الطلاب.")),
  ];
}

// قائمة مختصرة في الرئيسية: أول 5 فقط، و«عرض المزيد» يكمل هنا، ورابط للقسم الكامل
const SHORT = 5;
function shortList(title, rows, total, row, openTab, openLabel) {
  if (!rows.length) return null;
  const count = Math.max(total || 0, rows.length);
  const box = h("div", {}, rows.slice(0, SHORT).map(row));
  const more = rows.length > SHORT ? btn(`عرض المزيد (${rows.length - SHORT})`, () => { mount(box, rows.map(row)); more.remove(); }, "ghost sm") : null;
  return panel(h("span", {}, title, " ", badge(String(count), "gray")), null, box,
    h("div", { class: "row spaced" }, more, count > SHORT ? btn(openLabel, openTab, "ghost sm") : null));
}

// بحث سريع في الطلاب والمعلمين والفواتير
function quickSearch(goTo) {
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
        ...r.students.map((s) => ({ kind: "طالب", main: s.name, note: `${s.class_name || "بدون فصل"}${s.archived_at ? " — مؤرشف" : ""}`, key: s.access_key, tab: "students", term: s.name })),
        ...r.teachers.map((t) => ({ kind: "معلم", main: t.name, note: t.username ? `اسم المستخدم: ${t.username}` : "", tab: "teachers", term: t.name })),
        ...r.invoices.map((i) => ({ kind: "فاتورة", main: `${i.student_name} — ${money(i.amount)}`, note: `${i.title} — المدفوع ${money(i.paid)}`, tab: "ledger", term: i.student_name })),
      ];
      // الضغط على نتيجة ينقلك للقسم المناسب، مع تعبئة بحثه تلقائيًا (بدل ما يعيد البحث من الصفر)
      mount(box, rows.length ? rows.map((x) => h("button", { class: "search-result", type: "button",
          onclick: () => {
            if (x.tab === "students") { try { sessionStorage.setItem("midar_filter_students-q", x.term); } catch { /* تجاهل */ } }
            goTo(x.tab);
          } },
        h("div", { class: "pill" }, badge(x.kind, "gray"), h("b", {}, x.main)),
        x.note ? sub(x.note) : null,
        x.key ? h("div", { class: "sub pill" }, "المعرّف: ", keyText(x.key)) : null)) : empty("لا توجد نتائج."));
    } catch (e) { mount(box, notice(e.message, "err")); }
  };
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  return panel("بحث سريع", null, q, box);
}
