/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import { startServer, client, ownerPassword, endPool, readySchool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv;
const SECRET = process.env.OWNER_TOTP_SECRET;
const login = (c, extra = {}) => c.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, ...extra });
const ua = (name) => ({ "User-Agent": `Mozilla/5.0 (${name}) Chrome/130.0 Safari/537.36` });
const alerts = async (c) => (await c.get("/api/owner/security")).data.alerts;

// Failed owner sign-ins from earlier runs would lock the panel (5 per address in 15 minutes); start clean.
before(async () => {
  srv = await startServer();
  await transaction({ platform: true }, (q) => q("DELETE FROM security_events WHERE kind = 'owner_login_failed'"));
});
after(async () => {
  await transaction({ platform: true }, (q) => q("DELETE FROM security_events WHERE kind = 'owner_login_failed'"));
  await srv.close(); await endPool();
});

test("لوحة المالك: لا دخول بكلمة المرور وحدها، وجهاز جديد يرفع تنبيهًا، وإنهاء الجلسات الأخرى يعمل", async () => {
  assert.ok(SECRET, "الاختبار يحتاج OWNER_TOTP_SECRET");
  assert.equal((await client(srv.base).get("/api/owner/config")).data.totp, true);
  assert.equal((await login(client(srv.base))).status, 401, "بلا رمز");
  assert.equal((await login(client(srv.base), { code: "000000" })).status, 401, "رمز خاطئ");

  const a = client(srv.base);
  const first = await a.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code: currentTotp(SECRET) }, ua("Windows NT 10.0; Win64"));
  assert.equal(first.status, 200);
  const before = (await alerts(a)).filter((x) => x.kind.startsWith("owner_new_device")).length;

  const strange = `TestDevice ${Date.now()}`;
  const b = client(srv.base);
  assert.equal((await b.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code: currentTotp(SECRET) }, ua(strange))).status, 200);
  const after = (await alerts(a)).filter((x) => x.kind.startsWith("owner_new_device"));
  assert.equal(after.length, before + 1, "الدخول من جهاز لم يُستخدم من قبل يرفع تنبيهًا");
  assert.equal(after[0].severity, "high");

  const sec = (await a.get("/api/owner/security")).data;
  assert.equal(sec.mfa.source, "env");
  assert.ok(sec.sessions.filter((s) => s.current).length === 1, "الجلسة الحالية معلَّمة");
  const ended = await a.post("/api/owner/security/sessions/end-others", {});
  assert.ok(ended.data.ended >= 1);
  assert.equal((await b.get("/api/owner/me")).status, 401, "الجلسة الأخرى انتهت");
  assert.equal((await a.get("/api/owner/me")).status, 200, "الجلسة الحالية باقية");

  assert.equal((await a.post("/api/owner/security/alerts/seen", {})).status, 200);
  assert.equal((await a.get("/api/owner/security/badge")).data.unseen, 0);
  assert.equal((await client(srv.base).get("/api/owner/security")).status, 401, "صفحة الأمان للمالك فقط");

  // The encryption key is shown only with the authenticator code, so the owner can pin it in the server settings.
  assert.ok(["derived", "CREDENTIAL_KEY"].includes(sec.key_source));
  assert.equal((await a.post("/api/owner/security/credential-key", { code: "000000" })).status, 401);
  const k = await a.post("/api/owner/security/credential-key", { code: currentTotp(SECRET) });
  assert.equal(k.status, 200);
  assert.match(k.data.key, /^[0-9a-f]{64}$/);
  assert.equal((await client(srv.base).post("/api/owner/security/credential-key", { code: currentTotp(SECRET) })).status, 401);
});

test("التنبيهات: حذف كبير، وطلبات مرفوضة متكررة من حساب مدرسة، وتصدير نسخة كاملة", async () => {
  const s = await readySchool(srv.base, { prefix: "sec", students: 1 });
  const st = s.students[0];
  // 60 attendance rows for one student, removed in one statement. The application role cannot delete attendance at
  // all, so this runs as the database owner (the trigger watches every connection, not only the application's).
  const db = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(`INSERT INTO attendance (tenant_id, student_id, day, status, recorded_by)
                    SELECT $1, $2, d::date, 'present', 'اختبار' FROM generate_series(CURRENT_DATE - 59, CURRENT_DATE, interval '1 day') d
                    ON CONFLICT DO NOTHING`, [s.id, st.id]);
    await db.query("DELETE FROM attendance WHERE student_id = $1", [st.id]);
  } finally { await db.end(); }
  for (let i = 0; i < 32; i++) await s.admin.get(`/api/admin/students/${900000000 + i}`);
  assert.equal((await s.admin.get("/api/admin/export")).status, 200);

  // The repeated-refusals alert is written right after the last response finishes, so give it a moment.
  let kinds = [];
  for (let i = 0; i < 20; i++) {
    const list = await transaction({ platform: true }, (q) => q("SELECT kind, severity FROM security_alerts WHERE tenant_id = $1", [s.id]));
    kinds = list.map((x) => x.kind);
    if (kinds.includes("access_probe")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(kinds.includes("mass_delete:attendance"), `حذف كبير: ${kinds}`);
  assert.ok(kinds.includes("access_probe"), `طلبات مرفوضة متكررة: ${kinds}`);
  assert.ok(kinds.includes("full_export"), `تصدير كامل: ${kinds}`);

  // An alert cannot be read from a school's own context, even though the school's actions raised it.
  const seen = await transaction({ tenantId: s.id }, (q) => q("SELECT count(*)::int AS n FROM security_alerts"));
  assert.equal(seen[0].n, 0);
});

// Without OWNER_TOTP_SECRET on the server, a correct password only opens enrollment: no session until the code
// from the authenticator app proves the secret was saved. Runs a separate server process without that variable.
test("تفعيل التحقق الثنائي من شاشة الدخول عند عدم ضبطه على الخادم", async () => {
  await transaction({ platform: true }, async (q) => {
    await q("UPDATE owner_security SET totp_enc = NULL, enrolled_at = NULL, pending_enc = NULL, pending_hash = NULL, pending_expires = NULL WHERE id = 1");
    await q("DELETE FROM security_events WHERE kind = 'owner_login_failed'"); // this test fails on purpose a few times
  });
  const port = 3990 + Math.floor(Math.random() * 9);
  const childEnv = { ...process.env, OWNER_TOTP_SECRET: "", PORT: String(port), DEMO_AUTO: "false", NODE_ENV: "test" };
  const child = spawn(process.execPath, ["src/server.js"], { env: childEnv, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    const c = client(base);
    assert.equal((await c.get("/api/owner/config")).data.enroll, true);
    const r = await login(c);
    assert.equal(r.status, 202, "كلمة المرور الصحيحة تفتح خطوة التفعيل فقط");
    assert.match(r.data.secret, /^[A-Z2-7]{16,64}$/);
    assert.match(r.data.qr, /^data:image\//);
    assert.equal((await c.get("/api/owner/me")).status, 401, "لا جلسة قبل التفعيل");
    assert.equal((await c.post("/api/owner/enroll", { ticket: r.data.ticket, code: "000000" })).status, 400);
    assert.equal((await c.post("/api/owner/enroll", { ticket: "0".repeat(64), code: currentTotp(r.data.secret) })).status, 401, "تذكرة غير صحيحة");
    assert.equal(r.data.secret.length, 32, "مفتاح بطول يقبله الإدخال اليدوي في تطبيقات المصادقة");
    const enrolled = await c.post("/api/owner/enroll", { ticket: r.data.ticket, code: currentTotp(r.data.secret) });
    assert.equal(enrolled.status, 200);
    const codes = enrolled.data.recovery_codes;
    assert.equal(codes.length, 10, "عشرة رموز احتياطية بعد التفعيل");
    assert.ok(codes.every((x) => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(x)));
    assert.equal((await c.get("/api/owner/me")).status, 200);
    assert.equal((await c.get("/api/owner/security")).data.mfa.source, "app");

    const c2 = client(base);
    assert.equal((await c2.get("/api/owner/config")).data.totp, true);
    assert.equal((await login(c2)).status, 401, "بعد التفعيل لا دخول بلا رمز");
    const ok2 = await login(c2, { code: currentTotp(r.data.secret) });
    assert.equal(ok2.status, 200, JSON.stringify(ok2.data));
    assert.equal((await c2.post("/api/owner/enroll", { ticket: r.data.ticket, code: currentTotp(r.data.secret) })).status, 400, "لا تفعيل ثانٍ");

    // Without the phone: a backup code works once (in any letter case, with or without the dash), then never again.
    assert.equal((await login(client(base), { code: codes[0].toLowerCase().replace("-", "") })).status, 200, "رمز احتياطي بدل التطبيق");
    assert.equal((await login(client(base), { code: codes[0] })).status, 401, "الرمز الاحتياطي لا يُستخدم مرتين");
    assert.equal((await login(client(base), { password: "wrong-password-1", code: codes[1] })).status, 401);
    assert.equal((await login(client(base), { code: codes[1] })).status, 200, "كلمة مرور خاطئة لا تستهلك الرمز");
    assert.equal((await c.get("/api/owner/security")).data.recovery_left, 8);
    assert.equal((await c.post("/api/owner/security/recovery-codes", { code: "000000" })).status, 401, "إنشاء رموز جديدة يحتاج الرمز الحالي");
    const fresh = await c.post("/api/owner/security/recovery-codes", { code: currentTotp(r.data.secret) });
    assert.equal(fresh.data.recovery_codes.length, 10);
    assert.equal((await login(client(base), { code: codes[2] })).status, 401, "المجموعة القديمة تتوقف");
    assert.equal((await login(client(base), { code: fresh.data.recovery_codes[0] })).status, 200);
    const stored = await transaction({ platform: true }, (q) => q("SELECT totp_enc FROM owner_security WHERE id = 1"));
    assert.ok(!stored[0].totp_enc.includes(r.data.secret), "المفتاح محفوظ مشفّرًا");
  } finally {
    child.kill();
    await transaction({ platform: true }, async (q) => {
      await q("UPDATE owner_security SET totp_enc = NULL, enrolled_at = NULL WHERE id = 1");
      await q("DELETE FROM owner_recovery_codes");
      await q("DELETE FROM security_events WHERE kind = 'owner_login_failed'");
    });
  }
});

test("بوابة الرسائل الخاصة بالمدرسة لا تصل إلى عناوين داخلية (SSRF)", async () => {
  const { assertPublicHttps, _isPrivate } = await import("../src/core/http/safe-url.js");
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.31.0.1", "192.168.0.10", "::1", "::ffff:127.0.0.1", "fd12::1"]) {
    assert.equal(_isPrivate(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) assert.equal(_isPrivate(ip), false, ip);
  for (const u of ["https://127.0.0.1/send", "https://[::1]/send", "https://169.254.169.254/latest", "http://sms.example.com", "https://u:p@sms.example.com", "notaurl"]) {
    await assert.rejects(assertPublicHttps(u), u);
  }
});

test("إشعارات المالك على الجوال: التنبيه المهم والطلب الجديد يصلان مرة واحدة، والجهاز المحذوف يُزال", async () => {
  const { dispatchOwnerPush } = await import("../src/modules/shared/alerts.service.js");
  const { setTransport } = await import("../src/modules/shared/notify.service.js");
  const a = client(srv.base);
  assert.equal((await a.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code: currentTotp(SECRET) }, ua("Windows NT 10.0; Win64"))).status, 200);
  assert.equal((await client(srv.base).post("/api/owner/security/push", {})).status, 401, "للمالك فقط");
  assert.ok((await a.get("/api/owner/security/push")).data.key, "مفتاح الإشعارات متاح");
  const endpoint = `https://push.example.test/owner-${Date.now()}`;
  const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
  assert.equal((await a.post("/api/owner/security/push", { endpoint, keys })).status, 200);
  assert.equal((await a.get("/api/owner/security")).data.push.devices >= 1, true);

  const sent = [];
  setTransport({ push: async () => {} });
  try {
    await dispatchOwnerPush();  // anything already pending before this test
    setTransport({ push: async (sub, payload) => { if (sub.endpoint === endpoint) sent.push(payload); } });
    await transaction({ platform: true }, (q) => q("SELECT raise_security_alert($1, 'high', 'اختبار إشعار المالك', 'تفصيل', NULL)", [`owner_push_test:${Date.now()}`]));
    await dispatchOwnerPush();
    assert.equal(sent.filter((p) => p.title.includes("اختبار إشعار المالك")).length, 1, "التنبيه المهم وصل");
    assert.ok(sent.every((p) => p.url.startsWith(process.env.OWNER_PATH)), "الرابط يفتح لوحة المالك");
    await dispatchOwnerPush();
    assert.equal(sent.filter((p) => p.title.includes("اختبار إشعار المالك")).length, 1, "لا يتكرر");

    setTransport({ push: async (sub) => { if (sub.endpoint === endpoint) throw Object.assign(new Error("gone"), { statusCode: 410 }); } });
    await transaction({ platform: true }, (q) => q("SELECT raise_security_alert($1, 'high', 'جهاز محذوف', NULL, NULL)", [`owner_push_gone:${Date.now()}`]));
    await dispatchOwnerPush();
    const [{ n }] = await transaction({ platform: true }, (q) => q("SELECT count(*)::int AS n FROM owner_push_subscriptions WHERE endpoint = $1", [endpoint]));
    assert.equal(n, 0, "الجهاز الذي ألغى الاشتراك يُزال");
  } finally {
    setTransport(null);
  }
});
