/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound, forbidden } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { isUniversity } from "./org-types.service.js";
import * as uni from "./university.service.js";

export const requireUniversity = (req, res, next) => (isUniversity(req.tenant) ? next() : next(notFound("هذا القسم للجامعات")));

// The registrar's office (administration) runs everything; an instructor sees and grades only their own sections.
export function universityRouter(role) {
  const r = Router();
  r.use(requireUniversity);
  const teacherId = (req) => {
    if (role !== "teacher") return null;
    if (!req.user.teacher_id) throw forbidden("الحساب غير مرتبط بعضو هيئة تدريس");
    return req.user.teacher_id;
  };

  r.get("/meta", handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => ({
      settings: await uni.getSettings(q), terms: await uni.terms(q), labels: { degrees: uni.DEGREES, term_status: uni.TERM_STATUS, student_status: uni.STUDENT_STATUS },
    })));
  }));
  r.get("/sections", handle(async (req, res) => {
    const { term_id } = parse(z.object({ term_id: t.optId }), req.query);
    res.json(await inTenant(req, (q) => uni.sections(q, { termId: term_id ?? null, teacherId: teacherId(req) })));
  }));
  r.get("/sections/:id/roster", handle(async (req, res) => {
    const id = parse(t.id, req.params.id);
    res.json(await inTenant(req, (q) => uni.roster(q, id, { teacherId: teacherId(req) })));
  }));
  r.put("/sections/:id/marks", handle(async (req, res) => {
    const id = parse(t.id, req.params.id);
    const b = parse(uni.marksSchema, req.body);
    res.json(await inTenant(req, (q) => uni.setMarks(q, id, b, { teacherId: teacherId(req), actor: req.actor })));
  }));

  if (role === "admin") {
    r.get("/dashboard", handle(async (req, res) => res.json(await inTenant(req, uni.dashboard))));
    r.put("/settings", handle(async (req, res) => {
      const b = parse(uni.settingsSchema, req.body);
      res.json(await inTenant(req, (q) => uni.updateSettings(q, b)));
    }));
    r.get("/structure", handle(async (req, res) => res.json(await inTenant(req, uni.structure))));
    const add = (path, schema, fn) => r.post(path, handle(async (req, res) => {
      const b = parse(schema, req.body);
      res.status(201).json(await inTenant(req, (q) => fn(q, b)));
    }));
    add("/colleges", uni.collegeSchema, uni.addCollege);
    add("/departments", uni.departmentSchema, uni.addDepartment);
    add("/programs", uni.programSchema, uni.addProgram);
    add("/courses", uni.courseSchema, uni.addCourse);
    add("/terms", uni.termSchema, uni.addTerm);
    add("/sections", uni.sectionSchema, uni.addSection);
    r.patch("/courses/:id", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      const b = parse(z.object({ name: t.shortText("اسم المقرر", 150).optional(), credits: z.coerce.number().int().min(0).max(12).optional(),
        prerequisites: z.array(t.id).max(10).optional(), description: t.optText(1000), status: z.enum(["active", "archived"]).optional() }), req.body);
      res.json(await inTenant(req, (q) => uni.updateCourse(q, id, b)));
    }));
    r.put("/programs/:id/plan", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      res.json(await inTenant(req, (q) => uni.setPlan(q, id, parse(uni.planSchema, req.body))));
    }));
    r.patch("/terms/:id", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      const { status } = parse(z.object({ status: z.enum(Object.keys(uni.TERM_STATUS)) }), req.body);
      res.json(await inTenant(req, (q) => uni.setTermStatus(q, id, status)));
    }));
    r.patch("/sections/:id", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      const b = parse(z.object({ teacher_id: t.optId, capacity: z.coerce.number().int().min(1).max(1000).optional(), schedule: t.optText(200), room: t.optText(60) }), req.body);
      res.json(await inTenant(req, (q) => uni.updateSection(q, id, b)));
    }));
    r.post("/sections/:id/reopen", handle(async (req, res) => {
      await inTenant(req, (q) => uni.reopenGrades(q, parse(t.id, req.params.id)));
      res.json({ ok: true });
    }));
    r.get("/students", handle(async (req, res) => {
      const f = parse(z.object({ program_id: t.optId, q: z.string().trim().max(80).prefault("") }), req.query);
      res.json(await inTenant(req, (q) => uni.students(q, { programId: f.program_id ?? null, search: f.q })));
    }));
    r.post("/students", handle(async (req, res) => {
      const b = parse(uni.admitSchema, req.body);
      res.status(201).json(await inTenant(req, (q) => uni.admit(q, req.tenant, b)));
    }));
    r.patch("/students/:id/status", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      const { status } = parse(z.object({ status: z.enum(["active", "graduated", "withdrawn", "suspended"]) }), req.body);
      await inTenant(req, (q) => uni.setStudentStatus(q, id, status));
      res.json({ ok: true });
    }));
    r.get("/students/:id/transcript", handle(async (req, res) => {
      res.json(await inTenant(req, (q) => uni.transcript(q, parse(t.id, req.params.id))));
    }));
    r.post("/registrations", handle(async (req, res) => {
      const b = parse(uni.registerSchema, req.body);
      res.status(201).json(await inTenant(req, (q) => uni.register(q, b, { actor: req.actor, admin: true })));
    }));
    r.delete("/registrations/:id", handle(async (req, res) => {
      const { withdraw } = parse(z.object({ withdraw: z.enum(["0", "1"]).prefault("0") }), req.query);
      await inTenant(req, (q) => uni.drop(q, parse(t.id, req.params.id), { withdraw: withdraw === "1" }));
      res.json({ ok: true });
    }));
    r.get("/instructors", handle(async (req, res) => {
      res.json(await inTenant(req, (q) => q(`SELECT tc.id, tc.full_name AS name, tc.specialty, u.username,
                                                (SELECT count(*)::int FROM uni_sections s WHERE s.teacher_id = tc.id) AS sections
                                           FROM teachers tc LEFT JOIN users u ON u.teacher_id = tc.id AND u.role = 'teacher' ORDER BY tc.full_name`)));
    }));
  }
  return r;
}
