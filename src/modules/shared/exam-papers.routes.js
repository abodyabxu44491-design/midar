// مسارات مصمم الاختبارات: مصنع واحد يُركَّب في بوابة المعلم ولوحة الإدارة
// الفرق بين الدورين في «who» فقط، والصلاحيات كلها تُحسب في exam-papers.service.js
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as papers from "./exam-papers.service.js";
import * as bank from "./question-bank.service.js";
import { answerKey } from "../../../public/shared/js/exam/engine.js";

const whoOf = (req, role) => (role === "teacher" ? { role, teacherId: req.user.teacher_id } : { role: "admin" });
const idParam = (req) => parse(t.id, req.params.id);

// الصورة لا تتغير أبدًا بعد رفعها (التعديل = صورة جديدة بمعرّف جديد): كاش دائم في جهاز المستخدم فقط (private)
function sendImage(res, img) {
  res.set("Cache-Control", "private, max-age=31536000, immutable").type(img.mime).send(img.data);
}

export function papersRouter(role) {
  const r = Router();
  const who = (req) => whoOf(req, role);
  const tid = (req) => (role === "teacher" ? req.user.teacher_id : null);

  /* ---------- السياق والإحصاءات ---------- */
  r.get("/context", handle(async (req, res) => res.json(await inTenant(req, (q) => papers.context(q, who(req))))));

  r.get("/stats", handle(async (req, res) => res.json(await inTenant(req, async (q) => ({
    papers: await papers.counts(q, who(req)),
    bank: await bank.stats(q, tid(req)),
  })))));

  /* ---------- الأنواع والتعليمات المحفوظة ---------- */
  r.post("/types", handle(async (req, res) => {
    const b = parse(papers.typeSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => papers.addType(q, b.name, req.actor)));
  }));
  if (role === "teacher") {
    r.post("/presets", handle(async (req, res) => {
      const b = parse(papers.presetSchema, req.body);
      res.status(201).json(await inTenant(req, (q) => papers.addPreset(q, tid(req), b)));
    }));
    r.delete("/presets/:id", handle(async (req, res) => {
      await inTenant(req, (q) => papers.removePreset(q, tid(req), idParam(req)));
      res.json({ ok: true });
    }));
  }

  /* ---------- الصور ---------- */
  r.post("/images", handle(async (req, res) => {
    const b = parse(papers.imageSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => papers.saveImage(q, { teacherId: tid(req), file: b, actor: req.actor })));
  }));
  r.get("/images/:id", handle(async (req, res) => sendImage(res, await inTenant(req, (q) => papers.readImage(q, idParam(req), req.query.size === "thumb" ? "thumb" : "full")))));

  /* ---------- بنك الأسئلة ---------- */
  r.get("/bank", handle(async (req, res) => {
    const f = parse(bank.listSchema, req.query);
    res.json(await inTenant(req, (q) => bank.list(q, tid(req), f)));
  }));
  r.get("/bank/units", handle(async (req, res) => {
    const f = parse(z.object({ subject_id: t.optId }), req.query);
    res.json(await inTenant(req, (q) => bank.units(q, tid(req), f.subject_id)));
  }));
  r.post("/bank", handle(async (req, res) => {
    const b = parse(bank.bankCreateSchema, req.body);
    res.status(201).json(await inTenant(req, async (q) => {
      await papers.assertTeacherScope(q, who(req), { subject_id: b.subject_id });
      return bank.create(q, tid(req), b);
    }));
  }));
  r.get("/bank/:id", handle(async (req, res) => res.json(await inTenant(req, (q) => bank.getOne(q, idParam(req), tid(req))))));
  r.put("/bank/:id", handle(async (req, res) => {
    const b = parse(bank.bankUpdateSchema, req.body);
    await inTenant(req, async (q) => {
      if (b.subject_id) await papers.assertTeacherScope(q, who(req), { subject_id: b.subject_id });
      await bank.update(q, idParam(req), tid(req), b);
    });
    res.json({ ok: true });
  }));
  r.delete("/bank/:id", handle(async (req, res) => {
    await inTenant(req, (q) => bank.archive(q, idParam(req), tid(req)));
    res.json({ ok: true });
  }));
  // سحب أسئلة عشوائية حسب المواصفات (لا يحفظ شيئًا: المعلم يراجع ثم يضيف)
  r.post("/bank/pick", handle(async (req, res) => {
    const b = parse(bank.pickSchema, req.body);
    res.json(await inTenant(req, async (q) => {
      await papers.assertTeacherScope(q, who(req), { subject_id: b.subject_id });
      return bank.pick(q, tid(req), b);
    }));
  }));
  r.post("/bank/from-paper", handle(async (req, res) => {
    const b = parse(z.object({ paper_id: t.id, question_ids: z.array(z.string().max(40)).min(1).max(300) }), req.body);
    const saved = await inTenant(req, async (q) => {
      const { paper, perms } = await papers.getFor(q, who(req), b.paper_id);
      if (!perms.view) throw forbidden();
      return bank.saveFromPaper(q, tid(req), paper, b.question_ids);
    });
    res.status(201).json({ saved });
  }));

  /* ---------- الاختبارات ---------- */
  r.get("/", handle(async (req, res) => {
    const f = parse(papers.listFilter, req.query);
    res.json(await inTenant(req, (q) => papers.list(q, who(req), f)));
  }));

  r.post("/", handle(async (req, res) => {
    const b = parse(papers.createSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => papers.create(q, who(req), b, req.actor)));
  }));

  r.post("/quick", handle(async (req, res) => {
    const b = parse(papers.quickSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => papers.createFromSpec(q, who(req), {
      ...b, spec: papers.quickSpec(b.count), difficulty: "mixed", fill_missing: true,
    }, req.actor)));
  }));

  r.post("/from-bank", handle(async (req, res) => {
    const b = parse(papers.fromBankSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => papers.createFromSpec(q, who(req), b, req.actor)));
  }));

  r.post("/import", handle(async (req, res) => {
    const b = parse(papers.importSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => papers.importPaper(q, who(req), b, req.actor)));
  }));

  r.get("/:id", handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => papers.present(await papers.getFor(q, who(req), idParam(req)))));
  }));

  r.put("/:id", handle(async (req, res) => {
    const b = parse(papers.saveSchema, req.body);
    res.json(await inTenant(req, (q) => papers.save(q, who(req), idParam(req), b)));
  }));

  r.post("/:id/status", handle(async (req, res) => {
    const b = parse(papers.statusSchema, req.body);
    const status = await inTenant(req, (q) => papers.setStatus(q, who(req), idParam(req), b.action, req.actor));
    res.json({ status });
  }));

  r.delete("/:id", handle(async (req, res) => {
    await inTenant(req, (q) => papers.remove(q, who(req), idParam(req)));
    res.json({ ok: true });
  }));

  r.post("/:id/copy", handle(async (req, res) => {
    const b = parse(papers.copySchema, req.body);
    res.status(201).json(await inTenant(req, (q) => papers.copy(q, who(req), idParam(req), b, req.actor)));
  }));

  r.post("/:id/template", handle(async (req, res) => {
    const b = parse(z.object({ name: t.shortText("اسم القالب", 150) }), req.body);
    res.status(201).json(await inTenant(req, (q) => papers.saveTemplate(q, who(req), idParam(req), b.name, req.actor)));
  }));

  // نموذج الإجابة: مسار مستقل بصلاحية مستقلة يُتحقق منها هنا في الخادم
  r.get("/:id/answer-key", handle(async (req, res) => {
    const v = parse(z.object({ v: z.coerce.number().int().min(0).max(3).default(0) }), req.query);
    res.json(await inTenant(req, async (q) => {
      const { paper, perms } = await papers.getFor(q, who(req), idParam(req));
      if (!perms.answer_key) throw forbidden("نموذج الإجابة من صلاحية إدارة المدرسة");
      return answerKey(paper, Math.min(v.v, paper.versions - 1), paper.layout?.numbering || "continuous");
    }));
  }));

  r.get("/:id/export", handle(async (req, res) => {
    const data = await inTenant(req, async (q) => {
      const { paper, perms } = await papers.getFor(q, who(req), idParam(req));
      return papers.exportPaper(paper, perms.answer_key);
    });
    res.set("Content-Disposition", `attachment; filename="midar-exam-${idParam(req)}.json"`).json(data);
  }));

  r.get("/:id/roster", handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => {
      const { paper } = await papers.getFor(q, who(req), idParam(req));
      return papers.roster(q, paper);
    }));
  }));

  return r;
}

/* ---------- إعدادات الإدارة فقط ---------- */
export function papersAdminSettingsRouter() {
  const r = Router();
  r.get("/", handle(async (req, res) => res.json(await inTenant(req, papers.getSettings))));
  r.put("/", handle(async (req, res) => {
    const b = parse(papers.settingsSchema, req.body);
    res.json(await inTenant(req, (q) => papers.updateSettings(q, b)));
  }));
  // شعار المدرسة: يُرفع مرة واحدة ويستخدمه كل المعلمين تلقائيًا
  r.post("/logo", handle(async (req, res) => {
    const b = parse(papers.imageSchema, req.body);
    res.status(201).json(await inTenant(req, async (q) => {
      const img = await papers.saveImage(q, { kind: "logo", file: b, actor: req.actor });
      await papers.updateSettings(q, { logo_image_id: img.id });
      return img;
    }));
  }));
  r.delete("/logo", handle(async (req, res) => {
    await inTenant(req, (q) => papers.updateSettings(q, { logo_image_id: null }));
    res.json({ ok: true });
  }));
  r.put("/types/:id", handle(async (req, res) => {
    const b = parse(z.object({ is_active: z.boolean() }), req.body);
    await inTenant(req, (q) => q("UPDATE exam_types SET is_active = $2 WHERE id = $1", [parse(t.id, req.params.id), b.is_active]));
    res.json({ ok: true });
  }));
  return r;
}
