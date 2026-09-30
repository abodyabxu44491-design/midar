// هوية المدرسة: الشعار وبيانات المدرسة. الشعار يظهر في الشريط العلوي لكل البوابات، وصفحة المدرسة،
// وملف الطالب، والأوراق المطبوعة (كشوف الدرجات، الإيصالات، البطاقات)، وورقة الاختبار.
// نفس المسارات التي يستخدمها معالج أول دخول (/setup/profile و/setup/logo).
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, sub, toast, confirmAction, schoolLogoUrl } from "../../shared/js/ui.js";
import { A, countryField } from "./common.js";

// تصغير الشعار في المتصفح: حتى 600 بكسل للطباعة، ومصغّرة 160 بكسل للشريط العلوي. PNG يحفظ الشفافية.
async function prepareLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("اختر صورة PNG أو JPG أو WebP");
  const bmp = await createImageBitmap(file);
  const draw = (max, mime, q) => {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = c.getContext("2d");
    if (mime === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return { mime, data: c.toDataURL(mime, q).split(",")[1] };
  };
  const mime = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  return { ...draw(600, mime, 0.9), thumb: draw(160, mime, 0.9) };
}

/** لوحة الشعار (تُستخدم في الإعدادات ومعالج الإعداد) */
export function logoPanel({ me, profile, onChange }) {
  let logo = profile?.logo_image_id || me?.school?.logo || null;
  const schoolId = me?.school?.id;
  const box = h("div");
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "hidden" });
  const draw = () => mount(box,
    h("div", { class: "logo-edit" },
      h("div", { class: `logo-preview${logo ? "" : " empty"}` },
        logo ? h("img", { src: schoolLogoUrl(schoolId, logo), alt: "شعار المدرسة" }) : h("span", {}, "لا يوجد شعار")),
      h("div", { class: "logo-acts" },
        btn(logo ? "تغيير الشعار" : "رفع الشعار", () => file.click(), logo ? "ghost" : ""),
        logo ? btn("إزالة", async () => {
          if (!confirmAction("إزالة شعار المدرسة؟")) return;
          await api(`${A}/setup/logo`, undefined, "DELETE");
          logo = null; draw(); toast("أُزيل الشعار"); onChange?.(null);
        }, "danger sm") : null,
        sub("PNG بخلفية شفافة هو الأفضل. يُصغَّر تلقائيًا."))),
    file);
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    try {
      toast("جارٍ رفع الشعار…");
      const r = await api(`${A}/setup/logo`, await prepareLogo(f));
      logo = r.logo_image_id; draw(); toast("حُفظ الشعار"); onChange?.(logo);
    } catch (e) { toast(e.message, true); }
  });
  draw();
  return box;
}

export default async function schoolIdentity({ me }) {
  const { profile: p, catalog: c } = await api(`${A}/setup`);
  const f = {
    name: input({ value: p.name || "" }),
    school_type: select(c.school_types.map((x) => [x.key, x.name]), { value: p.school_type || "private" }),
    gender: select(c.genders.map((x) => [x.key, x.name]), { value: p.gender || "boys" }),
    country: countryField(c.countries, p.country), city: input({ value: p.city || "" }),
    address: input({ value: p.address || "" }),
    email: input({ class: "ltr", type: "email", value: p.email || "" }),
    phone: input({ class: "ltr", inputMode: "tel", value: p.phone || "" }),
  };
  // الشريط العلوي يتحدث فورًا بالشعار الجديد
  const refreshTopbar = (logo) => {
    const slot = document.querySelector(".topbar .school");
    if (!slot) return;
    slot.querySelector(".school-logo")?.remove();
    slot.classList.toggle("with-logo", Boolean(logo));
    if (logo) slot.prepend(h("img", { class: "school-logo", src: schoolLogoUrl(me.school.id, logo), alt: "" }));
  };
  return [
    panel("شعار المدرسة", null,
      sub("يظهر في أعلى كل الصفحات، وصفحة المدرسة وملف الطالب، والأوراق المطبوعة: كشوف الدرجات والإيصالات وبطاقات الطلاب وأوراق الاختبارات."),
      logoPanel({ me, profile: p, onChange: refreshTopbar })),
    panel("بيانات المدرسة", null,
      field("اسم المدرسة", f.name),
      h("div", { class: "row" }, field("نوع المدرسة", f.school_type), field("الجنس", f.gender)),
      h("div", { class: "row" }, field("الدولة", f.country.el), field("المدينة", f.city)),
      field("العنوان", f.address),
      h("div", { class: "row" }, field("البريد الإلكتروني", f.email), field("رقم الهاتف", f.phone)),
      sub("الهاتف والبريد والعنوان تظهر في صفحة المدرسة إن فعّلت «بيانات التواصل» من إعدادات الصفحة العامة."),
      btn("حفظ البيانات", async () => {
        await api(`${A}/setup/profile`, {
          name: f.name.value.trim() || undefined, school_type: f.school_type.value, gender: f.gender.value,
          country: f.country.value(), city: f.city.value.trim() || null, address: f.address.value.trim() || null,
          email: f.email.value.trim(), phone: f.phone.value.trim() }, "PUT");
        const title = document.querySelector(".topbar .school b");
        if (title && f.name.value.trim()) title.textContent = f.name.value.trim();
        toast("حُفظت بيانات المدرسة. رمز الاتصال لرسائل واتساب والعملة يتبعان الدولة.");
      })),
  ];
}
