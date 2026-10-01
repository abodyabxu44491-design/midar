// مدرسة العرض الكاملة: تُنشأ من لوحة المالك وتعمل كمدرسة حقيقية للمدير والمعلم وولي الأمر،
// بجدول كامل بلا تعارض، وحضور ودرجات منشورة وفواتير متوازنة مع القيود، ولا تُنشأ مرتين بنفس الرمز.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner, r, jobId;
const id = `sc-${uid()}`.slice(0, 28);

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  const start = await owner.post("/api/owner/tenants/showcase", { id, name: "مدرسة اختبار العرض" });
  assert.equal(start.status, 202, JSON.stringify(start.data));
  jobId = start.data.id;
  const job = await waitJob(owner, `/api/owner/jobs/${jobId}`);
  assert.equal(job.status, "done", JSON.stringify(job));
  r = { data: job.secret };
});
after(async () => { await srv.close(); await endPool(); });

async function waitJob(c, url) {
  for (let i = 0; i < 300; i++) {
    const j = (await c.get(url)).data;
    if (j.status !== "running") return j;
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error("job timeout");
}

const q1 = (sql, p = []) => transaction({ tenantId: id }, async (q) => (await q(sql, p))[0]);

test("الهيكل كامل: 3 مراحل و24 شعبة ومعلمون بنصاب لا يتجاوز 20 وجدول بلا تعارض", async () => {
  const s = r.data.summary;
  assert.equal(s.structure.stages, 3);
  assert.equal(s.structure.sections, 24);
  assert.ok(s.teachers >= 30, `teachers ${s.teachers}`);
  assert.ok(s.students >= 24 * 20);
  const clash = await q1(`SELECT count(*)::int AS n FROM (SELECT teacher_id, day, period FROM timetable_slots
                            WHERE teacher_id IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) > 1) x`);
  assert.equal(clash.n, 0);
  const gap = await q1(`SELECT count(*)::int AS n FROM classes c
     WHERE (SELECT count(*) FROM timetable_slots ts WHERE ts.class_id = c.id)
        <> (SELECT sum(s.weekly_periods) FROM subjects s JOIN subject_grades sg ON sg.subject_id = s.id WHERE sg.grade_id = c.grade_id AND s.is_active)`);
  assert.equal(gap.n, 0, "كل شعبة جدولها مكتمل");
  const load = await q1("SELECT max(n)::int AS m FROM (SELECT count(*) AS n FROM timetable_slots GROUP BY teacher_id) x");
  assert.ok(load.m <= 20);
});

test("عام كامل منتهٍ: فصلان، رسوم ودفعات بتواريخها، رواتب عشرة أشهر، والصندوق لا ينزل تحت الصفر", async () => {
  const y = await q1("SELECT name, end_date::text AS e, (SELECT count(*)::int FROM terms) AS terms FROM academic_years WHERE is_current");
  assert.equal(y.terms, 2);
  assert.ok(y.e < new Date().toISOString().slice(0, 10), "السنة منتهية");
  const pr = await q1("SELECT count(*)::int AS n, bool_and(status = 'paid') AS all_paid FROM payroll_runs");
  assert.equal(pr.n, 10);
  assert.ok(pr.all_paid);
  const months = await q1("SELECT count(DISTINCT to_char(occurred_on, 'YYYY-MM'))::int AS n FROM finance_entries WHERE source_type = 'fee'");
  assert.ok(months.n >= 6, "الدفعات موزعة على أشهر السنة");
  const neg = await q1("SELECT count(*)::int AS n FROM finance_accounts WHERE account_balance(id) < 0");
  assert.equal(neg.n, 0);
  const staff = await q1("SELECT count(*)::int AS n, count(DISTINCT category)::int AS kinds FROM staff WHERE is_active");
  assert.ok(staff.kinds >= 7, "أنواع الموظفين");
  const hol = await q1("SELECT count(*)::int AS n, bool_or(name ~ '(ثورة|الوحدة|الاستقلال|الوطني)') AS political FROM holidays");
  assert.equal(hol.political, false, "بلا مناسبات سياسية");
  assert.ok(r.data.summary.accountant.password);
});

test("الرسوم: فاتورة لكل طالب ودفعات مسجلة", async () => {
  const f = await q1(`SELECT (SELECT COALESCE(sum(amount), 0) FROM payments) AS paid,
                             (SELECT count(*) FROM invoices)::int AS inv`);
  assert.equal(f.inv, r.data.summary.students * 2, "فاتورة لكل فصل من الفصلين");
  assert.ok(f.paid > 0);
});

test("المدير يدخل ويرى المدرسة، والمعلم يرى جدوله، وولي الأمر يرى الحضور والدرجات", async () => {
  const c = r.data.credentials;
  const admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: id, username: c.username, password: c.password })).status, 200);
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = 'admin'"));
  const dash = await admin.get("/api/admin/dashboard");
  assert.equal(dash.status, 200, JSON.stringify(dash.data));

  const t = r.data.summary.teacher_samples[0];
  const teacher = client(srv.base);
  assert.equal((await teacher.post("/api/staff/login", { school: id, username: t.username, password: t.password })).status, 200);
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = $1", [t.username]));
  const tt = await teacher.get("/api/teacher/timetable");
  assert.equal(tt.status, 200);
  assert.ok(JSON.stringify(tt.data).length > 200);

  const p = r.data.summary.parent_samples[0];
  const pr = await client(srv.base).post(`/api/public/${id}/student`, { access: c.directory_code, student_id: p.student_id, key: p.access_key });
  assert.equal(pr.status, 200, JSON.stringify(pr.data));
  assert.ok(pr.data.attendance.length > 0, "سجل حضور");
  assert.ok(JSON.stringify(pr.data).includes("اختبار"), "درجات منشورة");
});

test("لا تُنشأ مرتين بنفس الرمز، وكلمات المرور لا تُحفظ في سجل العمليات وتُسلَّم مرة واحدة", async () => {
  const again = await owner.post("/api/owner/tenants/showcase", { id, name: "مكرر" });
  assert.equal(again.status, 409);
  const row = await transaction({ platform: true }, async (q) => (await q("SELECT * FROM jobs WHERE id = $1", [jobId]))[0]);
  assert.equal(row.status, "done");
  assert.ok(!JSON.stringify(row).includes(r.data.credentials.password), "لا كلمة مرور في jobs");
  assert.ok(!JSON.stringify(row).includes(r.data.summary.teacher_samples[0].password));
  const second = (await owner.get(`/api/owner/jobs/${jobId}`)).data;
  assert.equal(second.status, "done");
  assert.equal(second.secret, undefined, "النتيجة السرية تُسلَّم مرة واحدة");
  assert.equal(second.summary.counts.students, r.data.summary.students);
});
