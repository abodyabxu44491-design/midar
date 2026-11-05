/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Opens every page of every role in a real browser, on a phone and on a desktop, against a complete demo school, and
// reports what a user would see go wrong: script errors, failed requests, pages wider than the screen, empty pages.
//
//   . ci.env (the test configuration) && node scripts/e2e-roles.mjs [--shots dir]
//
// It needs Playwright with Chromium (not a project dependency) and a test database: it creates a demo school.
import { createRequire } from "node:module";
import fs from "node:fs";
import { startServer, client, setupAdmin, ownerPassword, ownerPath, endPool, uid } from "../tests/helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { createShowcase } from "../src/modules/owner/tenants.js";

// Playwright is installed on the machine, not as a project dependency, so it is loaded the CommonJS way.
const { chromium } = createRequire(import.meta.url)("playwright");

const shots = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

const srv = await startServer();
const base = srv.base;

// The people: owner, the school's manager, a teacher, the accountant and a parent.
const owner = client(base);
const otp = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
const lo = await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code: otp });
if (lo.status !== 200) throw new Error(`owner login ${lo.status}`);

const school = `e2e-${uid()}`;
console.log(`إنشاء مدرسة عرض كاملة (${school})…`);
const made = await createShowcase({ actor: "اختبار شامل", ip: null, protocol: "http", get: () => new URL(base).host },
  { id: school, name: "مدرسة الاختبار الشامل", per_section: 8 });
const admin = await setupAdmin(client(base), made.setup.url);

async function staff(username, password) {
  const c = client(base);
  const r = await c.post("/api/staff/login", { school, username, password });
  if (r.status !== 200) throw new Error(`staff login ${username}: ${r.status} ${JSON.stringify(r.data)}`);
  // A first sign-in uses the temporary password from the school, which must be replaced before anything else.
  const area = r.data.role === "accountant" ? "accountant" : "teacher";
  const ch = await c.post(`/api/${area}/password`, { current: password, next: "E2e-New-Pass-2026" });
  if (ch.status !== 200) throw new Error(`password change ${username}: ${ch.status} ${JSON.stringify(ch.data)}`);
  return c;
}
const t = made.summary.teacher_samples[0];
const teacher = await staff(t.username, t.password);
const accountant = await staff(made.summary.accountant.username, made.summary.accountant.password);
const kid = made.summary.parent_samples[0];

const cookiesOf = (c) => [...c.jar].map(([name, value]) => ({ name, value, url: base }));
const ROLES = [
  { name: "مالك المنصة", path: `${ownerPath}/`, cookies: cookiesOf(owner) },
  { name: "مدير المدرسة", path: `/${school}/idara`, cookies: cookiesOf(admin) },
  { name: "المعلم", path: `/${school}/idara`, cookies: cookiesOf(teacher) },
  { name: "المحاسب", path: `/${school}/idara`, cookies: cookiesOf(accountant) },
  { name: "ولي الأمر", path: `/${school}/student`, cookies: [],
    storage: { [`midar_student_${school}`]: JSON.stringify({ id: kid.student_id, key: kid.access_key }) }, tabs: false },
  { name: "الزائر", path: "/", cookies: [], tabs: false },
  { name: "دليل المدرسة", path: `/${school}`, cookies: [], tabs: false },
];
const SCREENS = [{ name: "جوال", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { name: "حاسوب", viewport: { width: 1366, height: 860 } }];

const browser = await chromium.launch();
const problems = [];
let pages = 0;

for (const screen of SCREENS) {
  for (const role of ROLES) {
    const ctx = await browser.newContext({ viewport: screen.viewport, isMobile: screen.isMobile, hasTouch: screen.hasTouch, locale: "ar" });
    if (role.cookies.length) await ctx.addCookies(role.cookies);
    if (role.storage) await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) sessionStorage.setItem(k, v); }, role.storage);
    const p = await ctx.newPage();
    let where = "";
    const note = (kind, detail) => problems.push({ screen: screen.name, role: role.name, page: where, kind, detail: String(detail).slice(0, 240) });
    p.on("pageerror", (e) => note("خطأ برمجي", e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) note("خطأ في الصفحة", m.text()); });
    p.on("response", (r) => {
      const u = new URL(r.url());
      if (u.origin === base && u.pathname.startsWith("/api/") && r.status() >= 400 && r.status() !== 401) note(`طلب فشل ${r.status()}`, `${r.request().method()} ${u.pathname}`);
    });

    const check = async (label) => {
      where = label;
      pages++;
      await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(400);
      const r = await p.evaluate(() => {
        const wide = document.documentElement.scrollWidth - window.innerWidth;
        const text = (document.querySelector("main, #app, body")?.innerText || "").trim();
        const broken = [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith("data:")).map((i) => i.src);
        return { wide, length: text.length, broken };
      });
      if (r.wide > 2) note("أعرض من الشاشة", `${r.wide}px`);
      if (r.length < 20) note("صفحة شبه فارغة", `${r.length} حرفًا`);
      for (const b of r.broken) note("صورة لا تظهر", b);
      if (shots) await p.screenshot({ path: `${shots}/${screen.name}-${role.name}-${label}.png`.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_/, `${shots}/`) });
    };

    await p.goto(base + role.path);
    await p.waitForTimeout(2500);
    await check("البداية");
    if (role.tabs !== false) {
      const keys = await p.$$eval("nav.tabs button[data-k]", (bs) => [...new Set(bs.map((b) => b.dataset.k))]);
      if (!keys.length) note("لا قائمة أقسام", "nav.tabs فارغ");
      for (const k of keys) {
        await p.evaluate((key) => { location.hash = `#/${key}`; }, k);
        await check(k);
      }
    }
    await ctx.close();
  }
}
await browser.close();

console.log(`\nفُتحت ${pages} صفحة في ${ROLES.length} أدوار على شاشتين.`);
if (!problems.length) console.log("✓ لا مشكلات.");
else {
  console.log(`✗ ${problems.length} مشكلة:`);
  for (const x of problems) console.log(`  [${x.screen}] ${x.role} / ${x.page}: ${x.kind} — ${x.detail}`);
}
fs.writeFileSync(process.env.E2E_REPORT || "/dev/null", JSON.stringify({ pages, problems }, null, 2));
await srv.close();
await endPool();
process.exit(problems.length ? 1 : 0);
