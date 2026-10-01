// التقويم المدرسي (الإدارة): إضافة الفعاليات وتعديلها، مع الإجازات والاختبارات وبداية الفصول تلقائيًا
import { h } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { field, input, select, textarea, btn, toast, dialog, confirmAction, sub } from "../../shared/js/ui.js";
import { calendarView, kindLabel } from "../../shared/js/calendar-view.js";
import { today } from "../../shared/js/format.js";
import { A } from "./common.js";

const KINDS = ["event", "meeting", "activity", "trip", "exam", "deadline", "other"];
const AUD = { all: "الجميع", parents: "أولياء الأمور فقط", staff: "المنسوبون فقط" };

export default async function calendar() {
  const classes = await api(`${A}/structure/classes`);
  const form = (e, refresh) => {
    const f = {
      title: input({ value: e?.title || "", maxLength: 120 }),
      kind: select(KINDS.map((k) => [k, kindLabel(k)]), { value: e?.kind || "event" }),
      starts_on: input({ type: "date", value: e?.start || today() }), ends_on: input({ type: "date", value: e?.end || e?.start || today() }),
      time_text: input({ value: e?.time || "", placeholder: "مثال: 9 صباحًا", maxLength: 40 }),
      audience: select(Object.entries(AUD), { value: e?.audience || "all" }),
      class_id: select([["", "كل المدرسة"], ...classes.map((c) => [c.id, c.name])], { value: e?.class_id || "" }),
      description: textarea({ rows: 2, maxLength: 1000, value: e?.description || "" }),
    };
    const notifyBox = h("input", { type: "checkbox" });
    const body = () => ({ title: f.title.value.trim(), kind: f.kind.value, starts_on: f.starts_on.value, ends_on: f.ends_on.value || null,
      time_text: f.time_text.value.trim() || null, audience: f.audience.value, class_id: f.class_id.value ? Number(f.class_id.value) : null,
      description: f.description.value.trim() || null, notify: notifyBox.checked });
    const d = dialog(e ? "تعديل فعالية" : "فعالية جديدة", h("div", {},
      field("العنوان", f.title), h("div", { class: "row" }, field("النوع", f.kind), field("يظهر لـ", f.audience)),
      h("div", { class: "row" }, field("من", f.starts_on), field("إلى", f.ends_on), field("الوقت", f.time_text)),
      field("الشعبة", f.class_id), field("التفاصيل", f.description),
      e ? null : h("label", { class: "check-line" }, notifyBox, "إشعار من تظهر لهم الآن")),
    [e ? btn("حذف", async () => { if (!confirmAction("حذف الفعالية؟")) return; await api(`${A}/calendar/${e.id}`, undefined, "DELETE"); d.close(); refresh(); }, "danger") : null,
      btn("حفظ", async () => {
        if (e) await api(`${A}/calendar/${e.id}`, body(), "PUT"); else await api(`${A}/calendar`, body());
        d.close(); toast("تم الحفظ"); refresh();
      })]);
  };
  let cal;
  const add = btn("+ فعالية", () => form(null, () => cal.refresh()), "sm");
  cal = calendarView({ load: (from, to) => api(`${A}/calendar?from=${from}&to=${to}`), actions: add,
    onOpen: (e) => (e.type === "event" ? form(e, () => cal.refresh()) : toast(e.type === "holiday" ? "الإجازات تُدار من «السنة الدراسية»" : "الاختبارات تُدار من «الاختبارات»")) });
  return [sub("الإجازات والاختبارات وبداية الفصول تظهر هنا تلقائيًا. أضف الفعاليات والاجتماعات والأنشطة، واختر من يراها."), cal.el];
}
