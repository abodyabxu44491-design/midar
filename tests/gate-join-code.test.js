// ربط أي جوال بالبوابة برمز من 6 أرقام: يعمل فورًا أو بانتظار الموافقة، بعدد وصلاحية محددين،
// مع قفل التخمين، والعزل بين المدارس، وإلغاء الرمز.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B;
const G = "/api/admin/attendance/gate";
const join = async (school, body, ip = "10.0.0.1") => {
  const res = await fetch(`${srv.base}/api/gate/${school}/join`, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const device = (school, pid, secret) => async (path, body) => {
  const res = await fetch(`${srv.base}/api/gate/${school}/${path}`, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Gate-Device": pid, "X-Gate-Secret": secret }, body: JSON.stringify(body || {}) });
  return { status: res.status, data: await res.json().catch(() => null) };
};

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => ({ statusCode: 201 }), sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "gj", students: 1 });
  B = await readySchool(srv.base, { prefix: "gk", students: 1 });
  await transaction({ platform: true }, (q) => q("DELETE FROM rate_limits"));
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("رمز يعمل فورًا لثلاثة جوالات: كل جوال يصير جهاز بوابة مفعّلًا بسره، والرابع مرفوض", async () => {
  const r = await A.admin.post(`${G}/join-codes`, { minutes: 60, max_devices: 3, auto_approve: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.code, /^\d{6}$/);
  assert.ok(r.data.link.endsWith(`/${A.id}/gate#j=${r.data.code}`));
  assert.ok(r.data.qr.startsWith("data:image/"));
  for (const [i, name] of ["جوال الحارس", "جوال المناوب", "تابلت البوابة"].entries()) {
    // الرمز يُقبل بمسافة وبالأرقام العربية
    const code = i === 1 ? r.data.code.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d))) : `${r.data.code.slice(0, 3)} ${r.data.code.slice(3)}`;
    const j = await join(A.id, { code, name, info: { ua: "test" } }, `10.0.1.${i}`);
    assert.equal(j.status, 200, JSON.stringify(j.data));
    assert.equal(j.data.status, "active");
    const st = await device(A.id, j.data.device, j.data.secret)("status", { client_ts: Date.now() });
    assert.equal(st.status, 200);
    assert.equal(st.data.status, "active");
  }
  const full = await join(A.id, { code: r.data.code, name: "جوال رابع" }, "10.0.1.9");
  assert.equal(full.status, 401);
  const devs = (await A.admin.get(`${G}/devices`)).data.filter((d) => d.status === "active");
  assert.equal(devs.length, 3);
  // الرمز المكتمل لا يظهر في الرموز الصالحة
  assert.equal((await A.admin.get(`${G}/join-codes`)).data.length, 0);
});

test("رمز بموافقة: الجوال بانتظار الموافقة حتى يوافق المدير، والرمز يبقى ظاهرًا للمدير مع من انضم", async () => {
  const r = await A.admin.post(`${G}/join-codes`, { max_devices: 2, auto_approve: false });
  const j = await join(A.id, { code: r.data.code, name: "جوال الحارس الجديد" }, "10.0.2.1");
  assert.equal(j.data.status, "pending");
  const call = device(A.id, j.data.device, j.data.secret);
  assert.equal((await call("status", {})).data.status, "pending");
  assert.equal((await call("roster", {})).status, 403, "لا قائمة طلاب قبل الموافقة");
  const [c] = (await A.admin.get(`${G}/join-codes`)).data;
  assert.equal(c.code, r.data.code);
  assert.equal(c.used_count, 1);
  assert.equal(c.devices[0].name, "جوال الحارس الجديد");
  const dev = (await A.admin.get(`${G}/devices`)).data.find((d) => d.name === "جوال الحارس الجديد");
  assert.equal((await A.admin.post(`${G}/devices/${dev.id}/approve`)).status, 200);
  assert.equal((await call("status", {})).data.status, "active");
  // إلغاء الرمز: لا يُقبل بعدها
  assert.equal((await A.admin.post(`${G}/join-codes/${c.id}/revoke`)).status, 200);
  assert.equal((await join(A.id, { code: r.data.code, name: "متأخر" }, "10.0.2.2")).status, 401);
});

test("العزل وقفل التخمين: رمز مدرسة لا يعمل في أخرى، و10 محاولات خاطئة تقفل الجهاز مؤقتًا", async () => {
  const r = await A.admin.post(`${G}/join-codes`, { max_devices: 1 });
  assert.equal((await join(B.id, { code: r.data.code, name: "دخيل" }, "10.0.3.1")).status, 401);
  const wrong = r.data.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 10; i++) await join(A.id, { code: wrong, name: "تخمين" }, "10.0.3.2");
  await transaction({ platform: true }, (q) => q("DELETE FROM rate_limits"));
  const locked = await join(A.id, { code: r.data.code, name: "تخمين" }, "10.0.3.2");
  assert.equal(locked.status, 429);
  // جهاز آخر غير مقفل
  assert.equal((await join(A.id, { code: r.data.code, name: "جوال سليم" }, "10.0.3.3")).status, 200);
  // المعلم لا يستطيع إنشاء رموز
  assert.equal((await A.teacher.post(`${G}/join-codes`, {})).status, 401);
  // مدخلات خاطئة
  assert.equal((await join(A.id, { code: "12", name: "x" })).status, 400);
});

test("الرمز المنتهي مرفوض", async () => {
  const r = await A.admin.post(`${G}/join-codes`, { max_devices: 1 });
  await transaction({ tenantId: A.id }, (q) => q("UPDATE gate_join_codes SET expires_at = now() - interval '1 minute' WHERE id = $1", [r.data.id]));
  assert.equal((await join(A.id, { code: r.data.code, name: "متأخر" }, "10.0.4.1")).status, 401);
});
