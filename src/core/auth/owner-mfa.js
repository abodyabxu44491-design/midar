/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The owner's second factor: OWNER_TOTP_SECRET when set on the server, otherwise the one enrolled from the sign-in
// screen (stored encrypted in owner_security). Used by sign-in and by every step that re-confirms the owner.
import { env } from "../../config/env.js";
import { openSecret } from "./secret-box.js";

export const TOTP_AAD = "owner-totp";

export async function ownerTotp(q) {
  if (env.OWNER_TOTP_SECRET) return { secret: env.OWNER_TOTP_SECRET, source: "env" };
  const [row] = await q("SELECT totp_enc, enrolled_at FROM owner_security WHERE id = 1");
  const secret = row?.totp_enc ? openSecret(row.totp_enc, TOTP_AAD) : null;
  return secret ? { secret, source: "app", enrolled_at: row.enrolled_at } : null;
}
