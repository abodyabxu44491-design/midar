/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// A short, readable school code (used in the school's link) made from its Arabic or English name.
const MAP = { ا: "a", أ: "a", إ: "i", آ: "a", ء: "", ؤ: "u", ئ: "i", ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh", د: "d", ذ: "dh", ر: "r", ز: "z",
  س: "s", ش: "sh", ص: "s", ض: "d", ط: "t", ظ: "z", ع: "a", غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n", ه: "h", ة: "a", و: "w", ي: "y", ى: "a" };
const GENERIC = new Set(["مدرسة", "مدرسه", "مدارس", "مجمع", "مجمعات", "روضة", "روضه", "معهد", "الأهلية", "الاهلية", "الأهليه", "الاهليه", "الخاصة", "الخاصه",
  "النموذجية", "النموذجيه", "العالمية", "العالميه", "الدولية", "الدوليه", "للبنين", "للبنات", "بنين", "بنات", "الثانوية", "الابتدائية", "المتوسطة", "الأساسية",
  "school", "schools", "international", "private", "academy"]);

const isV = (c) => "aeiou".includes(c);
function latin(word) {
  let w = word.replace(/[\u064B-\u0652\u0640]/g, "");
  if (/^[a-z0-9]+$/i.test(w)) return w.toLowerCase();
  const al = w.startsWith("ال") && w.length > 3;
  if (al) w = w.slice(2);
  const chars = [...w];
  let out = "";
  chars.forEach((ch, i) => {
    const prev = out.slice(-1), last = i === chars.length - 1;
    if (ch === "و" && prev && !isV(prev)) { out += last ? "o" : "oo"; return; }
    if (ch === "ي" && prev && !isV(prev)) { out += last ? "i" : "ee"; return; }
    out += MAP[ch] ?? (/[a-z0-9]/i.test(ch) ? ch.toLowerCase() : /[٠-٩]/.test(ch) ? String("٠١٢٣٤٥٦٧٨٩".indexOf(ch)) : "");
  });
  if (!/[aeiou]/.test(out.slice(1))) out = out.replace(/^([^aeiou]*[aeiou]?)([^aeiou])([^aeiou])/, "$1$2a$3");
  out = out.replace(/([aeiou])\1\1+/g, "$1$1");
  return al ? `al${out}` : out;
}

export function schoolCodeFrom(name) {
  const words = String(name || "").trim().split(/[\s\-_.,،]+/).filter(Boolean);
  const kept = words.filter((w) => !GENERIC.has(w.toLowerCase()));
  const parts = (kept.length ? kept : words).map(latin).filter(Boolean);
  let code = "";
  for (const p of parts) { const next = code ? `${code}-${p}` : p; if (next.length > 24) break; code = next; }
  code = code.replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (code.length < 3) code = `school${code ? `-${code}` : ""}`;
  return code.slice(0, 24);
}
