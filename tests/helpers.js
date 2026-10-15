/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { createApp } from "../src/app.js";
import { closePool, transaction } from "../src/core/db/pool.js";
import { setTransport } from "../src/modules/shared/notify.service.js";

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
  const admin = await activateSchool(base, id, r.data.setup.url);
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
  return { id, owner, admin, teacher, teacherId, c1, c2, math, students: list, code: r.data.directory_code,
    parent: (s) => ({ student_id: s.id, key: s.access_key }) };
}

export const randomPhone = () => `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

// Email for tests: every message lands in `mails` instead of an SMTP server.
export const mails = [];
export async function mailOn() {
  const { setMailTransport } = await import("../src/modules/shared/mail.service.js");
  setMailTransport({ send: async (g, m) => { mails.push(m); } });
  await transaction({ platform: true }, (q) => q(
    "UPDATE mail_gateway SET enabled = true, host = 'smtp.test', from_email = 'no-reply@midar.test' WHERE id = 1"));
}
export const lastCode = (to) => [...mails].reverse().find((m) => !to || m.to === to)?.text.match(/(\d{6})/)?.[1];
// Email sign-in as a real person does it: on a new device (202) the code from the email completes it.
export async function accountLogin(c, email, password) {
  const r = await c.post("/api/account/login", { email, password });
  if (r.status !== 202) return r;
  return c.post("/api/account/login/verify", { email, code: lastCode(email) });
}
export const randomEmail = (tag = "m") => `${tag}.${uid()}${uid()}@school.test`;

// Runs the manager's first setup from the school's setup link: a new email account, its code, then the link.
export async function activateSchool(base, schoolId, url, password = "School-Pass-2026", email = randomEmail()) {
  return setupAdmin(client(base), url, { password, email });
}
// The same, on a client the test already holds (its cookies receive the account and school sessions).
export async function setupAdmin(pub, url, { password = "School-Pass-2026", email = randomEmail() } = {}) {
  await mailOn();
  const setup = new URL(url).searchParams.get("token");
  const s = await pub.post("/api/account/signup", { email, password, name: "مدير المدرسة", setup });
  if (s.status !== 200) throw new Error(`signup ${s.status} ${JSON.stringify(s.data)}`);
  const v = await pub.post("/api/account/signup/verify", { email, code: lastCode(email) });
  if (v.status !== 200) throw new Error(`verify ${v.status} ${JSON.stringify(v.data)}`);
  const done = await pub.post("/api/account/setup/link", { token: setup, via: "email" });
  if (done.status !== 200) throw new Error(`link ${done.status} ${JSON.stringify(done.data)}`);
  pub.email = email; pub.password = password;
  return pub;
}
