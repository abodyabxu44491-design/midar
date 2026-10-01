// هوية المدرسة: الشعار (رفع وفحص وظهوره في البوابات وورقة الاختبار والصفحة العامة)،
// وصور المعلمين (للإدارة دائمًا، وللزوار وولي الأمر فقط إن فعّلت المدرسة نشرها)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";

let srv, owner, A, B;
const s = {};
// PNG حقيقية 1×1، وملف مزيف بامتداد صورة
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const FAKE = Buffer.from("<script>alert(1)</script>").toString("base64");

async function makeSchool(name) {
  const id = `id-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id, name, max_students: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: id, username: "admin", password: r.data.credentials.password })).status, 200);
  return { id, admin, code: r.data.credentials.directory_code };
}

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  A = await makeSchool("مدرسة الهوية أ");
  B = await makeSchool("مدرسة الهوية ب");
  s.cls = (await A.admin.post("/api/admin/structure/classes", { name: "الأول - أ" })).data.id;
  s.sub = (await A.admin.post("/api/admin/structure/subjects", { name: "الرياضيات" })).data.id;
  const t = await A.admin.post("/api/admin/teachers", { name: "أ. سارة", username: `sara${uid()}`, load: [{ class_id: s.cls, subject_id: s.sub }] });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  s.teacher = t.data.id ?? t.data.teacher?.id;
  const st = await A.admin.post("/api/admin/students", { name: "طالب الهوية", class_id: s.cls });
  assert.equal(st.status, 201, JSON.stringify(st.data));
  s.student = st.data.id ?? st.data[0]?.id;
  s.key = st.data.access_key ?? st.data[0]?.access_key;
});
after(async () => { await srv.close(); await endPool(); });

const pub = (school, path, body = {}) => client(srv.base).post(`/api/public/${school.id}${path}`, { access: school.code, ...body });

test("الشعار: يُرفع بصورة حقيقية فقط، ويظهر في البوابة والصفحة العامة وورقة الاختبار، ويُزال", async () => {
  assert.equal((await client(srv.base).get(`/api/public/${A.id}/logo`)).status, 404, "لا شعار بعد");
  assert.equal((await A.admin.post("/api/admin/setup/logo", { mime: "image/png", data: FAKE })).status, 400, "محتوى مزيف يُرفض");

  const up = await A.admin.post("/api/admin/setup/logo", { mime: "image/png", data: PNG, thumb: { mime: "image/png", data: PNG } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const logo = up.data.logo_image_id;

  assert.equal((await A.admin.get("/api/admin/me")).data.school.logo, logo, "البوابة تعرف الشعار");
  const img = await fetch(`${srv.base}/api/public/${A.id}/logo?v=${logo}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.match(img.headers.get("cache-control"), /immutable/, "رابط بنسخة = كاش طويل");
  assert.equal((await fetch(`${srv.base}/api/public/${A.id}/logo?size=thumb`)).status, 200);
  assert.equal((await pub(A, "/home")).data.school.logo_v, logo, "الصفحة العامة");
  assert.equal((await A.admin.get("/api/admin/papers/context")).data.settings.logo_image_id, logo, "ورقة الاختبار تستخدم شعار المدرسة");

  assert.equal((await client(srv.base).get(`/api/public/${B.id}/logo`)).status, 404, "مدرسة أخرى بلا شعار");
  assert.equal((await B.admin.get("/api/admin/me")).data.school.logo, null);

  assert.equal((await A.admin.del("/api/admin/setup/logo")).status, 200);
  assert.equal((await client(srv.base).get(`/api/public/${A.id}/logo`)).status, 404, "أُزيل");
  assert.equal((await A.admin.get("/api/admin/me")).data.school.logo, null);
});

test("صور المعلمين: للإدارة دائمًا، ولولي الأمر وزوار الصف فقط بعد تفعيل النشر", async () => {
  const photo = `data:image/png;base64,${PNG}`;
  assert.equal((await A.admin.put(`/api/admin/teachers/${s.teacher}/photo`, { data_url: photo })).status, 200);
  await A.admin.put("/api/admin/settings/public-page", { show_teachers: true, show_classes: true });

  const adminProfile = (await A.admin.get(`/api/admin/students/${s.student}/profile`)).data;
  assert.match(adminProfile.teachers[0].photo, /^data:image\/png;base64,/, "الإدارة ترى الصورة");
  assert.equal(adminProfile.teachers[0].teacher, "أ. سارة");

  const parent = async () => (await pub(A, "/student", { student_id: s.student, key: s.key })).data;
  const section = async () => (await pub(A, "/section", { class_id: s.cls, offset: 0 })).data;
  assert.equal((await parent()).teachers[0].photo, null, "النشر موقوف افتراضيًا");
  assert.equal((await section()).teachers[0].photo, null);

  assert.equal((await A.admin.put("/api/admin/settings/public-page", { show_teacher_photos: true })).status, 200);
  assert.match((await parent()).teachers[0].photo, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "ولي الأمر بعد التفعيل (بلا أسطر داخل base64)");
  assert.match((await section()).teachers[0].photo, /^data:image\/png;base64,/);

  await A.admin.put("/api/admin/settings/public-page", { show_teacher_photos: false });
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/section`, { class_id: s.cls })).data.teachers[0].photo, null, "إيقاف النشر يخفي الصور عن الصفحة المفتوحة");
  assert.equal((await parent()).teachers[0].photo, null, "الإيقاف يخفيها فورًا");
});
