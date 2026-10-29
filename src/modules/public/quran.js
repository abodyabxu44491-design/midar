/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { handle, badRequest } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool, verifyStudent } from "./context.js";
import { activeModules } from "../shared/notify.service.js";
import { forParent } from "../shared/quran.service.js";

// A parent follows their child's memorisation: progress, the latest entries and the achievements.
const r = Router({ mergeParams: true });
r.post("/student/quran", limits.studentKey, handle(async (req, res) => {
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    if (!(await activeModules(q)).quran) throw badRequest("حلقات التحفيظ غير مفعّلة في هذه المدرسة");
    return forParent(q, s.id);
  }));
}));
export default r;
