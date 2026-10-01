// صندوق الإشعارات وتسجيل الجهاز للإشعار الفوري — للمنسوبين (الإدارة والمعلم والمحاسب)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { pushPublicKey } from "./notify.service.js";

export const subscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(40).max(200), auth: z.string().min(10).max(100) }),
});
const readSchema = z.object({ ids: z.array(t.id).max(200).optional(), all: z.boolean().optional() });

export const inboxQuery = (q, col, id, limit = 50) => q(
  `SELECT id, kind, title, body, link, read_at, created_at FROM notifications WHERE ${col} = $1 ORDER BY id DESC LIMIT $2`, [id, limit]);
export const unreadCount = async (q, col, id) =>
  (await q(`SELECT count(*)::int AS n FROM notifications WHERE ${col} = $1 AND read_at IS NULL`, [id]))[0].n;
export const markRead = (q, col, id, b) => q(
  `UPDATE notifications SET read_at = now() WHERE ${col} = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`,
  [id, b.all ? null : (b.ids?.length ? b.ids : [0])]);

export async function savePush(q, target, sub) {
  await q(
    `INSERT INTO push_subscriptions (tenant_id, student_id, user_id, endpoint, p256dh, auth)
     VALUES (app_tenant(), $1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, endpoint, COALESCE(student_id, 0), COALESCE(user_id, 0))
     DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failures = 0`,
    [target.student_id ?? null, target.user_id ?? null, sub.endpoint, sub.keys.p256dh, sub.keys.auth]);
}

export function staffNotificationsRouter() {
  const r = Router();
  r.get("/", handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => ({
      items: await inboxQuery(q, "user_id", req.user.id),
      unread: await unreadCount(q, "user_id", req.user.id),
      push: { key: req.modules?.notifications ? pushPublicKey() : null },
    })));
  }));
  r.post("/read", handle(async (req, res) => {
    const b = parse(readSchema, req.body);
    await inTenant(req, (q) => markRead(q, "user_id", req.user.id, b));
    res.json({ ok: true });
  }));
  r.post("/push", handle(async (req, res) => {
    if (!req.modules?.notifications) throw badRequest("الإشعارات الفورية موقوفة في هذه المدرسة");
    const sub = parse(subscriptionSchema, req.body);
    await inTenant(req, (q) => savePush(q, { user_id: req.user.id }, sub));
    res.json({ ok: true });
  }));
  r.post("/push/remove", handle(async (req, res) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    await inTenant(req, (q) => q("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [req.user.id, endpoint]));
    res.json({ ok: true });
  }));
  return r;
}
