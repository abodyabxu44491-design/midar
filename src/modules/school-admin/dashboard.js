// الرئيسية: الملخص وبيانات الجلسة
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { schoolTotals } from "../shared/finance.service.js";
import { current } from "../shared/academic.service.js";

const r = Router();

r.get("/me", handle(async (req, res) => {
  const t = req.tenant;
  res.json({
    name: req.user.full_name,
    school: { id: t.id, name: t.name, max_students: t.max_students, subscription_end: t.subscription_end, directory_code: t.directory_code, currency: t.currency },
  });
}));

r.get("/dashboard", handle(async (req, res) => {
  const data = await inTenant(req, async (q) => {
    const [c] = await q(`SELECT
      (SELECT count(*) FROM students WHERE archived_at IS NULL)::int AS students,
      (SELECT count(*) FROM teachers)::int AS teachers,
      (SELECT count(*) FROM classes)::int AS classes,
      (SELECT count(*) FROM attendance WHERE day = CURRENT_DATE AND status = 'absent')::int AS absent_today,
      (SELECT count(*) FROM attendance WHERE day = CURRENT_DATE)::int AS recorded_today,
      (SELECT count(*) FROM exams WHERE status = 'pending')::int AS pending_exams,
      (SELECT count(*) FROM payment_claims WHERE status = 'pending')::int AS pending_claims`);
    return { ...c, ...(await schoolTotals(q)), academic: await current(q) };
  });
  res.json(data);
}));

export default r;
