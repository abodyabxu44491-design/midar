// التسجيل الذاتي الفوري: المدرسة تسجّل من الصفحة الرئيسية فتُنشأ مدرستها وتجربتها وتأخذ بيانات الدخول مباشرة
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner;
const visitor = () => client(srv.base);
const signup = (phone, extra = {}) => visitor().post("/api/public/leads/signup", {
  school_name: `مدرسة التسجيل ${uid()}`, contact_name: "أ. سالم أحمد", phone, city: "عدن", students_count: 120, ...extra });
// رقم فريد لكل تشغيل (الرقم الواحد لا يسجّل مدرسة ثانية)
const yemeni = () => `77${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await owner.put("/api/owner/settings", { landing_mode: "marketing", trial_enabled: true, trial_days: 30, trials_per_school: 1, instant_trial: false });
  // حد الطلبات لكل جهاز: نبدأ بلا طلبات عامة سابقة
  for (const old of (await owner.get("/api/owner/requests")).data.filter((x) => x.source === "public")) await owner.del(`/api/owner/requests/${old.id}`);
});
after(async () => {
  await owner.put("/api/owner/settings", { landing_mode: "blank", instant_trial: false });
  await srv.close(); await endPool();
});

test("التسجيل الفوري متوقف: يصل طلبًا عاديًا للمالك ولا تُنشأ مدرسة", async () => {
  assert.equal((await fetch(`${srv.base}/api/site`).then((r) => r.json())).instant_trial, false);
  const r = await signup(yemeni());
  assert.equal(r.status, 201);
  assert.equal(r.data.queued, true);
  assert.equal(r.data.credentials, undefined);
  const lead = (await owner.get("/api/owner/requests")).data.find((x) => x.source === "public");
  assert.equal(lead.instant, false);
  assert.equal(lead.tenant_id, null);
});

test("التسجيل الفوري مفعّل: مدرسة وتجربة وبيانات دخول تعمل، ولا مدرسة ثانية بنفس الرقم", async () => {
  assert.equal((await owner.put("/api/owner/settings", { instant_trial: true, instant_trial_daily_cap: 50 })).status, 200);
  assert.equal((await fetch(`${srv.base}/api/site`).then((r) => r.json())).instant_trial, true);
  const phone = yemeni();
  const r = await signup(phone);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const { credentials: c, school, links, trial } = r.data;
  assert.match(c.school, /^m[a-z0-9]{3,}$/);
  assert.equal(school.id, c.school);
  assert.equal(c.username, "admin");
  assert.ok(links.staff.admin.endsWith(`/${c.school}/idara?role=admin`));
  assert.ok(trial.ends_on, "التجربة لها تاريخ نهاية");

  // المدير يدخل ببيانات الدخول المؤقتة (ويُطلب منه تغيير كلمة المرور)
  const admin = client(srv.base);
  const login = await admin.post("/api/staff/login", { school: c.school, username: "admin", password: c.password });
  assert.equal(login.status, 200, JSON.stringify(login.data));

  // المدرسة: تجربة، بعملة الرقم اليمني، والطلب مرتبط بها ومعلَّم «تسجيل فوري»
  const [t] = await transaction({ platform: true }, (q) => q(
    "SELECT t.currency, s.kind, s.status FROM tenants t JOIN subscriptions s ON s.id = t.subscription_id WHERE t.id = $1", [c.school]));
  assert.deepEqual(t, { currency: "YER", kind: "trial", status: "trial" });
  const lead = (await owner.get("/api/owner/requests")).data.find((x) => x.tenant_id === c.school);
  assert.equal(lead.instant, true);
  assert.equal(lead.status, "active");

  // نفس الرقم بصيغة أخرى (بمفتاح الدولة): لا مدرسة ثانية
  const again = await signup(`+967 ${phone}`);
  assert.equal(again.status, 409);
  assert.match(again.data.error || again.data.message || "", /سبق تسجيل مدرسة/);
});

test("حدود الحماية: مدرستان لكل جهاز في اليوم، وبعدها يتحول لطلب عادي", async () => {
  const second = await signup(`05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`);
  assert.equal(second.status, 201);
  assert.ok(second.data.credentials, "المدرسة الثانية من نفس الجهاز تُنشأ");
  const [t] = await transaction({ platform: true }, (q) => q("SELECT currency FROM tenants WHERE id = $1", [second.data.credentials.school]));
  assert.equal(t.currency, "SAR", "رقم سعودي ← ريال سعودي");
  const third = await signup(yemeni());
  assert.equal(third.status, 201);
  assert.equal(third.data.queued, true, "الثالثة تصل طلبًا يراجعه المالك");
});
