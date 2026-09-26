// تبويب السجل: كل تعديل مع القيم قبل وبعد
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, btn, empty, line, sub } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";
import { A } from "./common.js";

const show = (v) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function audit() {
  const box = h("div");
  const more = h("div", { class: "spaced" });
  let last = null;
  const load = async () => {
    const rows = await api(`${A}/audit${last ? `?before=${last}` : ""}`);
    if (!rows.length && !last) return mount(box, empty("لا توجد عمليات."));
    for (const a of rows) {
      box.append(line(
        h("div", {}, h("span", {}, a.summary),
          a.changes?.length ? a.changes.slice(0, 6).map((c) => sub(`${c.field}: ${show(c.from)} ← ${show(c.to)}`)) : null),
        sub(`${a.actor}${a.ip ? ` — ${a.ip}` : ""} — ${fmtDateTime(a.created_at)}`)));
      last = a.id;
    }
    mount(more, rows.length === 100 ? btn("عرض المزيد", load, "ghost") : null);
  };
  await load();
  return panel("سجل العمليات", null, sub("يُسجل تلقائيًا من قاعدة البيانات، ولا يمكن تعديله أو حذفه."), box, more);
}
