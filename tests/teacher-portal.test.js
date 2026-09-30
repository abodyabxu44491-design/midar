// بوابة المعلم: صفحة «حسابي» وتحديث التواصل و«طلابي» (فصوله فقط)، وبقاء كلمة المرور المؤقتة ظاهرة للإدارة حتى يغيّرها
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { keySource } from "../src/core/auth/secret-box.js";

let srv, admin, teacher, school;
const s = {};

before(async () => {
  srv = await startServer();
  const owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  school = `tp-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id: school, name: "مدرسة البوابة", max_students: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school, username: "admin", password: r.data.credentials.password })).status, 200);
  s.mine = (await admin.post("/api/admin/structure/classes", { name: "الأول - أ" })).data.id;
  s.other = (await admin.post("/api/admin/structure/classes", { name: "الأول - ب" })).data.id;
  const sub = (await admin.post("/api/admin/structure/subjects", { name: "العلوم" })).data.id;
  s.user = `nora${uid()}`.slice(0, 20);
  const t = await admin.post("/api/admin/teachers", { name: "أ. نورة", username: s.user, job_title: "معلمة", specialty: "علوم", load: [{ class_id: s.mine, subject_id: sub }] });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  s.teacher = t.data.id; s.temp = t.data.credentials.password;
  await admin.post("/api/admin/students", { name: "طالبة الفصل", class_id: s.mine });
  await admin.post("/api/admin/students", { name: "طالبة أخرى", class_id: s.other });
});
after(async () => { await srv.close(); await endPool(); });

test("المفتاح: يُشتق تلقائيًا من DATABASE_URL إن لم يُضبط CREDENTIAL_KEY", () => {
  assert.equal(keySource({ DATABASE_URL: "postgres://x" }), "derived");
  assert.equal(keySource({}), "none");
  assert.equal(keySource({ CREDENTIAL_KEY: "a".repeat(64), DATABASE_URL: "postgres://x" }), "CREDENTIAL_KEY");
});

test("الإدارة ترى كلمة المرور المؤقتة في كل مرة حتى يغيّرها المعلم", async () => {
  for (let i = 0; i < 2; i++) {
    const r = await admin.post(`/api/admin/teachers/${s.teacher}/initial-credentials`, {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.password, s.temp);
    assert.equal(r.data.username, s.user);
  }
  teacher = client(srv.base);
  assert.equal((await teacher.post("/api/staff/login", { school, username: s.user, password: s.temp })).status, 200);
  s.pw = "Nora-Pass-2026x";
  assert.equal((await teacher.post("/api/teacher/password", { current: s.temp, next: s.pw })).status, 200);
  assert.equal((await admin.post(`/api/admin/teachers/${s.teacher}/initial-credentials`, {})).status, 404, "تختفي بعد التغيير");
  const file = (await admin.get(`/api/admin/teachers/${s.teacher}/file`)).data;
  assert.equal(file.account.initial_password_available, false);
});

test("حسابي: كل البيانات بلا أسرار، والمعلم يعدّل التواصل فقط", async () => {
  const p = await teacher.get("/api/teacher/profile");
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.profile.name, "أ. نورة");
  assert.equal(p.data.profile.job_title, "معلمة");
  assert.equal(p.data.account.username, s.user);
  assert.equal(p.data.summary.classes, 1);
  assert.equal(p.data.summary.students, 1);
  assert.doesNotMatch(JSON.stringify(p.data), /password_hash|initial_password|\$argon|\$scrypt/);

  assert.equal((await teacher.patch("/api/teacher/profile", { phone: "0551234567", email: "nora@example.com", job_title: "مديرة" })).status, 200);
  const after2 = (await teacher.get("/api/teacher/profile")).data.profile;
  assert.equal(after2.phone, "0551234567");
  assert.equal(after2.email, "nora@example.com");
  assert.equal(after2.job_title, "معلمة", "البيانات الوظيفية لا يغيّرها المعلم");
  assert.equal((await teacher.patch("/api/teacher/profile", { email: "خطأ" })).status, 400);
});

test("طلابي: طلاب فصوله فقط، بلا بيانات أولياء الأمور", async () => {
  const r = await teacher.get(`/api/teacher/students?class_id=${s.mine}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.map((x) => x.name), ["طالبة الفصل"]);
  assert.equal(r.data[0].absent, 0);
  assert.equal(r.data[0].guardian_phone, undefined);
  assert.equal(r.data[0].access_key, undefined);
  assert.equal((await teacher.get(`/api/teacher/students?class_id=${s.other}`)).status, 403);
});
