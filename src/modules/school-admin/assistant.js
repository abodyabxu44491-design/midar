// مساعد إدخال البيانات: قائمة الاكتمال، والطلاب الناقصة بياناتهم وحفظها، والمعلمون دفعة واحدة.
// إضافة الطلاب بلصق قائمة تستخدم مسار الطلاب نفسه (/students/import) بعد المعاينة في الواجهة.
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import { startJob } from "../../core/jobs.js";
import * as A from "../shared/data-assistant.service.js";
import * as teachersImport from "../shared/import-teachers.service.js";

const r = Router();

r.get("/checklist", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => A.checklist(q, req.modules || {})));
}));

r.get("/students", handle(async (req, res) => {
  const f = parse(A.missingQuery, req.query);
  res.json(await inTenant(req, (q) => A.studentsFor(q, f)));
}));

r.post("/students/fill", handle(async (req, res) => {
  const { rows } = parse(A.fillSchema, req.body);
  res.json(await inTenant(req, (q) => A.fillStudents(q, rows)));
}));

// المعلمون: أسماء مستخدمين تلقائية، ثم مسار استيراد المعلمين نفسه في الخلفية (كلمات مرور مؤقتة لمن أضافهم فقط)
r.post("/teachers", handle(async (req, res) => {
  const { teachers } = parse(A.teachersSchema, req.body);
  const maxTeachers = req.subscription?.max_teachers ?? null;
  res.status(202).json(await startJob({ tenantId: req.tenantId, kind: "import_teachers", total: teachers.length, step: "إضافة المعلمين", req },
    async ({ progress }) => {
      const { credentials, ...summary } = await inTenant(req, async (q) =>
        teachersImport.commit(q, req.tenantId, await A.teacherRows(q, teachers), { maxTeachers, onProgress: (n, total) => progress(n, total) }));
      return { summary, secret: { credentials } };
    }));
}));

export default r;
