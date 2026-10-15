/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { requireModule } from "../../core/auth/guards.js";
import * as sv from "../shared/services.service.js";
import { matchesMime } from "../shared/attachments.service.js";

const r = Router();
const id = (req, k = "id") => parse(t.id, req.params[k]);
const run = (fn) => handle(async (req, res) => res.json(await inTenant(req, (q) => fn(q, req))));

const bus = Router();
bus.get("/", run((q) => sv.buses(q)));
bus.post("/", run((q, req) => sv.saveBus(q, parse(sv.busSchema, req.body))));
bus.put("/:id", run((q, req) => sv.saveBus(q, parse(sv.busSchema, req.body), id(req))));
bus.delete("/:id", run(async (q, req) => { await sv.removeBus(q, id(req)); return { ok: true }; }));
bus.get("/:id/riders", run((q, req) => sv.ridersOf(q, id(req))));
bus.post("/:id/riders", run((q, req) => sv.assignRiders(q, id(req), parse(sv.assignSchema, req.body))));
bus.delete("/riders/:student", run(async (q, req) => { await sv.unassignRider(q, id(req, "student")); return { ok: true }; }));
bus.post("/:id/events", run((q, req) => sv.recordBusEvent(q, id(req), parse(sv.eventSchema, req.body), req.actor)));
bus.get("/:id/day", run((q, req) => sv.busDay(q, id(req), parse(z.object({ day: t.date }), req.query).day)));
bus.post("/:id/bill", run((q, req) => sv.billRiders(q, id(req), parse(z.object({ title: t.optText(120), due_date: t.optDate }), req.body), req.actor)));
r.use("/transport", requireModule("transport"), bus);

const lib = Router();
lib.get("/meta", run((q) => sv.libraryMeta(q)));
lib.get("/books", run((q, req) => {
  const f = parse(z.object({ q: z.string().trim().max(80).optional(), grade_id: t.optId }), req.query);
  return sv.books(q, { search: f.q || null, grade_id: f.grade_id ?? null });
}));
lib.post("/books", run((q, req) => sv.saveBook(q, parse(sv.bookSchema, req.body))));
lib.post("/books/grade", run((q, req) => sv.addGradeBooks(q, parse(sv.bulkSchema, req.body))));
lib.post("/books/:id/cover", run(async (q, req) => { await sv.setCover(q, id(req), parse(sv.coverSchema, req.body), matchesMime); return { ok: true }; }));
lib.delete("/books/:id/cover", run(async (q, req) => { await sv.removeCover(q, id(req)); return { ok: true }; }));
lib.get("/books/:id/cover", handle(async (req, res) => {
  const c = await inTenant(req, (q) => sv.readCover(q, id(req)));
  res.set("Cache-Control", "private, max-age=300").type(c.mime).send(c.data);
}));
lib.put("/books/:id", run((q, req) => sv.saveBook(q, parse(sv.bookSchema, req.body), id(req))));
lib.delete("/books/:id", run(async (q, req) => { await sv.removeBook(q, id(req)); return { ok: true }; }));
lib.get("/loans", run((q, req) => sv.loans(q, { open: req.query.all !== "1" })));
lib.post("/loans", run((q, req) => sv.lend(q, parse(sv.loanSchema, req.body), req.actor)));
lib.post("/loans/:id/return", run(async (q, req) => { await sv.returnLoan(q, id(req)); return { ok: true }; }));
r.use("/library", requireModule("library"), lib);

const inv = Router();
inv.get("/items", run((q) => sv.items(q)));
inv.post("/items", run((q, req) => sv.saveItem(q, parse(sv.itemSchema, req.body))));
inv.put("/items/:id", run((q, req) => sv.saveItem(q, parse(sv.itemSchema, req.body), id(req))));
inv.post("/items/:id/move", run((q, req) => sv.move(q, id(req), parse(sv.moveSchema, req.body), req.actor)));
inv.get("/moves", run((q, req) => sv.moves(q, req.query.item_id ? parse(t.id, req.query.item_id) : null)));
inv.get("/custody", run((q) => sv.custodyByStaff(q)));
r.use("/inventory", requireModule("inventory"), inv);

const clinic = Router();
clinic.get("/visits", run((q, req) => sv.visits(q, parse(z.object({ student_id: t.optId, from: t.optDate }), req.query))));
clinic.post("/visits", run((q, req) => sv.addVisit(q, parse(sv.visitSchema, req.body), req.actor)));
clinic.get("/students/:id", run((q, req) => sv.healthOf(q, id(req))));
clinic.put("/students/:id", run(async (q, req) => { await sv.saveHealth(q, id(req), parse(sv.healthSchema, req.body), req.actor); return { ok: true }; }));
r.use("/clinic", requireModule("clinic"), clinic);

export default r;
