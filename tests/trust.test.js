/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Trust on the public site: a review is published only with recorded consent, once per school and once per text, and
// visitors can report it; a certification is shown only when it can be verified and is still valid.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner, tenant;
const site = async () => (await client(srv.base).get("/api/site")).data;
const review = (over = {}) => ({ school_name: "مدرسة الثقة", body: `تجربة ممتازة مع المنصة ${uid()}`, rating: 5, consent: true,
  consent_by: "مدير المدرسة", consent_at: "2026-10-01", status: "approved", ...over });
const today = new Date().toISOString().slice(0, 10);

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await owner.put("/api/owner/settings", { landing_mode: "marketing" });
  tenant = `trust-${uid()}`;
  assert.equal((await owner.post("/api/owner/tenants", { id: tenant, name: "مدرسة مشتركة للثقة", max_students: 100 })).status, 201);
});
after(async () => {
  await transaction({ platform: true }, async (q) => { await q("DELETE FROM testimonials"); await q("DELETE FROM accreditations"); });
  await srv.close(); await endPool();
});

test("لا يُنشر رأي دون تسجيل من وافق من المدرسة ومتى", async () => {
  const r = await owner.post("/api/owner/testimonials", review({ consent_by: "", consent_at: "" }));
  assert.equal(r.status, 400);
  assert.match(r.data.error?.message || r.data.message || JSON.stringify(r.data), /من وافق/);
  assert.equal((await owner.post("/api/owner/testimonials", review({ status: "pending", consent_by: "", consent_at: "" }))).status, 201,
    "المسودة تُحفظ دون موافقة");
});

test("الرأي المنشور يظهر بتاريخه ونوع الخدمة، وشارة «مدرسة مشتركة» للمدرسة المشتركة فعلًا فقط", async () => {
  const a = await owner.post("/api/owner/testimonials", review({ school_name: "مدرسة مشتركة للثقة", tenant_id: tenant, service_used: "الحضور والدرجات" }));
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const b = await owner.post("/api/owner/testimonials", review({ school_name: "مدرسة غير مربوطة" }));
  assert.equal(b.status, 201);
  const shown = (await site()).testimonials;
  const sa = shown.find((x) => x.id === a.data.id), sb = shown.find((x) => x.id === b.data.id);
  assert.equal(sa.subscriber, true);
  assert.equal(sa.service_used, "الحضور والدرجات");
  assert.equal(sa.month, "2026-10");
  assert.equal(sb.subscriber, false, "اسم مدرسة وحده لا يكفي لشارة الاشتراك");
  for (const k of ["tenant_id", "consent_by", "consent_at"]) assert.equal(k in sa, false, `${k} لا يُكشف للزوار`);
});

test("رأي واحد منشور لكل مدرسة، ولا يُنشر النص نفسه مرتين", async () => {
  const one = await owner.post("/api/owner/testimonials", review({ tenant_id: tenant }));
  assert.equal(one.status, 400);
  assert.match(JSON.stringify(one.data), /رأي منشور بالفعل/);
  const body = `نص مكرر للاختبار ${uid()}`;
  assert.equal((await owner.post("/api/owner/testimonials", review({ body }))).status, 201);
  const dup = await owner.post("/api/owner/testimonials", review({ body: `  ${body.replace(" ", "   ")} ` }));
  assert.equal(dup.status, 400, "المسافات لا تجعل النص مختلفًا");
  assert.match(JSON.stringify(dup.data), /موجود في رأي آخر/);
});

test("الزائر يبلّغ عن رأي منشور فقط، مرة واحدة، والمالك يرى البلاغ ويغلقه", async () => {
  const pub = (await owner.post("/api/owner/testimonials", review())).data;
  const draft = (await owner.post("/api/owner/testimonials", review({ status: "pending" }))).data;
  const visitor = client(srv.base);
  assert.equal((await visitor.post(`/api/public/reviews/${draft.id}/report`, { reason: "هذا الرأي غير صحيح" })).status, 404, "المسودة ليست للعامة");
  assert.equal((await visitor.post(`/api/public/reviews/${pub.id}/report`, { reason: "قصير" })).status, 400, "السبب قصير");
  assert.equal((await visitor.post(`/api/public/reviews/${pub.id}/report`, { reason: "هذه المدرسة لا تستخدم المنصة", contact: "0500000000" })).status, 201);
  assert.equal((await visitor.post(`/api/public/reviews/${pub.id}/report`, { reason: "بلاغ ثانٍ من العنوان نفسه" })).status, 400, "بلاغ واحد في اليوم");
  const row = (await owner.get("/api/owner/testimonials")).data.find((x) => x.id === pub.id);
  assert.equal(row.open_reports, 1);
  const [rep] = (await owner.get(`/api/owner/testimonials/${pub.id}/reports`)).data;
  assert.equal(rep.reason, "هذه المدرسة لا تستخدم المنصة");
  assert.equal((await owner.post(`/api/owner/testimonials/reports/${rep.id}/resolve`, { resolution: "تحققنا وهو صحيح" })).status, 200);
  assert.equal((await owner.get("/api/owner/testimonials")).data.find((x) => x.id === pub.id).open_reports, 0);
  assert.equal((await client(srv.base).get(`/api/owner/testimonials/${pub.id}/reports`)).status, 401, "البلاغات للمالك وحده");
});

test("الاعتماد لا يُنشر بلا وسيلة تحقق وإثبات، ولا يظهر بعد انتهائه أو كمسودة", async () => {
  const base = { issuer: "جهة اختبار", title: "اعتماد تجريبي", scope: "نطاق الاختبار فقط" };
  assert.equal((await owner.post("/api/owner/accreditations", { ...base, status: "published", evidence_confirmed: true })).status, 400, "بلا رابط أو رقم");
  assert.equal((await owner.post("/api/owner/accreditations", { ...base, status: "published", number: "A-1" })).status, 400, "بلا تأكيد الإثبات");
  assert.equal((await owner.post("/api/owner/accreditations", { ...base, status: "published", evidence_confirmed: true, verify_url: "http://x.test/v" })).status, 400, "https فقط");
  const ok = await owner.post("/api/owner/accreditations", { ...base, status: "published", evidence_confirmed: true, number: "A-1", issued_on: "2026-01-01", expires_on: "2099-01-01" });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  await owner.post("/api/owner/accreditations", { ...base, title: "منتهٍ", status: "published", evidence_confirmed: true, number: "B-2", issued_on: "2020-01-01", expires_on: "2021-01-01" });
  await owner.post("/api/owner/accreditations", { ...base, title: "مسودة" });
  const shown = (await site()).accreditations;
  assert.deepEqual(shown.map((x) => x.title), ["اعتماد تجريبي"]);
  assert.equal(shown[0].expires_on, "2099-01-01");
  const all = (await owner.get("/api/owner/accreditations")).data;
  assert.equal(all.length, 3);
  assert.equal(all.find((x) => x.title === "منتهٍ").expired, true);
  assert.ok(today);
});
