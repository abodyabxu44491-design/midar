/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Email received at the platform's addresses. Cloudflare Email Routing hands each message to the email Worker, which
// forwards it to the owner's inbox and posts its text here, signed with INBOUND_EMAIL_SECRET. Unsigned calls are refused.
import { handle, notFound, unauthorized, badRequest } from "../../core/http/errors.js";
import { env } from "../../config/env.js";
import { inboundSignatureOk, recordEmail } from "../shared/inquiries.service.js";

export const inboundEmail = handle(async (req, res) => {
  if (!env.INBOUND_EMAIL_SECRET) throw notFound();
  const raw = typeof req.body === "string" ? req.body : "";
  if (!inboundSignatureOk(raw, req.get("x-midar-signature"))) throw unauthorized("توقيع غير صحيح");
  let m;
  try { m = JSON.parse(raw); } catch { throw badRequest("JSON غير صحيح"); }
  const sent = Number(m.sent_at);
  if (!(Math.abs(Date.now() - sent) < 10 * 60_000)) throw unauthorized("انتهت صلاحية الطلب");
  res.json(await recordEmail(m));
});
