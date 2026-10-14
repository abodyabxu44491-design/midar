/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(length) {
  let out = "";
  while (out.length < length) {
    for (const b of crypto.randomBytes(length * 2)) {
      if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export const newStudentKey = () => `${randomCode(4)}-${randomCode(4)}`;
export const newDirectoryCode = () => randomCode(8);
export const newTempPassword = () => `${randomCode(4)}-${randomCode(4)}-${crypto.randomInt(10, 99)}`;
export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

export function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y) && String(a) === String(b);
}
