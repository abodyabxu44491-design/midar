/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, client, ownerPassword, endPool, mailOn, mails, lastCode, randomEmail, uid } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";
import { setMailTransport } from "../src/modules/shared/mail.service.js";
import { setOAuthHttp, PROVIDER_AAD } from "../src/modules/account/oauth.service.js";
import { sealSecret } from "../src/core/auth/secret-box.js";

let srv, owner;
before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await mailOn();
});
after(async () => {
  setOAuthHttp(null); setMailTransport(null);
  await transaction({ platform: true }, (q) => q("UPDATE auth_providers SET enabled = false, client_id = '', secret_sealed = NULL"));
  await srv.close(); await endPool();
});

const tokenOf = (url) => new URL(url).searchParams.get("token");
async function newSchool(name) {
  const id = `ac-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id, name });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.credentials, undefined, "لا كلمة مرور تُسلَّم للمدير");
  return { id, token: tokenOf(r.data.setup.url) };
}
const state = async (id) => (await owner.get(`/api/owner/files/${id}`)).data;
const signup = async (c, email, setup, password = "Manager-Pass-2026") => {
  const s = await c.post("/api/account/signup", { email, password, name: "منى الشامي", setup });
  if (s.status !== 200) return s;
  return c.post("/api/account/signup/verify", { email, code: lastCode(email) });
};

test("رابط المدرسة: إنشاء حساب بالبريد، توثيقه، ربطه بالمدرسة، ثم الدخول للوحة", async () => {
  const s = await newSchool("مدرسة الفجر");
  assert.equal((await state(s.id)).activation_state, "no_email", "بلا بريد مدير مسجل");
  const c = client(srv.base);
  assert.equal((await c.get("/api/admin/me")).status, 401);
  const info = await c.post("/api/account/setup", { token: s.token });
  assert.equal(info.status, 200);
  assert.equal(info.data.school, "مدرسة الفجر");
  assert.equal((await c.get("/api/admin/me")).status, 401, "فتح الرابط لا يمنح أي صلاحية");
  assert.equal((await state(s.id)).activation_state, "no_email");

  const email = randomEmail();
  const s1 = await c.post("/api/account/signup", { email, password: "Manager-Pass-2026", name: "منى الشامي", setup: s.token });
  assert.equal(s1.status, 200, JSON.stringify(s1.data));
  const code = lastCode(email);
  assert.ok(!JSON.stringify(mails.at(-1).subject).includes(code), "الرمز ليس في العنوان");
  const wrong = await c.post("/api/account/signup/verify", { email, code: code === "111111" ? "222222" : "111111" });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /متبقٍ/);
  assert.equal((await c.post("/api/account/setup/link", { token: s.token })).status, 401, "لا ربط قبل توثيق البريد");
  assert.equal((await c.post("/api/account/signup/verify", { email, code })).status, 200);
  assert.equal((await state(s.id)).activation_state, "no_email");

  const link = await c.post("/api/account/setup/link", { token: s.token, via: "email" });
  assert.equal(link.status, 200, JSON.stringify(link.data));
  assert.equal(link.data.redirect, `/${s.id}/idara?role=admin`);
  assert.equal((await c.get("/api/admin/me")).status, 200, "يدخل لوحة المدرسة مباشرة");
  const f = await state(s.id);
  assert.equal(f.activation_state, "activated");
  assert.equal(f.account.email, email);
  assert.ok(!JSON.stringify(f).includes("password_hash"), "لا أسرار في ملف المالك");
  assert.equal((await client(srv.base).post("/api/account/setup", { token: s.token })).status, 410, "الرابط يُستخدم مرة واحدة");

  // The same email cannot open a second account; the old username login of the manager is closed.
  assert.equal((await client(srv.base).post("/api/account/signup", { email: email.toUpperCase(), password: "Another-Pass-2026", name: "سعاد" })).data.code, "exists");
  const legacy = await client(srv.base).post("/api/staff/login", { school: s.id, username: "admin", password: "anything-here" });
  assert.notEqual(legacy.status, 200);
  const [n] = await transaction({ platform: true }, (q) => q("SELECT count(*)::int AS n FROM accounts WHERE lower(email) = $1", [email]));
  assert.equal(n.n, 1);
});

test("إغلاق الصفحة قبل الإكمال ثم العودة: لا حسابات مكررة، والدخول من جهاز آخر بالبريد", async () => {
  const s = await newSchool("مدرسة الندى");
  const email = randomEmail();
  const phone1 = client(srv.base);
  assert.equal((await signup(phone1, email, s.token)).status, 200);
  // closed the page here (not linked yet)
  assert.equal((await state(s.id)).activation_state, "no_email");
  const again = client(srv.base);
  assert.equal((await again.post("/api/account/signup", { email, password: "Manager-Pass-2026", name: "منى", setup: s.token })).data.code, "exists");
  assert.equal((await again.post("/api/account/login", { email, password: "wrong-pass-123" })).status, 401);
  assert.equal((await again.post("/api/account/login", { email, password: "Manager-Pass-2026" })).status, 200);
  assert.equal((await again.post("/api/account/setup/link", { token: s.token })).status, 200);
  assert.equal((await again.get("/api/admin/me")).status, 200);

  // A new device: email + password, then the school (checked on the server).
  const tablet = client(srv.base);
  assert.equal((await tablet.post("/api/account/enter", { school: s.id })).status, 401);
  assert.equal((await tablet.post("/api/account/login", { email, password: "Manager-Pass-2026" })).status, 200);
  const me = (await tablet.get("/api/account/me")).data;
  assert.deepEqual(me.schools.map((x) => x.id), [s.id]);
  assert.equal(me.has_password, true);
  const other = await newSchool("مدرسة أخرى");
  assert.equal((await tablet.post("/api/account/enter", { school: other.id })).status, 403, "لا وصول لمدرسة غير مرتبطة");
  assert.equal((await tablet.post("/api/account/enter", { school: s.id })).status, 200);
  assert.equal((await tablet.get("/api/admin/me")).status, 200);
  // The device keeps the account session: next time the school opens without the password.
  const back = client(srv.base);
  back.jar.set([...tablet.jar.keys()].find((k) => k.includes("midar_ac")), tablet.jar.get([...tablet.jar.keys()].find((k) => k.includes("midar_ac"))));
  assert.equal((await back.post("/api/account/enter", { school: s.id })).status, 200);
});

test("مدرستان لحساب واحد، وتسجيل الخروج من كل الأجهزة", async () => {
  const a = await newSchool("مجمع الأمل - بنين");
  const b = await newSchool("مجمع الأمل - بنات");
  const email = randomEmail();
  const c = client(srv.base);
  assert.equal((await signup(c, email, a.token)).status, 200);
  assert.equal((await c.post("/api/account/setup/link", { token: a.token })).status, 200);
  assert.equal((await c.post("/api/account/setup/link", { token: b.token })).status, 200, "الحساب نفسه يُربط بالمدرسة الثانية");
  assert.deepEqual((await c.get("/api/account/me")).data.schools.map((x) => x.id).sort(), [a.id, b.id].sort());
  const d2 = client(srv.base);
  assert.equal((await d2.post("/api/account/login", { email, password: "Manager-Pass-2026" })).status, 200);
  assert.equal((await d2.post("/api/account/enter", { school: b.id })).status, 200);
  assert.equal((await c.post("/api/account/logout-all", {})).status, 200);
  assert.equal((await d2.get("/api/account/me")).status, 401, "انتهت جلسة الجهاز الآخر");
  assert.equal((await d2.get("/api/admin/me")).status, 401, "وانتهت جلسة المدرسة المفتوحة منه");
});

test("نسيت كلمة المرور: رمز على البريد الموثّق، لا رسالة لبريد غير مسجل، والجلسات القديمة تنتهي", async () => {
  const s = await newSchool("مدرسة الإشراق");
  const email = randomEmail();
  const c = client(srv.base);
  assert.equal((await signup(c, email, s.token)).status, 200);
  assert.equal((await c.post("/api/account/setup/link", { token: s.token })).status, 200);
  const before = mails.length;
  const unknown = await client(srv.base).post("/api/account/reset", { email: randomEmail("nobody") });
  assert.equal(unknown.status, 200);
  assert.equal(mails.length, before, "لا رسالة لبريد غير مسجل");
  const r = client(srv.base);
  assert.equal((await r.post("/api/account/reset", { email })).status, 200);
  assert.equal(mails.length, before + 1);
  assert.equal((await r.post("/api/account/reset", { email })).status, 429, "إعادة الطلب بعد دقيقة");
  const code = lastCode(email);
  for (let i = 0; i < 5; i++) assert.equal((await r.post("/api/account/reset/verify", { email, code: code === "123456" ? "654321" : "123456" })).status, 400);
  assert.equal((await r.post("/api/account/reset/verify", { email, code })).status, 429, "بعد خمس محاولات يتوقف حتى الرمز الصحيح");
  await transaction({ platform: true }, (q) => q("UPDATE account_codes SET last_sent_at = now() - interval '2 minutes' WHERE lower(email) = $1", [email]));
  assert.equal((await r.post("/api/account/reset", { email })).status, 200);
  const v = await r.post("/api/account/reset/verify", { email, code: lastCode(email) });
  assert.equal(v.status, 200);
  assert.equal((await r.post("/api/account/reset/finish", { ticket: v.data.ticket, password: "short" })).status, 400);
  assert.equal((await r.post("/api/account/reset/finish", { ticket: v.data.ticket, password: "Recovered-Pass-2026" })).status, 200);
  assert.equal((await r.post("/api/account/reset/finish", { ticket: v.data.ticket, password: "Recovered-Pass-2026" })).status, 410, "التذكرة مرة واحدة");
  assert.equal((await c.get("/api/admin/me")).status, 401, "جلسة المدرسة القديمة انتهت");
  assert.equal((await client(srv.base).post("/api/account/login", { email, password: "Manager-Pass-2026" })).status, 401);
  assert.equal((await client(srv.base).post("/api/account/login", { email, password: "Recovered-Pass-2026" })).status, 200);
});

test("استعادة الوصول من المالك: رابط استعادة ينقل المدرسة لحساب جديد ويقطع القديم", async () => {
  const s = await newSchool("مدرسة الرواد");
  const oldMail = randomEmail("old"), newMail = randomEmail("new");
  const c1 = client(srv.base);
  assert.equal((await signup(c1, oldMail, s.token)).status, 200);
  assert.equal((await c1.post("/api/account/setup/link", { token: s.token })).status, 200);
  // A stranger with a fresh account cannot take a linked school with a normal link (it is used).
  const link = await owner.post(`/api/owner/files/${s.id}/link`, {});
  assert.equal(link.status, 200, JSON.stringify(link.data));
  assert.equal((await state(s.id)).activation_state, "recovery");
  const c2 = client(srv.base);
  assert.equal((await signup(c2, newMail, tokenOf(link.data.url))).status, 200);
  assert.equal((await c2.post("/api/account/setup/link", { token: tokenOf(link.data.url) })).status, 200);
  assert.equal((await c2.get("/api/admin/me")).status, 200);
  assert.equal((await c1.get("/api/admin/me")).status, 401, "جلسة الحساب القديم في المدرسة انتهت");
  assert.equal((await c1.post("/api/account/enter", { school: s.id })).status, 403, "الحساب القديم لم يعد مرتبطًا");
  assert.equal((await state(s.id)).account.email, newMail);
});

test("المعلم والمحاسب يدخلان كما كانا، ومفتاح التراجع يعيد دخول المدير القديم", async () => {
  const s = await newSchool("مدرسة الثبات");
  const c = client(srv.base);
  assert.equal((await signup(c, randomEmail(), s.token)).status, 200);
  assert.equal((await c.post("/api/account/setup/link", { token: s.token })).status, 200);
  const t = await c.post("/api/admin/teachers", { name: "أ. سعيد ناصر", username: `t${uid()}` });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  const tl = await client(srv.base).post("/api/staff/login", { school: s.id, username: t.data.credentials.username, password: t.data.credentials.password });
  assert.equal(tl.status, 200, "دخول المعلم لم يتغير");
  const legacy = await client(srv.base).post("/api/staff/login", { school: s.id, username: "admin", password: "x".repeat(12) });
  assert.equal(legacy.status, 401, "كلمة مرور خاطئة تبقى خاطئة");
});

// ---- Google / Apple (providers simulated with locally signed tokens) ----
const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const signJwt = (claims) => {
  const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${head}.${body}.${crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), rsa.privateKey).toString("base64url")}`;
};
let nextClaims = null;
function fakeProviders() {
  setOAuthHttp({
    async json(url, init) {
      if (url.includes("certs") || url.includes("/auth/keys")) return { keys: [jwk] };
      if (url.includes("token")) {
        const form = new URLSearchParams(init.body);
        assert.equal(form.get("code"), "good-code");
        return { id_token: signJwt(nextClaims) };
      }
      throw new Error(`unexpected ${url}`);
    },
  });
}
async function providersOn() {
  const apple = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" });
  await transaction({ platform: true }, async (q) => {
    await q("UPDATE auth_providers SET enabled = true, client_id = 'google-client', secret_sealed = $1 WHERE provider = 'google'", [sealSecret("g-secret", PROVIDER_AAD("google"))]);
    await q("UPDATE auth_providers SET enabled = true, client_id = 'com.midar.web', team_id = 'TEAM123456', key_id = 'KEY1234567', secret_sealed = $1 WHERE provider = 'apple'",
      [sealSecret(apple, PROVIDER_AAD("apple"))]);
  });
  fakeProviders();
}
// Starts the provider round-trip like the browser would and returns the state/nonce it carries.
async function startOAuth(c, provider, query) {
  const r = await fetch(`${srv.base}/api/account/oauth/${provider}/start?${new URLSearchParams(query)}`, { redirect: "manual", headers: { Cookie: c.cookie() } });
  assert.equal(r.status, 303);
  const u = new URL(r.headers.get("location"));
  return { state: u.searchParams.get("state"), nonce: u.searchParams.get("nonce"), url: u };
}
async function googleBack(c, st, claims) {
  nextClaims = { iss: "https://accounts.google.com", aud: "google-client", exp: Math.floor(Date.now() / 1000) + 300, nonce: st.nonce, ...claims };
  const r = await fetch(`${srv.base}/api/account/oauth/google/callback?code=good-code&state=${st.state}`, { redirect: "manual", headers: { Cookie: c.cookie() } });
  for (const ck of r.headers.getSetCookie()) { const [pair] = ck.split(";"); const [k, v] = pair.split("="); if (v) c.jar.set(k, v); }
  return r.headers.get("location");
}

test("Google: إعداد المدرسة، ثم الدخول من جهاز جديد، ورفض الحسابات غير المرتبطة", async () => {
  await providersOn();
  const cfg = (await client(srv.base).get("/api/account/config")).data;
  assert.deepEqual([cfg.google, cfg.apple, cfg.email], [true, true, true]);
  const s = await newSchool("مدرسة جوجل");
  const sub = `g-${uid()}${uid()}`, gmail = randomEmail("g");
  const c = client(srv.base);
  const st = await startOAuth(c, "google", { purpose: "setup", setup: s.token });
  assert.equal(st.url.host, "accounts.google.com");
  assert.equal(st.url.searchParams.get("code_challenge_method"), "S256");
  const to = await googleBack(c, st, { sub, email: gmail, email_verified: true, name: "خالد" });
  assert.equal(to, `/${s.id}/idara?role=admin`, "يُربط ويدخل المدرسة مباشرة");
  assert.equal((await c.get("/api/admin/me")).status, 200);
  assert.equal((await state(s.id)).account.linked_via, "google");

  // Reused state, wrong nonce, unknown Google account: refused.
  assert.match(await googleBack(client(srv.base), st, { sub, email: gmail, email_verified: true }), /oauth=expired/);
  const n = client(srv.base);
  const st2 = await startOAuth(n, "google", { purpose: "login", school: s.id });
  nextClaims = null;
  assert.match(await googleBack(n, { ...st2, nonce: "other" }, { sub, email: gmail, email_verified: true }), /oauth=failed/);
  const st3 = await startOAuth(n, "google", { purpose: "login", school: s.id });
  assert.match(await googleBack(n, st3, { sub: "someone-else", email: gmail, email_verified: true }), /oauth=not_linked/, "لا ربط بتطابق البريد وحده");
  assert.equal((await n.get("/api/admin/me")).status, 401);

  // A new phone: Google again with the same account opens the school.
  const phone = client(srv.base);
  const st4 = await startOAuth(phone, "google", { purpose: "login", school: s.id });
  assert.equal(await googleBack(phone, st4, { sub, email: gmail, email_verified: true }), `/${s.id}/idara?role=admin`);
  assert.equal((await phone.get("/api/admin/me")).status, 200);
});

test("Google: بريد مسجّل مسبقًا لا يُدمج تلقائيًا، ويُربط من حسابه بعد الدخول", async () => {
  await providersOn();
  const s = await newSchool("مدرسة الدمج");
  const email = randomEmail();
  const c = client(srv.base);
  assert.equal((await signup(c, email, s.token)).status, 200);
  const other = await newSchool("مدرسة ثانية");
  const x = client(srv.base);
  const st = await startOAuth(x, "google", { purpose: "setup", setup: other.token });
  assert.match(await googleBack(x, st, { sub: `g-${uid()}`, email, email_verified: true }), /oauth=email_exists/);
  // Signed in to the existing account, the manager links Google from settings.
  const gsub = `g-${uid()}${uid()}`;
  const st2 = await startOAuth(c, "google", { purpose: "link" });
  assert.match(await googleBack(c, st2, { sub: gsub, email, email_verified: true }), /oauth=linked/);
  assert.deepEqual((await c.get("/api/account/me")).data.identities.map((i) => i.provider), ["google"]);
  assert.equal((await c.post("/api/account/identities/google/remove", {})).status, 200, "له كلمة مرور، فيمكن إلغاء الربط");
  // Unverified email from the provider never creates an account.
  const y = client(srv.base);
  const st3 = await startOAuth(y, "google", { purpose: "setup", setup: other.token });
  assert.match(await googleBack(y, st3, { sub: `g-${uid()}`, email: randomEmail(), email_verified: false }), /oauth=no_email/);
});

test("Apple: يعود برسالة POST من خادم Apple، ويُربط بالمدرسة", async () => {
  await providersOn();
  const s = await newSchool("مدرسة آبل");
  const c = client(srv.base);
  const st = await startOAuth(c, "apple", { purpose: "setup", setup: s.token });
  assert.equal(st.url.host, "appleid.apple.com");
  assert.equal(st.url.searchParams.get("response_mode"), "form_post");
  nextClaims = { iss: "https://appleid.apple.com", aud: "com.midar.web", exp: Math.floor(Date.now() / 1000) + 300, nonce: st.nonce,
    sub: `a-${uid()}`, email: `${uid()}@privaterelay.appleid.com`, email_verified: "true" };
  const r = await fetch(`${srv.base}/api/account/oauth/apple/callback`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://appleid.apple.com", "Sec-Fetch-Site": "cross-site" },
    body: new URLSearchParams({ code: "good-code", state: st.state, user: JSON.stringify({ name: { firstName: "سارة", lastName: "علي" } }) }).toString(),
  });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), `/${s.id}/idara?role=admin`);
  const f = await state(s.id);
  assert.equal(f.account.linked_via, "apple");
  assert.equal(f.account.full_name, "سارة علي");
});

test("مدرسة قائمة قبل التحديث: المدير يدخل ببياناته السابقة مرة واحدة فينتقل لإنشاء حسابه، ثم لا يعود الدخول القديم", async () => {
  const { hashPassword } = await import("../src/core/auth/password.js");
  const s = await newSchool("مدرسة الأمل القديمة");
  // An existing school: its manager still has the username and password from before the move.
  await transaction({ tenantId: s.id }, async (q) => q("UPDATE users SET password_hash = $1, must_change_password = false, full_name = 'أ. سالم باوزير' WHERE role = 'admin'",
    [await hashPassword("Old-School-Pass-1")]));
  const pub = client(srv.base);
  assert.deepEqual((await pub.get(`/api/staff/manager?school=${s.id}`)).data, { account: false });

  const wrong = await pub.post("/api/staff/login", { school: s.id, username: "admin", password: "Wrong-Pass-123" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.setup, undefined, "لا رابط بلا كلمة مرور صحيحة");

  const c = client(srv.base);
  const first = await c.post("/api/staff/login", { school: s.id, username: "admin", password: "Old-School-Pass-1" });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.match(first.data.setup, /^\/activate\?token=[0-9a-f]{64}$/);
  assert.equal((await c.get("/api/admin/me")).status, 401, "البيانات القديمة لا تفتح اللوحة");
  const f = await state(s.id);
  assert.ok(!JSON.stringify(f).includes(tokenOf(`http://x${first.data.setup}`)), "رابط أول دخول لا يظهر للمالك");

  const token = tokenOf(`http://x${first.data.setup}`);
  const info = await c.post("/api/account/setup", { token });
  assert.equal(info.data.manager_name, "أ. سالم باوزير");
  const email = randomEmail();
  assert.equal((await signup(c, email, token)).status, 200);
  const link = await c.post("/api/account/setup/link", { token, via: "email" });
  assert.equal(link.status, 200, JSON.stringify(link.data));

  const me = await c.get("/api/admin/me");
  assert.equal(me.status, 200);
  assert.equal(me.data.name, "منى الشامي", "اسم المدير من حسابه");
  assert.equal(me.data.account.email, email);
  assert.ok(me.data.account.verified_at && me.data.account.linked_at);
  assert.equal(me.data.account.linked_via, "email");
  assert.ok(!("password_hash" in me.data.account));

  assert.deepEqual((await pub.get(`/api/staff/manager?school=${s.id}`)).data, { account: true });
  const again = await client(srv.base).post("/api/staff/login", { school: s.id, username: "admin", password: "Old-School-Pass-1" });
  assert.equal(again.status, 403);
  assert.equal(again.data.code, "use_account", "بعد إنشاء الحساب يتوقف الدخول القديم");
  assert.equal((await c.post("/api/account/setup", { token })).status, 410, "الرابط يُستخدم مرة واحدة");

  // A deputy administrator has no account record in settings.
  const username = `dep-${uid()}`.slice(0, 20).toLowerCase();
  const pw = (await c.post("/api/admin/users/admins", { name: "وكيل", username })).data.credentials.password;
  const d = client(srv.base);
  assert.equal((await d.post("/api/staff/login", { school: s.id, username, password: pw })).status, 200);
  assert.equal((await d.get("/api/admin/me")).data.account, null);
});

// ---- First entry from the school's own login link (no activation link) ----
async function schoolWithManager(name, email) {
  const id = `fe-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id, name, manager_email: email });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.login_url.endsWith(`/${id}/idara?role=admin`));
  assert.equal(r.data.manager_email, email);
  return id;
}
async function emailAccount(email) {
  const c = client(srv.base);
  assert.equal((await c.post("/api/account/signup", { email, password: "Manager-Pass-2026", name: "مدير المدرسة" })).status, 200);
  assert.equal((await c.post("/api/account/signup/verify", { email, code: lastCode(email) })).status, 200);
  return c;
}

test("أول دخول من رابط المدرسة: يقبل بريد المدير المسجل فقط، ثم تُغلق المدرسة على حسابه", async () => {
  const mail = randomEmail("fe");
  const id = await schoolWithManager("مدرسة أول دخول", mail);
  const anon = client(srv.base);
  const info = (await anon.get(`/api/account/claim?school=${id}`)).data;
  assert.equal(info.first_entry, true);
  assert.equal(info.ready, true);
  assert.ok(!info.email_hint.includes(mail.split("@")[0]), "البريد يظهر مخفيًا جزئيًا");
  assert.equal((await anon.post("/api/account/claim", { school: id })).status, 401, "بلا حساب");
  const stranger = await emailAccount(randomEmail("x"));
  const bad = await stranger.post("/api/account/claim", { school: id });
  assert.equal(bad.status, 403);
  assert.equal(bad.data.code, "email_mismatch", "معرفة رابط المدرسة لا تكفي للاستيلاء عليها");
  assert.equal((await stranger.get("/api/admin/me")).status, 401);

  const manager = await emailAccount(mail);
  const ok = await manager.post("/api/account/claim", { school: id, via: "email" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.redirect, `/${id}/idara?role=admin`);
  assert.equal((await manager.get("/api/admin/me")).status, 200);
  const file = (await owner.get(`/api/owner/files/${id}`)).data;
  assert.equal(file.account.email, mail);
  assert.equal(file.activation_state, "activated");
  assert.equal(file.activation, null, "رابط الإعداد الداخلي أُغلق");
  assert.equal((await anon.get(`/api/account/claim?school=${id}`)).data.first_entry, false);
  const again = await emailAccount(randomEmail("y"));
  assert.equal((await again.post("/api/account/claim", { school: id })).status, 409, "لا يُربط مدير ثانٍ");
  assert.equal((await manager.post("/api/account/claim", { school: id })).status, 200, "المدير نفسه يدخل عاديًا");
});

test("أول دخول: مدرسة بلا بريد مدير لا تُربط، وGoogle بنفس البريد يربطها ويدخلها", async () => {
  const noMail = `fe-${uid()}`;
  assert.equal((await owner.post("/api/owner/tenants", { id: noMail, name: "مدرسة بلا بريد" })).status, 201);
  const st0 = (await owner.get(`/api/owner/files/${noMail}`)).data;
  assert.equal(st0.activation_state, "no_email");
  assert.equal((await client(srv.base).get(`/api/account/claim?school=${noMail}`)).data.ready, false);
  const someone = await emailAccount(randomEmail("z"));
  assert.equal((await someone.post("/api/account/claim", { school: noMail })).status, 403);

  await providersOn();
  const gmail = randomEmail("g");
  const id = await schoolWithManager("مدرسة جوجل الأولى", gmail);
  const wrong = client(srv.base);
  const s1 = await startOAuth(wrong, "google", { purpose: "claim", school: id });
  const to1 = await googleBack(wrong, s1, { sub: `g-${uid()}${uid()}`, email: randomEmail("other"), email_verified: true, name: "غريب" });
  assert.equal(to1, `/activate?school=${id}&oauth=claim_email`);
  assert.equal((await wrong.get("/api/admin/me")).status, 401);
  const c = client(srv.base);
  const s2 = await startOAuth(c, "google", { purpose: "claim", school: id });
  const to2 = await googleBack(c, s2, { sub: `g-${uid()}${uid()}`, email: gmail, email_verified: true, name: "سالم" });
  assert.equal(to2, `/${id}/idara?role=admin`);
  assert.equal((await c.get("/api/admin/me")).status, 200);
  assert.equal((await owner.get(`/api/owner/files/${id}`)).data.account.linked_via, "google");
  assert.equal((await fetch(`${srv.base}/api/account/oauth/google/start?purpose=claim`, { redirect: "manual" })).status, 401, "الرابط يحتاج المدرسة");
});
