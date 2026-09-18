// طلب التحاق طالب جديد من صفحة المدرسة (إذا فعّلته الإدارة)
import { Router } from "express";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool, accessSchema, checkAccess } from "./context.js";
import { getSettings } from "../shared/public-settings.service.js";
import { requestSchema } from "../shared/admissions.service.js";

const r = Router({ mergeParams: true });

r.post("/admissions", limits.login, handle(async (req, res) => {
  const b = parse(requestSchema, req.body);
  const access = parse(accessSchema.partial(), req.body).access;
  await inSchool(req, "زائر", async (q, tenant) => {
    const settings = await getSettings(q);
    if (!settings.show_admissions) throw forbidden("التسجيل غير متاح حاليًا في هذه المدرسة");
    if (settings.access_mode === "code") checkAccess(tenant, access);
    await q("SELECT submit_admission($1::jsonb)", [JSON.stringify(b)]);
  });
  res.status(201).json({ ok: true });
}));

export default r;
