/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { handle, notFound } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { parse, t, z } from "../../core/http/validate.js";
import { inSchool, verifyStudent } from "./context.js";
import * as uni from "../shared/university.service.js";

// A university student registers for and drops sections from the student page, under the same rules as the registrar
// (without the registrar's overrides), and only while registration is open.
const r = Router({ mergeParams: true });
const run = (req, fn) => inSchool(req, "طالب", async (q, tenant) => {
  if (tenant.org_type !== "university") throw notFound("هذا القسم للجامعات");
  const s = await verifyStudent(req, tenant, q, req.body);
  return fn(q, s);
});
r.post("/student/university", limits.studentKey, handle(async (req, res) => res.json(await run(req, (q, s) => uni.studentView(q, s.id)))));
r.post("/student/university/register", limits.studentKey, handle(async (req, res) => {
  const { section_id } = parse(z.object({ section_id: t.id }), req.body);
  res.status(201).json(await run(req, async (q, s) => {
    await uni.register(q, { student_id: s.id, section_id }, { actor: "الطالب", self: true });
    return uni.studentView(q, s.id);
  }));
}));
r.post("/student/university/drop", limits.studentKey, handle(async (req, res) => {
  const { registration_id } = parse(z.object({ registration_id: t.id }), req.body);
  res.json(await run(req, async (q, s) => { await uni.selfDrop(q, s.id, registration_id); return uni.studentView(q, s.id); }));
}));
export default r;
