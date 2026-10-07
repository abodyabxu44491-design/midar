// الحضور في الإدارة: متابعة اليوم، التسجيل، أعذار أولياء الأمور، التقارير، والإعدادات.
// كل الأقسام تقرأ نفس سجل الحضور الذي يسجله المعلمون، وما يُكتب هنا (السبب، قبول العذر، التنبيه) يظهر لولي الأمر.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { attendanceBoard } from "../../shared/js/attendance-board.js";
import { panel, field, input, select, btn, empty, notice, sub, toast, dialog, badge, switchBtn } from "../../shared/js/ui.js";
import { waButton, messageVars } from "../../shared/js/whatsapp.js";
import { alertDialog } from "../../shared/js/student-alerts.js";
import { ATTENDANCE, today, fmtDay, fmtDateTime, csv } from "../../shared/js/format.js";
import { A, loadClasses, optional } from "./common.js";
import { icons } from "../../shared/js/icons.js";
import { gateScanner, gateSettings } from "../../shared/js/gate-scanner.js";

const PARTS = [["today", "متابعة اليوم"], ["record", "تسجيل الحضور"], ["gate", "بوابة الحضور"], ["excuses", "الأعذار"], ["reports", "التقارير"], ["settings", "الإعدادات"]];
const shift = (d, days) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + days); return x.toISOString().slice(0, 10); };
const plural = (n, one, few, many) => (n === 1 ? one : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`);
let state = { part: "today", date: null, classId: null };

export default async function attendance({ me }) {
  const [classes, templates] = await Promise.all([loadClasses(), optional(api(`${A}/messaging/templates`), null)]);
  state.date ??= today();

  // واتساب لولي الأمر بقالب الغياب أو التأخر من إعدادات الرسائل
  const wa = (row, label) => {
    if (!row?.guardian_phone || !templates) return null;
    return waButton({ phone: row.guardian_phone, countryCode: templates.country_code,
      template: row.status === "late" ? templates.late : templates.absence,
      vars: messageVars({ student: row, school: me.school.name }),
      label: label || (row.status === "late" ? "تنبيه تأخر" : "تنبيه غياب") });
  };
  const addAlert = (row, preset) => alertDialog(row.name, (b) => api(`${A}/students/${row.id}/alerts`, b), preset);

  const chips = h("div", { class: "xb-chips att-parts", role: "tablist" });
  const box = h("div");
  const show = async (part = state.part) => {
    state.part = part;
    mount(chips, PARTS.map(([k, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(k === part),
      class: `xb-chip${k === part ? " on" : ""}`, onclick: () => show(k) }, label)));
    mount(box, empty("جارٍ التحميل…"));
    try { mount(box, await VIEWS[part]()); } catch (e) { mount(box, notice(e.message, "err")); }
  };
  const goRecord = (classId, date) => { state.classId = classId; state.date = date; show("record"); };

  /* ---------- متابعة اليوم ---------- */
  async function todayView() {
    const d = await api(`${A}/attendance/overview?date=${state.date}`);
    const T = d.totals;
    const dateIn = input({ type: "date", value: state.date, max: today() });
    dateIn.addEventListener("change", () => { state.date = dateIn.value || today(); show("today"); });
    const move = (n) => { const next = shift(state.date, n); if (next <= today()) { state.date = next; show("today"); } };
    const missing = d.classes.filter((c) => c.students && !c.recorded);

    const classCard = (c) => {
      const done = c.students && c.recorded >= c.students;
      const pctDone = c.students ? Math.round((c.recorded / c.students) * 100) : 0;
      return h("button", { type: "button", class: `att-class${done ? " done" : c.recorded ? " partial" : c.students ? " none" : " empty"}`,
        onclick: () => (c.students ? goRecord(c.id, state.date) : null), disabled: !c.students },
        h("div", { class: "ac-top" }, h("b", {}, c.name),
          c.students ? badge(done ? "مكتمل" : c.recorded ? `${c.recorded}/${c.students}` : "لم يُسجَّل", done ? "" : c.recorded ? "amber" : "red") : badge("بلا طلاب", "gray")),
        h("div", { class: "ac-bar" }, h("span", { style: `width:${pctDone}%` })),
        c.recorded ? h("div", { class: "ac-counts" },
          c.absent ? h("span", { class: "s-absent" }, `${c.absent} غائب`) : null,
          c.late ? h("span", { class: "s-late" }, `${c.late} متأخر`) : null,
          c.excused ? h("span", { class: "s-excused" }, `${c.excused} بعذر`) : null,
          !c.absent && !c.late && !c.excused ? h("span", { class: "s-present" }, "الكل حاضر") : null) : h("div", { class: "ac-counts" }, h("span", {}, `${c.students} طالب`)),
        c.recorded_by ? h("small", {}, `سجّله: ${c.recorded_by}`) : null);
    };

    const personRow = (p) => h("div", { class: `att-person s-${p.status}` },
      h("div", { class: "stu-main" }, h("b", {}, p.name),
        h("small", {}, [p.class_name, p.recorded_by ? `سجّله ${p.recorded_by}` : null].filter(Boolean).join(" · ")),
        p.excuse ? h("small", { class: "att-reason" }, `السبب: ${p.excuse}`) : null,
        p.parent_excuse_state === "pending" ? h("small", { class: "att-reason pending" }, `عذر ولي الأمر: ${p.parent_excuse}`) : null),
      h("span", { class: `stu-today s-${p.status}` }, ATTENDANCE[p.status][0]),
      h("div", { class: "att-person-acts" },
        btn(p.excuse ? "تعديل السبب" : "السبب", () => reasonDialog(p, state.date, () => show("today")), "ghost sm"),
        p.status !== "excused" ? wa(p) : null,
        btn("تنبيه", () => addAlert(p, { kind: "attendance", level: "warning", title: p.status === "late" ? "تأخر صباحي" : "غياب" }), "ghost sm")));

    return [
      h("div", { class: "att-head panel" },
        h("div", { class: "att-date" }, field("اليوم", dateIn),
          h("div", { class: "att-day-nav" },
            btn("السابق", () => move(-1), "ghost sm"), h("div", { class: "att-day" }, fmtDay(state.date)),
            btn("التالي", () => move(1), "ghost sm"))),
        state.date !== today() ? btn("اليوم", () => { state.date = today(); show("today"); }, "soft sm") : null),
      d.day.holiday ? notice(`هذا اليوم إجازة: ${d.day.holiday.name}. لا يُسجَّل فيه حضور.`, "warn")
        : !d.day.study_day ? notice("هذا اليوم ليس من أيام الدراسة المضبوطة في الإعدادات.", "warn") : null,
      d.pending_excuses ? h("div", { class: "sub-banner trial" }, icons.clipboard({ size: 20 }),
        h("div", {}, h("b", {}, plural(d.pending_excuses, "عذر جديد من ولي أمر", "أعذار جديدة", "عذرًا جديدًا")), h("small", {}, "بانتظار قبولك أو رفضك")),
        btn("مراجعة الأعذار", () => show("excuses"), "ghost sm")) : null,
      h("div", { class: "att-kpis big" },
        h("div", { class: "s-rate" }, h("b", {}, T.rate === null ? "—" : `${T.rate}%`), "نسبة الحضور"),
        h("div", { class: "s-present" }, h("b", {}, T.present), "حاضر"),
        h("div", { class: "s-absent" }, h("b", {}, T.absent), "غائب"),
        h("div", { class: "s-late" }, h("b", {}, T.late), "متأخر"),
        h("div", { class: "s-excused" }, h("b", {}, T.excused), "بعذر"),
        h("div", {}, h("b", {}, `${T.done}/${T.classes}`), "فصول مكتملة")),
      panel("الفصول", missing.length && !d.day.holiday ? `${missing.length} لم يُسجَّل` : null,
        missing.length && !d.day.holiday ? sub(`لم يُسجَّل بعد: ${missing.map((c) => c.name).join("، ")}. اضغط الفصل لتسجيله.`) : sub("اضغط أي فصل لفتح تسجيله."),
        d.classes.length ? h("div", { class: "att-classes" }, d.classes.map(classCard)) : empty("لا توجد فصول.")),
      panel("الغائبون والمتأخرون", d.people.length ? `${d.people.length}` : null,
        d.people.length ? [
          sub("اكتب سبب الغياب إن عرفته (يظهر لولي الأمر)، أو أرسل تنبيهًا بواتساب أو في ملف الطالب."),
          h("div", { class: "att-people" }, d.people.map(personRow))]
          : empty(T.recorded ? "لا غياب ولا تأخر في هذا اليوم." : "لم يُسجَّل حضور في هذا اليوم بعد.")),
      d.at_risk.length ? panel(`تجاوزوا حد الغياب (${d.threshold} أيام خلال 30 يومًا)`, `${d.at_risk.length}`,
        sub("يظهر لولي أمر كل منهم تنبيه غياب تلقائي في ملف الطالب."),
        h("div", { class: "att-people" }, d.at_risk.map((p) => h("div", { class: "att-person s-absent" },
          h("div", { class: "stu-main" }, h("b", {}, p.name), h("small", {}, `${p.class_name || ""} · آخر غياب ${fmtDay(p.last_absent)}`)),
          h("span", { class: "stu-today s-absent" }, `${p.absent} غياب`),
          h("div", { class: "att-person-acts" },
            wa({ ...p, status: "absent" }, "واتساب"),
            btn("تنبيه", () => addAlert(p, { kind: "attendance", level: "urgent", title: "تكرار الغياب",
              body: `غاب الطالب ${p.absent} أيام خلال آخر 30 يومًا. نرجو التواصل مع المدرسة.` }), "ghost sm")))))) : null,
    ];
  }

  // سبب الغياب: يُحفظ في سجل الحضور ويظهر لولي الأمر، ويمكن تحويل الغياب إلى «بعذر»
  function reasonDialog(p, date, done) {
    const text = input({ maxLength: 200, value: p.excuse || "", placeholder: "مثال: مراجعة طبية" });
    const status = select([["", `إبقاء الحالة (${ATTENDANCE[p.status][0]})`], ...(p.status === "absent" ? [["excused", "تحويله إلى غياب بعذر"]] : []),
      ...(p.status === "excused" ? [["absent", "إرجاعه غيابًا بلا عذر"]] : [])]);
    const d = dialog(`سبب ${ATTENDANCE[p.status][0]}: ${p.name}`, h("div", {},
      field("السبب", text), field("الحالة", status), sub("السبب يظهر لولي الأمر في ملف الطالب.")),
    [btn("حفظ", async () => {
      try {
        await api(`${A}/attendance/excuse`, { student_id: p.id, date, excuse: text.value.trim() || null, ...(status.value ? { status: status.value } : {}) }, "PATCH");
        d.close(); toast("حُفظ السبب"); done();
      } catch (e) { toast(e.message, true); }
    })]);
    text.focus();
  }

  /* ---------- التسجيل ---------- */
  const recordView = () => attendanceBoard(`${A}/attendance`, classes, wa, state.classId, state.date);

  /* ---------- الأعذار ---------- */
  async function excusesView() {
    const list = await api(`${A}/attendance/excuses`);
    const decide = async (x, accept) => {
      try {
        await api(`${A}/attendance/excuses/decide`, { student_id: x.student_id, date: x.day, accept });
        toast(accept ? "قُبل العذر وصار الغياب بعذر" : "رُفض العذر"); show("excuses");
      } catch (e) { toast(e.message, true); }
    };
    return panel("أعذار أولياء الأمور", list.length ? `${list.length} بانتظار المراجعة` : null,
      sub("يرسلها ولي الأمر من ملف الطالب عن غياب أو تأخر خلال آخر 30 يومًا. القبول يجعل الغياب «بعذر» ويظهر العذر سببًا له."),
      list.length ? h("div", { class: "att-people" }, list.map((x) => h("div", { class: `att-person s-${x.status}` },
        h("div", { class: "stu-main" }, h("b", {}, x.name),
          h("small", {}, `${x.class_name || ""} · ${ATTENDANCE[x.status][0]} يوم ${fmtDay(x.day)} · أُرسل ${fmtDateTime(x.parent_excuse_at)}`),
          h("p", { class: "excuse-text" }, x.parent_excuse)),
        h("div", { class: "att-person-acts" },
          btn("قبول", () => decide(x, true), "sm"),
          btn("رفض", () => decide(x, false), "ghost sm")))))
        : empty("لا توجد أعذار بانتظار المراجعة."));
  }

  /* ---------- التقارير ---------- */
  const monthStart = () => `${today().slice(0, 8)}01`;
  let rep = { from: null, to: null, class_id: "" };
  async function reportsView() {
    rep.from ??= monthStart(); rep.to ??= today();
    const from = input({ type: "date", value: rep.from, max: today() });
    const to = input({ type: "date", value: rep.to, max: today() });
    const cls = select([["", "كل الفصول"], ...classes.map((c) => [c.id, c.name])], { value: rep.class_id });
    const presets = [["هذا الأسبوع", () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toLocaleDateString("en-CA"); }],
      ["هذا الشهر", monthStart], ["آخر 30 يومًا", () => shift(today(), -30)]];
    const apply = () => { rep = { from: from.value, to: to.value, class_id: cls.value }; show("reports"); };
    const r = await api(`${A}/attendance/report?from=${rep.from}&to=${rep.to}${rep.class_id ? `&class_id=${rep.class_id}` : ""}`);
    const recorded = r.students.filter((s) => s.days);
    const tot = recorded.reduce((a, s) => ({ days: a.days + s.days, present: a.present + s.present, absent: a.absent + s.absent, late: a.late + s.late, excused: a.excused + s.excused }),
      { days: 0, present: 0, absent: 0, late: 0, excused: 0 });
    const rate = tot.days - tot.excused > 0 ? Math.round(((tot.present + tot.late) / (tot.days - tot.excused)) * 1000) / 10 : null;
    const q = input({ type: "search", placeholder: "بحث باسم الطالب" });
    const table = h("div");
    const paintTable = () => {
      const term = q.value.trim();
      const rows = recorded.filter((s) => !term || s.name.includes(term));
      mount(table, rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "att-table" },
        h("thead", {}, h("tr", {}, ["الطالب", "الفصل", "غياب", "تأخر", "بعذر", "أيام مسجلة", "نسبة الحضور", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, rows.map((s) => h("tr", { class: s.rate !== null && s.rate < 85 ? "low" : "" },
          h("td", {}, h("b", {}, s.name)), h("td", {}, s.class_name || "—"),
          h("td", { class: s.absent ? "n-absent" : "" }, s.absent), h("td", { class: s.late ? "n-late" : "" }, s.late), h("td", {}, s.excused),
          h("td", {}, s.days), h("td", {}, s.rate === null ? "—" : `${s.rate}%`),
          h("td", {}, s.absent || s.late ? btn("تنبيه", () => addAlert(s, { kind: "attendance", level: s.absent >= 3 ? "urgent" : "warning",
            title: "ملخص الحضور", body: `خلال الفترة ${rep.from} إلى ${rep.to}: غياب ${s.absent}، تأخر ${s.late}.` }), "ghost sm") : null)))))) : empty("لا توجد بيانات."));
    };
    q.addEventListener("input", paintTable); paintTable();
    const bar = (label, value, sublabel) => h("div", { class: "rate-row" }, h("span", {}, label),
      h("div", { class: "rate-bar" }, h("span", { style: `width:${value ?? 0}%`, class: value !== null && value < 85 ? "low" : "" })),
      h("b", {}, value === null ? "—" : `${value}%`), sublabel ? h("small", {}, sublabel) : null);
    return [
      panel("الفترة", null,
        h("div", { class: "form-grid" }, field("من", from), field("إلى", to), field("الفصل", cls)),
        h("div", { class: "row", style: "justify-content:flex-start;gap:6px;flex-wrap:wrap" },
          btn("عرض", apply), ...presets.map(([label, fn]) => btn(label, () => { from.value = fn(); to.value = today(); apply(); }, "ghost sm")))),
      h("div", { class: "att-kpis big" },
        h("div", { class: "s-rate" }, h("b", {}, rate === null ? "—" : `${rate}%`), "نسبة الحضور"),
        h("div", { class: "s-absent" }, h("b", {}, tot.absent), "غياب"), h("div", { class: "s-late" }, h("b", {}, tot.late), "تأخر"),
        h("div", { class: "s-excused" }, h("b", {}, tot.excused), "بعذر"), h("div", {}, h("b", {}, r.days.length), "أيام مسجلة")),
      r.classes.length > 1 ? panel("نسبة الحضور لكل فصل", null, r.classes.map((c) => bar(c.name, c.rate, `${c.absent} غياب · ${c.late} تأخر`))) : null,
      r.days.length ? panel("الحضور يومًا بيوم", null, h("div", { class: "day-bars" }, r.days.map((d) => h("div", { class: "day-bar", title: `${fmtDay(d.day)}: ${d.rate}% — ${d.absent} غياب` },
        h("span", { style: `height:${d.rate ?? 0}%`, class: d.rate < 85 ? "low" : "" }), h("small", {}, d.day.slice(8)))))) : null,
      panel("الطلاب (الأكثر غيابًا أولًا)", null,
        h("div", { class: "row spaced" }, q, btn("تصدير Excel/CSV", () => csv(`الحضور ${rep.from} - ${rep.to}.csv`, [
          ["الطالب", "الفصل", "غياب", "تأخر", "بعذر", "حاضر", "أيام مسجلة", "نسبة الحضور"],
          ...recorded.map((s) => [s.name, s.class_name, s.absent, s.late, s.excused, s.present, s.days, s.rate ?? ""])]), "ghost sm"),
          btn("طباعة", () => window.print(), "ghost sm")),
        table),
    ];
  }

  /* ---------- الإعدادات ---------- */
  async function settingsView() {
    const st = await api(`${A}/settings/public-page`);
    const s = st.settings || st;
    const threshold = input({ type: "number", min: 0, max: 60, value: s.absence_alert_threshold ?? 3, class: "ltr" });
    const save = (patch) => api(`${A}/settings/public-page`, patch, "PUT");
    return panel("إعدادات الحضور", null,
      field("حد تنبيه الغياب", threshold, "عدد أيام الغياب بلا عذر خلال 30 يومًا ليظهر تنبيه تلقائي لولي الأمر وفي متابعة اليوم. 0 = إيقاف."),
      btn("حفظ الحد", async () => { try { await save({ absence_alert_threshold: Number(threshold.value) }); toast("حُفظ"); } catch (e) { toast(e.message, true); } }, "soft sm"),
      h("div", { class: "line" }, h("div", {}, h("b", {}, "أعذار أولياء الأمور"), sub("يرسل ولي الأمر عذرًا عن الغياب من ملف الطالب، وتقبله أو ترفضه من «الأعذار».")),
        switchBtn(s.allow_parent_excuses !== false, "أعذار أولياء الأمور", async () => {
          try { await save({ allow_parent_excuses: !(s.allow_parent_excuses !== false) }); s.allow_parent_excuses = !(s.allow_parent_excuses !== false); toast("حُفظ"); return true; }
          catch (e) { toast(e.message, true); return false; }
        })),
      h("div", { class: "line" }, h("div", {}, h("b", {}, "إظهار الحضور لولي الأمر"),
        sub(s.profile_show_attendance ? "مفعّل: يرى ولي الأمر الحضور وأسباب الغياب." : "موقوف: لا يرى ولي الأمر الحضور ولا يستطيع إرسال أعذار.")),
        switchBtn(Boolean(s.profile_show_attendance), "إظهار الحضور لولي الأمر", async () => {
          try { await save({ profile_show_attendance: !s.profile_show_attendance }); s.profile_show_attendance = !s.profile_show_attendance; toast("حُفظ"); return true; }
          catch (e) { toast(e.message, true); return false; }
        })),
      sub("قوالب رسائل واتساب للغياب والتأخر من «الإعدادات ← الرسائل»."));
  }

  const VIEWS = { today: todayView, record: recordView, gate: async () => [gateScanner(A), await gateSettings(A)],
    excuses: excusesView, reports: reportsView, settings: settingsView };
  await show();
  return [chips, box];
}
