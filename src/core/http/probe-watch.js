/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Watches for a signed-in user whose requests keep being refused (403) or point at records that do not exist for
// their school (404): the shape of someone changing identifiers to reach another school's data. Isolation already
// refuses each request; this raises one alert so the owner knows it is happening.
import { transaction } from "../db/pool.js";
import { raiseAlert } from "../audit.js";

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 30;
const hits = new Map();

export function probeWatch(req, res, next) {
  res.on("finish", () => {
    if (res.statusCode !== 403 && res.statusCode !== 404) return;
    const who = req.tenantId ? `${req.tenantId}:${req.user?.id ?? req.parent?.id ?? "?"}` : null;
    if (!who) return;
    const now = Date.now();
    const h = hits.get(who);
    const e = h && now - h.start < WINDOW_MS ? h : { start: now, n: 0, raised: false };
    e.n += 1;
    hits.set(who, e);
    if (e.n >= LIMIT && !e.raised) {
      e.raised = true;
      transaction({ platform: true, actor: "النظام" }, (q) => raiseAlert(q, {
        kind: "access_probe", severity: "high", tenantId: req.tenantId,
        title: "طلبات مرفوضة متكررة من حساب داخل مدرسة",
        detail: `${e.n} طلبًا مرفوضًا أو لسجلات غير موجودة خلال 10 دقائق (المستخدم رقم ${req.user?.id ?? "?"}، العنوان ${req.ip || "غير معروف"}). قد تكون محاولة للوصول إلى بيانات غير مسموحة.`,
      })).catch(() => {});
    }
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
  });
  next();
}
