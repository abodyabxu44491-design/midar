/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The public policy pages open, link to each other, and claim nothing the company does not hold.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer, endPool } from "./helpers.js";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); await endPool(); });

const PAGES = ["/privacy", "/terms", "/subscription-policy", "/school-agreement", "/security", "/status"];
const queriesOf = (res) => Number((res.headers.get("server-timing") || "").match(/desc="(\d+) queries/)?.[1] ?? 0);

test("كل صفحات السياسات تفتح وتربط ببعضها، دون استعلام قاعدة البيانات", async () => {
  for (const path of PAGES) {
    const res = await fetch(`${srv.base}${path}`);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, /<html lang="ar" dir="rtl">/, path);
    assert.match(html, /data-operator hidden/, `${path}: سطر الجهة المشغلة مخفي حتى يُدخله المالك`);
    for (const link of PAGES) assert.ok(html.includes(`href="${link}"`), `${path} يربط بـ ${link}`);
    assert.equal(queriesOf(res), 0, `${path}: لا استعلامات`);
  }
});

test("صفحات السياسات لا تدّعي اعتمادًا أو ترخيصًا أو تسجيلًا", () => {
  // A certification, licence or registration is shown only from what the owner enters (company identity), never as
  // fixed page text.
  const claim = /\bISO\b|SOC ?2|PCI|GDPR[- ]compliant|معتمد(?:ة)? من|مرخّ?ص(?:ة)? من|شركة مسجلة|حاصل(?:ة)? على شهادة|سجل تجاري رقم/;
  for (const f of fs.readdirSync("public/pages/legal").filter((x) => x.endsWith(".html"))) {
    assert.doesNotMatch(fs.readFileSync(`public/pages/legal/${f}`, "utf8"), claim, f);
  }
});

test("صفحة حالة الخدمة تفحص المنصة لا قاعدة البيانات", async () => {
  const js = fs.readFileSync("public/pages/legal/status.js", "utf8");
  assert.match(js, /fetch\("\/healthz"/);
  assert.doesNotMatch(js, /healthz\/db/, "فتح الصفحة لا يوقظ قاعدة البيانات");
  const res = await fetch(`${srv.base}/legal-page/status.js`);
  assert.equal(res.status, 200);
});

test("الصفحات الجديدة في خريطة الموقع ومسموحة لمحركات البحث", async () => {
  const map = await (await fetch(`${srv.base}/sitemap.xml`)).text();
  const robots = await (await fetch(`${srv.base}/robots.txt`)).text();
  for (const p of ["/security", "/school-agreement"]) {
    assert.ok(map.includes(p), `sitemap: ${p}`);
    assert.ok(robots.includes(`Allow: ${p}`), `robots: ${p}`);
    const res = await fetch(`${srv.base}${p}`);
    assert.equal(res.headers.get("x-robots-tag"), null, `${p} قابلة للفهرسة`);
  }
});
