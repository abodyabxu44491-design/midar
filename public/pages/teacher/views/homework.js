/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, textarea, select, btn, empty, badge, line, sub, toast, confirmAction } from "../../shared/js/ui.js";
import { fmtDate, today } from "../../shared/js/format.js";

const T = "/api/teacher/homework";

export default async function homework({ me, refresh }) {
  if (!me.load.length) return empty("لا توجد مواد مسندة لك.");
  const list = await api(T);
  const pair = select(me.load.map((l) => [`${l.class_id}:${l.subject_id}`, `${l.class_name} — ${l.subject_name}`]));
  const title = input({ placeholder: "عنوان الواجب" });
  const details = textarea({ rows: 2, placeholder: "التفاصيل (اختياري)" });
  const due = input({ type: "date", value: today() });

  return [
    panel("واجب جديد", null,
      h("div", { class: "row" }, field("العنوان", title), field("الفصل والمادة", pair)),
      field("التفاصيل", details),
      field("موعد التسليم", due),
      btn("نشر الواجب", async () => {
        const [class_id, subject_id] = pair.value.split(":");
        try {
          await api(T, { class_id, subject_id, title: title.value, details: details.value || null, due_date: due.value || null });
          toast("نُشر الواجب"); refresh();
        } catch (e) { toast(e.message, true); }
      })),
    panel("واجباتي", list.length ? String(list.length) : null, list.length ? myList(list, refresh) : empty("لم تنشر واجبات بعد.")),
  ];
}

// Current homework first, filtered by class in one row, a page at a time instead of the whole year at once.
function myList(list, refresh) {
  const PAGE = 15;
  let cls = "", when = "open", shown = PAGE;
  const classes = [...new Map(list.map((a) => [a.class_name, a.class_name])).keys()];
  const nav = h("div", { class: "subnav", role: "tablist" });
  const whenNav = h("div", { class: "subnav", role: "tablist" });
  const out = h("div");
  const paint = () => {
    const tab = (on, text, fn) => h("button", { type: "button", role: "tab", "aria-selected": String(on), class: `subnav-b${on ? " on" : ""}`, onclick: fn }, text);
    mount(whenNav, tab(when === "open", "الحالية", () => { when = "open"; shown = PAGE; paint(); }),
      tab(when === "past", "المنتهية", () => { when = "past"; shown = PAGE; paint(); }), tab(when === "all", "الكل", () => { when = "all"; shown = PAGE; paint(); }));
    mount(nav, classes.length > 1 ? [tab(!cls, "كل الفصول", () => { cls = ""; shown = PAGE; paint(); }),
      ...classes.map((c) => tab(cls === c, c, () => { cls = c; shown = PAGE; paint(); }))] : []);
    const rows = list.filter((a) => (!cls || a.class_name === cls)
      && (when === "all" || (when === "open") === !(a.due_date && a.due_date < today())));
    mount(out, rows.length ? [...rows.slice(0, shown).map((a) => row(a, refresh)),
      rows.length > shown ? btn(`عرض المزيد (${rows.length - shown})`, () => { shown += PAGE; paint(); }, "ghost sm") : null]
      : empty(when === "open" ? "لا توجد واجبات حالية." : "لا توجد واجبات."));
  };
  paint();
  return [whenNav, nav, out];
}

function row(a, refresh) {
  const box = h("div", { class: "hidden", style: "background:var(--bg);border-radius:8px;padding:10px;margin-top:8px;width:100%" });
  const late = a.due_date && a.due_date < today();
  const open = btn("رصد التسليم", async () => {
    if (!box.classList.contains("hidden")) return box.classList.add("hidden");
    const rows = await api(`${T}/${a.id}/submissions`);
    const marks = new Map(rows.map((r) => [r.id, r.submitted]));
    const chip = (r) => {
      const el = h("button", { type: "button", class: "quick-name" }, r.name);
      const paint = () => { el.dataset.state = marks.get(r.id) ? "present" : "absent"; };
      el.addEventListener("click", () => { marks.set(r.id, !marks.get(r.id)); paint(); });
      paint();
      return el;
    };
    mount(box,
      sub("اضغط على الاسم للتبديل بين «سلّم» و«لم يسلّم»."),
      rows.length ? h("div", { class: "quick-grid" }, rows.map(chip)) : empty("لا يوجد طلاب في الفصل."),
      rows.length ? h("div", { class: "toolbar spaced" }, btn("حفظ", async () => {
        await api(`${T}/${a.id}/submissions`, { entries: rows.map((r) => ({ student_id: r.id, submitted: !!marks.get(r.id), note: null })) }, "PUT");
        toast("تم الحفظ"); refresh();
      })) : null);
    box.classList.remove("hidden");
  }, "ghost sm");

  return line(
    h("div", {}, h("b", {}, a.title), " ",
      badge(`${a.submitted_count} من ${a.class_size} سلّم`, a.submitted_count >= a.class_size ? "" : "amber"),
      late ? badge("انتهى موعده", "gray") : null,
      sub(`${a.class_name} — ${a.subject}${a.due_date ? ` — التسليم ${fmtDate(a.due_date)}` : ""}`),
      a.details ? sub(a.details) : null),
    h("div", { class: "row", style: "flex:none" }, open,
      btn("حذف", async () => {
        if (!confirmAction("حذف الواجب؟")) return;
        await api(`${T}/${a.id}`, undefined, "DELETE"); refresh();
      }, "danger sm")),
    box);
}
