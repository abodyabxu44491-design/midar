// إشعارات ولي الأمر: صندوق الإشعارات وتسجيل الجهاز للإشعار الفوري (بمعرّف الطالب فقط)
import { Router } from "express";
import { handle, badRequest } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { parse, t, z } from "../../core/http/validate.js";
import { inSchool, verifyStudent } from "./context.js";
import { activeModules, pushPublicKey } from "../shared/notify.service.js";
import { subscriptionSchema, inboxQuery, unreadCount, markRead, savePush } from "../shared/notifications.routes.js";

const r = Router({ mergeParams: true });

r.post("/student/inbox", limits.studentKey, handle(async (req, res) => {
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    const mods = await activeModules(q);
    return { items: await inboxQuery(q, "student_id", s.id), unread: await unreadCount(q, "student_id", s.id),
      push: { key: mods.notifications ? pushPublicKey() : null } };
  }));
}));

r.post("/student/inbox/read", limits.studentKey, handle(async (req, res) => {
  const b = parse(z.object({ ids: z.array(t.id).max(200).optional(), all: z.boolean().optional() }), req.body);
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    await markRead(q, "student_id", s.id, b);
    return { ok: true };
  }));
}));

r.post("/student/push", limits.studentKey, handle(async (req, res) => {
  const sub = parse(subscriptionSchema, req.body.subscription);
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    if (!(await activeModules(q)).notifications) throw badRequest("الإشعارات الفورية غير مفعّلة في هذه المدرسة");
    await savePush(q, { student_id: s.id }, sub);
    return { ok: true };
  }));
}));

r.post("/student/push/remove", limits.studentKey, handle(async (req, res) => {
  const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    await q("DELETE FROM push_subscriptions WHERE student_id = $1 AND endpoint = $2", [s.id, endpoint]);
    return { ok: true };
  }));
}));

export default r;
