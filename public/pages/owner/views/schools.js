import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, empty, badge, field, input, select, btn, sub, toast, confirmAction } from "/shared/js/ui.js";
import { fmtDate } from "/shared/js/format.js";
import { handoverCard } from "./create.js";

const STATUS = { active: ["مفعّلة", ""], suspended: ["موقوفة", "red"], archived: ["مؤرشفة", "gray"] };
const PLANS = [["basic", "الأساسية"], ["pro", "الاحترافية"], ["enterprise", "المؤسسات"]];

export default async function schools({ refresh }) {
  const list = await api("/api/owner/tenants");
  if (!list.length) return panel("المدارس", null, empty("لا توجد مدارس. أضف أول مدرسة من تبويب «إضافة مدرسة»."));
  return list.map((x) => {
    const plan = select(PLANS, { value: x.plan });
    const max = input({ type: "number", min: 1, value: x.max_students });
    const end = input({ type: "date", value: x.subscription_end || "" });
    const patch = (body, msg, ask) => async () => {
      if (ask && !confirmAction(ask)) return;
      await api(`/api/owner/tenants/${x.id}`, body, "PATCH");
      toast(msg);
      refresh();
    };
    return panel(x.name, badge(...STATUS[x.status]),
      sub(`الرمز: ${x.id} — ${x.students} طالب — ${x.teachers} معلم — ${x.open_sessions} جلسة نشطة — أُنشئت ${fmtDate(x.created_at)}`),
      sub(`رابط الطلاب: ${location.origin}/${x.id} — دخول المنسوبين: ${location.origin}/${x.id}/idara`),
      h("div", { class: "row spaced" }, field("الباقة", plan), field("حد الطلاب", max), field("نهاية الاشتراك", end)),
      h("div", { class: "row", style: "justify-content:flex-start" },
        btn("حفظ الاشتراك", patch({ plan: plan.value, max_students: Number(max.value), subscription_end: end.value || null }, "تم حفظ الاشتراك"), "sm"),
        x.status === "active"
          ? btn("إيقاف المدرسة", patch({ status: "suspended" }, "تم الإيقاف وإخراج جميع المستخدمين", `إيقاف ${x.name}؟ سيُخرج جميع مستخدميها فورًا.`), "danger sm")
          : btn("تفعيل المدرسة", patch({ status: "active" }, "تم التفعيل"), "soft sm"),
        x.status !== "archived" && btn("أرشفة", patch({ status: "archived" }, "تمت الأرشفة", `أرشفة ${x.name}؟`), "ghost sm"),
        btn("كلمة مرور جديدة للمدير", async () => {
          if (!confirmAction("إنشاء كلمة مرور جديدة لمدير هذه المدرسة؟ القديمة ستتوقف.")) return;
          const r = await api(`/api/owner/tenants/${x.id}/reset-admin`, {});
          handoverCard({ school: { name: x.name }, credentials: { ...r.credentials, directory_code: "— بدون تغيير —" } });
        }, "ghost sm")));
  });
}
