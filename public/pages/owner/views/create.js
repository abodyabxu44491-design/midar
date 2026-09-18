import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, dialog, line, sub, keyText, notice, toast, brandLogo } from "/shared/js/ui.js";
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
      handoverCard(r);
      refresh();
    }));
}

// بطاقة تسليم: كل ما تحتاجه المدرسة في صفحة واحدة قابلة للطباعة
export function handoverCard(r) {
  const site = location.origin;
  const publicLink = `${site}/${r.credentials.school}`;
  const staffLink = `${publicLink}/idara`;
  const rows = [
    ["اسم المدرسة", r.school.name],
    ["رابط الطلاب وأولياء الأمور", publicLink],
    ["رمز صفحة الطلاب", r.credentials.directory_code],
    ["رابط دخول المدير والمعلمين", staffLink],
    ["اسم المستخدم", r.credentials.username],
    ["كلمة المرور المؤقتة", r.credentials.password],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  dialog("بطاقة تسليم المدرسة", h("div", { class: "handover" },
    h("div", { class: "print-only" }, brandLogo("print-logo", false)),
    notice("كلمة المرور لن تظهر مرة أخرى. انسخها أو اطبع البطاقة وسلّمها للمدرسة الآن.", "warn"),
    rows.map(([k, v]) => line(h("span", { class: "sub" }, k), keyText(v))),
    sub("يغيّر المدير كلمة المرور بعد أول دخول من: الإعدادات ← تغيير كلمة المرور.")),
  [
    btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); }),
    btn("طباعة", () => window.print(), "ghost"),
  ]);
}
