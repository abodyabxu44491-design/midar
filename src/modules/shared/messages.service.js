/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { z, t } from "../../core/http/validate.js";

export const templateSchema = z.object({
  country_code: z.string().regex(/^[0-9]{1,4}$/, "رمز الدولة أرقام فقط").optional(),
  absence: t.shortText("قالب الغياب", 600).optional(),
  late: t.shortText("قالب التأخر", 600).optional(),
  fees: t.shortText("قالب الرسوم", 600).optional(),
  general: t.shortText("القالب العام", 600).optional(),
});
const FIELDS = ["country_code", "absence", "late", "fees", "general"];

export async function getTemplates(q) {
  const read = () => q(`SELECT ${FIELDS.join(", ")} FROM school_messages WHERE tenant_id = app_tenant()`);
  const [row] = await read();
  if (row) return row;
  await q("INSERT INTO school_messages (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  return (await read())[0];
}

export async function updateTemplates(q, patch) {
  await getTemplates(q);
  const keys = FIELDS.filter((f) => patch[f] !== undefined);
  if (!keys.length) return getTemplates(q);
  const [row] = await q(
    `UPDATE school_messages SET ${keys.map((f, i) => `${f} = $${i + 1}`).join(", ")}
      WHERE tenant_id = app_tenant() RETURNING ${FIELDS.join(", ")}`, keys.map((f) => patch[f]));
  return row;
}
