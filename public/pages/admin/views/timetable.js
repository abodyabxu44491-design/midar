// تبويب الجدول الدراسي: تعديل مباشر في الشبكة، ومنع تعارض المعلمين
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, notice, confirmAction, sectionMenu } from "../../shared/js/ui.js";
import { timetableGrid, DAYS, WORK_DAYS, PERIODS } from "../../shared/js/timetable.js";
import { A, loadClasses, loadSubjects } from "./common.js";

export default function timetable(ctx) {
  return sectionMenu({
    title: "الجدول الدراسي",
    items: [
      { key: "editor", name: "جدول الصفوف", note: "تعديل يدوي لكل شعبة" },
      { key: "generate", name: "توليد تلقائي", note: "مسودة تُعتمد بموافقتك" },
      { key: "settings", name: "إعدادات الجدول", note: "الأيام والحصص وأوقاتها" },
      { key: "copy", name: "نسخ جدول شعبة", note: "انسخ الجدول إلى شعبة أخرى" },
      { key: "conflicts", name: "فحص التعارضات", note: "معلم أو قاعة في وقتين" },
    ],
    render: (key, { reload }) => views[key]({ ...ctx, show: reload }),
  });
}

const views = { editor, generate: generateView, settings: settingsView, copy: copyView, conflicts: conflictsView };

async function editor({ refresh }) {
  const [classes, subjects, teachers] = await Promise.all([loadClasses(), loadSubjects(), api(`${A}/teachers`)]);
  if (!classes.length) return panel("الجدول الدراسي", null, empty("أضف الفصول والمواد أولًا."));

  const picker = select(classes.map((c) => [c.id, c.name]));
  const msg = h("div");
  const box = h("div");

  // الخيارات المتاحة للصف = المواد المسندة لمعلميه، مع خيار «بدون معلم»
  const optionsFor = (classId) => {
    const out = [["", "—"]];
    for (const s of subjects) {
      const mine = teachers.filter((t) => t.load.some((l) => l.class_id === Number(classId) && l.subject_id === s.id));
      for (const t of mine) out.push([`${s.id}:${t.id}`, `${s.name} — ${t.name}`]);
      out.push([`${s.id}:`, `${s.name} — بدون معلم`]);
    }
    return out;
  };

  async function load() {
    const classId = Number(picker.value);
    mount(box, empty("جارٍ التحميل…"));
    const slots = await api(`${A}/timetable?class_id=${classId}`);
    const options = optionsFor(classId);
    mount(box, timetableGrid(slots, {
      cell: (day, period, slot) => {
        const sel = select(options, { value: slot ? `${slot.subject_id}:${slot.teacher_id ?? ""}` : "" });
        sel.addEventListener("change", async () => {
          const [subject_id, teacher_id] = sel.value.split(":");
          mount(msg);
          try {
            await api(`${A}/timetable/slot`, { class_id: classId, day, period, subject_id: subject_id || null, teacher_id: teacher_id || null }, "PUT");
            toast("تم الحفظ");
            load();
          } catch (e) { mount(msg, notice(e.message, "err")); load(); }
        });
        return sel;
      },
    }));
  }
  picker.addEventListener("change", load);
  await load();

  return panel("الجدول الدراسي", btn("مسح جدول الصف", async () => {
    if (!confirmAction("حذف كل حصص هذا الصف؟")) return;
    const r = await api(`${A}/timetable/class/${picker.value}`, undefined, "DELETE");
    toast(`حُذفت ${r.deleted} حصة`);
    load();
  }, "danger sm"),
    field("الصف", picker),
    sub("اختر المادة والمعلم لكل حصة. التعارض مرفوض تلقائيًا."),
    msg, box);
}


/* ---------------- إعدادات الجدول ---------------- */
async function settingsView({ show }) {
  const d = await api(`${A}/timetable/settings`);
  const s = d.settings;
  const dayBoxes = DAYS.map((name, i) => {
    const cb = input({ type: "checkbox", checked: s.days.includes(i) });
    return { i, cb, el: h("label", { class: "small", style: "margin-inline-end:12px" }, cb, " ", name) };
  });
  const periods = input({ type: "number", min: 1, max: 10, value: s.periods_per_day });
  const start = input({ type: "time", value: s.start_time });
  const minutes = input({ type: "number", min: 20, max: 120, value: s.period_minutes });
  const breakAfter = select([["", "بلا فسحة"], ...Array.from({ length: 10 }, (_, i) => [i + 1, `بعد الحصة ${i + 1}`])],
    { value: s.break_after ?? "" });
  const breakMin = input({ type: "number", min: 0, max: 120, value: s.break_minutes });
  const times = h("div");

  const drawTimes = () => mount(times, h("div", { class: "scroll" }, h("table", { class: "grid" },
    h("thead", {}, h("tr", {}, h("th", {}, "الحصة"), h("th", {}, "من"), h("th", {}, "إلى"), h("th", {}, "بعدها"))),
    h("tbody", {}, d.times.map((t2) => h("tr", {},
      h("td", {}, t2.period), h("td", { class: "ltr" }, t2.from), h("td", { class: "ltr" }, t2.to),
      h("td", {}, t2.break_after ? `فسحة ${t2.break_after} دقيقة` : "—")))))));
  drawTimes();

  return panel("إعدادات الجدول", null,
    sub("أيام الدراسة"),
    h("div", { class: "spaced" }, dayBoxes.map((x) => x.el)),
    h("div", { class: "row" }, field("عدد الحصص اليومية", periods), field("بداية الدوام", start), field("مدة الحصة (دقيقة)", minutes)),
    h("div", { class: "row" }, field("الفسحة", breakAfter), field("مدة الفسحة (دقيقة)", breakMin)),
    btn("حفظ الإعدادات", async () => {
      await api(`${A}/timetable/settings`, {
        days: dayBoxes.filter((x) => x.cb.checked).map((x) => x.i),
        periods_per_day: Number(periods.value), start_time: start.value,
        period_minutes: Number(minutes.value),
        break_after: breakAfter.value ? Number(breakAfter.value) : null,
        break_minutes: Number(breakMin.value),
      }, "PUT");
      toast("حُفظت الإعدادات"); show();
    }),
    h("h3", { class: "sec-title" }, "أوقات الحصص"), times);
}

/* ---------------- التوليد التلقائي ---------------- */
async function generateView({ show }) {
  const classes = await loadClasses();
  const picks = classes.map((c) => {
    const cb = input({ type: "checkbox", checked: true });
    return { id: c.id, cb, el: h("label", { class: "small", style: "margin-inline-end:12px;white-space:nowrap" }, cb, " ", c.name) };
  });
  const replace = input({ type: "checkbox", checked: true });
  const out = h("div");
  const msg = h("div");
  let draft = null;

  return panel("توليد جدول مبدئي", null,
    sub("يوزّع النظام حصص كل مادة حسب عدد حصصها الأسبوعية وإسناد المعلمين، بلا تعارض. المسودة لا تُحفظ إلا بموافقتك."),
    classes.length ? h("div", { class: "spaced" }, picks.map((p) => p.el)) : empty("أضف الشعب أولًا."),
    h("label", { class: "f pill" }, replace, "استبدال الجدول الحالي لهذه الشعب"),
    h("div", { class: "row spaced" },
      btn("توليد المسودة", async () => {
        mount(msg); mount(out, empty("جارٍ التوليد…"));
        try {
          draft = await api(`${A}/timetable/generate`, {
            class_ids: picks.filter((p) => p.cb.checked).map((p) => p.id), replace: replace.checked });
          drawDraft();
        } catch (e) { mount(out); mount(msg, notice(e.message, "err")); }
      }),
      btn("اعتماد المسودة", async () => {
        if (!draft) return toast("ولّد المسودة أولًا", true);
        if (!confirmAction(`اعتماد ${draft.slots.length} حصة؟`)) return;
        const r = await api(`${A}/timetable/apply`, {
          slots: draft.slots.map(({ class_id, day, period, subject_id, teacher_id }) =>
            ({ class_id, day, period, subject_id, teacher_id })),
          replace: replace.checked,
        });
        toast(`اعتُمدت ${r.saved} حصة في ${r.classes} شعب`);
        draft = null; show();
      }, "soft")),
    msg, out);

  function drawDraft() {
    const byClass = new Map();
    for (const s of draft.slots) byClass.set(s.class_name, [...(byClass.get(s.class_name) || []), s]);
    mount(out,
      notice(`المسودة: ${draft.slots.length} حصة في ${draft.classes} شعب. راجعها ثم اضغط «اعتماد المسودة».`, ""),
      draft.warnings.length
        ? h("div", {}, h("h3", { class: "sec-title" }, `تنبيهات (${draft.warnings.length})`),
            h("ul", { class: "small" }, draft.warnings.slice(0, 12).map((w) => h("li", {}, w))))
        : null,
      [...byClass.entries()].map(([name, slots]) => h("section", { class: "panel" },
        h("h2", {}, name),
        timetableGrid(slots, { days: draft.settings.days, periods: Array.from({ length: draft.settings.periods_per_day }, (_, i) => i + 1),
          cell: (day, period, slot) => (slot
            ? h("b", { class: "small" }, slot.subject)
            : h("span", { class: "muted" }, "—")) }))));
  }
}

/* ---------------- فحص التعارضات ---------------- */
async function conflictsView() {
  const c = await api(`${A}/timetable/conflicts`);
  const rows = [
    ...c.teacher.map((x) => ({ kind: "معلم", who: x.teacher, day: x.day, period: x.period, classes: x.classes })),
    ...c.room.map((x) => ({ kind: "قاعة", who: x.room, day: x.day, period: x.period, classes: x.classes })),
  ];
  return panel("فحص التعارضات", null,
    rows.length
      ? rows.map((x) => line(
          h("div", {}, h("b", {}, `${x.kind}: ${x.who}`), " ", badge("تعارض", "red"),
            sub(`${DAYS[x.day]} — الحصة ${x.period} — ${x.classes.join("، ")}`)),
          null))
      : notice("لا توجد تعارضات في الجدول الحالي.", ""));
}


/* ---------------- نسخ جدول شعبة ---------------- */
async function copyView({ show }) {
  const classes = await loadClasses();
  if (classes.length < 2) return panel("نسخ جدول شعبة", null, empty("تحتاج شعبتين على الأقل."));
  const from = select(classes.map((c) => [c.id, c.name]));
  const to = select(classes.map((c) => [c.id, c.name]), { value: classes[1].id });
  const keep = input({ type: "checkbox", checked: true });
  const msg = h("div");
  return panel("نسخ جدول شعبة", null,
    sub("يُستبدل جدول الشعبة الهدف. المعلم المشغول في نفس الوقت تُترك حصته بلا معلم لتختاره بنفسك."),
    h("div", { class: "row" }, field("من شعبة", from), field("إلى شعبة", to)),
    h("label", { class: "f pill" }, keep, "نسخ المعلمين أيضًا"),
    msg,
    btn("نسخ الجدول", async () => {
      mount(msg);
      try {
        const r = await api(`${A}/timetable/copy`, {
          from_class_id: from.value, to_class_id: to.value, keep_teachers: keep.checked });
        toast(`نُسخت ${r.copied} حصة${r.without_teacher ? ` — ${r.without_teacher} بلا معلم` : ""}`);
        show();
      } catch (e) { mount(msg, notice(e.message, "err")); }
    }));
}
