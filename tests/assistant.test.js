// مساعد إدخال البيانات: قراءة القوائم الملصوقة، قائمة الاكتمال، إكمال الناقص في جدول، والمعلمون دفعة واحدة.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";
import { parseList, normalizePhone } from "../public/shared/js/paste-parse.js";

let srv, owner, admin, cls;
const id = `as-${uid()}`.slice(0, 28);

async function waitJob(c, url) {
  for (let i = 0; i < 300; i++) {
    const r = await c.get(url);
    if (r.data.status !== "running") return r.data;
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error("job timeout");
}

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  const r = await owner.post("/api/owner/tenants", { id, name: "مدرسة المساعد", max_students: 100 });
  admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: id, username: "admin", password: r.data.credentials.password })).status, 200);
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = 'admin'"));
});
after(async () => { await srv.close(); await endPool(); });

test("قراءة القائمة: الترقيم، الأرقام العربية، 967، أعمدة Excel، المكرر والموجود، وسطر العناوين", () => {
  const rows = parseList([
    "الاسم\tالجوال",
    "1- محمد علي أحمد العريقي 777123456",
    "٢) أحمد صالح ناجي الشميري ٧٣٣-٤٥٦-٧٨٩",
    "يوسف عبده قاسم الصبري\tعبده قاسم الصبري\t00967711222333",
    "1- 777555666 سامي جمال العبسي",
    "محمد علي أحمد العريقي",
    "عمر الحكيمي",
  ].join("\n"), { existing: ["عُمَر  الحكيمي"] });
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => r.phone), ["777123456", "733456789", "711222333", "777555666", null, null]);
  assert.equal(rows[0].guardian_name, "علي أحمد العريقي");
  assert.equal(rows[0].guardian_suggested, true);
  assert.equal(rows[2].guardian_name, "عبده قاسم الصبري");
  assert.equal(rows[2].guardian_suggested, false);
  assert.equal(rows[3].name, "سامي جمال العبسي");
  assert.equal(rows[4].duplicate, true);
  assert.equal(rows[5].exists, true, "التشكيل والمسافات لا تمنع اكتشاف الموجود");
  assert.ok(rows[5].warnings.includes("الاسم أقل من ثلاثي"));
  assert.equal(normalizePhone("+967 77 712 3456").phone, "777123456");
  assert.equal(normalizePhone("0777123456").ok, true);
  assert.equal(normalizePhone("12345").ok, false);
});

test("قائمة الاكتمال لمدرسة جديدة: الطلاب والمعلمون مطلوبون والنسبة منخفضة", async () => {
  const d = (await admin.get("/api/admin/assistant/checklist")).data;
  const item = (k) => d.items.find((x) => x.key === k);
  assert.equal(item("students").level, "todo");
  assert.equal(item("teachers").level, "todo");
  assert.ok(d.score < 50, `score ${d.score}`);
  const t = await admin.post("/api/admin/setup/template", { template: "primary", sections_per_grade: 1, grade_set: "yemen" });
  assert.ok([200, 201].includes(t.status));
  cls = (await admin.get("/api/admin/structure/classes")).data[0].id;
});

test("إضافة الطلاب ثم إكمال الناقص في جدول: ما تغيّر فقط، والأرقام العربية، وتعارض النسخة", async () => {
  const list = parseList("محمد علي أحمد العريقي 777123456\nأحمد صالح ناجي الشميري\nخالد فؤاد سيف المخلافي");
  const add = await admin.post("/api/admin/students/import", { students: list.map((r) => ({ name: r.name, class_id: cls, guardian_name: r.guardian_name, guardian_phone: r.phone })) });
  assert.equal(add.status, 201, JSON.stringify(add.data));

  let miss = (await admin.get(`/api/admin/assistant/students?missing=phone&class_id=${cls}`)).data;
  assert.equal(miss.length, 2);
  const [a, b] = miss;
  const r = await admin.post("/api/admin/assistant/students/fill", { rows: [
    { id: a.id, version: a.version, guardian_phone: "٧٣٣٤٥٦٧٨٩", birth_date: "2016-05-01" },
    { id: b.id, version: b.version + 5, guardian_phone: "770000000" },     // نسخة قديمة: لا تُحفظ
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.updated, 1);
  assert.deepEqual(r.data.conflicts, [b.id]);
  const row = await transaction({ tenantId: id }, async (q) => (await q("SELECT guardian_phone, guardian_name, birth_date::text AS b FROM students WHERE id = $1", [a.id]))[0]);
  assert.equal(row.guardian_phone, "733456789");
  assert.equal(row.b, "2016-05-01");
  assert.equal(row.guardian_name, a.guardian_name, "ما لم يُرسل لا يتغير");
  miss = (await admin.get(`/api/admin/assistant/students?missing=phone&class_id=${cls}`)).data;
  assert.equal(miss.length, 1);
  // رقم طالب مكرر في الجدول نفسه مرفوض
  const all = (await admin.get(`/api/admin/assistant/students?missing=all&class_id=${cls}`)).data;
  const dup = await admin.post("/api/admin/assistant/students/fill", { rows: all.slice(0, 2).map((s) => ({ id: s.id, version: s.version, student_no: "500" })) });
  assert.equal(dup.status, 400);
});

test("المعلمون دفعة واحدة: أسماء مستخدمين متتابعة، وكلمات مرور تعمل، والدفعة الثانية تكمل الترقيم", async () => {
  const start = await admin.post("/api/admin/assistant/teachers", { teachers: [
    { name: "عبدالله محمد الشميري", phone: "٧٧٧١٢٣٤٥٦", specialty: "رياضيات" }, { name: "أحمد علي العريقي" }] });
  assert.equal(start.status, 202, JSON.stringify(start.data));
  const job = await waitJob(admin, `/api/admin/jobs/${start.data.id}`);
  assert.equal(job.status, "done", JSON.stringify(job));
  const creds = job.secret.credentials;
  assert.deepEqual(creds.map((c) => c.username), ["t1001", "t1002"]);
  const t = client(srv.base);
  assert.equal((await t.post("/api/staff/login", { school: id, username: "t1001", password: creds[0].password })).status, 200);
  const saved = await transaction({ tenantId: id }, async (q) => (await q("SELECT phone, specialty FROM teachers WHERE full_name = 'عبدالله محمد الشميري'"))[0]);
  assert.equal(saved.phone, "777123456");
  assert.equal(saved.specialty, "رياضيات");

  const again = await admin.post("/api/admin/assistant/teachers", { teachers: [{ name: "خالد سعيد الحكيمي" }] });
  const j2 = await waitJob(admin, `/api/admin/jobs/${again.data.id}`);
  assert.equal(j2.secret.credentials[0].username, "t1003");

  const d = (await admin.get("/api/admin/assistant/checklist")).data;
  assert.equal(d.items.find((x) => x.key === "teachers").level, "ok");
  assert.equal(d.items.find((x) => x.key === "students").level, "ok");
  assert.equal(d.items.find((x) => x.key === "no_phone").level, "warn");
});
