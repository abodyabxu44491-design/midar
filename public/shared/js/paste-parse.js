/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { detectPhone } from "./phone.js";

const AR_DIGITS = /[٠-٩]/g, FA_DIGITS = /[۰-۹]/g;
export const ascii = (v) => String(v ?? "").replace(AR_DIGITS, (d) => d.charCodeAt(0) - 0x0660).replace(FA_DIGITS, (d) => d.charCodeAt(0) - 0x06F0);

export const normName = (v) => String(v ?? "")
  .replace(/[ً-ٰٟـ]/g, "")
  .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/\s+/g, " ").trim();

export const cleanName = (v) => String(v ?? "")
  .replace(/[0-9٠-٩۰-۹]/g, " ")
  .replace(/[()[\]{}:;،,.\-_/\\|*#"'«»؟?!+=]/g, " ")
  .replace(/\s+/g, " ").trim();

export function normalizePhone(raw, dial = "967") {
  const p = detectPhone(raw, dial);
  return p ? { phone: p.stored, ok: p.ok, label: p.label, country: p.country } : { phone: null, ok: false, label: null, country: null };
}

const PHONE_RE = /\+?[0-9][0-9\s-]{5,17}[0-9]/g;
const LEADING_NUMBER = /^\s*[0-9]{1,3}\s*[-).:،,]\s*(?=[^\d\s])|^\s*[0-9]{1,3}\s+(?=[^\d\s])/;

export function parseList(text, { dial = "967", existing = [] } = {}) {
  const have = new Set(existing.map(normName));
  const seen = new Map();
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    let line = ascii(raw).replace(/‎|‏| /g, " ").trim();
    if (!line) continue;
    const cells = line.includes("\t") ? line.split("\t") : /[|;،,]/.test(line) ? line.split(/[|;،,]/) : [line];
    let phone = null, phoneOk = false, phoneLabel = null, phoneCountry = null;
    const texts = [];
    for (let cell of cells) {
      cell = cell.trim();
      if (!cell) continue;
      cell = cell.replace(LEADING_NUMBER, "");
      cell = cell.replace(PHONE_RE, (m) => {
        const parts = m.split(/[\s-]+/).filter(Boolean);
        let p = normalizePhone(m, dial);
        if (!p.ok && parts.length > 1 && parts[0].length <= 3) { const alt = normalizePhone(parts.slice(1).join(""), dial); if (alt.ok) p = alt; }
        if (p.phone && p.phone.replace(/\D/g, "").length >= 7 && !phone) { phone = p.phone; phoneOk = p.ok; phoneLabel = p.label; phoneCountry = p.country; return "\u0000"; }
        return m.replace(/\D/g, "").length >= 7 ? " " : m;
      });
      for (const part of cell.split("\u0000")) { const name = cleanName(part); if (name) texts.push(name); }
    }
    if (!phone && texts.length && texts.every((t) => /^(الاسم|اسم الطالب|اسم المعلم|الجوال|رقم الجوال|ولي الامر|ولي الأمر|اسم ولي الامر|اسم ولي الأمر|الهاتف|م|التخصص|المادة|name|phone)$/i.test(t))) continue;
    const name = texts[0] || "";
    if (!name) continue;
    const words = name.split(" ");
    const suggested = texts[1] ? null : (words.length >= 3 ? words.slice(1).join(" ") : null);
    const warnings = [];
    if (words.length < 3) warnings.push("الاسم أقل من ثلاثي");
    if (!/[؀-ۿa-zA-Z]{2}/.test(name)) warnings.push("الاسم غير واضح");
    if (phone && !phoneOk) warnings.push("رقم الجوال بشكل غير معتاد");
    const key = normName(name);
    const duplicate = seen.has(key);
    seen.set(key, true);
    out.push({
      name, guardian_name: texts[1] || suggested, guardian_suggested: Boolean(suggested), extra: texts.slice(2).join(" ") || null,
      phone, phone_ok: phone ? phoneOk : null, phone_label: phone ? phoneLabel : null, phone_country: phone ? phoneCountry : null,
      warnings, duplicate, exists: have.has(key),
    });
  }
  return out;
}
