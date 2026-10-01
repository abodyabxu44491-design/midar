// أدوات الاختبار: تشغيل التطبيق على منفذ عشوائي + متصفح مبسط بكوكيز
import { createApp } from "../src/app.js";
import { closePool } from "../src/core/db/pool.js";

export async function startServer() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

export function client(base, { origin } = {}) {
  const jar = new Map();
  async function call(method, path, body, extra = {}) {
    const headers = { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extra };
    if (origin) headers.Origin = origin;
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = pair.split("=");
      if (v) jar.set(k, v); else jar.delete(k);
    }
    let data = null;
    try { data = await res.json(); } catch { /* */ }
    return { status: res.status, data };
  }
  return {
    get: (p) => call("GET", p),
    post: (p, b = {}, h) => call("POST", p, b, h),
    patch: (p, b) => call("PATCH", p, b),
    put: (p, b) => call("PUT", p, b),
    del: (p) => call("DELETE", p),
    jar,
    cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

export const uid = () => Math.random().toString(36).slice(2, 8);
export const ownerPassword = process.env.TEST_OWNER_PASSWORD;
export const ownerPath = process.env.OWNER_PATH;
export const endPool = () => closePool();

/**
 * مدرسة جاهزة للاختبار: هيكل ابتدائي بشعبتين، ومادة الرياضيات، ومعلم مسند، وطالبان.
 * تعيد عملاء مسجلين (المالك والمدير والمعلم) ومعرّفات العناصر.
 */
export async function readySchool(base, { prefix = "t", name = "مدرسة الاختبار", students = 2 } = {}) {
  const { currentTotp } = await import("../src/core/auth/totp.js");
  const { transaction } = await import("../src/core/db/pool.js");
  const owner = client(base);
  const otp = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  const lo = await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code: otp });
  if (lo.status !== 200) throw new Error(`owner login ${lo.status}`);
  const id = `${prefix}-${uid()}`.slice(0, 28);
  const r = await owner.post("/api/owner/tenants", { id, name });
  if (r.status !== 201) throw new Error(`tenant ${r.status} ${JSON.stringify(r.data)}`);
  const admin = client(base);
  await admin.post("/api/staff/login", { school: id, username: "admin", password: r.data.credentials.password });
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = 'admin'"));
  await admin.post("/api/admin/setup/template", { template: "primary", sections_per_grade: 2, grade_set: "yemen" });
  const classes = (await admin.get("/api/admin/structure/classes")).data;
  const c1 = classes.find((c) => c.name === "الأول - أ"), c2 = classes.find((c) => c.name === "الأول - ب");
  const math = (await admin.get("/api/admin/structure/subjects")).data.find((s) => s.name === "الرياضيات");
  const t = await admin.post("/api/admin/teachers", { name: "أ. خالد سعيد", username: `tch${uid()}`.slice(0, 18),
    load: [{ class_id: c1.id, subject_id: math.id }, { class_id: c2.id, subject_id: math.id }] });
  const teacher = client(base);
  await teacher.post("/api/staff/login", { school: id, username: t.data.credentials.username, password: t.data.credentials.password });
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false WHERE role = 'teacher'"));
  const list = [];
  const names = ["أحمد علي سالم", "سالم محمد ناصر", "عمر خالد يحيى", "يوسف حسن علي"];
  for (let i = 0; i < students; i++) {
    const s = await admin.post("/api/admin/students", { name: names[i % names.length], class_id: c1.id, guardian_phone: `77${String(1000000 + i * 37).slice(0, 7)}` });
    if (s.status !== 201) throw new Error(`student ${s.status} ${JSON.stringify(s.data)}`);
    list.push(s.data);
  }
  const teacherId = (await admin.get("/api/admin/teachers/")).data[0].id;
  return { id, owner, admin, teacher, teacherId, c1, c2, math, students: list, code: r.data.credentials.directory_code,
    parent: (s) => ({ student_id: s.id, key: s.access_key }) };
}
