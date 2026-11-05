/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The owner's side of the trust center: run the automatic checks, record procedures with their evidence, set the domain
// to verify, and issue or revoke internal certificates. Every check is kept; nothing here can be edited after the fact.
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { KINDS, KIND_NAMES, CERT_KINDS, INTERNAL_NOTE, runAutomatic, recordCheck, latestChecks, issueCertificate,
  revokeCertificate, setDomain, domainInstructions } from "../shared/trust.service.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const kindP = z.object({ kind: z.enum(KIND_NAMES, "نوع الفحص غير معروف") });
const AUTO_KINDS = KIND_NAMES.filter((k) => KINDS[k].method === "automatic");
const RECORDED_KINDS = KIND_NAMES.filter((k) => KINDS[k].method === "recorded");

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, async (q) => {
    const [s] = await q("SELECT trust_domain, trust_domain_token FROM platform_settings WHERE id");
    return {
      note: INTERNAL_NOTE,
      kinds: await latestChecks(q),
      domain: domainInstructions(s?.trust_domain, s?.trust_domain_token),
      certificates: await q(`SELECT x.*, (x.revoked_at IS NULL AND x.valid_until > now()) AS valid FROM trust_certificates x
                              ORDER BY x.issued_at DESC LIMIT 200`),
    };
  }));
}));

r.get("/checks/:kind", handle(async (req, res) => {
  const { kind } = parse(kindP, req.params);
  res.json(await platform(req, (q) => q("SELECT * FROM trust_checks WHERE kind = $1 ORDER BY checked_at DESC LIMIT 50", [kind])));
}));

// Runs every automatic check, or one of them.
r.post("/run", handle(async (req, res) => {
  const { kind } = parse(z.object({ kind: z.enum(AUTO_KINDS, "هذا الفحص لا يعمل آليًا").optional() }), req.body || {});
  res.status(201).json(await platform(req, async (q) => {
    const out = [];
    for (const k of kind ? [kind] : AUTO_KINDS) out.push(await runAutomatic(q, k, req.actor));
    return out;
  }));
}));

const recordSchema = z.object({
  kind: z.enum(RECORDED_KINDS, "هذا الفحص آلي ولا يُسجَّل يدويًا"),
  passed: z.boolean({ error: "حدّد نتيجة الإجراء" }),
  summary: z.string().trim().min(10, "اكتب ما الذي نُفّذ ونتيجته (10 أحرف على الأقل)").max(500),
  reference: z.string().trim().min(3, "اكتب مرجع الدليل: رابطًا أو رقم نسخة أو اسم ملف").max(300),
  details: t.optText(5000),
  confirm: z.literal(true, { error: "أكّد أن الإجراء نُفّذ فعلًا وأن الدليل محفوظ لديك" }),
});
r.post("/record", handle(async (req, res) => {
  const b = parse(recordSchema, req.body);
  res.status(201).json(await platform(req, (q) => recordCheck(q, b, req.actor)));
}));

r.put("/domain", handle(async (req, res) => {
  const { domain } = parse(z.object({
    domain: z.string().trim().toLowerCase().max(253).regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, "اكتب النطاق فقط، مثل midar.school"),
  }), req.body);
  res.json(await platform(req, (q) => setDomain(q, domain)));
}));

r.post("/certificates", handle(async (req, res) => {
  const { kind } = parse(z.object({ kind: z.enum(CERT_KINDS, "لا توجد شهادة لهذا النوع") }), req.body);
  res.status(201).json(await platform(req, (q) => issueCertificate(q, kind, req.actor)));
}));

r.post("/certificates/:id/revoke", handle(async (req, res) => {
  const { id } = parse(z.object({ id: t.id }), req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, "اكتب سبب الإلغاء").max(300) }), req.body);
  res.json(await platform(req, (q) => revokeCertificate(q, id, reason)));
}));

export default r;
