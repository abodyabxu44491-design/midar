// الأقساط وخصم الإخوة: الخصم التلقائي عند تطبيق قالب الرسوم، وتذكير القسط قبل استحقاقه وبعد فواته مرة واحدة
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";
import { remindersFor } from "../src/modules/shared/reminders.service.js";

let srv, A, kids, other, planId;
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Aden" });

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "in", students: 0 });
  // ثلاثة إخوة بنفس الجوال (بصيغتين مختلفتين) وطالب آخر
  kids = [];
  for (const [i, ph] of ["771111111", "+967771111111", "0771111111"].entries()) {
    kids.push((await A.admin.post("/api/admin/students", { name: `أخ رقم ${i + 1} العمودي`, class_id: A.c1.id, guardian_phone: ph })).data);
  }
  other = (await A.admin.post("/api/admin/students", { name: "طالب منفرد", class_id: A.c1.id, guardian_phone: "772222222" })).data;
  const p = await A.admin.post("/api/admin/finance/plans", { name: "رسوم الفصل", amount: 1000, installments: 2, first_due: day(3), interval_months: 1 });
  planId = p.data.id;
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("خصم الإخوة: موقوف افتراضيًا، وعند تفعيله الأخ الأكبر كامل والثاني والثالث بنسبهم", async () => {
  let pr = (await A.admin.post(`/api/admin/finance/plans/${planId}/apply`, { dry_run: true })).data;
  assert.ok(pr.preview.every((x) => x.total === 1000 && !x.sibling));
  assert.equal((await A.admin.put("/api/admin/communication/features/fees", { sibling_discount: true, sibling_second_pct: 10, sibling_third_pct: 20 })).status, 200);
  pr = (await A.admin.post(`/api/admin/finance/plans/${planId}/apply`, { dry_run: true })).data;
  const by = Object.fromEntries(pr.preview.map((x) => [x.student_id, x]));
  assert.equal(by[kids[0].id].total, 1000, "الأقدم تسجيلًا");
  assert.equal(by[kids[1].id].total, 900);
  assert.equal(by[kids[2].id].total, 800);
  assert.equal(by[other.id].total, 1000);
  assert.equal(by[kids[2].id].sibling.rank, 3);
  const r = await A.admin.post(`/api/admin/finance/plans/${planId}/apply`, {});
  assert.equal(r.data.invoices, 8, "دفعتان لكل طالب");
  const inv = (await A.admin.get(`/api/admin/finance/invoices?student_id=${kids[1].id}`)).data;
  const rows = inv.invoices || inv;
  assert.equal(rows.filter((x) => x.student_id === kids[1].id).reduce((a, x) => a + Number(x.amount), 0), 900);
  // إيقاف قسم الأقساط يوقف الخصم التلقائي
  await A.admin.put("/api/admin/settings/modules", { installments: false });
  pr = (await A.admin.post(`/api/admin/finance/plans/${planId}/apply`, { dry_run: true })).data;
  assert.ok(pr.preview.every((x) => !x.sibling));
  await A.admin.put("/api/admin/settings/modules", { installments: true });
});

test("التذكير: قبل الاستحقاق بالأيام المحددة، وبعد فواته، ومرة واحدة فقط، ولا تذكير لقسط مسدد", async () => {
  // كل الدفعة الأولى تستحق بعد 3 أيام (الإعداد الافتراضي)
  const r1 = await transaction({ tenantId: A.id }, remindersFor);
  assert.equal(r1.due, 4);
  const again = await transaction({ tenantId: A.id }, remindersFor);
  assert.equal(again.due, 0, "لا يتكرر");
  const inbox = (await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(kids[0]))).data;
  assert.ok(inbox.items.some((n) => /تذكير: قسط يستحق/.test(n.title)));
  // قسط فات موعده أمس: يُسدد لطالب، ويبقى لآخر
  await transaction({ tenantId: A.id }, (q) => q("UPDATE invoices SET due_date = $1 WHERE installment_no = 1", [day(-1)]));
  const first = (await A.admin.get(`/api/admin/finance/invoices?student_id=${other.id}`)).data;
  const open = (first.invoices || first).find((x) => x.student_id === other.id && Number(x.amount) === 500 && x.due_date === day(-1));
  assert.equal((await A.admin.post(`/api/admin/finance/invoices/${open.id}/payments`, { amount: 500, method: "cash", idempotency_key: `k-${Date.now()}` })).status, 201);
  const r2 = await transaction({ tenantId: A.id }, remindersFor);
  assert.equal(r2.overdue, 3, "المسدد لا يُذكَّر");
});
