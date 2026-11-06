/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Messages to the platform: from the site's forms (protected against bots and floods) and from its email addresses
// (through the email Worker, signed), all in the owner's inbox with a status and a log. And the official identity:
// shown only as entered, and read the same way by search engines.
import "./inbound-env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, client, ownerPassword, endPool, uid } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";
import { formToken } from "../src/modules/shared/inquiries.service.js";
import { noticeMail } from "../src/modules/shared/mail.service.js";

let srv, owner, pub;
const msg = (r) => r.data?.error?.message || r.data?.message || JSON.stringify(r.data);
const ready = () => formToken(Date.now() - 5000);
const form = (over = {}) => ({ kind: "support", name: "سارة أحمد", email: `sara.${uid()}@school.test`, organization: "مدرسة النور",
  subject: "مشكلة في الدخول", body: `لا أستطيع الدخول إلى حساب المدرسة منذ الصباح ${uid()}`, token: ready(), ...over });
const SECRET = process.env.INBOUND_EMAIL_SECRET;
const inbound = (m, { secret = SECRET, raw } = {}) => {
  const body = raw ?? JSON.stringify({ to: "support@midarschool.com", from: `p.${uid()}@example.org`, from_name: "ولي أمر",
    subject: "استفسار بالبريد", text: `نص الرسالة ${uid()}`, message_id: `<${uid()}@example.org>`, sent_at: Date.now(), ...m });
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return fetch(`${srv.base}/api/inbound/email`, { method: "POST", headers: { "content-type": "application/json", "x-midar-signature": `sha256=${sig}` }, body })
    .then(async (r) => ({ status: r.status, data: await r.json().catch(() => null), body }));
};

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  pub = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
});
after(async () => {
  await transaction({ platform: true }, (q) => q("DELETE FROM inquiries"));
  await srv.close(); await endPool();
});

test("رسالة من نموذج الموقع تُحفظ برقم، وتظهر في صندوق المالك مع سجلها", async () => {
  const f = form();
  const r = await pub.post("/api/public/inquiries", f);
  assert.equal(r.status, 201, msg(r));
  assert.match(r.data.message, new RegExp(String(r.data.id)));
  const list = await owner.get("/api/owner/inbox");
  const x = list.data.items.find((i) => i.id === r.data.id);
  assert.ok(x, "في الصندوق");
  assert.equal(x.status, "new");
  assert.equal(x.kind, "support");
  assert.equal(x.organization, "مدرسة النور");
  const one = await owner.get(`/api/owner/inbox/${r.data.id}`);
  assert.equal(one.data.body, f.body);
  assert.equal(one.data.events[0].kind, "received");
});

test("حماية النموذج: حقل الروبوت، والإرسال الفوري، والختم المزوّر، والرسالة المكررة، وبلا وسيلة رد", async () => {
  const before = (await owner.get("/api/owner/inbox?status=all")).data.items.length;
  const trap = await pub.post("/api/public/inquiries", form({ website: "http://spam.example" }));
  assert.equal(trap.status, 201, "يرد كأنه نجح");
  assert.equal((await owner.get("/api/owner/inbox?status=all")).data.items.length, before, "ولا يحفظ شيئًا");

  assert.equal((await pub.post("/api/public/inquiries", form({ token: formToken() }))).status, 400, "أسرع من إنسان");
  assert.equal((await pub.post("/api/public/inquiries", form({ token: `${Date.now() - 5000}.forged` }))).status, 400, "ختم مزوّر");
  assert.equal((await pub.post("/api/public/inquiries", form({ token: undefined }))).status, 400, "بلا ختم");
  assert.equal((await pub.post("/api/public/inquiries", form({ email: "", phone: "" }))).status, 400, "لا بريد ولا جوال");
  assert.equal((await pub.post("/api/public/inquiries", form({ kind: "admin" }))).status, 400, "المراسلات الإدارية بالبريد فقط");

  const f = form();
  assert.equal((await pub.post("/api/public/inquiries", f)).status, 201);
  const dup = await pub.post("/api/public/inquiries", { ...f, token: ready() });
  assert.equal(dup.status, 400, msg(dup));
  assert.match(msg(dup), /من قبل/);
});

test("المالك يغيّر الحالة ويكتب ملاحظة، وكل ذلك في السجل؛ والرد بالبريد يحتاج خدمة إرسال", async () => {
  const { id } = (await pub.post("/api/public/inquiries", form({ kind: "sales", subject: "سعر الباقة" }))).data;
  assert.equal((await owner.patch(`/api/owner/inbox/${id}`, { status: "in_progress", note: "اتصلنا به هاتفيًا" })).status, 200);
  const x = (await owner.get(`/api/owner/inbox/${id}`)).data;
  assert.equal(x.status, "in_progress");
  assert.deepEqual(x.events.map((e) => e.kind), ["received", "status", "note"]);
  const reply = await owner.post(`/api/owner/inbox/${id}/reply`, { body: "شكرًا لتواصلك، الأسعار في صفحة الباقات." });
  if (!(await owner.get("/api/owner/inbox")).data.can_reply) assert.equal(reply.status, 409);
  await assert.rejects(transaction({ platform: true }, (q) => q("UPDATE inquiry_events SET body = 'x'")), "السجل لا يُعدَّل");
  assert.equal((await pub.get("/api/owner/inbox")).status, 401);
});

test("البريد الوارد عبر Cloudflare يظهر في الصندوق بنوعه حسب العنوان، مرة واحدة، وبتوقيع صحيح فقط", async () => {
  const r = await inbound({ to: "Support@MidarSchool.com" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.id);
  const x = (await owner.get(`/api/owner/inbox/${r.data.id}`)).data;
  assert.equal(x.channel, "email");
  assert.equal(x.kind, "support");
  assert.equal(x.to_address, "support@midarschool.com");
  assert.equal((await inbound({ to: "sales@midarschool.com" })).status, 200);

  const again = await inbound({}, { raw: r.body });
  assert.equal(again.data.duplicate, true, "الرسالة نفسها لا تُسجل مرتين");
  assert.equal((await inbound({}, { secret: "wrong_secret_wrong_secret_wrong_secret" })).status, 401);
  assert.equal((await inbound({ sent_at: Date.now() - 3600_000 })).status, 401, "طلب قديم معاد");
  const unsigned = await fetch(`${srv.base}/api/inbound/email`, { method: "POST", body: "{}" });
  assert.equal(unsigned.status, 401);
});

test("الهوية الرسمية تظهر كما أُدخلت فقط، وتقرؤها محركات البحث بالبيانات نفسها", async () => {
  const CLEAR = { site_url: "", email_info: "", email_support: "", email_sales: "", email_admin: "", founded_year: "", social_links: {}, services_upcoming: "" };
  const was = (await owner.get("/api/owner/settings")).data.landing_mode;
  await owner.put("/api/owner/settings", { landing_mode: "marketing", ...CLEAR });
  let s = (await pub.get("/api/site")).data;
  assert.deepEqual(s.official.emails, {});
  assert.equal(s.official.founded_year, null, "لا سنة تأسيس دون إدخال");

  const r = await owner.put("/api/owner/settings", { site_url: "https://midarschool.com", email_info: "info@midarschool.com",
    email_support: "support@midarschool.com", email_sales: "sales@midarschool.com", founded_year: 2020,
    social_links: { x: "https://x.com/midarschool", facebook: "" }, services_upcoming: "تطبيق المعلم دون اتصال\nبوابة الدفع" });
  assert.equal(r.status, 200, msg(r));
  assert.equal((await owner.put("/api/owner/settings", { site_url: "http://midarschool.com" })).status, 400, "https فقط");
  assert.equal((await owner.put("/api/owner/settings", { social_links: { myspace: "https://a.b" } })).status, 400);
  s = (await pub.get("/api/site")).data;
  assert.equal(s.official.emails.support, "support@midarschool.com");
  assert.deepEqual(Object.keys(s.official.social).filter((k) => k !== "instagram"), ["x"], "الرابط الفارغ لا يُحفظ");
  assert.deepEqual(s.official.upcoming, ["تطبيق المعلم دون اتصال", "بوابة الدفع"]);

  const home = await (await fetch(`${srv.base}/`)).text();
  const ld = [...home.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const org = ld.find((o) => o["@type"] === "Organization");
  assert.equal(org.name, "مدار | MIDAIR SCHOOL");
  assert.equal(org.url, "https://midarschool.com/");
  assert.equal(org.email, "info@midarschool.com");
  assert.equal(org.foundingDate, "2020");
  assert.ok(org.sameAs.includes("https://x.com/midarschool"));
  assert.ok(org.contactPoint.some((c) => c.contactType === "sales" && c.email === "sales@midarschool.com"));
  assert.equal(org.aggregateRating, undefined, "لا تقييمات مصطنعة في البيانات المنظمة");
  assert.ok(ld.some((o) => o["@type"] === "SoftwareApplication") && ld.some((o) => o["@type"] === "WebSite"));
  await owner.put("/api/owner/settings", { landing_mode: was, ...CLEAR });
});

test("صفحة الأسئلة الشائعة مكتوبة في الصفحة نفسها ومعها بياناتها المنظمة، وصفحة عن المنصة والدعم تفتحان", async () => {
  const faq = await (await fetch(`${srv.base}/faq`)).text();
  assert.match(faq, /<details><summary>كيف ألغي الاشتراك؟<\/summary>/);
  const ld = JSON.parse(faq.match(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1]);
  assert.equal(ld["@type"], "FAQPage");
  assert.ok(ld.mainEntity.length >= 12);
  for (const p of ["/about", "/support"]) assert.equal((await fetch(`${srv.base}${p}`)).status, 200, p);
  const support = await (await fetch(`${srv.base}/support`)).text();
  assert.match(support, /data-inquiry/);
  const sitemap = await (await fetch(`${srv.base}/sitemap.xml`)).text();
  for (const p of ["/about", "/faq", "/support", "/trust"]) assert.ok(sitemap.includes(p), p);
});

test("رسائل المنصة تحمل التوقيع الرسمي", () => {
  const m = noticeMail({ to: "a@b.c", title: "تنبيه", lines: ["سطر"] });
  assert.match(m.text, /مدار \| MIDAIR SCHOOL\nمنصة لإدارة المؤسسات التعليمية/);
  assert.match(m.html, /MIDAIR SCHOOL/);
});
