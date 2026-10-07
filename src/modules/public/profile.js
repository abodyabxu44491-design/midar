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
import { badRequest, notFound } from "../../core/http/errors.js";
import { cardTokens, cardUrl } from "../shared/gate.service.js";
import { qrDataUrl } from "../shared/certificates.service.js";
import { baseUrl } from "../../core/links.js";

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

// بطاقة الحضور: ولي الأمر يطبعها من ملف الطالب (نفس البطاقة التي تطبعها الإدارة)، إن كانت المدرسة تستخدم البوابة
r.post("/student/attendance-card", limits.studentKey, handle(async (req, res) => {
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    const [{ n }] = await q("SELECT count(*)::int AS n FROM gates WHERE is_active");
    if (!n) throw notFound("المدرسة لا تستخدم بوابة الحضور");
    const tk = (await cardTokens(q, [s.id], { actor: "ولي أمر" })).get(Number(s.id));
    const [c] = await q("SELECT name FROM classes WHERE id = $1", [s.class_id]);
    const qr = cardUrl(baseUrl(req), tenant.id, tk.token);
    return { school: tenant.name, name: s.full_name, class_name: c?.name || null, version: tk.version, qr, qr_img: qrDataUrl(qr) };
  }));
}));

export default r;
