/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { transaction } from "../../core/db/pool.js";
import { notFound, conflict } from "../../core/http/errors.js";
import { activate } from "./subscription.service.js";
import { schoolTotals } from "./finance.service.js";

const CURRENCY = { SAR: "ر.س", YER: "ر.ي", USD: "$" };

export async function groupQuota(q, groupId) {
  const [g] = await q(
    `SELECT g.id, g.max_schools, g.extra_school_price, p.currency FROM school_groups g
       LEFT JOIN plans p ON p.id = g.plan_id WHERE g.id = $1 FOR UPDATE OF g`, [groupId]);
  if (!g) throw notFound("المجموعة غير موجودة");
  const [{ n }] = await q("SELECT count(*)::int AS n FROM tenants WHERE group_id = $1 AND status <> 'archived'", [groupId]);
  if (n >= g.max_schools) {
    const extra = g.extra_school_price != null ? ` كل مدرسة إضافية بـ ${Number(g.extra_school_price)} ${CURRENCY[g.currency] || g.currency || ""}.` : "";
    throw conflict(`وصلت المجموعة إلى حدها (${g.max_schools} مدارس). لإضافة مدرسة أخرى تواصل مع إدارة مدار لرفع الحد.${extra}`);
  }
  return { used: n, max: g.max_schools };
}

export async function enterprisePlanId(q) {
  const [p] = await q("SELECT id FROM plans WHERE code = 'enterprise' AND status <> 'archived'");
  return p?.id ?? null;
}

// The subscription every school of a group runs on: the group's plan until the group's end date, billed at group level.
export function groupSubscription(g) {
  return {
    kind: "paid", plan_id: g.plan_id || undefined, price: 0, discount: 0, addons: [], status: "active",
    billing_cycle: g.ends_on ? "custom" : "none", ends_on: g.ends_on || null, max_students: null,
    note: `ضمن مجموعة ${g.name}`,
  };
}

export async function syncGroupSchools(q, g, actor) {
  const rows = await q("SELECT id FROM tenants WHERE group_id = $1 AND status <> 'archived' ORDER BY id", [g.id]);
  for (const t of rows) await activate(q, t.id, groupSubscription(g), actor, { event: "renewed" });
  return rows.length;
}

export const groupSchoolRows = (q, groupId) => q(
  `SELECT id, name, status, currency, subscription_end, created_at FROM tenants
    WHERE group_id = $1 AND status <> 'archived' ORDER BY created_at, id`, [groupId]);

// Figures read inside each school's own scope, so row-level isolation still applies school by school.
export async function schoolFigures(ctx, tenantId) {
  return transaction({ ...ctx, tenantId }, async (q) => {
    const [c] = await q(`SELECT
      (SELECT count(*) FROM students WHERE archived_at IS NULL)::int AS students,
      (SELECT count(*) FROM teachers)::int AS teachers,
      (SELECT count(*) FROM classes)::int AS classes,
      (SELECT count(*) FROM attendance WHERE day = CURRENT_DATE)::int AS recorded_today,
      (SELECT count(*) FROM attendance WHERE day = CURRENT_DATE AND status = 'absent')::int AS absent_today`);
    const [admin] = await q(
      "SELECT username, full_name, must_change_password, last_login_at FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    return { ...c, ...(await schoolTotals(q)), admin: admin || null };
  });
}
