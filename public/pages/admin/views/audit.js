// تبويب السجل: تصفية وبحث، وكل تعديل مع القيم قبل وبعد
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, empty, line, sub } from "/shared/js/ui.js";
import { fmtDateTime, csv } from "/shared/js/format.js";
import { A } from "./common.js";

const show = (v) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function audit() {
  const filters = await api(`${A}/audit/filters`);
  const table = select([["", "كل الأقسام"], ...filters.tables.map((t) => [t.key, t.name])]);
  const action = select([["", "كل العمليات"], ...filters.actions.map((a) => [a.key, a.name])]);
  const from = input({ type: "date" });
  const to = input({ type: "date" });
  const search = input({ type: "search", placeholder: "بحث في الاسم أو القيم" });

  const box = h("div");
  const more = h("div", { class: "spaced" });
  let last = null;
  let loaded = [];

  const query = (before) => {
    const p = new URLSearchParams();
    if (before) p.set("before", before);
    if (table.value) p.set("table", table.value);
    if (action.value) p.set("action", action.value);
    if (from.value) p.set("from", from.value);
    if (to.value) p.set("to", to.value);
    if (search.value.trim().length >= 2) p.set("q", search.value.trim());
    return p.toString();
  };

  const append = (rows) => {
    for (const a of rows) {
      box.append(line(
        h("div", {}, h("span", {}, a.summary),
          a.changes?.length ? a.changes.slice(0, 6).map((c) => sub(`${c.field}: ${show(c.from)} ← ${show(c.to)}`)) : null),
        sub(`${a.actor}${a.ip ? ` — ${a.ip}` : ""} — ${fmtDateTime(a.created_at)}`)));
      last = a.id;
    }
    loaded = loaded.concat(rows);
    mount(more, rows.length === 100 ? btn("عرض المزيد", loadMore, "ghost") : null);
  };

  const reload = async () => {
    last = null; loaded = []; mount(box, empty("جارٍ التحميل…"));
    const rows = await api(`${A}/audit?${query()}`);
    mount(box);
    if (!rows.length) return mount(box, empty("لا توجد عمليات مطابقة."));
    append(rows);
  };
  const loadMore = async () => append(await api(`${A}/audit?${query(last)}`));

  let timer;
  for (const el of [table, action, from, to]) el.addEventListener("change", reload);
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(reload, 350); });
  await reload();

  return panel("سجل العمليات",
    btn("تصدير المعروض", () => csv("سجل-العمليات.csv",
      [["العملية", "المنفّذ", "العنوان", "الوقت"], ...loaded.map((a) => [a.summary, a.actor, a.ip || "", a.created_at])]), "ghost sm"),
    h("div", { class: "row" }, field("القسم", table), field("نوع العملية", action)),
    h("div", { class: "row" }, field("من تاريخ", from), field("إلى تاريخ", to)),
    field("بحث", search),
    sub("يُسجل تلقائيًا من قاعدة البيانات، ولا يمكن تعديله أو حذفه."),
    box, more);
}
