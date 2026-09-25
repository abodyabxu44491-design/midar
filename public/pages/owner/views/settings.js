// إعدادات المنصة: الصفحة الرسمية، التواصل، التجربة المجانية، وسياسة الاشتراكات
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, select, input, textarea, btn, sub, toast, notice } from "/shared/js/ui.js";

export default async function settings() {
  const s = await api("/api/owner/settings");
  const msg = h("div");
  const chk = (v, label, hint) => { const el = h("input", { type: "checkbox", checked: !!v, style: "width:18px;height:18px;flex:none;margin-top:3px" });
    return [el, h("label", { class: "row", style: "align-items:flex-start;gap:8px;margin-bottom:10px;cursor:pointer" }, el, h("div", {}, h("b", {}, label), hint ? sub(hint) : null))]; };

  // الصفحة الرسمية والتواصل
  const mode = select([["blank", "فاضية (الشعار فقط)"], ["marketing", "الصفحة الرسمية: الباقات والتجربة والتواصل"]], { value: s.landing_mode });
  const headline = input({ value: s.site_headline || "", placeholder: "إدارة مدرستك كاملة في مكان واحد" });
  const subhead = textarea({ rows: 2, value: s.site_subheadline || "" });
  const phone = input({ class: "ltr", value: s.brand_phone || "" });
  const email = input({ class: "ltr", type: "email", value: s.brand_email || "" });
  const support = input({ class: "ltr", inputMode: "tel", value: s.support_whatsapp || "" });
  const supportNote = input({ value: s.support_note || "", placeholder: "سطر يظهر للمدارس في صفحة اشتراكها" });

  // إعدادات التجربة المجانية
  const [tOn, tOnL] = chk(s.trial_enabled, "التجربة المجانية متاحة");
  const days = input({ type: "number", min: 1, max: 365, value: s.trial_days });
  const [tAll, tAllL] = chk(s.trial_all_plans, "التجربة متاحة لكل الباقات", "إذا ألغيتها يُطبَّق خيار «تتيح تجربة مجانية» في كل باقة على حدة");
  const [tNo, tNoL] = chk(s.trial_without_plan, "يمكن طلب تجربة المنصة بدون اختيار باقة", "وأنت تحدد الباقة عند التفعيل");
  const perSchool = input({ type: "number", min: 1, max: 10, value: s.trials_per_school });
  const reminders = input({ value: (s.trial_reminder_days || []).join("، "), placeholder: "7، 3، 1" });
  const tGrace = input({ type: "number", min: 0, max: 30, value: s.trial_grace_days });
  const [tExt, tExtL] = chk(s.trial_owner_extend, "يمكنني تمديد التجربة يدويًا");
  const [showPlans, showPlansL] = chk(s.show_plans_after_expiry, "تظهر الباقات للمدرسة بعد انتهاء التجربة أو الاشتراك", "مع إمكانية إرسال طلب اشتراك من داخل حسابها");
  // سياسة الاشتراكات
  const grace = input({ type: "number", min: 0, max: 60, value: s.default_grace_days });
  const reqMode = select([["request", "زر «طلب هذه الميزة»"], ["upgrade", "زر «طلب ترقية الباقة»"], ["hidden", "بدون أزرار (تظهر مقفلة فقط)"]], { value: s.feature_request_mode });

  const save = async () => {
    mount(msg);
    try {
      await api("/api/owner/settings", {
        landing_mode: mode.value, site_headline: headline.value, site_subheadline: subhead.value, brand_phone: phone.value, brand_email: email.value,
        support_whatsapp: support.value, support_note: supportNote.value,
        trial_enabled: tOn.checked, trial_days: Number(days.value), trial_all_plans: tAll.checked, trial_without_plan: tNo.checked,
        trials_per_school: Number(perSchool.value), trial_reminder_days: reminders.value.split(/[،,\s]+/).filter(Boolean).map(Number),
        trial_grace_days: Number(tGrace.value), trial_owner_extend: tExt.checked, show_plans_after_expiry: showPlans.checked,
        default_grace_days: Number(grace.value), feature_request_mode: reqMode.value,
      }, "PUT");
      toast("تم الحفظ");
    } catch (e) { mount(msg, notice(e.message, "err")); }
  };

  return [
    panel("الصفحة الرسمية", btn("معاينة الصفحة", () => window.open("/", "_blank"), "ghost sm"),
      field("الصفحة الرئيسية", mode), field("العنوان الرئيسي", headline), field("الوصف المختصر", subhead),
      sub("الباقات والأسعار والمميزات تُقرأ من تبويب «الباقات» تلقائيًا.")),
    panel("التواصل", null,
      h("div", { class: "row" }, field("جوال التواصل (واتساب) في الصفحة", phone), field("البريد الإلكتروني", email)),
      h("div", { class: "row" }, field("واتساب الدعم (يظهر للمدارس)", support), field("سطر التواصل", supportNote))),
    panel("إعدادات التجربة المجانية", null,
      tOnL, h("div", { class: "row" }, field("مدة التجربة (يوم)", days), field("عدد التجارب المسموحة لكل مدرسة", perSchool, "الافتراضي مرة واحدة، ويمكنك منح تجربة إضافية يدويًا"),
        field("فترة سماح بعد التجربة (يوم)", tGrace)),
      field("أيام التنبيه قبل انتهاء التجربة", reminders, "تظهر للمدرسة وتُسجَّل في سجل الاشتراك"),
      tAllL, tNoL, tExtL, showPlansL,
      notice("عند انتهاء التجربة: يتوقف الوصول فقط، والبيانات كلها محفوظة. المدير يدخل ويرى «انتهت تجربتك المجانية — اختر باقة للاستمرار».", "")),
    panel("سياسة الاشتراكات", null,
      h("div", { class: "row" }, field("فترة السماح الافتراضية بعد انتهاء الاشتراك (يوم)", grace, "0 = بدون فترة سماح"),
        field("المميزات غير المتاحة في باقة المدرسة", reqMode))),
    msg, btn("حفظ الإعدادات", save),
  ];
}
