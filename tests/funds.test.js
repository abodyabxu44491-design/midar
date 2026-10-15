/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readySchool, endPool, uid } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";

const L = "/api/admin/ledger";
let srv, A, B, inv, funds;
const pay = (body) => A.admin.post(`/api/admin/finance/invoices/${inv.id}/payments`, { amount: 100, idempotency_key: `k-${uid()}${uid()}`, ...body });
const lastFee = async () => (await A.admin.get(`${L}/entries?from=2000-01-01&to=2100-01-01&source_type=fee`)).data[0];

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "fu", students: 1 });
  B = await readySchool(srv.base, { prefix: "fv", students: 1 });
  await A.admin.put("/api/admin/settings/modules", { donations: true, payroll: true });
  await A.admin.post("/api/admin/finance/invoices", { target: "student", target_id: A.students[0].id, title: "رسوم الفصل", amount: 5000 });
  inv = (await A.admin.get("/api/admin/finance/invoices")).data.invoices.find((i) => i.title === "رسوم الفصل");
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("صندوق التبرعات نوع مستقل، والرسوم لا تدخله تلقائيًا حتى لو رُبط بطريقة دفع", async () => {
  const d = await A.admin.post(`${L}/accounts`, { name: "صندوق التبرعات", kind: "donations", opening_balance: 0, methods: ["transfer"] });
  assert.equal(d.status, 201, JSON.stringify(d.data));
  const fr = await A.admin.get("/api/admin/finance/funds");
  assert.equal(fr.status, 200, JSON.stringify(fr.data));
  funds = fr.data;
  const donations = funds.funds.find((f) => f.kind === "donations");
  const bank = funds.funds.find((f) => f.kind === "bank");
  assert.equal(funds.defaults.donation, Number(donations.id), "التبرعات لصندوق التبرعات");
  assert.notEqual(funds.defaults.transfer, Number(donations.id), "التحويل البنكي لا يُقترح له صندوق التبرعات");
  assert.equal((await pay({ method: "transfer" })).status, 201);
  const fee = await lastFee();
  assert.equal(fee.account_name, bank.name, "رسوم بتحويل بنكي تذهب للحساب البنكي لا لصندوق التبرعات");
  const g = await A.admin.post(`${L}/donations`, { donor_name: "فاعل خير", amount: 300, method: "transfer", received_on: "2026-09-01" });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  const de = (await A.admin.get(`${L}/entries?from=2000-01-01&to=2100-01-01&source_type=donation`)).data[0];
  assert.equal(de.account_name, "صندوق التبرعات");
});

test("كل دفعة تُورد للصندوق المختار في الشاشة، والاسترداد يُصرف من الصندوق المختار", async () => {
  const box = await A.admin.post(`${L}/accounts`, { name: "صندوق الرسوم الفرعي", kind: "cash", opening_balance: 0 });
  assert.equal(box.status, 201, JSON.stringify(box.data));
  assert.equal((await pay({ method: "cash", account_id: box.data.id })).status, 201);
  assert.equal((await lastFee()).account_name, "صندوق الرسوم الفرعي");
  const r = await A.admin.post(`/api/admin/finance/invoices/${inv.id}/refunds`, { amount: 50, note: "استرداد جزء", account_id: box.data.id, idempotency_key: `k-${uid()}${uid()}` });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const ref = (await A.admin.get(`${L}/entries?from=2000-01-01&to=2100-01-01&source_type=refund`)).data[0];
  assert.equal(ref.account_name, "صندوق الرسوم الفرعي");
  const acc = (await A.admin.get(`${L}/accounts`)).data.find((a) => a.id === box.data.id);
  assert.equal(Number(acc.balance), 50);
});

test("لا يُقبل صندوق موقوف أو بعملة أخرى أو من مدرسة أخرى", async () => {
  const off = await A.admin.post(`${L}/accounts`, { name: "صندوق قديم", kind: "cash", opening_balance: 0 });
  await A.admin.patch(`${L}/accounts/${off.data.id}/active`, { active: false }, "PATCH");
  const r1 = await pay({ method: "cash", account_id: off.data.id });
  assert.equal(r1.status, 400);
  assert.match(r1.data.error, /موقوف/);
  const usd = await A.admin.post(`${L}/accounts`, { name: "حساب بالدولار", kind: "bank", currency: "USD", opening_balance: 0 });
  assert.equal(usd.status, 201, JSON.stringify(usd.data));
  assert.equal((await pay({ method: "transfer", account_id: usd.data.id })).status, 400, "عملة مختلفة تُسجل يدويًا بسعر التحويل");
  const theirs = (await B.admin.get(`${L}/accounts`)).data[0];
  assert.equal((await pay({ method: "cash", account_id: theirs.id })).status, 404, "صندوق مدرسة أخرى غير موجود");
  assert.ok(!(await A.admin.get("/api/admin/finance/funds")).data.funds.some((f) => f.id === off.data.id || f.id === usd.data.id));
});

test("الصندوق المعتاد لكل طريقة دفع يُضبط من مكان واحد", async () => {
  const box = (await A.admin.get(`${L}/accounts`)).data.find((a) => a.name === "صندوق الرسوم الفرعي");
  assert.equal((await A.admin.put(`${L}/defaults`, { card: box.id }, "PUT")).status, 200);
  assert.equal((await A.admin.get("/api/admin/finance/funds")).data.defaults.card, Number(box.id));
  assert.equal((await pay({ method: "card" })).status, 201);
  assert.equal((await lastFee()).account_name, "صندوق الرسوم الفرعي");
  assert.equal((await A.admin.put(`${L}/defaults`, { card: 99999999 }, "PUT")).status, 404);
});
