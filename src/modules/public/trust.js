/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The public trust center: which internal badges are active and on what check, and the verification of a certificate
// by its number. Only what a visitor needs is returned, never a check's private evidence.
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { publicTrust, verifyCertificate } from "../shared/trust.service.js";
import { qrDataUrl } from "../shared/certificates.service.js";

const r = Router();
r.get("/", handle(async (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json(await transaction({ ip: req.ip }, (q) => publicTrust(q)));
}));
r.get("/verify/:ref", handle(async (req, res) => {
  const ref = String(req.params.ref || "").trim().toUpperCase();
  if (!/^MS-[0-9]{4}-[0-9]{4}$/.test(ref)) throw notFound("لا توجد شهادة بهذا الرقم");
  const c = await transaction({ ip: req.ip }, (q) => verifyCertificate(q, ref));
  if (!c) throw notFound("لا توجد شهادة بهذا الرقم");
  res.set("Cache-Control", "no-store");
  res.json({ ...c, qr: qrDataUrl(`${req.protocol}://${req.get("host")}/trust/verify/${c.ref}`) });
}));
export default r;
