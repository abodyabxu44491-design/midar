/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The company behind Midar is shown only from what the owner entered: nothing about a legal entity or a registration
// appears on the public site until it is filled in, and clearing a field removes it again.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { operatorLine, productLine } from "../public/shared/js/company.js";

let srv, owner;
const FIELDS = ["company_name", "company_name_en", "company_legal_name", "company_reg_no", "company_country", "company_address"];
const site = async () => (await client(srv.base).get("/api/site")).data;
const save = (body) => owner.put("/api/owner/settings", body);

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
});
after(async () => {
  await save(Object.fromEntries(FIELDS.map((k) => [k, ""])));
  await srv.close(); await endPool();
});

test("بلا بيانات شركة: لا يذكر الموقع أي جهة أو تسجيل", async () => {
  assert.equal((await save(Object.fromEntries(FIELDS.map((k) => [k, ""])))).status, 200);
  const s = await site();
  assert.equal(s.company, null);
  for (const k of FIELDS) assert.equal(k in s, false, `${k} لا يُرسل خامًا`);
  assert.equal(productLine(s.company), "مدار — منصة إدارة المدارس");
  assert.equal(operatorLine(s.company), null);
});

test("ما يدخله المالك يظهر وحده، والفارغ لا يظهر", async () => {
  const r = await save({ company_name_en: "MIDAR SCHOOL", company_country: "اليمن" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = await site();
  assert.deepEqual(s.company, { name_en: "MIDAR SCHOOL", country: "اليمن" });
  assert.equal(productLine(s.company), "مدار — منتج MIDAR SCHOOL");
  assert.equal(operatorLine(s.company), "تقدّم خدمة مدار MIDAR SCHOOL، اليمن.");
  assert.doesNotMatch(operatorLine(s.company), /سجل/, "لا ذكر لسجل لم يُدخل");
});

test("السجل والاسم القانوني يظهران فقط بعد إدخالهما، ومسحهما يزيلهما", async () => {
  await save({ company_legal_name: "مؤسسة مدار للتقنية", company_reg_no: "4030123456" });
  let s = await site();
  assert.equal(operatorLine(s.company), "تقدّم خدمة مدار MIDAR SCHOOL (مؤسسة مدار للتقنية)، سجل تجاري رقم 4030123456، اليمن.");
  await save({ company_legal_name: "", company_reg_no: "" });
  s = await site();
  assert.deepEqual(s.company, { name_en: "MIDAR SCHOOL", country: "اليمن" });
});

test("المدخلات تُتحقق منها، وغير المالك لا يعدّلها", async () => {
  assert.equal((await save({ company_name_en: "x" })).status, 400);
  assert.equal((await save({ company_reg_no: "1".repeat(61) })).status, 400);
  assert.equal((await client(srv.base).put("/api/owner/settings", { company_name: "منتحل" })).status, 401);
  assert.equal((await site()).company?.name, undefined);
});
