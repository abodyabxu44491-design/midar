/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { handle } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import { readJob } from "../../core/jobs.js";

export function jobsRouter(scope) {
  const r = Router();
  r.get("/:id", handle(async (req, res) => {
    const id = parse(t.id, req.params.id);
    res.set("Cache-Control", "no-store");
    res.json(await readJob({ tenantId: scope === "school" ? req.tenantId : null, id, req }));
  }));
  return r;
}
