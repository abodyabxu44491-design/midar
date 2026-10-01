// المساعد الذكي للمدير: سؤال بلغة طبيعية عن بيانات المدرسة (قراءة فقط)
import { Router } from "express";
import { handle } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { ask, aiReady, recentQuestions } from "../shared/ai.service.js";

const r = Router();
const askSchema = z.object({
  question: z.string().trim().min(2, "اكتب سؤالك").max(1000),
  history: z.array(z.object({ q: z.string().max(1000), a: z.string().max(20000) })).max(4).default([]),
});

r.get("/", handle(async (req, res) => res.json({ ready: aiReady(), recent: await recentQuestions(req) })));
r.post("/ask", handle(async (req, res) => res.json(await ask(req, parse(askSchema, req.body)))));

export default r;
