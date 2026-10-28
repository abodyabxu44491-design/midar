/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Certificate designs: templates (a page and freely placed elements) and the images they use.
// Layouts are validated strictly (types, ranges, colours); text is rendered as text, never as HTML.
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";
import { matchesMime } from "./attachments.service.js";
import { ELEMENT_TYPES, BORDERS, FONTS, PRESETS, presetFor, presetLayout } from "../../../public/shared/js/cert-presets.js";

const color = z.string().regex(/^(#[0-9A-Fa-f]{6}|transparent)$/, "لون غير صحيح");
const mm = (max = 420) => z.number().min(-50).max(max);
const style = z.object({
  font: z.enum(Object.keys(FONTS)).optional(), size: z.number().min(4).max(120).optional(), bold: z.boolean().optional(),
  italic: z.boolean().optional(), color: color.optional(), align: z.enum(["right", "center", "left", "justify"]).optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(), lh: z.number().min(0.8).max(3).optional(), ls: z.number().min(-2).max(10).optional(),
  fit: z.boolean().optional(), bg: color.optional(), bc: color.optional(), bw: z.number().min(0).max(10).optional(),
  br: z.number().min(0).max(100).optional(), op: z.number().min(0).max(1).optional(), dash: z.enum(["solid", "dashed", "dotted", "double"]).optional(),
  fitImg: z.enum(["contain", "cover", "fill"]).optional(),
  // grades table
  headBg: color.optional(), headColor: color.optional(), line: color.optional(), score: z.boolean().optional(), max: z.boolean().optional(),
  percent: z.boolean().optional(), grade: z.boolean().optional(), total: z.boolean().optional(), zebra: z.boolean().optional(),
}).strict();
const element = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/), type: z.enum(ELEMENT_TYPES),
  x: mm(), y: mm(), w: z.number().min(0.2).max(420), h: z.number().min(0.2).max(420), rot: z.number().min(-180).max(180).prefault(0),
  locked: z.boolean().prefault(false), hidden: z.boolean().prefault(false),
  text: z.string().max(2000).optional(), asset: z.number().int().positive().nullable().optional(), style: style.prefault({}),
}).strict();
export const layoutSchema = z.object({
  v: z.literal(1).prefault(1),
  page: z.object({
    orientation: z.enum(["portrait", "landscape"]), bg: color.prefault("#FFFFFF"), bgAsset: z.number().int().positive().nullable().prefault(null),
    bgFit: z.enum(["cover", "contain", "fill"]).prefault("cover"), bgOp: z.number().min(0).max(1).prefault(1),
    border: z.object({ style: z.enum(Object.keys(BORDERS)), color, accent: color, width: z.number().min(0.2).max(6), inset: z.number().min(0).max(30) }).strict(),
  }).strict(),
  els: z.array(element).max(120),
}).strict();

const KIND = z.enum(["term", "year", "custom", "course", "attendance", "any"]);
export const templateSchema = z.object({ name: t.shortText("اسم التصميم", 80), kind: KIND, layout: layoutSchema });
export const createSchema = z.object({
  name: t.shortText("اسم التصميم", 80), kind: KIND,
  from: z.union([z.object({ preset: z.enum(Object.keys(PRESETS)) }), z.object({ template: t.id })]).optional(),
});

const assetIds = (layout) => [layout.page.bgAsset, ...layout.els.map((e) => e.asset)].filter(Boolean).map(Number);
async function checkAssets(q, layout) {
  const ids = [...new Set(assetIds(layout))];
  if (!ids.length) return;
  const rows = await q("SELECT id FROM certificate_assets WHERE id = ANY($1)", [ids]);
  if (rows.length !== ids.length) throw badRequest("التصميم يستخدم صورة غير موجودة في مكتبة المؤسسة");
}

export const list = (q) => q(
  `SELECT id, name, kind, is_default, version, updated_at, updated_by, layout -> 'page' ->> 'orientation' AS orientation
     FROM certificate_templates WHERE archived_at IS NULL ORDER BY kind, is_default DESC, name`);
export async function get(q, id) {
  const [row] = await q("SELECT id, name, kind, layout, is_default, version, updated_at, updated_by FROM certificate_templates WHERE id = $1 AND archived_at IS NULL", [id]);
  if (!row) throw notFound("التصميم غير موجود");
  return row;
}

export async function create(q, b, actor) {
  let layout = presetLayout(presetFor(b.kind === "any" ? "term" : b.kind));
  if (b.from?.preset) layout = presetLayout(b.from.preset);
  if (b.from?.template) layout = (await get(q, b.from.template)).layout;
  layout = layoutSchema.parse(layout);
  const [row] = await q(`INSERT INTO certificate_templates (tenant_id, name, kind, layout, created_by, updated_by)
                         VALUES (app_tenant(), $1, $2, $3, $4, $4) RETURNING id`, [b.name, b.kind, JSON.stringify(layout), actor]);
  return get(q, row.id);
}

export async function update(q, id, b, actor) {
  const cur = await get(q, id);
  await checkAssets(q, b.layout);
  // A template that is some kind's default keeps that kind; changing the kind clears the default.
  await q(`UPDATE certificate_templates SET name = $2, kind = $3, layout = $4, version = version + 1, updated_by = $5,
                  is_default = is_default AND kind = $3 WHERE id = $1`,
  [id, b.name, b.kind, JSON.stringify(b.layout), actor]);
  return { ...(await get(q, id)), previous_version: cur.version };
}

export async function setDefault(q, id) {
  const tpl = await get(q, id);
  await q("UPDATE certificate_templates SET is_default = false WHERE kind = $1 AND is_default AND id <> $2", [tpl.kind, id]);
  await q("UPDATE certificate_templates SET is_default = true WHERE id = $1", [id]);
  return { ok: true, kind: tpl.kind };
}
export async function archive(q, id) {
  await get(q, id);
  await q("UPDATE certificate_templates SET archived_at = now(), is_default = false WHERE id = $1", [id]);
  return { ok: true };
}

// The design a new certificate of this kind gets: the chosen template, else the kind's default, else the
// default for all kinds, else the built-in design. The issued certificate keeps a copy of it.
export async function layoutFor(q, kind, templateId = null) {
  if (templateId) {
    const tpl = await get(q, templateId);
    if (tpl.kind !== kind && tpl.kind !== "any") throw badRequest("هذا التصميم لنوع آخر من الشهادات");
    return { layout: tpl.layout, template: { id: tpl.id, name: tpl.name, version: tpl.version } };
  }
  const [tpl] = await q(`SELECT id, name, version, layout FROM certificate_templates
                          WHERE is_default AND archived_at IS NULL AND kind IN ($1, 'any') ORDER BY kind = $1 DESC LIMIT 1`, [kind]);
  if (tpl) return { layout: tpl.layout, template: { id: tpl.id, name: tpl.name, version: tpl.version } };
  const key = presetFor(kind);
  return { layout: presetLayout(key), template: { preset: key, name: PRESETS[key].name } };
}

// ---------- Images ----------
export const assetSchema = z.object({
  name: z.string().trim().min(1).max(80).prefault("صورة"),
  mime: z.enum(["image/png", "image/jpeg", "image/webp"], { error: "الصور المسموحة: PNG أو JPG أو WEBP" }),
  data: z.string().min(16).max(Math.ceil(2.8 * 1024 * 1024 * 1.37)),
  width: z.number().int().min(1).max(20000).optional(), height: z.number().int().min(1).max(20000).optional(),
});
export async function addAsset(q, f, actor) {
  const buffer = Buffer.from(f.data, "base64");
  if (!buffer.length) throw badRequest("الصورة فارغة");
  if (buffer.length > 2.8 * 1024 * 1024) throw badRequest("حجم الصورة أكبر من 2.8 ميجابايت. صغّرها ثم أعد المحاولة");
  if (!matchesMime(buffer, f.mime)) throw badRequest("محتوى الملف لا يطابق نوعه. ارفع صورة PNG أو JPG أو WEBP سليمة");
  const [{ n }] = await q("SELECT count(*)::int AS n FROM certificate_assets WHERE NOT hidden");
  if (n >= 200) throw badRequest("مكتبة الصور ممتلئة (200 صورة). أخفِ صورًا لا تحتاجها.");
  const [row] = await q(`INSERT INTO certificate_assets (tenant_id, name, mime, size_bytes, width, height, data, uploaded_by)
                         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id, name, mime, size_bytes, width, height`,
  [f.name, f.mime, buffer.length, f.width ?? null, f.height ?? null, buffer, actor]);
  return row;
}
export const assets = (q) => q("SELECT id, name, mime, size_bytes, width, height, created_at FROM certificate_assets WHERE NOT hidden ORDER BY id DESC");
export async function readAsset(q, id) {
  const [row] = await q("SELECT mime, data FROM certificate_assets WHERE id = $1", [id]);
  if (!row) throw notFound("الصورة غير موجودة");
  return row;
}
export async function hideAsset(q, id) {
  const rows = await q("UPDATE certificate_assets SET hidden = true WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("الصورة غير موجودة");
}

// The images a set of certificates needs, as data URLs (print works without further requests, also for parents).
export async function assetsFor(q, layouts) {
  const ids = [...new Set(layouts.filter(Boolean).flatMap(assetIds))];
  if (!ids.length) return {};
  const rows = await q("SELECT id, mime, data FROM certificate_assets WHERE id = ANY($1)", [ids]);
  return Object.fromEntries(rows.map((r) => [r.id, `data:${r.mime};base64,${r.data.toString("base64")}`]));
}
