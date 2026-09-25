// إعدادات المنصة: شكل الصفحة الرئيسية وبيانات التواصل
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();
const schema = z.object({
  landing_mode: z.enum(["blank", "marketing"]).optional(),
  brand_phone: z.string().trim().regex(/^[0-9+ ]{0,20}$/).optional().or(z.literal("")).transform((v) => v || null),
  brand_email: z.string().trim().email("البريد غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
  support_whatsapp: z.string().trim().regex(/^[0-9+]{0,20}$/, "رقم غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
  support_note: z.string().trim().max(300).optional().or(z.literal("")).transform((v) => v || null),
});

r.get("/", handle(async (req, res) => {
  const [row] = await transaction({ platform: true, actor: req.actor }, (q) =>
    q("SELECT landing_mode, brand_phone, brand_email, support_whatsapp, support_note FROM platform_settings WHERE id"));
  res.json(row);
}));

r.put("/", handle(async (req, res) => {
  const b = parse(schema, req.body);
  const [row] = await transaction({ platform: true, actor: req.actor, ip: req.ip }, async (q) => {
    const [cur] = await q("SELECT * FROM platform_settings WHERE id");
    return q(`UPDATE platform_settings SET landing_mode = $1, brand_phone = $2, brand_email = $3,
                support_whatsapp = $4, support_note = $5
              WHERE id RETURNING landing_mode, brand_phone, brand_email, support_whatsapp, support_note`,
      [b.landing_mode ?? cur.landing_mode,
       b.brand_phone !== undefined ? b.brand_phone : cur.brand_phone,
       b.brand_email !== undefined ? b.brand_email : cur.brand_email,
       b.support_whatsapp !== undefined ? b.support_whatsapp : cur.support_whatsapp,
       b.support_note !== undefined ? b.support_note : cur.support_note]);
  });
  res.json(row);
}));

export default r;
