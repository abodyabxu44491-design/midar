/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as quran from "./quran.service.js";

// The administration runs everything; a teacher sees only the circles they lead, and records for their own students.
export function quranRouter(role) {
  const r = Router();
  const teacherId = (req) => (role === "teacher" ? req.user.teacher_id : null);
  const staffOnly = (req) => { if (role === "teacher" && !req.user.teacher_id) throw forbidden("الحساب غير مرتبط بمعلم"); };

  r.get("/meta", handle(async (req, res) => {
    staffOnly(req);
    res.json(await inTenant(req, async (q) => ({
      ...quran.meta(),
      halaqat: await quran.halaqat(q, { teacherId: teacherId(req), all: role === "admin" }),
      levels: await quran.levels(q),
      teachers: role === "admin" ? await q("SELECT id, full_name AS name FROM teachers ORDER BY full_name") : [],
    })));
  }));
  r.get("/halaqat/:id", handle(async (req, res) => {
    const id = parse(t.id, req.params.id);
    res.json(await inTenant(req, (q) => quran.halaqaDetail(q, id, { teacherId: teacherId(req) })));
  }));
  r.get("/halaqat/:id/report", handle(async (req, res) => {
    const id = parse(t.id, req.params.id);
    const f = parse(quran.rangeQuery, req.query);
    res.json(await inTenant(req, (q) => quran.halaqaReport(q, id, f, { teacherId: teacherId(req) })));
  }));
  r.get("/students/:id", handle(async (req, res) => {
    const id = parse(t.id, req.params.id);
    res.json(await inTenant(req, (q) => quran.studentProgress(q, id, { teacherId: teacherId(req) })));
  }));
  r.post("/records", handle(async (req, res) => {
    staffOnly(req);
    const b = parse(quran.recordSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => quran.addRecord(q, b, { teacherId: teacherId(req), actor: req.actor })));
  }));
  // Several students at once (a circle's attendance): the same kind, one entry each.
  r.post("/absences", handle(async (req, res) => {
    staffOnly(req);
    const b = parse(z.object({ student_ids: z.array(t.id).min(1).max(500), kind: z.enum(["absent", "excused"]), on_date: t.date.optional(), notes: t.optText(500) }), req.body);
    res.status(201).json(await inTenant(req, async (q) => {
      const saved = [];
      for (const id of b.student_ids) saved.push(await quran.addRecord(q, { student_id: id, kind: b.kind, on_date: b.on_date, notes: b.notes }, { teacherId: teacherId(req), actor: req.actor }));
      return { saved: saved.length };
    }));
  }));
  r.delete("/records/:id", handle(async (req, res) => {
    const id = parse(t.id, req.params.id);
    await inTenant(req, (q) => quran.removeRecord(q, id, { teacherId: teacherId(req) }));
    res.json({ ok: true });
  }));

  if (role === "admin") {
    r.post("/levels", handle(async (req, res) => {
      const b = parse(quran.levelSchema, req.body);
      res.status(201).json(await inTenant(req, (q) => quran.addLevel(q, b)));
    }));
    r.patch("/levels/:id", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      res.json(await inTenant(req, (q) => quran.updateLevel(q, id, parse(z.object({ name: t.shortText("اسم المستوى", 80).optional(), description: t.optText(300), sort: z.coerce.number().int().min(0).max(10000).optional() }), req.body))));
    }));
    r.delete("/levels/:id", handle(async (req, res) => {
      await inTenant(req, (q) => quran.removeLevel(q, parse(t.id, req.params.id)));
      res.json({ ok: true });
    }));
    r.post("/halaqat", handle(async (req, res) => {
      const b = parse(quran.halaqaSchema, req.body);
      res.status(201).json(await inTenant(req, (q) => quran.addHalaqa(q, b)));
    }));
    r.patch("/halaqat/:id", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      const b = parse(quran.halaqaPatch, req.body);
      res.json(await inTenant(req, (q) => quran.updateHalaqa(q, id, b)));
    }));
    r.post("/halaqat/:id/members", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      res.status(201).json(await inTenant(req, (q) => quran.addMembers(q, id, parse(quran.membersSchema, req.body))));
    }));
    r.patch("/members/:id", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      res.json(await inTenant(req, (q) => quran.updateMember(q, id, parse(quran.memberPatch, req.body))));
    }));
    r.delete("/members/:id", handle(async (req, res) => {
      await inTenant(req, (q) => quran.endMember(q, parse(t.id, req.params.id)));
      res.json({ ok: true });
    }));
    r.get("/reports/teachers", handle(async (req, res) => {
      res.json(await inTenant(req, (q) => quran.teachersReport(q, parse(quran.rangeQuery, req.query))));
    }));
    // Students not in any circle yet, for adding to one.
    r.get("/unassigned", handle(async (req, res) => {
      res.json(await inTenant(req, (q) => q(
        `SELECT s.id, s.full_name AS name, s.student_no, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id
          WHERE s.archived_at IS NULL AND s.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM halaqa_members m WHERE m.student_id = s.id AND m.ended_on IS NULL)
          ORDER BY c.name NULLS LAST, s.full_name LIMIT 2000`)));
    }));
    r.post("/achievements", handle(async (req, res) => {
      const b = parse(quran.achievementSchema, req.body);
      res.status(201).json(await inTenant(req, (q) => quran.addAchievement(q, b, { actor: req.actor, school: req.tenant.name })));
    }));
  }
  return r;
}
