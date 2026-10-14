/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner, pub;
const phone = () => `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  pub = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await owner.put("/api/owner/settings", { landing_mode: "marketing", trial_enabled: true });
  await transaction({ platform: true }, (q) => q("DELETE FROM leads WHERE ip = '127.0.0.1' AND created_at > now() - interval '1 day'"));
});
after(async () => { await owner.put("/api/owner/settings", { landing_mode: "blank" }); await srv.close(); await endPool(); });

test("طلب التسجيل الكامل: رقم الطلب وحالته، وتفاصيل المدرسة والمدير تصل للمالك، ولا يتكرر الطلب", async () => {
  const mobile = phone();
  const body = { kind: "trial", school_name: "مدرسة الأمل الأهلية", contact_name: "خالد علي", phone: mobile, city: "عدن",
    details: { short_name: "الأمل", org_type: "private", country: "YE", school_email: "info@alamal.example", stages: ["primary", "middle"], classes_count: 12,
      academic_year: "2026/2027", manager: { first: "خالد", second: "أحمد", family: "باوزير", title: "مدير المدرسة", preferred: "whatsapp" } } };
  const r = await pub.post("/api/public/leads", body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.id > 0);
  const st = await pub.post("/api/public/leads/status", { id: r.data.id, phone: `+967 ${mobile.slice(1)}` });
  assert.equal(st.status, 200, JSON.stringify(st.data));
  assert.equal(st.data.status, "new");
  assert.equal((await pub.post("/api/public/leads/status", { id: r.data.id, phone: "0599999999" })).status, 404, "الجوال الخطأ لا يكشف الطلب");
  const dup = await pub.post("/api/public/leads", body);
  assert.equal(dup.status, 400);
  assert.match(dup.data.error, new RegExp(String(r.data.id)));
  const list = await owner.get("/api/owner/requests?status=open");
  const row = (list.data.items || list.data).find?.((x) => x.id === r.data.id);
  assert.ok(row, "الطلب في قائمة المالك");
  assert.equal(row.details.manager.family, "باوزير");
  assert.equal(row.contact_name, "خالد أحمد باوزير", "الاسم الكامل يُجمع من أجزائه");
  const bad = await pub.post("/api/public/leads", { ...body, phone: phone(), details: { ...body.details, school_email: "ليس بريدًا" } });
  assert.equal(bad.status, 400);
});

test("آراء العملاء: لا يُنشر رأي بلا موافقة، ويظهر المعتمد فقط في الموقع، وسعر السنة الأولى في الباقات", async () => {
  const noConsent = await owner.post("/api/owner/testimonials", { school_name: "مدرسة النور", body: "منصة رائعة سهّلت علينا متابعة الحضور.", status: "approved" });
  assert.equal(noConsent.status, 400, "النشر يحتاج موافقة المدرسة");
  const t = await owner.post("/api/owner/testimonials", { school_name: "مدرسة النور", body: "منصة رائعة سهّلت علينا متابعة الحضور.", consent: true, rating: 5 });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  let site = (await pub.get("/api/site")).data;
  assert.equal(site.testimonials.some((x) => x.id === t.data.id), false, "بانتظار الاعتماد لا يظهر");
  await owner.put(`/api/owner/testimonials/${t.data.id}`, { ...t.data, status: "approved" });
  site = (await pub.get("/api/site")).data;
  assert.equal(site.testimonials.some((x) => x.id === t.data.id), true);
  const basic = site.plans.find((p) => p.code === "basic");
  if (basic) assert.deepEqual(basic.first_year, { price: 299, renewal: 500 });
  await owner.del(`/api/owner/testimonials/${t.data.id}`);
  assert.equal((await pub.get("/subscription-policy")).status, 200);
});
