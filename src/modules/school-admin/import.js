// الاستيراد من ملفات: تنزيل القالب، معاينة الملف، ثم الاستيراد
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { KINDS, template, importRows, rowsSchema } from "../shared/import.service.js";

const r = Router();
const kindParam = z.enum(Object.keys(KINDS));

// قائمة أنواع الاستيراد وأعمدتها (تُبنى منها الواجهة)
r.get("/kinds", handle(async (req, res) => {
  res.json(Object.entries(KINDS).map(([key, def]) => ({
    key, name: def.name, note: def.note,
    columns: def.columns.map((c) => ({ header: c.header, required: Boolean(c.required) })),
  })));
}));

// تنزيل القالب جاهزًا للتعبئة في Excel
r.get("/template/:kind", handle(async (req, res) => {
  const kind = parse(kindParam, req.params.kind);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`قالب-${KINDS[kind].name}.csv`)}`);
  res.send(template(kind));
}));

// معاينة أو استيراد. الاستيراد كامل أو لا شيء.
r.post("/:kind", handle(async (req, res) => {
  const kind = parse(kindParam, req.params.kind);
  const b = parse(rowsSchema, req.body);
  const result = await inTenant(req, async (q) => {
    const out = await importRows(q, req.tenant, kind, b.rows, { dryRun: b.dry_run, actor: req.actor });
    if (out.errors.length) throw badRequest(`الملف يحتاج تصحيحًا: ${out.errors.length} خطأ`, { errors: out.errors });
    return out;
  });
  res.json(result);
}));

export default r;
