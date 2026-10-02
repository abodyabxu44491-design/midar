// صفحتا الخصوصية والشروط: النص ثابت في الصفحة، وبيانات التواصل من إعدادات المنصة (لوحة المالك)
import { h, mount } from "../shared/js/dom.js";

async function contact() {
  let s = {};
  try { s = await (await fetch("/api/site")).json(); } catch { return; }
  const phone = s.support_whatsapp || s.brand_phone;
  const parts = [
    s.brand_email ? h("a", { href: `mailto:${s.brand_email}`, class: "ltr" }, s.brand_email) : null,
    phone ? h("a", { href: `https://wa.me/${String(phone).replace(/\D/g, "")}`, target: "_blank", rel: "noopener", class: "ltr" }, phone) : null,
  ].filter(Boolean);
  if (!parts.length) return;
  for (const el of document.querySelectorAll("[data-contact]")) {
    mount(el, parts.flatMap((p, i) => (i ? [" أو واتساب ", p] : ["البريد ", p])), ".");
  }
}
contact();
