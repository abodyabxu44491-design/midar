// اليمن السوق الأساسية: عملة ورمز اتصال افتراضيان، الدولة تضبطهما، أسماء الصفوف والمراحل اليمنية،
// الأرقام العربية في الجوال، والحساب البنكي أو المحفظة بلا آيبان.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner, admin;
const id = `ye-${uid()}`.slice(0, 28);
const one = (sql, p = []) => transaction({ tenantId: id }, async (q) => (await q(sql, p))[0]);

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  const r = await owner.post("/api/owner/tenants", { id, name: "مدرسة يمنية", max_students: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: id, username: "admin", password: r.data.credentials.password })).status, 200);
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = 'admin'"));
});
after(async () => { await srv.close(); await endPool(); });

test("المدرسة الجديدة: ريال يمني ورمز اتصال 967 افتراضيًا", async () => {
  assert.equal((await one("SELECT currency FROM tenants WHERE id = $1", [id])).currency, "YER");
  const tpl = (await admin.get("/api/admin/messaging/templates")).data;
  assert.equal(tpl.country_code, "967");
});

test("الدولة تضبط رمز الاتصال والعملة (قبل أي حركة مالية)", async () => {
  assert.equal((await admin.put("/api/admin/setup/profile", { country: "السعودية" })).status, 200);
  assert.equal((await admin.get("/api/admin/messaging/templates")).data.country_code, "966");
  assert.equal((await one("SELECT currency FROM tenants WHERE id = $1", [id])).currency, "SAR");
  assert.equal((await admin.put("/api/admin/setup/profile", { country: "اليمن" })).status, 200);
  assert.equal((await admin.get("/api/admin/messaging/templates")).data.country_code, "967");
  assert.equal((await one("SELECT currency FROM tenants WHERE id = $1", [id])).currency, "YER");
  // دولة أخرى: لا تغيّر العملة ولا الرمز
  await admin.put("/api/admin/setup/profile", { country: "ماليزيا" });
  assert.equal((await admin.get("/api/admin/messaging/templates")).data.country_code, "967");
  await admin.put("/api/admin/setup/profile", { country: "اليمن" });
});

test("أسماء الصفوف اليمنية بلا «الأساسي»، والمراحل: الأساسي والثانوي", async () => {
  const r = await admin.post("/api/admin/setup/template", { template: "full", sections_per_grade: 1, grade_set: "yemen" });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.data));
  const grades = (await transaction({ tenantId: id }, (q) => q("SELECT g.name FROM grades g JOIN stages s ON s.id = g.stage_id ORDER BY s.sort_order, g.sort_order"))).map((g) => g.name);
  assert.deepEqual(grades.slice(0, 3), ["الأول", "الثاني", "الثالث"]);
  assert.ok(grades.includes("التاسع") && grades.includes("أول ثانوي"));
  assert.ok(!grades.some((g) => g.includes("الأساسي")));
  const stages = (await transaction({ tenantId: id }, (q) => q("SELECT name FROM stages ORDER BY sort_order"))).map((s) => s.name);
  assert.deepEqual(stages, ["الأساسي (1–6)", "الأساسي (7–9)", "الثانوي"]);
  // الرجوع لنمط آخر يعيد أسماء المراحل الافتراضية أيضًا
  await admin.post("/api/admin/setup/rename-grades", { grade_set: "arabic_full" });
  assert.equal((await one("SELECT name FROM stages ORDER BY sort_order LIMIT 1")).name, "المرحلة الابتدائية");
  await admin.post("/api/admin/setup/rename-grades", { grade_set: "yemen" });
  assert.equal((await one("SELECT name FROM stages ORDER BY sort_order LIMIT 1")).name, "الأساسي (1–6)");
});

test("الجوال بالأرقام العربية وبالشرطات يُقبل ويُحفظ أرقامًا", async () => {
  const s = await admin.post("/api/admin/students", { name: "محمد علي العريقي", guardian_phone: "٧٧٧-١٢٣-٤٥٦" });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal((await one("SELECT guardian_phone FROM students WHERE id = $1", [s.data.id])).guardian_phone, "777123456");
});

test("حساب بنكي أو محفظة برقم حساب فقط بلا آيبان، ولا يُقبل بدون رقم", async () => {
  const ok = await admin.post("/api/admin/settings/payment/accounts", { bank_name: "محفظة جوالي", account_holder: "مدرسة يمنية", account_number: "٧٧٧٠٠٠١٢٣" });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const bad = await admin.post("/api/admin/settings/payment/accounts", { bank_name: "بنك", account_holder: "مدرسة يمنية" });
  assert.equal(bad.status, 400);
  const acc = (await admin.get("/api/admin/settings/payment")).data.accounts;
  assert.equal(acc[0].account_number, "777000123");
  assert.equal(acc[0].iban, null);
});
