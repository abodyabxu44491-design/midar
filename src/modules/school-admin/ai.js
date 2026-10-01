// المساعد الذكي للمدير: تقارير ذكية مجانية للجميع، وأسئلة حرة بلغة طبيعية لمن أضاف مفتاحه (قراءة فقط)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { ask, aiStatus, recentQuestions, setSchoolKey, deleteSchoolKey } from "../shared/ai.service.js";
import { availableReports, runReport, reportParams } from "../shared/smart-reports.service.js";

const r = Router();
const askSchema = z.object({
  question: z.string().trim().min(2, "اكتب سؤالك").max(1000),
  history: z.array(z.object({ q: z.string().max(1000), a: z.string().max(20000) })).max(4).default([]),
});

r.get("/", handle(async (req, res) => {
  const status = await aiStatus(req);
  res.json({
    ...status,
    reports: availableReports(req.modules),
    classes: (await inTenant(req, (q) => q("SELECT name FROM classes ORDER BY name"))).map((c) => c.name),
    recent: status.ready ? await recentQuestions(req) : [],
  });
}));
r.post("/report/:key", handle(async (req, res) => res.json(await runReport(req, String(req.params.key), parse(reportParams, req.body || {})))));
r.post("/ask", handle(async (req, res) => res.json(await ask(req, parse(askSchema, req.body)))));
r.put("/key", handle(async (req, res) => res.json(await setSchoolKey(req, parse(z.object({ key: z.string().max(400) }), req.body).key))));
r.delete("/key", handle(async (req, res) => res.json(await deleteSchoolKey(req))));

export default r;
