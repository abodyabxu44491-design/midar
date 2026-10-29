/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { logoId } from "../shared/school-logo.service.js";
import { accessSummary } from "../shared/subscription.service.js";
import { schoolLinks } from "../../core/links.js";
import { inTenant, transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { schoolTotals } from "../shared/finance.service.js";
import { current } from "../shared/academic.service.js";
import { dayStatus } from "../shared/attendance.service.js";

const r = Router();

r.get("/me", handle(async (req, res) => {
  const t = req.tenant;
  const [p] = await inTenant(req, (q) => q("SELECT setup_completed_at FROM school_profile WHERE tenant_id = app_tenant()"));
  // The Midar account linked to this administrator (the school's manager); deputies have none.
  const [account] = await transaction({ platform: true, actor: req.user.full_name, ip: req.ip }, (q) => q(
    `SELECT a.email, a.full_name AS name, a.email_verified_at AS verified_at, a.created_at, a.last_login_at,
            s.linked_at, s.linked_via, a.password_hash IS NOT NULL AS has_password
       FROM account_schools s JOIN accounts a ON a.id = s.account_id
      WHERE s.tenant_id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND a.disabled_at IS NULL`, [req.tenant.id, req.user.id]));
  res.json({
    modules: req.modules,
    setup_completed: req.tenant.org_type === "institute" || Boolean(p?.setup_completed_at),
    name: req.user.full_name,
    admin_scope: req.user.admin_scope || "full",
    org_type: req.tenant.org_type || "school",
    org_type_key: req.tenant.org_type_key || null,
    staff_role: req.tenant.org_type === "institute" ? req.user.staff_role || "director" : null,
    must_change_password: req.user.must_change_password,
    account: account || null,
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
    const byGrade = await q(`SELECT st.id AS stage_id, st.name AS stage, g.id AS grade_id, g.name AS grade,
        count(DISTINCT cl.id)::int AS classes, count(s.id)::int AS students
       FROM stages st JOIN grades g ON g.stage_id = st.id
       LEFT JOIN classes cl ON cl.grade_id = g.id
       LEFT JOIN students s ON s.class_id = cl.id AND s.archived_at IS NULL
      GROUP BY st.id, st.name, st.sort_order, g.id, g.name, g.sort_order
      ORDER BY st.sort_order, st.id, g.sort_order, g.id`);
    const recentStudents = await q(`SELECT s.id, s.full_name AS name, s.gender, c.name AS class_name, s.created_at
       FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.archived_at IS NULL ORDER BY s.created_at DESC, s.id DESC LIMIT 6`);
    const recentAnnouncements = await q("SELECT id, title, created_at FROM announcements ORDER BY id DESC LIMIT 6");
    // School-scope administrators do not see fees or payment claims.
    const full = (req.user.admin_scope || "full") === "full";
    if (!full) c.pending_claims = 0;
    return { ...c, ...(full ? await schoolTotals(q) : {}), academic: await current(q),
      today: await dayStatus(q, new Date().toISOString().slice(0, 10)),
      by_grade: byGrade, recent_students: recentStudents, recent_announcements: recentAnnouncements };
  });
  res.json(data);
}));

export default r;
