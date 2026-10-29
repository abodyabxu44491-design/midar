/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound, conflict, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { ENGINES, STATUSES, LIVE_ENGINES, PUBLIC_ENGINES, TERM_KEYS, ENGINE_TERMS, engineDefaults, termsSchema, typeKey } from "../shared/org-types.service.js";

// The owner's list of institution types. A type is never deleted (institutions may use it); it is switched off instead.
const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);

const terms = termsSchema;
const baseSchema = z.object({
  name: t.shortText("اسم النوع", 80),
  description: t.optText(400),
  status: z.enum(Object.keys(STATUSES)).prefault("planned"),
  sort: z.coerce.number().int().min(0).max(10000).prefault(150),
  default_features: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/)).max(80).optional(),
  terms,
});
const createSchema = baseSchema.extend({ key: typeKey, engine: z.enum(Object.keys(ENGINES)) });
const updateSchema = z.object({
  name: t.shortText("اسم النوع", 80).optional(),
  description: t.optText(400),
  status: z.enum(Object.keys(STATUSES)).optional(),
  sort: z.coerce.number().int().min(0).max(10000).optional(),
  default_features: baseSchema.shape.default_features,
  terms,
});

async function checkFeatures(q, keys) {
  if (!keys?.length) return;
  const known = new Set((await q("SELECT key FROM features WHERE key = ANY($1)", [keys])).map((f) => f.key));
  const bad = keys.filter((k) => !known.has(k));
  if (bad.length) throw badRequest(`أقسام غير معروفة: ${bad.join("، ")}`);
}

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, async (q) => ({
    types: await q(`SELECT o.*, (SELECT count(*)::int FROM tenants t WHERE t.org_type_key = o.key) AS tenants,
                           (SELECT count(*)::int FROM tenants t WHERE t.org_type_key = o.key AND t.status = 'active') AS active_tenants
                      FROM org_types o ORDER BY o.sort, o.key`),
    features: await q("SELECT key, name, category, kind FROM features WHERE is_active ORDER BY sort, key"),
    engines: Object.entries(ENGINES).map(([key, name]) => ({ key, name, live: LIVE_ENGINES.includes(key), public: PUBLIC_ENGINES.includes(key) })),
    statuses: Object.entries(STATUSES).map(([key, name]) => ({ key, name })),
    term_keys: Object.entries(TERM_KEYS).map(([key, name]) => ({ key, name })),
    engine_terms: Object.fromEntries(Object.keys(ENGINES).map((e) => [e, ENGINE_TERMS[e].map((key) => ({ key, name: engineDefaults(e)[key] }))])),
  })));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(createSchema, req.body);
  if (!PUBLIC_ENGINES.includes(b.engine) && ["available", "beta"].includes(b.status)) {
    throw badRequest(`المحرك ${ENGINES[b.engine]} قيد التطوير، فيبقى النوع «قيد التطوير» حتى يكتمل`);
  }
  res.status(201).json(await platform(req, async (q) => {
    const [dup] = await q("SELECT 1 FROM org_types WHERE key = $1", [b.key]);
    if (dup) throw conflict("هذا المفتاح مستخدم لنوع آخر");
    await checkFeatures(q, b.default_features);
    const [row] = await q(
      `INSERT INTO org_types (key, name, description, engine, status, sort, default_features, terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [b.key, b.name, b.description ?? null, b.engine, b.status, b.sort, b.default_features ?? [], b.terms ?? {}]);
    return row;
  }));
}));

// Editing a type does not touch the institutions already on it: their sections and settings stay as they are.
r.patch("/:key", handle(async (req, res) => {
  const key = parse(typeKey, req.params.key);
  const b = parse(updateSchema, req.body);
  res.json(await platform(req, async (q) => {
    const [cur] = await q("SELECT * FROM org_types WHERE key = $1 FOR UPDATE", [key]);
    if (!cur) throw notFound("النوع غير موجود");
    if (b.status && !PUBLIC_ENGINES.includes(cur.engine) && ["available", "beta"].includes(b.status)) {
      throw badRequest(`المحرك ${ENGINES[cur.engine]} قيد التطوير، فيبقى النوع «قيد التطوير» حتى يكتمل`);
    }
    await checkFeatures(q, b.default_features);
    const [row] = await q(
      `UPDATE org_types SET name = $2, description = $3, status = $4, sort = $5, default_features = $6, terms = $7, version = version + 1
        WHERE key = $1 RETURNING *`,
      [key, b.name ?? cur.name, b.description !== undefined ? b.description : cur.description, b.status ?? cur.status, b.sort ?? cur.sort,
       b.default_features ?? cur.default_features, b.terms ?? cur.terms]);
    return row;
  }));
}));

export default r;
