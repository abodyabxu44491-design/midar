/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as bd from "../shared/book-deposits.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  const f = parse(z.object({ status: z.enum(Object.keys(bd.STATUSES)).optional().or(z.literal("")), student_id: t.optId }), req.query);
  res.json(await inTenant(req, async (q) => ({
    ...(await bd.overview(q)), items: await bd.list(q, { status: f.status || null, studentId: f.student_id }),
    books: await q(`SELECT b.id, b.title, b.copies - (SELECT count(*) FROM library_loans l WHERE l.book_id = b.id AND l.returned_on IS NULL)::int AS available
                      FROM library_books b ORDER BY b.title LIMIT 500`),
    conditions: bd.CONDITIONS, statuses: bd.STATUSES,
  })));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(bd.issueSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => bd.issue(q, b, req.actor)));
}));

r.post("/:id/return", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(bd.returnSchema, req.body);
  res.json(await inTenant(req, (q) => bd.settle(q, id, b, req.actor)));
}));

r.get("/:id/voucher", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, (q) => bd.voucher(q, id)));
}));

export default r;
