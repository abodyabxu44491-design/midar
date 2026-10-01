// الموظفون والرواتب داخل المالية: المعلمون موظفون تلقائيًا، أنواع الموظفين، الراتب (أساسي + بدل)،
// مسير الشهر (معاينة ← إنشاء ← تعديل ← اعتماد ← صرف بتاريخ) وقيوده في السجل، وحذف المسودة، والنظرة العامة.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, admin, teacherId;
const id = `pr-${uid()}`.slice(0, 28);
const L = "/api/admin/ledger";

before(async () => {
  srv = await startServer();
  const owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  const r = await owner.post("/api/owner/tenants", { id, name: "مدرسة الرواتب" });
  admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: id, username: "admin", password: r.data.credentials.password })).status, 200);
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = 'admin'"));
});
after(async () => { await srv.close(); await endPool(); });

test("المعلم موظف تلقائيًا: يُضاف ويتبعه اسمه وجواله، ويُوقف بحذفه", async () => {
  const t = await admin.post("/api/admin/teachers", { name: "أ. سعيد علي الحكيمي", username: `s${uid()}`.slice(0, 18), phone: "777111222" });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  teacherId = t.data.id;
  let staff = (await admin.get(`${L}/staff`)).data.staff;
  const me = staff.find((s) => s.teacher_id === teacherId);
  assert.ok(me, "المعلم ظهر في الموظفين");
  assert.equal(me.category, "teacher");
  assert.equal(me.phone, "777111222");
  await admin.patch(`/api/admin/teachers/${teacherId}`, { name: "أ. سعيد علي الحكيمي (معدّل)", phone: "733000111" });
  staff = (await admin.get(`${L}/staff`)).data.staff;
  assert.equal(staff.find((s) => s.teacher_id === teacherId).full_name, "أ. سعيد علي الحكيمي (معدّل)");
  // المعلم المرتبط: الاسم والنوع لا يتغيران من المالية
  await admin.patch(`${L}/staff/${me.id}`, { full_name: "اسم آخر", category: "guard", base_salary: 120000, allowance: 20000, pay_method: "transfer", account_number: "٣٠١٢٠٤٥" });
  const after = (await admin.get(`${L}/staff`)).data.staff.find((s) => s.id === me.id);
  assert.equal(after.category, "teacher");
  assert.notEqual(after.full_name, "اسم آخر");
  assert.equal(Number(after.monthly), 140000);
  assert.equal(after.account_number, "3012045");
  const file = (await admin.get(`/api/admin/teachers/${teacherId}/file`)).data;
  assert.equal(Number(file.teacher.monthly_salary), 140000, "الراتب يظهر في ملف المعلم");
});

test("أنواع الموظفين والملخص: حارس وسائق ومحاسب، والراتب يُعدَّل من السطر", async () => {
  for (const [name, category, base] of [["ناصر محمد الحارس", "guard", 60000], ["علي صالح السائق", "driver", 70000], ["فؤاد أحمد المحاسب", "accountant", 0]]) {
    const r = await admin.post(`${L}/staff`, { full_name: name, category, base_salary: base, phone: "0501234567" });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  let d = (await admin.get(`${L}/staff`)).data;
  assert.deepEqual(d.summary.types.map((x) => x.key), ["teacher", "accountant", "guard", "driver"], "الأنواع بترتيبها");
  assert.equal(d.summary.no_salary, 1);
  const acc = d.staff.find((s) => s.category === "accountant");
  assert.equal(acc.phone, "0501234567", "جوال سعودي مقبول");
  assert.equal((await admin.patch(`${L}/staff/${acc.id}/salary`, { base_salary: 90000, allowance: 5000 })).status, 200);
  d = (await admin.get(`${L}/staff`)).data;
  assert.equal(d.summary.no_salary, 0);
  assert.equal(d.summary.monthly, 140000 + 60000 + 70000 + 95000);
});

test("مسير الشهر: معاينة ← إنشاء (أساسي + بدل) ← حذف المسودة وإعادتها ← تعديل ← اعتماد ← صرف بتاريخ", async () => {
  const period = "2026-06-01";
  let m = (await admin.get(`${L}/payroll/month?period=${period}`)).data;
  assert.equal(m.run, null);
  assert.equal(m.preview.length, 4);
  assert.equal(m.total, 365000);

  let run = (await admin.post(`${L}/payroll`, { period })).data;
  assert.equal(run.employees, 4);
  m = (await admin.get(`${L}/payroll/month?period=${period}`)).data;
  assert.equal(Number(m.run.total), 365000, "الأساسي + البدل الثابت");
  assert.equal((await admin.del(`${L}/payroll/${m.run.id}`)).status, 200, "حذف المسودة");
  assert.equal((await admin.get(`${L}/payroll/month?period=${period}`)).data.run, null);
  run = (await admin.post(`${L}/payroll`, { period })).data;
  assert.ok(run.id, "إعادة الإنشاء للشهر نفسه");

  m = (await admin.get(`${L}/payroll/month?period=${period}`)).data;
  const guard = m.items.find((i) => i.category === "guard");
  const upd = await admin.patch(`${L}/payroll/${run.id}/items/${guard.id}`, { allowances: 0, bonus: 10000, deductions: 5000, advances: 0 });
  assert.equal(Number(upd.data.net), 65000);
  assert.equal((await admin.patch(`${L}/payroll/${run.id}/items/${guard.id}`, { allowances: 0, bonus: 0, deductions: 999999, advances: 0 })).status, 400, "الخصم لا يتجاوز الراتب");

  assert.equal((await admin.post(`${L}/payroll/${run.id}/approve`, {})).status, 200);
  assert.equal((await admin.del(`${L}/payroll/${run.id}`)).status, 400, "المعتمد لا يُحذف");
  const paid = await admin.post(`${L}/payroll/${run.id}/pay`, { method: "cash", paid_on: "2026-06-30" });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal(paid.data.paid, 4);
  const entries = (await admin.get(`${L}/entries?from=2026-06-01&to=2026-06-30&source_type=salary`)).data;
  assert.equal(entries.length, 4);
  assert.ok(entries.every((e) => e.occurred_on.startsWith("2026-06-30")), "القيد بتاريخ الصرف");
  assert.equal(entries.reduce((n, e) => n + Number(e.amount), 0), 370000);

  const o = (await admin.get(`${L}/overview?from=2026-06-01&to=2026-06-30`)).data;
  assert.equal(o.salaries, 370000);
  assert.equal(o.staff.count, 4);
  assert.ok(o.payroll, "رواتب الشهر الحالي في النظرة العامة");
});

test("حذف المعلم يوقف سجله الوظيفي ولا يحذف رواتبه المصروفة", async () => {
  const del = await admin.del(`/api/admin/teachers/${teacherId}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const staff = (await admin.get(`${L}/staff`)).data.staff;
  const old = staff.find((s) => s.full_name.startsWith("أ. سعيد"));
  assert.equal(old.is_active, false);
  const entries = (await admin.get(`${L}/entries?from=2026-06-01&to=2026-06-30&source_type=salary`)).data;
  assert.equal(entries.length, 4);
});
