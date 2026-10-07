// طلب التحاق طالب جديد من صفحة المدرسة (إذا فعّلته الإدارة)
import { Router } from "express";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool } from "./context.js";
import { getSettings } from "../shared/public-settings.service.js";
import { requestSchema } from "../shared/admissions.service.js";
import { notify, adminUserIds } from "../shared/notify.service.js";

const r = Router({ mergeParams: true });

r.post("/admissions", limits.login, handle(async (req, res) => {
  const b = parse(requestSchema, req.body);
  await inSchool(req, "زائر", async (q, tenant) => {
    const settings = await getSettings(q);
    if (!settings.show_admissions) throw forbidden("التسجيل غير متاح حاليًا في هذه المدرسة");
    await q("SELECT submit_admission($1::jsonb)", [JSON.stringify(b)]);
    await notify(q, { event: "request", users: await adminUserIds(q), title: "طلب تسجيل جديد", priority: 2,
      body: `${b.student_name}${b.grade_wanted ? ` — ${b.grade_wanted}` : ""}`, link: "admissions" });
  });
  res.status(201).json({ ok: true });
}));

export default r;
