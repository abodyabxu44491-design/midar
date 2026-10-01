// بوابة المحاسب: المالية والرسوم فقط. لا وصول للطلاب ولا الدرجات ولا الإعدادات.
import { Router } from "express";
import { logoId } from "../shared/school-logo.service.js";
import { accessSummary } from "../shared/subscription.service.js";
import { requireStaff, requireModule } from "../../core/auth/guards.js";
import { logoutRouter, changePassword } from "../shared/staff-auth.js";
import { handle } from "../../core/http/errors.js";
import { inTenant } from "../../core/db/pool.js";
import { studentSummaries } from "../shared/finance.service.js";
import { getTemplates } from "../shared/messages.service.js";
import { structure } from "../shared/structure.service.js";
import { parse, t } from "../../core/http/validate.js";
import ledger from "../school-admin/ledger.js";
import fees from "../school-admin/finance.js";
import { staffNotificationsRouter } from "../shared/notifications.routes.js";

const r = Router();
r.use(logoutRouter("accountant"));
r.use(requireStaff("accountant"));

r.get("/me", handle(async (req, res) => {
  res.json({
    name: req.user.full_name,
    role: "accountant",
    access: accessSummary(req),
    must_change_password: req.user.must_change_password,
    school: { id: req.tenant.id, name: req.tenant.name, logo: await inTenant(req, logoId) },
    currency: req.tenant.currency,
    modules: req.modules,
    permissions: { approve: req.user.can_approve_finance, payroll: req.user.can_manage_payroll, accounts: req.user.can_manage_accounts },
  });
}));
r.post("/password", changePassword);
// بيانات للقراءة فقط يحتاجها تبويب الرسوم (بدون درجات ولا حضور ولا إعدادات)
r.get("/structure/classes", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => q("SELECT id, name FROM classes ORDER BY id")));
}));

// الهيكل (المراحل والصفوف والشعب) لقوالب الرسوم حسب الصف — قراءة فقط، بلا إعدادات المدرسة
r.get("/setup", handle(async (req, res) => {
  res.json({ structure: await inTenant(req, structure) });
}));

r.get("/students", handle(async (req, res) => {
  const classId = req.query.class_id ? parse(t.id, req.query.class_id) : null;   // اختيار طالب من شعبة عند إصدار فاتورة
  res.json(await inTenant(req, async (q) => {
    const rows = await q(
      `SELECT s.id, s.full_name AS name, s.class_id, c.name AS class_name, s.guardian_name, s.guardian_phone, s.fees_enabled
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.status = 'active' AND ($1::bigint IS NULL OR s.class_id = $1) ORDER BY c.id NULLS LAST, s.full_name`, [classId]);
    const summaries = await studentSummaries(q, rows.filter((st) => st.fees_enabled).map((st) => st.id));
    for (const st of rows) st.fees = st.fees_enabled ? summaries.get(Number(st.id)) : null;
    return rows;
  }));
}));

r.get("/messaging/templates", handle(async (req, res) => {
  res.json(await inTenant(req, getTemplates));
}));

r.use("/notifications", staffNotificationsRouter());
r.use("/ledger", requireModule("finance"), ledger);
r.use("/finance", requireModule("fees"), fees);

export default r;
