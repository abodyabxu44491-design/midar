// رسائل واتساب: تُجهّز الرسالة ويُفتح تطبيق واتساب من جهاز المستخدم.
// لا يوجد اشتراك ولا مزود رسائل، ولا يُرسل أي شيء من الخادم.
import { h } from "./dom.js";
import { money, today, fmtDate } from "./format.js";
import { detectPhone } from "./phone.js";

/**
 * تحويل الرقم إلى صيغة واتساب الدولية، والدولة تُعرف من الرقم نفسه:
 *   777123456 → 967777123456 (يمني)   0501234567 → 966501234567 (سعودي مغترب)
 *   +971501234567 → 971501234567 (أي دولة بمفتاحها)
 * countryCode (رمز دولة المدرسة) يُستخدم فقط لرقم لا يُعرف شكله (مثل الهاتف الثابت).
 */
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

/**
 * زر واتساب جاهز.
 * @param {{phone, template, vars, countryCode, label}} o
 */
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
