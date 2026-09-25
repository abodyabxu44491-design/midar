// تبويب الإعلانات
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, textarea, select, btn, empty, line, sub, toast, confirmAction } from "/shared/js/ui.js";
import { fmtDate } from "/shared/js/format.js";
import { A, loadClasses, classOptions } from "./common.js";

export default async function announcements({ refresh }) {
  const [list, classes] = await Promise.all([api(`${A}/announcements`), loadClasses()]);
  const title = input(), body = textarea({ rows: 3 }), target = select(classOptions(classes, "كل المدرسة"));
  return [
    panel("إرسال تعميم", null, field("العنوان", title), field("التفاصيل", body), field("يظهر لـ", target),
      btn("إرسال التعميم", async () => {
        await api(`${A}/announcements`, { title: title.value, body: body.value || null, class_id: target.value || null });
        toast("أُرسل التعميم"); refresh();
      })),
    panel("التعاميم المرسلة", null, list.length ? list.map((a) => line(
      h("div", {}, h("b", {}, a.title), h("div", {}, a.body), sub(`${a.class_name || "كل المدرسة"} — ${a.created_by} — ${fmtDate(a.created_at)}`)),
      btn("حذف", async () => { if (confirmAction("حذف التعميم؟")) { await api(`${A}/announcements/${a.id}`, undefined, "DELETE"); refresh(); } }, "danger sm")))
      : empty("لا توجد تعاميم.")),
  ];
}
