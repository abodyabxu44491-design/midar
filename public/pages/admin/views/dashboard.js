/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, notice, line, sub, input, empty, badge, btn, keyText, linkRow, copyRow, schoolLogoUrl, kpiCard, kpiGrid, personAvatar } from "../../shared/js/ui.js";
import { icons } from "../../shared/js/icons.js";
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
    urgent: { name: "عاجل", cls: "bad" },
    action: { name: "يحتاج إجراء", cls: "warn" },
    info: { name: "معلومات", cls: "" },
  };

  const center = (data, goTo) => {
    if (!data.items.length) return null;
    return h("div", {},
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

  const todayText = d.today?.holiday ? `اليوم إجازة: ${d.today.holiday.name}`
    : d.today && !d.today.study_day ? "اليوم ليس يوم دراسة" : null;
  const logo = schoolLogoUrl(me.school.id, me.school.logo);
  const L = me.links;

  const go = goTo || (() => {});
  const rate = d.recorded_today ? Math.round(((d.recorded_today - d.absent_today) / d.recorded_today) * 100) : null;
  const feesTotal = Number(d.fees_paid || 0) + Number(d.fees_remaining || 0);
  const firstName = String(me.name || "").replace(/^(أ\.|د\.)\s*/, "").split(" ")[0];

  return [
    h("section", { class: "dash-hello" },
      logo ? h("img", { class: "dash-logo", src: logo, alt: "" })
        : h("span", { class: "dash-logo ph", "aria-hidden": "true" }, icons.building({ size: 26 })),
      h("div", { class: "dash-hello-text" },
        h("h2", {}, `أهلًا، ${firstName || me.name}`),
        h("p", {}, [
          me.school.name,
          new Date().toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" }),
          d.academic ? `${d.academic.year_name} — ${d.academic.term_name || "لم يُحدد الفصل"}` : null,
          todayText,
        ].filter(Boolean).join(" · ")))),

    d.recent_announcements?.length ? h("button", { type: "button", class: "ann-strip", onclick: () => go("announcements") },
      h("span", { class: "ann-ic" }, icons.megaphone({ size: 18 })),
      h("b", {}, "إعلانات المدرسة"),
      h("span", { class: "ann-items" }, d.recent_announcements.slice(0, 3).map((a) => h("span", {}, a.title)))) : null,

    kpiGrid(
      kpiCard({ icon: "users", tone: "teal", label: "الطلاب", value: String(d.students), ratio: me.school.max_students ? d.students / me.school.max_students : null,
        note: me.school.max_students ? `من ${me.school.max_students} في الباقة · ${d.classes} فصل` : `${d.classes} فصل`, onClick: () => go("students") }),
      me.modules?.attendance === false ? null : kpiCard({ icon: "check", tone: "teal", label: "حضور اليوم", value: rate === null ? "—" : `${rate}%`, ratio: rate === null ? null : rate / 100,
        note: d.recorded_today ? `${d.absent_today} غائبًا من ${d.recorded_today}` : todayText || "لم يُسجل الحضور بعد", onClick: () => go("attendance") }),
      kpiCard({ icon: "user", tone: "violet", label: "المعلمون", value: String(d.teachers), note: d.pending_exams ? `${d.pending_exams} اختبار بانتظار الاعتماد` : "فريق المدرسة", onClick: () => go("teachers") }),
      me.modules?.fees === false ? null : kpiCard({ icon: "wallet", tone: "amber", label: "الرسوم المحصّلة", value: money(d.fees_paid), ratio: feesTotal ? Number(d.fees_paid || 0) / feesTotal : null,
        note: `المتبقي ${money(d.fees_remaining)}`, onClick: () => go(me.modules?.finance ? "ledger" : "finance") })),

    // Everything that happened or needs action, in one panel with tabs.
    activityPanel(d, go, [
      notifications.items.length ? ["alerts", "التنبيهات", notifications.items.reduce((n, x) => n + Number(x.count || 0), 0), () => center(notifications, go)] : null,
      alerts.overdue.length ? ["overdue", "الفواتير المتأخرة", Math.max(c.overdue_invoices || 0, alerts.overdue.length), () => shortList(alerts.overdue, (i) => line(
        h("div", {}, h("b", {}, `${i.student_name} — ${money(i.remaining)}`),
          sub(`${i.title} — استحقت ${fmtDate(i.due_date)}${i.class_name ? ` — ${i.class_name}` : ""}`)),
        canMessage ? waButton({ phone: i.guardian_phone, template: templates.fees, countryCode: templates.country_code,
          vars: messageVars({ student: { name: i.student_name, class_name: i.class_name }, school: me.school.name,
            fees: { remaining: i.remaining }, link: directoryLink(me) }), label: "تذكير واتساب" }) : null),
        () => go("finance"), "كل الفواتير في قسم الرسوم")] : null,
      alerts.absentees.length ? ["absent", "غياب متكرر", Math.max(c.frequent_absentees || 0, alerts.absentees.length), () => shortList(alerts.absentees, (s) => line(
        h("div", {}, h("b", {}, s.name), sub(`${s.class_name || "—"} — ${s.absences} أيام غياب في آخر 30 يومًا`)),
        canMessage ? waButton({ phone: s.guardian_phone, template: templates.absence, countryCode: templates.country_code,
          vars: messageVars({ student: s, school: me.school.name }), label: "تنبيه ولي الأمر" }) : null),
        () => go("attendance"), "كل الغياب في قسم الحضور")] : null,
    ].filter(Boolean)),

    h("div", { class: "dash-cols" },
      h("div", { class: "dash-main" }, stagesPanel(d.by_grade || [], go)),
      h("div", { class: "dash-side" }, quickSearch(go))),

    panel("روابط مدرستك", null,
      linkRow("صفحة الطلاب وأولياء الأمور", L?.public?.home || directoryLink(me), { note: "شاركها مع الأهالي" }),
      linkRow("دخول الإدارة والمعلمين والمحاسبين", staffLink(me), { note: "خاص بمنسوبي المدرسة" }),
      sub("معرّف كل طالب (لفتح ملفه) تجده في تبويب الطلاب.")),
  ];
}

const SHORT = 5;
function shortList(rows, row, openTab, openLabel) {
  const box = h("div", {}, rows.slice(0, SHORT).map(row));
  const more = rows.length > SHORT ? btn(`عرض المزيد (${rows.length - SHORT})`, () => { mount(box, rows.map(row)); more.remove(); }, "ghost sm") : null;
  return h("div", {}, box, h("div", { class: "row spaced" }, more, btn(openLabel, openTab, "ghost sm")));
}

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
      mount(box, rows.length ? rows.map((x) => h("button", { class: "search-result", type: "button",
          onclick: () => {
            if (x.tab === "students") { try { sessionStorage.setItem("midar_filter_students-q", x.term); } catch { /* ignore */ } }
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

function stagesPanel(rows, go) {
  if (!rows.length) return null;
  const stages = [];
  for (const r of rows) {
    let st = stages.find((x) => x.id === r.stage_id);
    if (!st) stages.push(st = { id: r.stage_id, name: r.stage, grades: [] });
    st.grades.push(r);
  }
  const tones = ["teal", "amber", "violet", "navy"];
  return panel("الطلاب حسب المرحلة", null, h("div", { class: "stage-list" }, stages.map((st, i) => {
    const total = st.grades.reduce((n, g) => n + g.students, 0), classes = st.grades.reduce((n, g) => n + g.classes, 0);
    return h("div", { class: `stage-card ${tones[i % tones.length]}` },
      h("div", { class: "stage-head" },
        h("span", { class: "stage-ic", "aria-hidden": "true" }, st.name.replace(/^ال/, "").charAt(0)),
        h("b", { class: "stage-name" }, st.name),
        h("span", { class: "stage-num" }, h("b", {}, String(total)), h("small", {}, "طالبًا")),
        h("span", { class: "stage-num" }, h("b", {}, String(classes)), h("small", {}, "فصول"))),
      h("div", { class: "grade-tiles" }, st.grades.map((g) => h("button", { type: "button", class: "grade-tile", onclick: () => go("students") },
        h("small", {}, g.grade), h("b", {}, String(g.students))))));
  })));
}

function activityPanel(d, go, extra = []) {
  const when = (t) => new Date(t).toLocaleDateString("ar", { day: "numeric", month: "short" });
  const tabsDef = [
    ...extra,
    d.recent_students?.length ? ["students", "الطلاب الجدد", null, () => h("div", { class: "act-list" }, d.recent_students.map((s) => h("button", { type: "button", class: "act-row", onclick: () => go("students") },
      personAvatar(s.gender, 34), h("span", { class: "act-main" }, h("b", {}, s.name), h("small", {}, s.class_name || "بدون فصل")), h("small", { class: "act-when" }, when(s.created_at)))))] : null,
    d.recent_announcements?.length ? ["ann", "التعاميم", null, () => h("div", { class: "act-list" }, d.recent_announcements.map((a) => h("button", { type: "button", class: "act-row", onclick: () => go("announcements") },
      h("span", { class: "act-ic" }, icons.megaphone({ size: 16 })), h("span", { class: "act-main" }, h("b", {}, a.title)), h("small", { class: "act-when" }, when(a.created_at)))))] : null,
  ].filter(Boolean);
  if (!tabsDef.length) return null;
  let cur = tabsDef[0][0];
  const body = h("div");
  const bar = h("div", { class: "act-tabs", role: "tablist" });
  const draw = () => {
    bar.querySelectorAll("button").forEach((b) => { const on = b.dataset.k === cur; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
    mount(body, tabsDef.find((t) => t[0] === cur)[3]());
  };
  mount(bar, tabsDef.map(([k, label, n]) => h("button", { type: "button", role: "tab", "data-k": k, onclick: () => { cur = k; draw(); } },
    label, n ? h("span", { class: "act-n" }, String(n)) : null)));
  draw();
  return panel("آخر النشاطات", null, bar, body);
}
