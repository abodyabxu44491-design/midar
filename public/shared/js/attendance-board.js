// لوحة تسجيل الحضور (تستخدمها الإدارة والمعلم، كل واحد بمساره المنفصل)
//
// التسجيل مسودة على الشاشة ثم حفظ واحد: اضغط «الكل حاضر» ثم غيّر الغائبين فقط، أو اختر حالة كل طالب،
// وشريط الحفظ أسفل الشاشة يعرض عدد التغييرات. سبب التعديل يُطلب فقط عند تغيير حالة محفوظة سابقًا.
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { field, input, select, btn, panel, empty, toast, notice, dialog } from "./ui.js";
import { ATTENDANCE, today } from "./format.js";

const ORDER = ["present", "absent", "late", "excused"];
const SHORT = { present: "حاضر", absent: "غائب", late: "متأخر", excused: "بعذر" };
const shift = (d, days) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + days); return x.toISOString().slice(0, 10); };

// endpoint: رابط API (الإدارة، متصل) أو مصدر بيانات محلي { list, save } (المعلم: يعمل بدون إنترنت)
export function attendanceBoard(endpoint, classes, wa = null, initialClassId = null, initialDate = null) {
  const source = typeof endpoint === "object" ? endpoint : {
    list: (classId, date) => api(`${endpoint}?class_id=${classId}&date=${date}`),
    save: (date, reason, entries) => api(endpoint, { date, reason, entries }),
    dayStatus: (date) => api(`${endpoint}/day-status?date=${date}`),
  };
  // المعلم دون اتصال: مصدره المحلي لا يعرف الإجازات، فنسأل الخادم إن أمكن ونتجاهل الفشل
  const dayStatus = async (d) => {
    try { return source.dayStatus ? await source.dayStatus(d) : (navigator.onLine ? await api(`/api/teacher/attendance/day-status?date=${d}`) : null); }
    catch { return null; }
  };
  if (!classes.length) return panel("تسجيل الحضور", null, empty("لا توجد فصول مسندة."));

  const cls = select(classes.map((c) => [c.id, c.name]), initialClassId ? { value: initialClassId } : {});
  const date = input({ type: "date", value: initialDate && initialDate <= today() ? initialDate : today(), max: today() });
  const search = input({ type: "search", placeholder: "بحث باسم الطالب", "aria-label": "بحث باسم الطالب" });
  const dayLabel = h("div", { class: "att-day" });
  const summary = h("div", { class: "att-summary" });
  const list = h("div", { class: "att-list" });
  const bar = h("div", { class: "att-bar hidden" });
  const box = h("div");

  let rows = [];                 // من الخادم أو الجهاز: { id, name, status, pending, ... }
  const draft = new Map();       // student_id ← الحالة المختارة ولم تُحفظ بعد
  const reasons = new Map();     // student_id ← سبب الغياب/التأخر المكتوب ولم يُحفظ (يظهر لولي الأمر)
  const openReason = new Set();  // صفوف مفتوح فيها حقل السبب

  const statusOf = (r) => draft.get(r.id) ?? r.status ?? null;
  const statusChanged = (r) => draft.has(r.id) && draft.get(r.id) !== r.status;
  const reasonChanged = (r) => reasons.has(r.id) && (reasons.get(r.id) || null) !== (r.excuse || null) && statusOf(r) && statusOf(r) !== "present";
  const changed = () => rows.filter((r) => statusChanged(r) || reasonChanged(r));

  const paintSummary = () => {
    const counts = Object.fromEntries(ORDER.map((k) => [k, 0]));
    let none = 0;
    for (const r of rows) { const s = statusOf(r); if (s) counts[s]++; else none++; }
    mount(summary,
      ORDER.map((k) => h("span", { class: `att-count s-${k}` }, h("b", {}, counts[k]), SHORT[k])),
      none ? h("span", { class: "att-count s-none" }, h("b", {}, none), "لم يُسجَّل") : null);
    const n = changed().length;
    bar.classList.toggle("hidden", !n);
    mount(bar, h("span", {}, n === 1 ? "تغيير واحد لم يُحفظ" : `${n} تغييرات لم تُحفظ`),
      h("div", { class: "row", style: "flex:none;gap:6px" },
        btn("تراجع", () => { draft.clear(); reasons.clear(); openReason.clear(); paintRows(); }, "ghost sm"),
        btn("حفظ الحضور", saveDraft)));
  };

  const rowEl = (r, i) => {
    const s = statusOf(r);
    const dirty = statusChanged(r) || reasonChanged(r);
    const needsReason = s && s !== "present";
    const reasonVal = reasons.has(r.id) ? reasons.get(r.id) : (r.excuse || "");
    return h("div", { class: `att-row${s ? ` s-${s}` : ""}${dirty ? " dirty" : ""}`, "data-id": r.id },
      h("span", { class: "att-no" }, i + 1),
      h("div", { class: "att-name" }, h("b", {}, r.name),
        r.pending ? h("small", { class: "pending-dot", title: "محفوظ على الجهاز، بانتظار المزامنة" }, "بانتظار المزامنة")
          : r.status && !dirty ? h("small", {}, `مسجّل: ${ATTENDANCE[r.status][0]}`) : dirty ? h("small", {}, "لم يُحفظ بعد") : null,
        r.first_in_at && !dirty ? h("small", { class: "att-gate" }, `البوابة ${new Date(r.first_in_at).toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" })}${r.minutes_late ? ` — تأخر ${r.minutes_late} د` : ""}`) : null,
        reasonVal && !openReason.has(r.id) ? h("small", { class: "att-reason" }, `السبب: ${reasonVal}`) : null,
        r.parent_excuse_state === "pending" ? h("small", { class: "att-reason pending" }, `عذر من ولي الأمر بانتظار المراجعة: ${r.parent_excuse}`) : null,
        wa && !dirty && ["absent", "late"].includes(r.status) ? wa(r) : null,
        needsReason && openReason.has(r.id) ? reasonInput(r, reasonVal) : null,
        needsReason && !openReason.has(r.id) ? h("button", { type: "button", class: "att-why", title: "سبب الغياب أو التأخر (يظهر لولي الأمر)",
          onclick: () => { openReason.add(r.id); repaintRow(r); list.querySelector(`[data-id="${r.id}"] .att-why-input`)?.focus(); } }, reasonVal ? "تعديل السبب" : "+ السبب") : null),
      h("div", { class: "att-seg", role: "radiogroup", "aria-label": `حالة ${r.name}` }, ORDER.map((k) => h("button", {
        type: "button", role: "radio", "aria-checked": String(s === k), class: `seg s-${k}${s === k ? " on" : ""}`,
        onclick: () => {
          if (r.status === k) draft.delete(r.id); else draft.set(r.id, k);
          // اختيار غائب/متأخر لطالب واحد يفتح حقل السبب مباشرة (اختياري)
          if (k === "present") openReason.delete(r.id);
          repaintRow(r);
        },
      }, SHORT[k]))));
  };
  const reasonInput = (r, val) => {
    const el = h("input", { class: "att-why-input", maxLength: 200, value: val, placeholder: "سبب الغياب أو التأخر (يظهر لولي الأمر)",
      oninput: () => { reasons.set(r.id, el.value.trim()); paintSummary(); markDirty(r); },
      onkeydown: (e) => { if (e.key === "Enter") { openReason.delete(r.id); repaintRow(r); } } });
    return h("div", { class: "att-why-box" }, el, h("button", { type: "button", class: "btn ghost sm", onclick: () => { openReason.delete(r.id); repaintRow(r); } }, "تم"));
  };
  const markDirty = (r) => list.querySelector(`[data-id="${r.id}"]`)?.classList.toggle("dirty", statusChanged(r) || reasonChanged(r));
  const repaintRow = (r) => {
    const i = rows.indexOf(r);
    list.querySelector(`[data-id="${r.id}"]`)?.replaceWith(rowEl(r, i));
    paintSummary();
  };
  const paintRows = () => {
    const term = search.value.trim();
    const shown = rows.filter((r) => !term || r.name.includes(term));
    mount(list, shown.length ? shown.map((r) => rowEl(r, rows.indexOf(r))) : empty("لا يوجد طالب بهذا الاسم."));
    paintSummary();
  };
  search.addEventListener("input", paintRows);

  const markAll = (status, onlyEmpty) => {
    for (const r of rows) if (!onlyEmpty || !statusOf(r)) { if (r.status === status) draft.delete(r.id); else draft.set(r.id, status); }
    paintRows();
  };

  async function saveDraft() {
    const entries = changed().map((r) => {
      const st = statusOf(r);
      const why = reasons.has(r.id) ? reasons.get(r.id) : undefined;
      return { student_id: r.id, status: st, ...(st !== "present" && why ? { excuse: why } : {}) };
    });
    if (!entries.length) return;
    const edits = changed().filter((r) => statusChanged(r) && r.status);
    let reason = null;
    if (edits.length) {
      reason = await askReason(edits);
      if (reason === null) return;
    }
    try {
      const r = await source.save(date.value, reason, entries);
      toast(r.local ? (navigator.onLine ? "حُفظ الحضور على الجهاز وتتم المزامنة" : "حُفظ الحضور على الجهاز — سيُرسل عند عودة الاتصال")
        : `تم حفظ الحضور (${entries.length})`);
      await load(true);
    } catch (e) { toast(e.message, true); }
  }
  const askReason = (edits) => new Promise((resolve) => {
    const why = input({ placeholder: "مثال: وصل الطالب متأخرًا بعد التسجيل" });
    let answered = false;
    const d = dialog("سبب تعديل الحضور", h("div", {},
      notice(`ستُعدّل حالة ${edits.length === 1 ? `«${edits[0].name}»` : `${edits.length} طلاب`} مسجلة سابقًا. يُحفظ السبب في سجل الطالب.`, "warn"),
      field("السبب", why)),
    [btn("حفظ التعديل", () => {
      if (!why.value.trim()) return toast("اكتب السبب", true);
      answered = true; d.close(); resolve(why.value.trim());
    })]);
    d.addEventListener("close", () => { if (!answered) resolve(null); });
    why.focus();
  });

  async function load(keepSearch = false) {
    draft.clear(); reasons.clear(); openReason.clear();
    if (!keepSearch) search.value = "";
    dayLabel.textContent = new Date(`${date.value}T12:00:00`).toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });
    nextBtn.disabled = date.value >= today();
    mount(box, empty("جارٍ التحميل…"));
    bar.classList.add("hidden");
    try {
      const day = await dayStatus(date.value);
      if (day?.holiday) return mount(box, notice(`هذا اليوم إجازة: ${day.holiday.name}. لا يُسجَّل فيه حضور.`, "warn"));
      rows = await source.list(cls.value, date.value);
      if (!rows.length) return mount(box, empty("لا يوجد طلاب في هذا الفصل."));
      const empties = rows.filter((r) => !r.status).length;
      mount(box,
        day && !day.study_day ? notice("هذا اليوم ليس من أيام الدراسة المضبوطة في الإعدادات.", "warn") : null,
        summary,
        h("div", { class: "att-tools" },
          empties ? btn(empties === rows.length ? "الكل حاضر" : `الباقون حاضرون (${empties})`, () => markAll("present", true)) : null,
          rows.length > 8 ? search : null),
        empties === rows.length ? h("p", { class: "sub att-hint" }, "اضغط «الكل حاضر» ثم غيّر حالة الغائبين والمتأخرين فقط، واحفظ مرة واحدة.") : null,
        list);
      paintRows();
    } catch (e) { mount(box, notice(e.message, "err")); }
  }

  // تنبيه قبل مغادرة الفصل أو اليوم بتغييرات غير محفوظة
  const guard = (fn) => () => {
    if (changed().length && !confirm("لديك تغييرات لم تُحفظ. تجاهلها؟")) return false;
    fn(); return true;
  };
  let lastClass = cls.value, lastDate = date.value;
  cls.addEventListener("change", () => { if (!guard(load)()) cls.value = lastClass; lastClass = cls.value; });
  date.addEventListener("change", () => { if (!guard(load)()) date.value = lastDate; lastDate = date.value; });
  const prevBtn = h("button", { type: "button", class: "btn ghost sm", "aria-label": "اليوم السابق", onclick: guard(() => { date.value = shift(date.value, -1); lastDate = date.value; load(); }) }, "السابق");
  const nextBtn = h("button", { type: "button", class: "btn ghost sm", "aria-label": "اليوم التالي", onclick: guard(() => { if (date.value < today()) { date.value = shift(date.value, 1); lastDate = date.value; load(); } }) }, "التالي");

  load();
  return panel("تسجيل الحضور", null,
    h("div", { class: "att-head" },
      field(classes.length > 1 ? "الفصل" : "الفصل", cls),
      h("div", { class: "att-date" }, field("التاريخ", date), h("div", { class: "att-day-nav" }, prevBtn, dayLabel, nextBtn))),
    box, bar);
}
