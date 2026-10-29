/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { badRequest } from "../../core/http/errors.js";
import { z } from "../../core/http/validate.js";

// Institution types: one platform, many kinds of institution. A type picks an engine (how learning is organised)
// and carries its own terms, default sections and settings; the owner manages the list.
export const ENGINES = { school: "مدرسي", institute: "تدريبي", university: "جامعي" };
export const STATUSES = { available: "متاح", beta: "تجريبي", planned: "قيد التطوير", disabled: "موقوف" };
// Engines the platform can run today. A type on another engine stays visible to the owner only.
export const LIVE_ENGINES = ["school", "institute"];
export const PUBLIC_STATUSES = ["available", "beta"];
export const typeKey = z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "نوع المؤسسة غير صحيح");

// The request form used fixed values before the types list; those requests still read correctly.
const LEGACY = { private: "private_school", public: "public_school", international: "international_school", institute: "training_institute", other: "other" };
export const fromLegacy = (v) => (v ? LEGACY[v] || v : null);

export async function publicTypes(q) {
  return q(`SELECT key, name, description, engine, status FROM org_types
             WHERE status = ANY($1) AND engine = ANY($2) ORDER BY sort, key`, [PUBLIC_STATUSES, LIVE_ENGINES]);
}

export async function allTypes(q) {
  return q("SELECT key, name, engine, status FROM org_types ORDER BY sort, key");
}

// The type a new institution gets: the one asked for, or the base type of its engine. Only types on an engine the
// platform runs today, and not switched off, can be used.
export async function resolveType(q, key, orgType) {
  const k = key || (orgType === "institute" ? "training_institute" : "private_school");
  const [t] = await q("SELECT key, name, engine, status FROM org_types WHERE key = $1", [k]);
  if (!t) throw badRequest("نوع المؤسسة غير موجود");
  if (t.status === "disabled") throw badRequest(`نوع «${t.name}» موقوف حاليًا`);
  if (!LIVE_ENGINES.includes(t.engine)) throw badRequest(`نوع «${t.name}» قيد التطوير ولا يمكن إنشاء مؤسسة منه بعد`);
  if (orgType && orgType !== t.engine) throw badRequest("نوع المؤسسة لا يناسب طريقة التنظيم المختارة");
  return t;
}
