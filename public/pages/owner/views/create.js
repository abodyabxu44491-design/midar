import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, showCredentials } from "/shared/js/ui.js";
import { h } from "/shared/js/dom.js";

export default function create({ refresh }) {
  const f = {
    name: input(), id: input({ class: "ltr", placeholder: "alnoor" }), admin: input({ value: "مدير المدرسة" }),
    plan: select([["basic", "الأساسية"], ["pro", "الاحترافية"], ["enterprise", "المؤسسات"]]),
    max: input({ type: "number", value: 200, min: 1 }), end: input({ type: "date" }),
  };
  return panel("إضافة مدرسة جديدة", null,
    field("اسم المدرسة", f.name),
    field("رمز المدرسة", f.id, "حروف إنجليزية صغيرة وأرقام. يظهر في رابط صفحة الطلاب ولا يمكن تغييره."),
    field("اسم مدير المدرسة", f.admin),
    h("div", { class: "row" }, field("الباقة", f.plan), field("حد الطلاب", f.max), field("نهاية الاشتراك", f.end)),
    btn("إنشاء المدرسة", async () => {
      const r = await api("/api/owner/tenants", {
        name: f.name.value, id: f.id.value, admin_name: f.admin.value, plan: f.plan.value,
        max_students: Number(f.max.value), subscription_end: f.end.value || null,
      });
      showCredentials("تم إنشاء المدرسة", r.credentials, `سلّم هذه البيانات لمدير المدرسة. يدخل من: ${location.origin}/admin`);
      refresh();
    }));
}
