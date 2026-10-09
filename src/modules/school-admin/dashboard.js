// الرئيسية: الملخص وبيانات الجلسة
import { Router } from "express";
import { logoId } from "../shared/school-logo.service.js";
import { accessSummary } from "../shared/subscription.service.js";
import { schoolLinks } from "../../core/links.js";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { schoolTotals } from "../shared/finance.service.js";
import { current } from "../shared/academic.service.js";
import { dayStatus } from "../shared/attendance.service.js";

const r = Router();

r.get("/me", handle(async (req, res) => {
  const t = req.tenant;
  const [p] = await inTenant(req, (q) => q("SELECT setup_completed_at FROM school_profile WHERE tenant_id = app_tenant()"));
  res.json({
    modules: req.modules,
    setup_completed: Boolean(p?.setup_completed_at),
    name: req.user.full_name,
    must_change_password: req.user.must_change_password,
    access: accessSummary(req),
    links: schoolLinks(req, req.tenant.id),
    school: { id: t.id, name: t.name, max_students: t.max_students, subscription_end: t.subscription_end, directory_code: t.directory_code, currency: t.currency,
      logo: await inTenant(req, logoId) },
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
      (SELECT count(*) FROM payment_claims WHERE status = 'pending')::int AS pending_claims,
      -- قائمة «ابدأ هنا» للمدرسة الجديدة
      (SELECT count(*) FROM teacher_assignments)::int AS assignments,
      EXISTS (SELECT 1 FROM attendance) AS attendance_any,
      (SELECT created_at > now() - interval '60 days' FROM tenants WHERE id = app_tenant()) AS new_school`);
    return { ...c, ...(await schoolTotals(q)), academic: await current(q),
      today: await dayStatus(q, new Date().toISOString().slice(0, 10)) };
  });
  res.json(data);
}));

export default r;
