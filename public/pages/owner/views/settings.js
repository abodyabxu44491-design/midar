// إعدادات المنصة: شكل الصفحة الرئيسية وبيانات التواصل
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, select, input, btn, sub, toast, notice } from "/shared/js/ui.js";

export default async function settings() {
  const s = await api("/api/owner/settings");
  const mode = select([["blank", "فاضية (الشعار فقط)"], ["marketing", "صفحة تسويقية مع طلب تجربة"]], { value: s.landing_mode });
  const phone = input({ class: "ltr", value: s.brand_phone || "", placeholder: "رقم الجوال" });
  const email = input({ class: "ltr", type: "email", value: s.brand_email || "" });
  const support = input({ class: "ltr", inputMode: "tel", value: s.support_whatsapp || "", placeholder: "رقم واتساب الدعم" });
  const supportNote = input({ value: s.support_note || "", placeholder: "سطر يظهر للمدارس في إعداداتها" });
  const msg = h("div");
  return panel("إعدادات المنصة", btn("معاينة الصفحة الرئيسية", () => window.open("/", "_blank"), "ghost sm"),
    field("الصفحة الرئيسية", mode),
    sub("الطلبات الواردة تصلك في تبويب «طلبات التجربة»."),
    field("جوال التواصل (واتساب)", phone),
    field("البريد الإلكتروني", email),
    field("واتساب الدعم (يظهر للمدارس)", support),
    field("سطر التواصل", supportNote),
    msg,
    btn("حفظ", async () => {
      mount(msg);
      try {
        await api("/api/owner/settings", { landing_mode: mode.value, brand_phone: phone.value, brand_email: email.value,
          support_whatsapp: support.value, support_note: supportNote.value }, "PUT");
        toast("تم الحفظ");
      } catch (e) { mount(msg, notice(e.message, "err")); }
    }));
}
