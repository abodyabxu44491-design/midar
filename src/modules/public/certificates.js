// الشهادات للعموم: التحقق برمز QR (بلا دخول)، وطباعة ولي الأمر لشهادات ابنه (بمعرّف الطالب)
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound, badRequest } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { parse, t, z } from "../../core/http/validate.js";
import { inSchool, verifyStudent } from "./context.js";
import { forPrint } from "../shared/certificates.service.js";
import { activeModules } from "../shared/notify.service.js";
import { originOf } from "../school-admin/certificates.js";

export const verifyRouter = Router();
verifyRouter.get("/verify/:code", limits.studentKey, handle(async (req, res) => {
  const code = parse(z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{10}$/, "رمز الشهادة غير صحيح"), req.params.code);
  const [row] = await transaction({ platform: true, actor: "زائر", ip: req.ip }, (q) => q("SELECT * FROM verify_certificate($1)", [code]));
  if (!row) throw notFound("لا توجد شهادة بهذا الرمز");
  res.set("Cache-Control", "no-store").json(row);
}));

export const schoolRouter = Router({ mergeParams: true });
schoolRouter.post("/student/certificates/print", limits.studentKey, handle(async (req, res) => {
  const { id } = parse(z.object({ id: t.id }), req.body);
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    if (!(await activeModules(q)).certificates) throw badRequest("الشهادات غير مفعّلة");
    const rows = await forPrint(q, [id], originOf(req), { studentId: s.id });
    if (!rows.length || rows[0].revoked_at) throw notFound("الشهادة غير موجودة");
    return rows;
  }));
}));
