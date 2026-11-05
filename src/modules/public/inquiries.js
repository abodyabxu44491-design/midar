/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The site's contact and support forms. Every message is saved and shown in the owner's inbox; the form is protected by
// a signed time stamp, a hidden field, a per-address limit and duplicate detection.
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { KINDS, formToken, formTokenProblem, notifyNew } from "../shared/inquiries.service.js";

const r = Router();
const schema = z.object({
  kind: z.enum(Object.keys(KINDS).filter((k) => k !== "admin"), "اختر نوع الطلب"),
  name: t.name("الاسم"),
  email: z.union([z.literal(""), z.null(), z.string().trim().toLowerCase().email("البريد غير صحيح").max(200)]).optional().transform((v) => v || null),
  phone: z.union([z.literal(""), z.null(), z.string().trim().regex(/^[0-9+ ]{6,20}$/, "رقم الجوال غير صحيح")]).optional().transform((v) => v || null),
  organization: t.optText(150),
  subject: z.string().trim().min(3, "اكتب عنوانًا للرسالة").max(200),
  body: z.string().trim().min(10, "اكتب رسالتك (10 أحرف على الأقل)").max(5000, "الرسالة طويلة (5000 حرف كحد أقصى)"),
  website: z.string().max(200).optional(),
  token: z.string().max(80).optional(),
}).refine((x) => x.email || x.phone, { message: "اكتب بريدك أو رقم جوالك لنرد عليك", path: ["email"] });

r.get("/form", (req, res) => { res.set("Cache-Control", "no-store").json({ token: formToken(), kinds: KINDS }); });

r.post("/", limits.login, handle(async (req, res) => {
  const b = parse(schema, req.body);
  // A hidden field people never see: if it is filled, a bot filled it. It gets the same reply, and nothing is saved.
  if (b.website) return res.status(201).json({ ok: true, message: "وصلتنا رسالتك." });
  const problem = formTokenProblem(b.token);
  if (problem) throw badRequest(problem);
  const [{ id }] = await transaction({ actor: "زائر", ip: req.ip }, (q) => q("SELECT submit_inquiry($1::jsonb) AS id", [JSON.stringify(b)]));
  notifyNew(id);
  res.status(201).json({ ok: true, id: Number(id), message: `وصلتنا رسالتك برقم ${id}. سنرد عليك قريبًا بإذن الله.` });
}));

export default r;
