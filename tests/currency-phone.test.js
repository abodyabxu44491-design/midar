/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// One school serves parents with numbers from different countries, and works in the currency it chooses.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool, setupAdmin } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { detectPhone } from "../public/shared/js/phone.js";
import { CURRENCY_CODES } from "../public/shared/js/currencies.js";

let srv, admin;
before(async () => {
  srv = await startServer();
  const owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  const r = await owner.post("/api/owner/tenants", { id: `cur-${uid()}`, name: "مدرسة العملات والأرقام", max_students: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  admin = await setupAdmin(client(srv.base), r.data.setup.url);
});
after(async () => { await srv.close(); await endPool(); });

test("أرقام أولياء الأمور من دول مختلفة في المدرسة نفسها: كل رقم يُعرف بدولته أيًا كانت دولة المدرسة", () => {
  for (const schoolDial of ["967", "966"]) {
    const intl = (n) => detectPhone(n, schoolDial).intl;
    assert.equal(intl("771234567"), "967771234567", "يمني محلي");
    assert.equal(intl("0771234567"), "967771234567");
    assert.equal(intl("0551234567"), "966551234567", "سعودي محلي");
    assert.equal(intl("551234567"), "966551234567");
    assert.equal(intl("+971501234567"), "971501234567", "أي دولة مع +");
    assert.equal(intl("00201012345678"), "201012345678", "أي دولة مع 00");
    assert.equal(intl("971501234567"), "971501234567", "رمز الدولة بلا + لا يُضاف إليه رمز المدرسة");
    assert.equal(intl("٠٥٥١٢٣٤٥٦٧"), "966551234567", "الأرقام العربية");
  }
  assert.equal(detectPhone("01012345678", "20").intl, "201012345678", "رقم محلي لدولة أخرى يأخذ رمز المدرسة");
});

test("الطلاب بأرقام سعودية ويمنية ودولية في المدرسة نفسها، وكل رقم يُحفظ كما هو بدولته", async () => {
  const phones = ["0551234567", "771234567", "+971501234567"];
  for (const [i, p] of phones.entries()) {
    const r = await admin.post("/api/admin/students", { name: `طالب الأرقام ${i + 1}`, guardian_phone: p });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const s = r.data.student ?? r.data;
    assert.equal(detectPhone(s.guardian_phone, "967").intl, detectPhone(p, "967").intl, `${p} يبقى رقمه الصحيح`);
  }
});

test("المدرسة تختار أي عملة من القائمة وتغيّرها، والعملة غير المعروفة مرفوضة", async () => {
  assert.ok(CURRENCY_CODES.length >= 25 && ["YER", "SAR", "AED", "KWD", "EGP", "USD"].every((c) => CURRENCY_CODES.includes(c)));
  for (const c of ["AED", "KWD", "SAR", "YER"]) {
    const r = await admin.put("/api/admin/settings/currency", { currency: c });
    assert.equal(r.status, 200, `${c}: ${JSON.stringify(r.data)}`);
    assert.equal((await admin.get("/api/admin/me")).data.school.currency, c);
  }
  assert.equal((await admin.put("/api/admin/settings/currency", { currency: "XYZ" })).status, 400);
});
