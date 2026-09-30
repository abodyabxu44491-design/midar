// ملف الطالب الكامل — يُفتح بمعرّف الطالب فقط
import { Router } from "express";
import { handle } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool, verifyStudent } from "./context.js";
import { buildProfile } from "../shared/student-profile.service.js";
import { getSettings } from "../shared/public-settings.service.js";
import { submitParentExcuse, parentExcuseSchema } from "../shared/attendance.service.js";
import { acknowledge } from "../shared/student-alerts.service.js";
import { parse, t, z } from "../../core/http/validate.js";
import { badRequest } from "../../core/http/errors.js";

const r = Router({ mergeParams: true });

r.post("/student", limits.studentKey, handle(async (req, res) => {
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    const { admin, ...profile } = await buildProfile(q, tenant, s, { admin: false });
    return profile;
  }));
}));

// ولي الأمر يرسل عذرًا عن غياب أو تأخر، وتقبله الإدارة أو ترفضه من «الحضور ← الأعذار»
r.post("/student/excuse", limits.studentKey, handle(async (req, res) => {
  const b = parse(parentExcuseSchema, req.body);
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    const settings = await getSettings(q);
    if (!settings.allow_parent_excuses || !settings.profile_show_attendance) throw badRequest("إرسال الأعذار غير متاح في هذه المدرسة");
    return submitParentExcuse(q, s.id, b);
  }));
}));

// تأكيد الاطلاع على تنبيه
r.post("/student/alerts/ack", limits.studentKey, handle(async (req, res) => {
  const { alert_id } = parse(z.object({ alert_id: t.id }), req.body);
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    return acknowledge(q, s.id, alert_id);
  }));
}));

export default r;
