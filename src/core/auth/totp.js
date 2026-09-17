// التحقق الثنائي (TOTP) متوافق مع Google Authenticator و Microsoft Authenticator
import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newTotpSecret() {
  return Array.from(crypto.randomBytes(20), (b) => B32[b % 32]).join("");
}

function base32Decode(s) {
  let bits = "";
  for (const c of s.replace(/=+$/, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function codeAt(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

// يقبل الرمز الحالي والذي قبله وبعده (فرق توقيت 30 ثانية)
export function verifyTotp(secret, code) {
  if (!/^\d{6}$/.test(String(code || ""))) return false;
  const now = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(codeAt(secret, now + d)), Buffer.from(String(code))));
}

export const totpUri = (secret, label = "MIDAR:owner") =>
  `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=MIDAR&algorithm=SHA1&digits=6&period=30`;
