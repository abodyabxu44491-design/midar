// لوحة تسجيل الحضور (تستخدمها الإدارة والمعلم، كل واحد بمساره المنفصل)
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { field, input, select, btn, panel, empty, line, toast, notice } from "./ui.js";
import { ATTENDANCE, today } from "./format.js";

export function attendanceBoard(endpoint, classes, wa = null) {
  if (!classes.length) return panel("تسجيل الحضور", null, empty("لا توجد فصول."));
  const cls = select(classes.map((c) => [c.id, c.name]));
  const date = input({ type: "date", value: today(), max: today() });
  const reason = input({ placeholder: "مطلوب فقط عند تعديل حالة مسجلة" });
  const box = h("div");

  const save = async (entries) => {
    const r = await api(endpoint, { date: date.value, reason: reason.value || null, entries });
    if (r.changed) toast(`تم التعديل (${r.changed})`);
    await load();
  };

  async function load() {
    mount(box, empty("جارٍ التحميل…"));
    try {
      const rows = await api(`${endpoint}?class_id=${cls.value}&date=${date.value}`);
      if (!rows.length) return mount(box, empty("لا يوجد طلاب في هذا الفصل."));
      const pending = rows.filter((r) => !r.status);
      mount(box,
        pending.length ? btn(`تحديد الباقين حاضرين (${pending.length})`, () => save(pending.map((r) => ({ student_id: r.id, status: "present" }))), "soft sm") : null,
        rows.map((r) => line(
          h("div", { class: "pill" }, h("b", {}, r.name),
            wa && ["absent", "late"].includes(r.status) ? wa(r) : null),
          h("div", { class: "chips" }, Object.entries(ATTENDANCE).map(([k, [label, color]]) => h("button", {
            type: "button", class: `chip${r.status === k ? " on" : ""}`, "aria-pressed": String(r.status === k),
            style: `color:${color};${r.status === k ? `background:${color}` : ""}`,
            onclick: async (ev) => { ev.currentTarget.disabled = true; try { await save([{ student_id: r.id, status: k }]); } catch (e) { toast(e.message, true); load(); } },
          }, label))))));
    } catch (e) { mount(box, notice(e.message, "err")); }
  }
  cls.addEventListener("change", load);
  date.addEventListener("change", load);
  load();
  return panel("تسجيل الحضور", null, h("div", { class: "row" }, field("الفصل", cls), field("التاريخ", date), field("سبب التعديل", reason)), box);
}
