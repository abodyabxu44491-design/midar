/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { transaction } from "../../core/db/pool.js";
import { AppError } from "../../core/http/errors.js";

export const DEMO_MESSAGE = "هذه مدرسة تجريبية للعرض فقط، والتعديل فيها غير متاح. اطلب تجربتك المجانية لتبدأ بمدرستك.";
export const demoReadonly = () => new AppError(403, DEMO_MESSAGE, "demo_readonly");

const ADMIN_READS = [/^\/ai\/report\/[\w-]+$/, /^\/academic\/promotion-preview$/];
export const staffWriteAllowed = (req, role) =>
  req.method === "GET" || req.method === "HEAD" || (role === "admin" && ADMIN_READS.some((re) => re.test(req.path)));

const PUBLIC_WRITES = [
  /^\/admissions$/, /^\/transfer-claims$/, /^\/password-request$/, /^\/student\/excuse$/,
  /^\/student\/surveys\/\d+$/, /^\/student\/meetings\/book$/, /^\/student\/meetings\/\d+\/cancel$/,
  /^\/student\/push$/, /^\/student\/inbox\/archive$/, /^\/student\/chat\/send$/, /^\/student\/notify-prefs\/save$/, /^\/student\/online-exams\/\d+\/(start|save|submit|image)$/,
];

const cache = new Map();
const TTL = 60_000;
export async function isDemoSchool(id) {
  const key = String(id || "").toLowerCase();
  if (!/^[a-z0-9-]{3,30}$/.test(key)) return false;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.demo;
  const [t] = await transaction({ tenantId: key }, (q) => q("SELECT is_demo FROM tenants WHERE id = $1", [key]));
  const demo = Boolean(t?.is_demo);
  cache.set(key, { demo, until: Date.now() + TTL });
  return demo;
}
export const forgetDemoCache = () => cache.clear();

export const publicDemoGuard = async (req, res, next) => {
  try {
    if (!(await isDemoSchool(req.params.school))) return next();
    res.set("X-Demo", "1");
    const sub = req.path;
    if (req.method !== "GET" && PUBLIC_WRITES.some((re) => re.test(sub))) throw demoReadonly();
    next();
  } catch (e) { next(e); }
};

export async function demoSchool() {
  const [t] = await transaction({ platform: true, actor: "زائر العرض التجريبي" }, (q) => q(
    "SELECT id, name FROM tenants WHERE is_demo AND status = 'active' AND emergency_locked_at IS NULL LIMIT 1"));
  return t || null;
}
