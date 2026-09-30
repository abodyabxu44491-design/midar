// لوحة الإجازات والعطل: نفس الجدول الذي يكتبه معالج الإعداد الأول
import { h } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, sub, badge, line, empty, toast, confirmAction } from "../../shared/js/ui.js";
import { fmtDate } from "../../shared/js/format.js";
import { A } from "./common.js";

export async function holidaysPanel(refresh) {
  const { holidays, kinds } = await api(`${A}/academic/holidays`);
  const name = input({ placeholder: "مثال: إجازة عيد الفطر" });
  const kind = select(Object.entries(kinds));
  const a = input({ type: "date", class: "ltr" }), b = input({ type: "date", class: "ltr" });
  const affects = input({ type: "checkbox", checked: true });
  return panel("الإجازات والعطل", null,
    sub("يستفيد منها الحضور والجدول: اليوم داخل إجازة لا يُعدّ يوم دراسة."),
    holidays.length ? holidays.map((x) => line(
      h("div", {}, h("b", {}, x.name), " ", badge(kinds[x.kind] || x.kind, "gray"),
        sub(`${fmtDate(x.start_date)} إلى ${fmtDate(x.end_date)}${x.affects_attendance ? "" : " — لا تؤثر على الحضور"}`)),
      btn("حذف", async () => {
        if (!confirmAction(`حذف «${x.name}»؟`)) return;
        await api(`${A}/academic/holidays/${x.id}`, undefined, "DELETE"); toast("حُذفت الإجازة"); refresh();
      }, "danger sm"))) : empty("لا توجد إجازات مضافة."),
    field("اسم الإجازة", name), field("النوع", kind),
    h("div", { class: "row" }, field("من", a), field("إلى", b)),
    h("label", { class: "f pill" }, affects, "تؤثر على الحضور"),
    btn("إضافة إجازة", async () => {
      if (!name.value.trim() || !a.value || !b.value) return toast("أكمل اسم الإجازة وتاريخيها");
      await api(`${A}/academic/holidays`, { name: name.value.trim(), kind: kind.value, start_date: a.value, end_date: b.value,
        affects_attendance: affects.checked, show_in_calendar: true });
      toast("أُضيفت الإجازة"); refresh();
    }, "soft"));
}
