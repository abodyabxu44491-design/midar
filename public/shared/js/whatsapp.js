// رسائل واتساب: تُجهّز الرسالة ويُفتح تطبيق واتساب من جهاز المستخدم.
// لا يوجد اشتراك ولا مزود رسائل، ولا يُرسل أي شيء من الخادم.
import { h } from "./dom.js";
import { money, today, fmtDate } from "./format.js";

/**
 * تحويل الرقم إلى صيغة واتساب الدولية:
 *   +967771234567 → 967771234567 (أي دولة، كما كُتب)
 *   0501234567 مع رمز دولة المدرسة 966 → 966501234567
 */
export function toIntl(phone, countryCode = "966") {
  const raw = String(phone || "").trim();
  if (!raw) return null;
  if (raw.startsWith("+")) return raw.slice(1).replace(/\D/g, "") || null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return String(countryCode).replace(/\D/g, "") + digits.slice(1);
  if (digits.startsWith(String(countryCode))) return digits;
  return String(countryCode).replace(/\D/g, "") + digits;
}

export function fillTemplate(template, vars) {
  return String(template || "").replace(/\{([^}]+)\}/g, (m, k) => (vars[k.trim()] ?? m));
}

export function waLink(phone, text, countryCode = "966") {
  const num = toIntl(phone, countryCode);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

/**
 * زر واتساب جاهز.
 * @param {{phone, template, vars, countryCode, label}} o
 */
export function waButton({ phone, template, vars, countryCode = "966", label = "واتساب", cls = "ghost sm" }) {
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
