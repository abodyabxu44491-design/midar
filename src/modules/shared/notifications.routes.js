// مركز الإشعارات وتسجيل الأجهزة للإشعار الفوري — للمنسوبين (الإدارة والمعلم والمحاسب)
// والدوال المشتركة مع صفحة ولي الأمر (نفس المركز بنفس التصنيفات، لكن بمعرّف الطالب)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { pushPublicKey, getPrefs, setPrefs, prefsSchema, CATEGORIES } from "./notify.service.js";

export const subscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(40).max(200), auth: z.string().min(10).max(100) }),
});
export const readSchema = z.object({ ids: z.array(t.id).max(200).optional(), all: z.boolean().optional() });
export const archiveSchema = z.object({ ids: z.array(t.id).min(1).max(200) });
export const filterSchema = z.object({
  category: z.string().regex(/^[a-z_]{2,20}$/).optional(),
  unread: z.boolean().optional(),
  q: z.string().trim().max(60).optional(),
  before: t.id.optional(),
});

/** قائمة مركز الإشعارات (غير المؤرشفة) مع التصفية والبحث والتحميل المتتابع */
export async function inboxQuery(q, col, id, f = {}, limit = 50) {
  const items = await q(
    `SELECT id, kind, category, priority, title, body, link, read_at, created_at, updated_at, repeats FROM notifications
      WHERE ${col} = $1 AND archived_at IS NULL
        AND ($2::text IS NULL OR category = $2) AND (NOT $3 OR read_at IS NULL)
        AND ($4::text IS NULL OR title ILIKE '%' || $4 || '%' OR body ILIKE '%' || $4 || '%')
        AND ($5::bigint IS NULL OR id < $5)
      ORDER BY id DESC LIMIT $6`,
    [id, f.category ?? null, Boolean(f.unread), f.q ? f.q.replace(/[%_\\]/g, "\\$&") : null, f.before ?? null, limit + 1]);
  return { items: items.slice(0, limit), more: items.length > limit };
}
/** أعداد غير المقروء: الإجمالي ولكل تصنيف (أرقام أزرار التصفية) */
export async function unreadCounts(q, col, id) {
  const rows = await q(`SELECT category, count(*)::int AS n FROM notifications WHERE ${col} = $1 AND read_at IS NULL AND archived_at IS NULL GROUP BY 1`, [id]);
  const by = Object.fromEntries(rows.map((r) => [r.category, r.n]));
  return { unread: rows.reduce((a, r) => a + r.n, 0), by_category: by };
}
export const unreadCount = async (q, col, id) => (await unreadCounts(q, col, id)).unread;
export const markRead = (q, col, id, b) => q(
  `UPDATE notifications SET read_at = now() WHERE ${col} = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`,
  [id, b.all ? null : (b.ids?.length ? b.ids : [0])]);
// الأرشفة تُخفي الإشعار من المركز لهذا المستلم فقط (يبقى في سجل المدرسة للتشخيص)
export const archive = (q, col, id, b) => q(
  `UPDATE notifications SET archived_at = now(), read_at = COALESCE(read_at, now()) WHERE ${col} = $1 AND id = ANY($2) AND archived_at IS NULL RETURNING id`,
  [id, b.ids]);
export const categoriesList = () => Object.entries(CATEGORIES).map(([key, name]) => ({ key, name }));

export async function savePush(q, target, sub) {
  await q(
    `INSERT INTO push_subscriptions (tenant_id, student_id, user_id, endpoint, p256dh, auth)
     VALUES (app_tenant(), $1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, endpoint, COALESCE(student_id, 0), COALESCE(user_id, 0))
     DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failures = 0`,
    [target.student_id ?? null, target.user_id ?? null, sub.endpoint, sub.keys.p256dh, sub.keys.auth]);
}
/** عدد الأجهزة المسجّلة لهذا المستلم (يظهر في الإعدادات: «الإشعارات تصل إلى جهازين») */
export const deviceCount = async (q, col, id) =>
  (await q(`SELECT count(*)::int AS n FROM push_subscriptions WHERE ${col} = $1`, [id]))[0].n;

export function staffNotificationsRouter() {
  const r = Router();
  const me = (req) => req.user.id;
  r.get("/", handle(async (req, res) => {
    const f = parse(filterSchema, {
      category: req.query.category || undefined, unread: req.query.unread === "1" || undefined,
      q: req.query.q || undefined, before: req.query.before || undefined });
    res.json(await inTenant(req, async (q) => ({
      ...(await inboxQuery(q, "user_id", me(req), f)),
      ...(await unreadCounts(q, "user_id", me(req))),
      categories: categoriesList(),
      push: { key: req.modules?.notifications ? pushPublicKey() : null },
    })));
  }));
  r.post("/read", handle(async (req, res) => {
    const b = parse(readSchema, req.body);
    await inTenant(req, (q) => markRead(q, "user_id", me(req), b));
    res.json({ ok: true });
  }));
  r.post("/archive", handle(async (req, res) => {
    const b = parse(archiveSchema, req.body);
    const rows = await inTenant(req, (q) => archive(q, "user_id", me(req), b));
    res.json({ archived: rows.length ?? 0 });
  }));
  r.get("/prefs", handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => ({ ...(await getPrefs(q, { user_id: me(req) })), devices: await deviceCount(q, "user_id", me(req)) })));
  }));
  r.put("/prefs", handle(async (req, res) => {
    const b = parse(prefsSchema, req.body);
    res.json(await inTenant(req, (q) => setPrefs(q, { user_id: me(req) }, b)));
  }));
  r.post("/push", handle(async (req, res) => {
    if (!req.modules?.notifications) throw badRequest("الإشعارات الفورية موقوفة في هذه المدرسة");
    const sub = parse(subscriptionSchema, req.body);
    await inTenant(req, (q) => savePush(q, { user_id: me(req) }, sub));
    res.json({ ok: true });
  }));
  r.post("/push/remove", handle(async (req, res) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    await inTenant(req, (q) => q("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [me(req), endpoint]));
    res.json({ ok: true });
  }));
  return r;
}
