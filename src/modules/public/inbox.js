// إشعارات ولي الأمر: مركز الإشعارات، واختياراته، وتسجيل الجهاز للإشعار الفوري (بمعرّف الطالب فقط)
// كل طلب يُتحقق فيه من معرّف الطالب داخل مدرسته؛ فلا يصل ولي أمر لإشعارات طالب آخر أو مدرسة أخرى.
import { Router } from "express";
import { handle, badRequest } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { parse, z } from "../../core/http/validate.js";
import { inSchool, verifyStudent } from "./context.js";
import { activeModules, pushPublicKey, getPrefs, setPrefs, prefsSchema } from "../shared/notify.service.js";
import { subscriptionSchema, inboxQuery, unreadCounts, markRead, archive, savePush, readSchema, archiveSchema, filterSchema,
  categoriesList, deviceCount } from "../shared/notifications.routes.js";

const r = Router({ mergeParams: true });

r.post("/student/inbox", limits.studentKey, handle(async (req, res) => {
  const f = parse(filterSchema, req.body.filter || {});
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    const mods = await activeModules(q);
    return { ...(await inboxQuery(q, "student_id", s.id, f)), ...(await unreadCounts(q, "student_id", s.id)),
      categories: categoriesList(), push: { key: mods.notifications ? pushPublicKey() : null } };
  }));
}));

r.post("/student/inbox/read", limits.studentKey, handle(async (req, res) => {
  const b = parse(readSchema, req.body);
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    await markRead(q, "student_id", s.id, b);
    return { ok: true };
  }));
}));

r.post("/student/inbox/archive", limits.studentKey, handle(async (req, res) => {
  const b = parse(archiveSchema, req.body);
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    return { archived: (await archive(q, "student_id", s.id, b)).length };
  }));
}));

// اختيارات ولي الأمر: الأنواع التي لا يريد تنبيهها على الجوال (الإلزامي من المدرسة لا يُكتم)
const prefsHandler = (save) => handle(async (req, res) => {
  const patch = save ? parse(prefsSchema, { muted: req.body.muted }) : null;
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    const prefs = patch ? await setPrefs(q, { student_id: s.id }, patch) : await getPrefs(q, { student_id: s.id });
    return { ...prefs, devices: await deviceCount(q, "student_id", s.id) };
  }));
});
r.post("/student/notify-prefs", limits.studentKey, prefsHandler(false));
r.post("/student/notify-prefs/save", limits.studentKey, prefsHandler(true));

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
