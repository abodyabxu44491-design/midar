/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
const AR = /[٠-٩]/g, FA = /[۰-۹]/g;
const ascii = (v) => String(v ?? "").replace(AR, (d) => d.charCodeAt(0) - 0x0660).replace(FA, (d) => d.charCodeAt(0) - 0x06F0);

export const COUNTRY_CODES = {
  967: { key: "YE", name: "يمني" }, 966: { key: "SA", name: "سعودي" }, 971: { key: "AE", name: "إماراتي" }, 968: { key: "OM", name: "عُماني" },
  974: { key: "QA", name: "قطري" }, 965: { key: "KW", name: "كويتي" }, 973: { key: "BH", name: "بحريني" }, 20: { key: "EG", name: "مصري" },
  962: { key: "JO", name: "أردني" }, 249: { key: "SD", name: "سوداني" }, 90: { key: "TR", name: "تركي" }, 60: { key: "MY", name: "ماليزي" },
  44: { key: "GB", name: "بريطاني" }, 1: { key: "US", name: "أمريكي" },
};
const YE_MOBILE = /^7[01378][0-9]{7}$/;
const SA_MOBILE = /^5[0-9]{8}$/;

function codeOf(intl) {
  for (const len of [3, 2, 1]) { const c = COUNTRY_CODES[intl.slice(0, len)]; if (c) return { code: intl.slice(0, len), ...c }; }
  return null;
}

export function detectPhone(raw, fallbackDial = "967") {
  let d = ascii(raw).trim().replace(/[^\d+]/g, "");
  if (!d.replace(/\+/g, "")) return null;
  let explicit = false;
  if (d.startsWith("+")) { d = d.slice(1).replace(/\+/g, ""); explicit = true; } else if (d.startsWith("00")) { d = d.slice(2); explicit = true; }
  d = d.replace(/\+/g, "");

  const withCode = explicit || (/^(967|966)/.test(d) && d.length === 12);
  if (withCode) {
    const c = codeOf(d);
    const national = c ? d.slice(c.code.length) : d;
    if (c?.key === "YE") return { intl: d, country: "YE", label: c.name, stored: national.replace(/^0/, ""), ok: YE_MOBILE.test(national.replace(/^0/, "")) };
    if (c?.key === "SA") { const n = national.replace(/^0/, ""); return { intl: `966${n}`, country: "SA", label: c.name, stored: `0${n}`, ok: SA_MOBILE.test(n) }; }
    return { intl: d, country: c?.key || null, label: c?.name || "دولي", stored: `+${d}`, ok: d.length >= 8 && d.length <= 15 };
  }
  if (YE_MOBILE.test(d) || (d.length === 10 && YE_MOBILE.test(d.slice(1)) && d.startsWith("0"))) {
    const n = d.length === 10 ? d.slice(1) : d;
    return { intl: `967${n}`, country: "YE", label: "يمني", stored: n, ok: true };
  }
  if (/^05[0-9]{8}$/.test(d) || SA_MOBILE.test(d)) {
    const n = d.replace(/^0/, "");
    return { intl: `966${n}`, country: "SA", label: "سعودي", stored: `0${n}`, ok: true };
  }
  const dial = String(fallbackDial || "").replace(/\D/g, "");
  const n = d.replace(/^0/, "");
  const c = COUNTRY_CODES[dial];
  return { intl: dial ? `${dial}${n}` : d, country: c?.key || null, label: c?.name || null, stored: d, ok: false };
}

export const storedPhone = (raw, fallbackDial) => detectPhone(raw, fallbackDial)?.stored ?? null;
