// ملف الطالب الكامل — يُفتح بمعرّف الطالب فقط
import { Router } from "express";
import { handle } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool, verifyStudent } from "./context.js";
import { buildProfile } from "../shared/student-profile.service.js";

const r = Router({ mergeParams: true });

r.post("/student", limits.studentKey, handle(async (req, res) => {
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    const { admin, ...profile } = await buildProfile(q, tenant, s, { admin: false });
    return profile;
  }));
}));

export default r;
