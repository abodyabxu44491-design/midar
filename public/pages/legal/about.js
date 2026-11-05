/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The identity card is filled only from what the owner entered: a fact that was not entered is not shown.
import { h, mount } from "../shared/js/dom.js";

const SOCIAL = { instagram: "إنستغرام", x: "X", facebook: "فيسبوك", linkedin: "لينكدإن", youtube: "يوتيوب", tiktok: "تيك توك", snapchat: "سناب شات", telegram: "تيليجرام" };

document.addEventListener("midar:site", ({ detail: s }) => {
  const o = s.official || {};
  const c = s.company || {};
  const facts = document.querySelector("[data-facts]");
  const add = (k, v) => { if (v) facts.append(h("dt", {}, k), h("dd", {}, v)); };
  add("الموقع الرسمي", o.site_url ? h("a", { href: o.site_url, class: "ltr" }, o.site_url) : null);
  add("سنة التأسيس", o.founded_year ? String(o.founded_year) : null);
  add("الجهة المشغّلة", c.legal_name || c.name_en || c.name || null);
  add("الدولة", c.country || null);
  add("السجل التجاري", c.reg_no ? h("span", { class: "ltr" }, c.reg_no) : null);
  const social = Object.entries(o.social || {});
  add("الحسابات الرسمية", social.length ? h("span", {}, social.map(([k, u], i) => [i ? " · " : "", h("a", { href: u, target: "_blank", rel: "noopener me" }, SOCIAL[k] || k)])) : null);
  if (o.summary) document.querySelector("[data-summary]").textContent = o.summary;
  if (o.audience) document.querySelector("[data-audience]").textContent = o.audience;
  const groups = {};
  for (const f of s.features || []) (groups[f.category || "أخرى"] ||= []).push(f.name);
  const list = Object.entries(groups);
  mount(document.querySelector("[data-services]"), list.length ? list.map(([g, names]) => h("li", {}, h("b", {}, `${g}: `), names.join("، ")))
    : h("li", {}, "إدارة الطلاب والمعلمين، والحضور والغياب، والاختبارات والدرجات والشهادات، والجداول، والرسوم والرواتب، والتواصل مع أولياء الأمور."));
  if (o.upcoming?.length) {
    document.querySelector("[data-upcoming-box]").hidden = false;
    mount(document.querySelector("[data-upcoming]"), o.upcoming.map((x) => h("li", {}, x)));
  }
});
