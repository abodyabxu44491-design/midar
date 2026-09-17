// السداد من ملف الطالب: إشعار تحويل بنكي تراجعه إدارة المدرسة
// (لا يُسجل أي مبلغ كمدفوع قبل تأكيد الإدارة)
import { Router } from "express";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool, verifyStudent } from "./context.js";
import * as payments from "../shared/payments.service.js";

const r = Router({ mergeParams: true });

r.post("/transfer-claims", limits.payment, handle(async (req, res) => {
  const b = parse(payments.claimSchema, req.body);
  res.status(201).json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    if (!s.fees_enabled) throw badRequest("الرسوم غير مفعّلة لهذا الطالب");
    return payments.createClaim(q, s, b);
  }));
}));

export default r;
