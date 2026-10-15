/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { logEvent } from "../../core/audit.js";
import * as svc from "./institute.service.js";
import { forPrint, revoke } from "./certificates.service.js";
import * as results from "./results.service.js";
import { logoId } from "./school-logo.service.js";
import { newTempPassword } from "../../core/auth/codes.js";
import { hashPassword } from "../../core/auth/password.js";
import { conflict } from "../../core/http/errors.js";

const { requireCap } = svc;
export const requireInstitute = (req, res, next) => (req.tenant?.org_type === "institute" ? next() : next(notFound("هذا القسم للمعاهد التدريبية")));
const id = (req, k = "id") => parse(t.id, req.params[k]);
const audit = (q, req, action) => logEvent(q, { tenantId: req.tenantId, actor: req.actor, action });
const originOf = (req) => `${req.protocol}://${req.get("host")}`;
const school = async (req, q) => ({ name: req.tenant.name, logo: await logoId(q) });

// Institute administration (admin staff by role, and the accountant for fees). Every route checks a capability on the server.
export function instituteRouter() {
  const r = Router();
  r.use(requireInstitute);

  r.get("/meta", handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => ({
      settings: await svc.getSettings(q), caps: svc.capsOf(req.user), staff_role: req.user.role === "accountant" ? "accountant" : req.user.staff_role || "director",
      labels: { course_status: svc.COURSE_STATUS, enroll_status: svc.ENROLL_STATUS, trainee_status: svc.TRAINEE_STATUS, modes: svc.MODES,
        assess_kind: svc.ASSESS_KIND, trainee_fields: svc.TRAINEE_FIELDS, staff_roles: svc.STAFF_ROLES },
      reports: Object.entries(svc.REPORTS).filter(([, v]) => svc.can(req.user, v.cap)).map(([key, v]) => ({ key, label: v.label, needs: v.needs || null })),
    })));
  }));
  r.put("/settings", requireCap("settings"), handle(async (req, res) => {
    const b = parse(svc.settingsSchema, req.body);
    res.json(await inTenant(req, async (q) => { const s = await svc.updateSettings(q, b); await audit(q, req, "تعديل إعدادات المعهد"); return s; }));
  }));
  r.get("/dashboard", requireCap("view"), handle(async (req, res) => {
    res.json(await inTenant(req, (q) => svc.dashboard(q, { finance: svc.can(req.user, "finance") })));
  }));

  // Programs
  r.get("/programs", requireCap("view"), handle(async (req, res) => res.json(await inTenant(req, svc.listPrograms))));
  r.post("/programs", requireCap("catalog"), handle(async (req, res) => {
    const b = parse(svc.programSchema, req.body);
    res.status(201).json(await inTenant(req, async (q) => { const p = await svc.saveProgram(q, null, b); await audit(q, req, `إنشاء برنامج ${p.name}`); return p; }));
  }));
  r.put("/programs/:id", requireCap("catalog"), handle(async (req, res) => {
    const b = parse(svc.programSchema, req.body);
    res.json(await inTenant(req, (q) => svc.saveProgram(q, id(req), b)));
  }));

  // Courses and groups
  const courseFilter = z.object({ status: z.enum(Object.keys(svc.COURSE_STATUS)).optional(), program_id: t.optId, q: z.string().trim().max(80).optional() });
  r.get("/courses", requireCap("view"), handle(async (req, res) => {
    const f = parse(courseFilter, req.query);
    res.json(await inTenant(req, (q) => svc.listCourses(q, { status: f.status ?? null, program_id: f.program_id ?? null, q: f.q || null })));
  }));
  r.get("/courses/:id", requireCap("view"), handle(async (req, res) => res.json(await inTenant(req, (q) => svc.getCourse(q, id(req))))));
  r.post("/courses", requireCap("catalog"), handle(async (req, res) => {
    const b = parse(svc.courseSchema, req.body);
    res.status(201).json(await inTenant(req, async (q) => { const c = await svc.saveCourse(q, null, b, req.actor); await audit(q, req, `إنشاء دورة ${c.name}`); return c; }));
  }));
  r.put("/courses/:id", requireCap("catalog"), handle(async (req, res) => {
    const b = parse(svc.courseSchema, req.body);
    res.json(await inTenant(req, (q) => svc.saveCourse(q, id(req), b, req.actor)));
  }));
  r.post("/courses/:id/groups", requireCap("catalog"), handle(async (req, res) => {
    const b = parse(svc.groupSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => svc.saveGroup(q, id(req), null, b, req.actor)));
  }));
  r.put("/courses/:id/groups/:gid", requireCap("catalog"), handle(async (req, res) => {
    const b = parse(svc.groupSchema, req.body);
    res.json(await inTenant(req, (q) => svc.saveGroup(q, id(req), id(req, "gid"), b, req.actor)));
  }));
  r.delete("/courses/:id/groups/:gid", requireCap("catalog"), handle(async (req, res) => {
    await inTenant(req, (q) => svc.deleteGroup(q, id(req), id(req, "gid"))); res.json({ ok: true });
  }));

  // Sessions, attendance, assessments and scores (academic staff)
  r.post("/courses/:id/sessions", requireCap("teach"), handle(async (req, res) => {
    const b = parse(svc.sessionSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => svc.addSessions(q, id(req), b)));
  }));
  r.patch("/sessions/:id", requireCap("teach"), handle(async (req, res) => {
    const b = parse(svc.sessionStatusSchema, req.body);
    await inTenant(req, (q) => svc.updateSession(q, id(req), b)); res.json({ ok: true });
  }));
  r.delete("/sessions/:id", requireCap("teach"), handle(async (req, res) => { await inTenant(req, (q) => svc.deleteSession(q, id(req))); res.json({ ok: true }); }));
  r.get("/sessions", requireCap("view"), handle(async (req, res) => {
    const f = parse(z.object({ from: t.optDate, to: t.optDate }), req.query);
    res.json(await inTenant(req, (q) => q(
      `SELECT s.*, c.name AS course, c.code, g.name AS group_name, tr.full_name AS trainer,
              (SELECT count(*)::int FROM session_attendance a WHERE a.session_id = s.id) AS recorded
         FROM training_sessions s JOIN courses c ON c.id = s.course_id LEFT JOIN course_groups g ON g.id = s.group_id LEFT JOIN teachers tr ON tr.id = s.trainer_id
        WHERE s.day BETWEEN COALESCE($1::date, CURRENT_DATE - 7) AND COALESCE($2::date, CURRENT_DATE + 21) ORDER BY s.day, s.starts_at NULLS FIRST`, [f.from ?? null, f.to ?? null])));
  }));
  r.get("/sessions/:id/attendance", requireCap("view"), handle(async (req, res) => res.json(await inTenant(req, (q) => svc.sessionRoster(q, id(req))))));
  r.put("/sessions/:id/attendance", requireCap("teach"), handle(async (req, res) => {
    const b = parse(svc.attendanceSchema, req.body);
    res.json(await inTenant(req, (q) => svc.saveAttendance(q, id(req), b, req.actor)));
  }));
  r.post("/courses/:id/assessments", requireCap("catalog"), handle(async (req, res) => {
    const b = parse(svc.assessmentSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => svc.saveAssessment(q, id(req), null, b)));
  }));
  r.put("/courses/:id/assessments/:aid", requireCap("catalog"), handle(async (req, res) => {
    const b = parse(svc.assessmentSchema, req.body);
    res.json(await inTenant(req, (q) => svc.saveAssessment(q, id(req), id(req, "aid"), b)));
  }));
  r.delete("/courses/:id/assessments/:aid", requireCap("catalog"), handle(async (req, res) => {
    await inTenant(req, (q) => svc.deleteAssessment(q, id(req), id(req, "aid"))); res.json({ ok: true });
  }));
  r.put("/assessments/:id/scores", requireCap("teach"), handle(async (req, res) => {
    const b = parse(svc.scoresSchema, req.body);
    res.json(await inTenant(req, async (q) => {
      const out = await svc.saveScores(q, id(req), b, req.actor);
      if (out.changed) await audit(q, req, `رصد/تعديل ${out.changed} درجة (تقييم ${id(req)})`);
      return out;
    }));
  }));

  // Trainees and enrollments
  const traineeFilter = z.object({ q: z.string().trim().max(80).optional(), status: z.enum(Object.keys(svc.TRAINEE_STATUS)).optional(), course_id: t.optId });
  r.get("/trainees", requireCap("view"), handle(async (req, res) => {
    const f = parse(traineeFilter, req.query);
    res.json(await inTenant(req, (q) => svc.listTrainees(q, { q: f.q || null, status: f.status ?? null, course_id: f.course_id ?? null })));
  }));
  r.post("/trainees", requireCap("trainees"), handle(async (req, res) => {
    const b = parse(svc.traineeSchema, req.body);
    res.status(201).json(await inTenant(req, async (q) => { const s = await svc.createTrainee(q, req.tenant, b); await audit(q, req, `تسجيل متدرب ${s.full_name}`); return s; }));
  }));
  r.put("/trainees/:id", requireCap("trainees"), handle(async (req, res) => {
    const b = parse(svc.traineeSchema, req.body);
    res.json(await inTenant(req, (q) => svc.updateTrainee(q, id(req), b)));
  }));
  r.post("/trainees/:id/status", requireCap("enroll"), handle(async (req, res) => {
    const b = parse(svc.statusSchema, req.body);
    await inTenant(req, async (q) => { await svc.setTraineeStatus(q, id(req), b); await audit(q, req, `تغيير حالة متدرب ${id(req)} إلى ${svc.TRAINEE_STATUS[b.status]}`); });
    res.json({ ok: true });
  }));
  r.get("/trainees/:id/record", requireCap("view"), handle(async (req, res) => {
    const rec = await inTenant(req, (q) => svc.traineeRecord(q, id(req)));
    if (!svc.can(req.user, "finance") && !svc.can(req.user, "enroll")) { delete rec.invoices; delete rec.payments; delete rec.summary.fees_due; delete rec.summary.fees_paid; delete rec.summary.balance; }
    res.json(rec);
  }));
  r.post("/enrollments", requireCap("enroll"), handle(async (req, res) => {
    const b = parse(svc.enrollSchema, req.body);
    res.status(201).json(await inTenant(req, async (q) => {
      const e = await svc.enroll(q, b, req.actor, { canDiscount: svc.can(req.user, "finance") });
      await audit(q, req, `تسجيل المتدرب ${b.student_id} في الدورة ${b.course_id}`);
      return e;
    }));
  }));
  r.post("/enrollments/:id/transfer", requireCap("enroll"), handle(async (req, res) => {
    const b = parse(svc.transferSchema, req.body);
    await inTenant(req, (q) => svc.transfer(q, id(req), b, req.actor)); res.json({ ok: true });
  }));
  r.post("/enrollments/:id/status", requireCap("enroll"), handle(async (req, res) => {
    const b = parse(svc.enrollStatusSchema, req.body);
    await inTenant(req, (q) => svc.setEnrollmentStatus(q, id(req), b, req.actor)); res.json({ ok: true });
  }));
  r.post("/enrollments/:id/finalize", requireCap("teach"), handle(async (req, res) => {
    const b = parse(z.object({ force: z.boolean().default(false), reason: t.optText(300) }), req.body);
    res.json(await inTenant(req, async (q) => {
      const out = await svc.finalize(q, id(req), req.actor, b);
      await audit(q, req, `اعتماد نتيجة التسجيل ${id(req)}: ${out.status === "completed" ? "اجتاز" : "لم يجتز"}`);
      return out;
    }));
  }));
  r.post("/enrollments/:id/discount", requireCap("finance"), handle(async (req, res) => {
    const b = parse(svc.discountSchema, req.body);
    await inTenant(req, async (q) => { await svc.setDiscount(q, id(req), b, req.actor); await audit(q, req, `خصم ${b.amount} على التسجيل ${id(req)}: ${b.reason}`); });
    res.json({ ok: true });
  }));
  r.post("/enrollments/:id/certificate", requireCap("certificates"), handle(async (req, res) => {
    const b = parse(svc.certificateSchema, req.body);
    const out = await inTenant(req, async (q) => {
      const c = await svc.issueCertificate(q, id(req), b, req.actor, await school(req, q));
      if (!c.stale) await audit(q, req, `إصدار ${c.title} رقم ${c.serial}`);
      return c;
    });
    if (out.stale) throw conflict(results.STALE);
    res.status(201).json(out);
  }));
  r.post("/certificates/print", requireCap("view"), handle(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(t.id).min(1).max(200) }), req.body);
    res.json(await inTenant(req, (q) => forPrint(q, ids, originOf(req), { actor: req.actor })));
  }));
  r.post("/certificates/:id/revoke", requireCap("approve"), handle(async (req, res) => {
    const { reason } = parse(z.object({ reason: t.shortText("سبب الإلغاء", 200) }), req.body);
    await inTenant(req, async (q) => {
      const c = await revoke(q, id(req), reason, req.actor, { kinds: ["course", "attendance"] });
      await audit(q, req, `إلغاء الشهادة ${c.serial}: ${reason}`);
    });
    res.json({ ok: true });
  }));
  r.get("/certificates/:id/history", requireCap("view"), handle(async (req, res) => {
    res.json(await inTenant(req, (q) => q("SELECT action, actor, reason, created_at FROM certificate_events WHERE certificate_id = $1 ORDER BY id", [id(req)])));
  }));

  // Course results: the academic office prepares and sends them for review; the director approves them.
  const courseSc = (q, req) => results.courseScope(q, id(req));
  r.get("/courses/:id/results", requireCap("view"), handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => ({ ...(await results.overview(q, await courseSc(q, req))), can_approve: svc.can(req.user, "approve") })));
  }));
  const step = (path, cap, fn, label) => r.post(`/courses/:id/results/${path}`, requireCap(cap), handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => {
      const sc = await courseSc(q, req);
      const out = await fn(q, sc, req);
      await audit(q, req, `${label} نتائج ${sc.label}${req.body?.reason ? `: ${req.body.reason}` : ""}`);
      return out;
    }));
  }));
  step("submit", "certificates", (q, sc, req) => results.submit(q, sc, req.actor), "إرسال للمراجعة:");
  step("return", "certificates", (q, sc, req) => results.sendBack(q, sc, req.actor, parse(results.reasonSchema, req.body).reason), "إعادة للتعديل:");
  step("approve", "approve", (q, sc, req) => results.approve(q, sc, req.actor, parse(results.approveSchema, req.body)), "اعتماد داخلي:");
  step("reopen", "approve", (q, sc, req) => results.reopen(q, sc, req.actor, parse(results.reasonSchema, req.body).reason), "إعادة فتح:");

  // Fees and reports
  r.get("/fees", requireCap("finance"), handle(async (req, res) => {
    const f = parse(z.object({ course_id: t.optId }), req.query);
    res.json(await inTenant(req, (q) => svc.feesOverview(q, { course_id: f.course_id ?? null })));
  }));
  r.get("/reports/:key", handle(async (req, res) => {
    const R = svc.REPORTS[req.params.key];
    if (!R) throw notFound("التقرير غير موجود");
    if (!svc.can(req.user, R.cap)) throw notFound("التقرير غير متاح");
    const f = parse(svc.reportSchema.extend({ format: z.enum(["json", "csv"]).default("json") }), req.query);
    const out = await inTenant(req, (q) => svc.report(q, req.params.key, f));
    if (f.format === "csv") {
      res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="${req.params.key}.csv"`);
      return res.send(svc.toCsv(out));
    }
    res.json(out);
  }));

  // Trainers (teachers) overview; creating trainer accounts reuses the teachers routes.
  r.get("/trainers", requireCap("view"), handle(async (req, res) => {
    res.json(await inTenant(req, (q) => q(
      `SELECT t.id, t.full_name, t.phone, t.employee_no, t.specialty, t.qualification, t.email, u.username, u.is_active,
              (SELECT count(DISTINCT c.id) FROM courses c LEFT JOIN course_groups g ON g.course_id = c.id
                WHERE (c.trainer_id = t.id OR g.trainer_id = t.id) AND c.status IN ('open', 'running', 'planned'))::int AS active_courses,
              (SELECT COALESCE(sum(s.hours), 0) FROM training_sessions s WHERE s.trainer_id = t.id AND s.status = 'held') AS held_hours,
              (SELECT count(*) FROM training_sessions s WHERE s.trainer_id = t.id AND s.status = 'planned' AND s.day >= CURRENT_DATE)::int AS upcoming
         FROM teachers t LEFT JOIN users u ON u.teacher_id = t.id AND u.role = 'teacher' ORDER BY t.full_name`)));
  }));
  r.get("/trainers/:id", requireCap("view"), handle(async (req, res) => {
    const tid = id(req);
    res.json(await inTenant(req, async (q) => ({
      courses: await svc.listCourses(q, { trainer_id: tid }),
      sessions: await q(`SELECT s.*, c.name AS course, g.name AS group_name FROM training_sessions s JOIN courses c ON c.id = s.course_id
                           LEFT JOIN course_groups g ON g.id = s.group_id WHERE s.trainer_id = $1 ORDER BY s.day DESC LIMIT 200`, [tid]),
      history: await q(`SELECT l.*, c.name AS course FROM training_log l LEFT JOIN courses c ON c.id = l.course_id WHERE l.kind = 'trainer'
                          AND (l.from_value = (SELECT full_name FROM teachers WHERE id = $1) OR l.to_value = (SELECT full_name FROM teachers WHERE id = $1)) ORDER BY l.id DESC LIMIT 50`, [tid]),
    })));
  }));

  // Staff roles (director only): who is academic, registrar or reception.
  r.get("/staff", requireCap("settings"), handle(async (req, res) => {
    res.json(await inTenant(req, (q) => q("SELECT id, full_name, username, role, staff_role, is_active, last_login_at FROM users WHERE role IN ('admin', 'accountant') ORDER BY role, full_name")));
  }));
  r.post("/staff", requireCap("settings"), handle(async (req, res) => {
    const b = parse(z.object({ name: t.name("اسم الموظف"), username: t.username, staff_role: z.enum(Object.keys(svc.STAFF_ROLES)) }), req.body);
    const password = newTempPassword();
    const hash = await hashPassword(password);
    const uid = await inTenant(req, async (q) => {
      const [taken] = await q("SELECT 1 FROM users WHERE username = $1", [b.username]);
      if (taken) throw conflict("اسم المستخدم مستخدم");
      const [u] = await q(`INSERT INTO users (tenant_id, role, full_name, username, password_hash, must_change_password, staff_role)
                           VALUES (app_tenant(), 'admin', $1, $2, $3, true, $4) RETURNING id`, [b.name, b.username, hash, b.staff_role]);
      await audit(q, req, `إنشاء حساب ${svc.STAFF_ROLES[b.staff_role]}: ${b.name}`);
      return u.id;
    });
    res.status(201).json({ id: uid, credentials: { school: req.tenantId, username: b.username, password } });
  }));
  r.put("/staff/:id/role", requireCap("settings"), handle(async (req, res) => {
    const { staff_role } = parse(z.object({ staff_role: z.enum(Object.keys(svc.STAFF_ROLES)) }), req.body);
    await inTenant(req, async (q) => {
      const uid = id(req);
      if (Number(uid) === Number(req.user.id) && staff_role !== "director") throw notFound("لا يمكنك تغيير دورك بنفسك");
      const rows = await q("UPDATE users SET staff_role = $2 WHERE id = $1 AND role = 'admin' RETURNING full_name", [uid, staff_role]);
      if (!rows.length) throw notFound("الحساب غير موجود");
      if (staff_role !== "director") await q("DELETE FROM sessions WHERE user_id = $1", [uid]);
      await audit(q, req, `تعيين دور ${svc.STAFF_ROLES[staff_role]} للحساب ${rows[0].full_name}`);
    });
    res.json({ ok: true });
  }));
  return r;
}

// Trainers: only their own courses, groups and sessions.
export function trainerRouter() {
  const r = Router();
  r.use(requireInstitute);
  const me = (req) => {
    if (!req.user.teacher_id) throw notFound("الحساب غير مرتبط بمدرب");
    return req.user.teacher_id;
  };
  r.get("/meta", handle(async (req, res) => res.json(await inTenant(req, async (q) => ({ settings: await svc.getSettings(q),
    labels: { course_status: svc.COURSE_STATUS, enroll_status: svc.ENROLL_STATUS, modes: svc.MODES, assess_kind: svc.ASSESS_KIND } })))));
  r.get("/courses", handle(async (req, res) => res.json(await inTenant(req, (q) => svc.listCourses(q, { trainer_id: me(req) })))));
  r.get("/courses/:id", handle(async (req, res) => {
    const tid = me(req);
    res.json(await inTenant(req, async (q) => {
      const [own] = await q(`SELECT 1 FROM courses c WHERE c.id = $1 AND (c.trainer_id = $2 OR EXISTS (SELECT 1 FROM course_groups g WHERE g.course_id = c.id AND g.trainer_id = $2))`, [id(req), tid]);
      if (!own) throw notFound("الدورة ليست من دوراتك");
      const d = await svc.getCourse(q, id(req));
      const mine = (await svc.courseRoster(q, id(req), { trainerId: tid })).map((e) => Number(e.id));
      return { ...d, enrollments: d.enrollments.filter((e) => mine.includes(Number(e.id))),
        sessions: d.sessions.filter((s) => [s.trainer_id, d.groups.find((g) => Number(g.id) === Number(s.group_id))?.trainer_id,
          s.group_id ? null : d.course.trainer_id].map(Number).includes(Number(tid))), history: [] };
    }));
  }));
  r.get("/sessions", handle(async (req, res) => {
    res.json(await inTenant(req, (q) => q(
      `SELECT s.*, c.name AS course, g.name AS group_name, (SELECT count(*)::int FROM session_attendance a WHERE a.session_id = s.id) AS recorded
         FROM training_sessions s JOIN courses c ON c.id = s.course_id LEFT JOIN course_groups g ON g.id = s.group_id
        WHERE (s.trainer_id = $1 OR g.trainer_id = $1 OR (s.group_id IS NULL AND c.trainer_id = $1))
          AND s.day BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE + 21 ORDER BY s.day, s.starts_at NULLS FIRST`, [me(req)])));
  }));
  r.get("/sessions/:id/attendance", handle(async (req, res) => res.json(await inTenant(req, (q) => svc.sessionRoster(q, id(req), { trainerId: me(req) })))));
  r.put("/sessions/:id/attendance", handle(async (req, res) => {
    const b = parse(svc.attendanceSchema, req.body);
    res.json(await inTenant(req, (q) => svc.saveAttendance(q, id(req), b, req.actor, { trainerId: me(req) })));
  }));
  r.patch("/sessions/:id", handle(async (req, res) => {
    const b = parse(svc.sessionStatusSchema.pick({ topic: true, note: true }).extend({ status: z.enum(["held", "planned"]).default("held") }), req.body);
    await inTenant(req, (q) => svc.updateSession(q, id(req), b, { trainerId: me(req) })); res.json({ ok: true });
  }));
  r.put("/assessments/:id/scores", handle(async (req, res) => {
    const b = parse(svc.scoresSchema, req.body);
    res.json(await inTenant(req, async (q) => {
      const out = await svc.saveScores(q, id(req), b, req.actor, { trainerId: me(req) });
      if (out.changed) await audit(q, req, `رصد/تعديل ${out.changed} درجة (تقييم ${id(req)})`);
      return out;
    }));
  }));
  return r;
}
