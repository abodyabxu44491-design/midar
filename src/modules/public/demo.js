// الدخول للعرض التجريبي من الصفحة الرئيسية: بلا تسجيل، في مدرسة العرض (للقراءة فقط)
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { createSession } from "../../core/auth/sessions.js";
import { demoSchool } from "../shared/demo.service.js";

const r = Router();
const ACTOR = "زائر العرض التجريبي";
const startSchema = z.object({ role: z.enum(["admin", "teacher", "accountant", "parent"]) });

r.post("/start", limits.demo, handle(async (req, res) => {
  const { role } = parse(startSchema, req.body);
  const school = await demoSchool();
  if (!school) throw notFound("العرض التجريبي غير متاح حاليًا");
  const out = await transaction({ tenantId: school.id, actor: ACTOR, ip: req.ip }, async (q) => {
    if (role === "parent") {
      // طالب له بيانات كاملة: الأكثر درجات منشورة
      const [s] = await q(
        `SELECT s.access_key FROM students s WHERE s.status = 'active'
          ORDER BY (SELECT count(*) FROM scores sc WHERE sc.student_id = s.id) DESC, s.id LIMIT 1`);
      if (!s) throw notFound("العرض التجريبي غير متاح حاليًا");
      return { url: `/${school.id}?k=${encodeURIComponent(s.access_key)}` };
    }
    // المعلم: صاحب أكثر الفصول والمواد حتى يظهر التطبيق ممتلئًا
    const [u] = await q(
      `SELECT u.id FROM users u WHERE u.role = $1 AND u.is_active
        ORDER BY (SELECT count(*) FROM teacher_assignments ta WHERE ta.teacher_id = u.teacher_id) DESC, u.id LIMIT 1`, [role]);
    if (!u) throw notFound("هذا الدور غير متاح في العرض التجريبي");
    await createSession(res, role, { userId: u.id, tenantId: school.id, ip: req.ip, userAgent: req.get("user-agent"), remember: false }, q);
    return { url: `/${school.id}/idara?role=${role}` };
  });
  res.json(out);
}));

export default r;
