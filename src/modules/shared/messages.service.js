// قوالب رسائل واتساب: النظام يجهز الرسالة ورابط المحادثة، والإرسال يتم من جوال المستخدم
// (بدون أي اشتراك في مزود رسائل)
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
  const [row] = await q(
    `INSERT INTO school_messages (tenant_id) VALUES (app_tenant())
     ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
     RETURNING ${FIELDS.join(", ")}`);
  return row;
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
