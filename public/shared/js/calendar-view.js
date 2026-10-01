// التقويم المدرسي: شبكة شهر على الشاشات الكبيرة، وقائمة مرتبة دائمًا (وهي وحدها على الجوال)
import { h, mount } from "./dom.js";
import { btn, empty, sub, notice } from "./ui.js";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const DOW = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const iso = (d) => d.toISOString().slice(0, 10);
const KIND_LABEL = { holiday: "إجازة", exam: "اختبار", term: "الفصل الدراسي", event: "فعالية", meeting: "اجتماع", activity: "نشاط", trip: "رحلة", deadline: "موعد نهائي", other: "أخرى" };
export const kindLabel = (k) => KIND_LABEL[k] || "";

/** قائمة عناصر (تُستخدم أيضًا في ملف الطالب) */
export function eventList(items, { onOpen } = {}) {
  if (!items.length) return empty("لا توجد مناسبات في هذه الفترة.");
  return h("div", { class: "cal-list" }, items.map((e) => {
    const d = new Date(`${e.start}T00:00:00Z`);
    return h("div", { class: "cal-item", role: onOpen && e.type === "event" ? "button" : null, onclick: onOpen && e.type === "event" ? () => onOpen(e) : null },
      h("div", { class: "d" }, d.getUTCDate(), h("small", {}, MONTHS[d.getUTCMonth()])),
      h("div", {}, h("b", {}, e.title),
        sub([kindLabel(e.kind), e.end && e.end !== e.start ? `حتى ${e.end}` : null, e.time, e.class_name].filter(Boolean).join(" — ")),
        e.description ? sub(e.description) : null));
  }));
}

/**
 * @param {{ load: (from:string, to:string) => Promise<any[]>, actions?: Node|null, onOpen?: (e)=>void }} o
 */
export function calendarView({ load, actions = null, onOpen }) {
  const now = new Date();
  let y = Number(sessionStorage.getItem("midar_cal_y")) || now.getFullYear();
  let m = sessionStorage.getItem("midar_cal_m") !== null ? Number(sessionStorage.getItem("midar_cal_m")) : now.getMonth();
  const title = h("h2", { style: "margin:0" });
  const grid = h("div", { class: "cal-month" });
  const list = h("div");
  const draw = async () => {
    try { sessionStorage.setItem("midar_cal_y", String(y)); sessionStorage.setItem("midar_cal_m", String(m)); } catch { /* */ }
    title.textContent = `${MONTHS[m]} ${y}`;
    const first = new Date(Date.UTC(y, m, 1)), last = new Date(Date.UTC(y, m + 1, 0));
    const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
    const end = new Date(last); end.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
    mount(list, sub("جارٍ التحميل…"));
    let items;
    try { items = await load(iso(start), iso(end)); } catch (e) { return mount(list, notice(e.message, "err")); }
    const today = iso(new Date());
    const cells = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = iso(d);
      const evs = items.filter((e) => day >= e.start && day <= (e.end || e.start));
      cells.push(h("div", { class: `cal-day${d.getUTCMonth() !== m ? " out" : ""}${day === today ? " today" : ""}` },
        h("span", { class: "n" }, d.getUTCDate()),
        evs.slice(0, 3).map((e) => h("button", { type: "button", class: `cal-ev ${e.type === "holiday" ? "holiday" : e.type === "exam" ? "exam" : e.type === "term" ? "term" : ""}`,
          title: e.title, onclick: () => onOpen?.(e) }, e.title)),
        evs.length > 3 ? h("small", { class: "muted" }, `+${evs.length - 3}`) : null));
    }
    mount(grid, DOW.map((x) => h("div", { class: "dow" }, x)), cells);
    const monthItems = items.filter((e) => (e.end || e.start) >= iso(first) && e.start <= iso(last));
    mount(list, eventList(monthItems, { onOpen }));
  };
  draw();
  return {
    el: h("div", { class: "panel" },
      h("div", { class: "row", style: "justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px" },
        h("div", { class: "row", style: "align-items:center;gap:6px;flex:none" },
          btn("السابق", () => { m--; if (m < 0) { m = 11; y--; } draw(); }, "ghost sm"), title,
          btn("التالي", () => { m++; if (m > 11) { m = 0; y++; } draw(); }, "ghost sm")),
        h("div", { class: "row", style: "flex:none;gap:6px" }, btn("اليوم", () => { y = now.getFullYear(); m = now.getMonth(); draw(); }, "ghost sm"), actions)),
      grid, h("h3", { class: "sec-title" }, "مناسبات الشهر"), list),
    refresh: draw,
  };
}
