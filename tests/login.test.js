// الدخول لمدرسة جديدة: كلمة المرور الصحيحة تُقبل مهما أضاف لها الجوال أو النسخ من واتساب أحرفًا لا تُرى،
// دون إضعاف الأمان (كلمات المرور التي يختارها المستخدم تبقى حساسة لحالة الأحرف)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner;
const s = {};
const ar = (t) => t.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const login = (password, username = "admin", school = s.id) => client(srv.base).post("/api/staff/login", { school, username, password });

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  s.id = `login-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id: s.id, name: "مدرسة اختبار الدخول" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  s.pw = r.data.credentials.password;
});

after(async () => { await srv.close(); await endPool(); });

test("مدرسة جديدة: كلمة المرور المؤقتة تُقبل كما تصل فعليًا من الجوال وواتساب", async () => {
  const variants = [
    ["كما هي", s.pw],
    ["حروف صغيرة", s.pw.toLowerCase()],
    ["مسافة في البداية والنهاية", ` ${s.pw} `],
    ["علامات اتجاه مخفية (واتساب)", `\u2066${s.pw}\u2069`],
    ["علامة LRM مخفية", `\u200E${s.pw}\u200F`],
    ["أرقام عربية", ar(s.pw)],
    ["شرطة بديلة", s.pw.replace(/-/g, "\u2010")],
    ["اسم مستخدم بحرف كبير ومسافة", s.pw, " Admin "],
  ];
  for (const [label, pw, user] of variants) {
    const r = await login(pw, user);
    assert.equal(r.status, 200, `${label}: ${JSON.stringify(r.data)}`);
  }
  assert.equal((await login("WRONG-PASS-00")).status, 401, "كلمة خاطئة فعلًا تُرفض");
  assert.equal((await login(s.pw, "admin", "no-such-school")).status, 401);
});

test("تغيير كلمة المرور المؤقتة بعد الدخول بها بحروف صغيرة", async () => {
  const c = client(srv.base);
  assert.equal((await c.post("/api/staff/login", { school: s.id, username: "admin", password: s.pw.toLowerCase() })).status, 200);
  const r = await c.post("/api/admin/password", { current: s.pw.toLowerCase(), next: "MySecret٩٩x" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  s.userPw = "MySecret99x";
  const same = await c.post("/api/admin/password", { current: "MySecret99x", next: "\u200EMySecret99x " });
  assert.equal(same.status, 400, "نفس كلمة المرور بأحرف مخفية ليست كلمة جديدة");
});

test("كلمة المرور التي يختارها المستخدم: الأحرف المخفية والأرقام العربية مقبولة، والحروف الكبيرة/الصغيرة تبقى مهمة", async () => {
  assert.equal((await login("MySecret99x")).status, 200, "حُفظت بالأرقام العربية وتُكتب باللاتينية");
  assert.equal((await login("\u2066MySecret٩٩x\u2069")).status, 200);
  assert.equal((await login("mysecret99x")).status, 401, "ليست مؤقتة: حساسة لحالة الأحرف");
  assert.equal((await login("MYSECRET99X")).status, 401);
});

test("توافق مع كلمات مرور حُفظت قبل التوحيد (بالشكل الأصلي كما كُتب)", async () => {
  // بصمة بالصيغة القديمة: كلمة مرور بأرقام عربية دون تحويل
  const salt = crypto.randomBytes(16);
  const hash = await promisify(crypto.scrypt)("قديم٢٠٢٤".normalize("NFKC"), salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  await transaction({ tenantId: s.id }, (q) => q("UPDATE users SET password_hash = $1, must_change_password = false WHERE username = 'admin'",
    [`scrypt$32768$8$1$${salt.toString("base64")}$${hash.toString("base64")}`]));
  assert.equal((await login("قديم٢٠٢٤")).status, 200, "الشكل الأصلي ما زال يعمل");
});

test("المحاولات الخاطئة الحقيقية ما زالت تقفل الحساب", async () => {
  const id = `lock-${uid()}`;
  await owner.post("/api/owner/tenants", { id, name: "قفل" });
  let last;
  for (let i = 0; i < 6; i++) last = await login(`WRONG-${i}`, "admin", id);
  assert.equal(last.status, 429);
  assert.equal(last.data.code, "locked");
});
