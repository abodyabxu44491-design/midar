/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../shared/js/dom.js";
import { operatorLine, productLine } from "../shared/js/company.js";

const mailto = (a) => h("a", { href: `mailto:${a}`, class: "ltr" }, a);
const LABEL = { support: "الدعم الفني", sales: "الاشتراكات والمبيعات", info: "الاستفسارات العامة", admin: "المراسلات الإدارية" };

async function contact() {
  let s = {};
  try { s = await (await fetch("/api/site")).json(); } catch { return; }
  const operator = operatorLine(s.company);
  for (const el of document.querySelectorAll("[data-operator]")) { el.textContent = operator || ""; el.hidden = !operator; }
  for (const el of document.querySelectorAll("[data-product]")) el.textContent = productLine(s.company);
  const emails = s.official?.emails || {};
  const main = emails.support || emails.info || s.brand_email;
  for (const el of document.querySelectorAll("[data-footmail]")) mount(el, main ? [" · ", mailto(main)] : null);

  const phone = s.support_whatsapp || s.brand_phone;
  const parts = [
    main ? ["البريد ", mailto(main)] : null,
    phone ? ["واتساب ", h("a", { href: `https://wa.me/${String(phone).replace(/\D/g, "")}`, target: "_blank", rel: "noopener", class: "ltr" }, phone)] : null,
    s.brand_instagram ? ["إنستغرام ", h("a", { href: `https://instagram.com/${encodeURIComponent(s.brand_instagram)}`, target: "_blank", rel: "noopener", class: "ltr" }, `@${s.brand_instagram}`)] : null,
  ].filter(Boolean);
  if (parts.length) {
    for (const el of document.querySelectorAll("[data-contact]")) mount(el, "تواصل معنا: ", parts.flatMap((p, i) => (i ? ["، أو ", ...p] : p)), ".");
  }
  // The full list of official addresses, each with what it is for (support, about pages).
  const list = Object.entries(emails);
  for (const el of document.querySelectorAll("[data-official]")) {
    if (!list.length && !phone) continue;
    mount(el, h("ul", {},
      list.map(([k, a]) => h("li", {}, `${LABEL[k] || k}: `, mailto(a))),
      phone ? h("li", {}, "واتساب: ", h("a", { href: `https://wa.me/${String(phone).replace(/\D/g, "")}`, target: "_blank", rel: "noopener", class: "ltr" }, phone)) : null,
      s.official?.site_url ? h("li", {}, "الموقع الرسمي: ", h("a", { href: s.official.site_url, class: "ltr" }, s.official.site_url)) : null));
  }
  document.dispatchEvent(new CustomEvent("midar:site", { detail: s }));
}
contact();
