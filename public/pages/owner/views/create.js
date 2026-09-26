import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, dialog, line, sub, keyText, notice, toast, brandLogo } from "/shared/js/ui.js";
import { h } from "/shared/js/dom.js";
import { loadRefs, subForm } from "./sub-form.js";

export default async function create({ refresh }) {
  const refs = await loadRefs();
  const f = { name: input(), id: input({ class: "ltr", placeholder: "حروف إنجليزية صغيرة" }), admin: input({ value: "مدير المدرسة" }) };
  const form = subForm(refs, { kind: "trial" });
  return panel("إضافة مدرسة جديدة", null,
    field("اسم المدرسة", f.name),
    field("رمز المدرسة", f.id, "حروف إنجليزية صغيرة وأرقام. يظهر في رابط صفحة الطلاب ولا يمكن تغييره."),
    field("اسم مدير المدرسة", f.admin),
    h("h3", {}, "الاشتراك"), form.el,
    btn("إنشاء المدرسة", async () => {
      const r = await api("/api/owner/tenants", { name: f.name.value, id: f.id.value, admin_name: f.admin.value, subscription: form.value() });
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
    notice("انسخ البطاقة أو اطبعها الآن. كلمة المرور لن تظهر مرة أخرى.", "warn"),
    rows.map(([k, v]) => line(h("span", { class: "sub" }, k), keyText(v))),
    sub("يغيّر المدير كلمة المرور بعد أول دخول من: الإعدادات ← تغيير كلمة المرور.")),
  [
    btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); }),
    btn("طباعة", () => window.print(), "ghost"),
  ]);
}
