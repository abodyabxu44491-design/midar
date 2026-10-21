/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The owner's second factor: OWNER_TOTP_SECRET when set on the server, otherwise the one enrolled from the sign-in
// screen (stored encrypted in owner_security). One-time backup codes stand in for the app when the phone is not
// at hand. Used by sign-in and by every step that re-confirms the owner.
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { openSecret } from "./secret-box.js";
import { verifyTotp } from "./totp.js";
import { raiseAlert } from "../audit.js";

export const TOTP_AAD = "owner-totp";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I lookalikes
const RECOVERY_COUNT = 10;
const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const normalize = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function ownerTotp(q) {
  if (env.OWNER_TOTP_SECRET) return { secret: env.OWNER_TOTP_SECRET, source: "env" };
  const [row] = await q("SELECT totp_enc, enrolled_at FROM owner_security WHERE id = 1");
  const secret = row?.totp_enc ? openSecret(row.totp_enc, TOTP_AAD) : null;
  return secret ? { secret, source: "app", enrolled_at: row.enrolled_at } : null;
}

// A new set of backup codes (the previous set stops working). Returned once in plain text, stored hashed.
export async function newRecoveryCodes(q) {
  const codes = Array.from({ length: RECOVERY_COUNT }, () => {
    const c = Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
  await q("DELETE FROM owner_recovery_codes");
  await q("INSERT INTO owner_recovery_codes (code_hash) SELECT unnest($1::text[])", [codes.map((c) => sha(normalize(c)))]);
  return codes;
}

export async function recoveryLeft(q) {
  const [r] = await q("SELECT count(*)::int AS n FROM owner_recovery_codes WHERE used_at IS NULL");
  return r.n;
}

// The six digits from the app, or one unused backup code (which is then spent and reported as an alert).
export async function checkOwnerFactor(q, mfa, code, ip) {
  if (!mfa) return true;
  if (verifyTotp(mfa.secret, code)) return true;
  const n = normalize(code);
  if (n.length !== 8) return false;
  const [used] = await q("UPDATE owner_recovery_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL RETURNING 1", [sha(n)]);
  if (!used) return false;
  const left = await recoveryLeft(q);
  await raiseAlert(q, { kind: "owner_recovery_used", severity: "high", title: "استُخدم رمز احتياطي لدخول لوحة المالك",
    detail: `من العنوان ${ip || "غير معروف"}. بقي ${left} من الرموز الاحتياطية. إن لم تكن أنت فغيّر كلمة المرور وأنشئ رموزًا جديدة فورًا.` });
  return true;
}
