// توليد الرموز العشوائية الآمنة
import crypto from "node:crypto";

// بدون الحروف المتشابهة (0 O 1 I L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(length) {
  let out = "";
  while (out.length < length) {
    for (const b of crypto.randomBytes(length * 2)) {
      if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length]; // بدون انحياز
      if (out.length === length) break;
    }
  }
  return out;
}

export const newStudentKey = () => `${randomCode(4)}-${randomCode(4)}`;   // مثال: K7P2-QX9M
export const newDirectoryCode = () => randomCode(8);
export const newTempPassword = () => `${randomCode(4)}-${randomCode(4)}-${crypto.randomInt(10, 99)}`;
export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

export function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y) && String(a) === String(b);
}
