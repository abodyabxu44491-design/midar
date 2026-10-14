/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h } from "./dom.js";
import { money, today, fmtDate } from "./format.js";
import { detectPhone } from "./phone.js";

export function toIntl(phone, countryCode = "967") {
  return detectPhone(phone, countryCode)?.intl || null;
}

export function fillTemplate(template, vars) {
  return String(template || "").replace(/\{([^}]+)\}/g, (m, k) => (vars[k.trim()] ?? m));
}

export function waLink(phone, text, countryCode = "967") {
  const num = toIntl(phone, countryCode);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

export function waButton({ phone, template, vars, countryCode = "967", label = "واتساب", cls = "ghost sm" }) {
  const url = waLink(phone, fillTemplate(template, vars), countryCode);
  if (!url) return h("span", { class: "sub" }, "لا يوجد جوال");
  return h("a", { class: `btn ${cls}`, href: url, target: "_blank", rel: "noopener" }, label);
}

export const messageVars = ({ student, school, fees, link }) => ({
  "الطالب": student.name,
  "المدرسة": school,
  "الفصل": student.class_name || "",
  "التاريخ": fmtDate(today()),
  "المبلغ": fees ? money(fees.remaining) : "",
  "الرابط": link || "",
});
