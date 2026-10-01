// حالة عملية خلفية: المدير يسأل عن عمليات مدرسته، والمالك عن عملياته. لا يراها إلا من بدأها.
import { Router } from "express";
import { handle } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import { readJob } from "../../core/jobs.js";

export function jobsRouter(scope) {
  const r = Router();
  r.get("/:id", handle(async (req, res) => {
    const id = parse(t.id, req.params.id);
    res.set("Cache-Control", "no-store");   // قد تحمل كلمات مرور مؤقتة عند الانتهاء
    res.json(await readJob({ tenantId: scope === "school" ? req.tenantId : null, id, req }));
  }));
  return r;
}
