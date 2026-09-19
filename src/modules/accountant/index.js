// بوابة المحاسب: المالية والرسوم فقط. لا وصول للطلاب ولا الدرجات ولا الإعدادات.
import { Router } from "express";
import { requireStaff } from "../../core/auth/guards.js";
import { logoutRouter, changePassword } from "../shared/staff-auth.js";
import { handle } from "../../core/http/errors.js";
import { inTenant } from "../../core/db/pool.js";
import { studentSummary } from "../shared/finance.service.js";
import { getTemplates } from "../shared/messages.service.js";
import ledger from "../school-admin/ledger.js";
import fees from "../school-admin/finance.js";

const r = Router();
r.use(logoutRouter("accountant"));
r.use(requireStaff("accountant"));

r.get("/me", handle(async (req, res) => {
  res.json({
    name: req.user.full_name,
    role: "accountant",
    school: { id: req.tenant.id, name: req.tenant.name },
    permissions: { approve: req.user.can_approve_finance, payroll: req.user.can_manage_payroll },
  });
}));
r.post("/password", changePassword);
// بيانات للقراءة فقط يحتاجها تبويب الرسوم (بدون درجات ولا حضور ولا إعدادات)
r.get("/structure/classes", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => q("SELECT id, name FROM classes ORDER BY id")));
}));

r.get("/students", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    const rows = await q(
      `SELECT s.id, s.full_name AS name, s.class_id, c.name AS class_name, s.guardian_name, s.guardian_phone, s.fees_enabled
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.status = 'active' ORDER BY c.id NULLS LAST, s.full_name`);
    for (const st of rows) st.fees = st.fees_enabled ? await studentSummary(q, st.id) : null;
    return rows;
  }));
}));

r.get("/messaging/templates", handle(async (req, res) => {
  res.json(await inTenant(req, getTemplates));
}));

r.use("/ledger", ledger);
r.use("/finance", fees);

export default r;
