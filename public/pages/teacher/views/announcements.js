import { h } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, empty, line, sub } from "../../shared/js/ui.js";
import { fmtDate } from "../../shared/js/format.js";

export default async function announcements() {
  const list = await api("/api/teacher/announcements");
  return panel("التعاميم المرسلة", null, list.length ? list.map((a) => line(
    h("div", {}, h("b", {}, a.title), h("div", {}, a.body), sub(`${a.class_name || "كل المدرسة"} — ${fmtDate(a.created_at)}`)))) : empty("لا توجد تعاميم."));
}
