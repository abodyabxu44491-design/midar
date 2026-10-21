/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, endPool, readySchool, uid } from "./helpers.js";
import { transaction } from "../src/core/db/pool.js";

let srv, sc;
before(async () => { srv = await startServer(); sc = await readySchool(srv.base, { prefix: "cr" }); });
after(async () => { await srv.close(); await endPool(); });

async function staff(role, extra = {}) {
  const username = `${role.slice(0, 3)}${uid()}`;
  const path = role === "accountant" ? "/api/admin/users" : "/api/admin/users/admins";
  const r = await sc.admin.post(path, { name: role === "accountant" ? "محاسب المدرسة" : "وكيل المدرسة", username, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const c = client(srv.base);
  await transaction({ tenantId: sc.id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = $1", [username]));
  assert.equal((await c.post("/api/staff/login", { school: sc.id, username, password: r.data.credentials.password })).status, 200);
  return c;
}

test("الطالب: اللقب والمنطقة يُحفظان ويُبحث بهما ويُصفّى بالمنطقة", async () => {
  const s = await sc.admin.post("/api/admin/students", { name: "محمد علي أحمد سالم", family_name: "الحامد", area: "حي الروضة", class_id: sc.c1.id });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const byFamily = (await sc.admin.get(`/api/admin/students?q=${encodeURIComponent("الحامد")}`)).data;
  assert.ok(byFamily.some((x) => x.id === s.data.id && x.area === "حي الروضة"));
  const byArea = (await sc.admin.get(`/api/admin/students?area=${encodeURIComponent("حي الروضة")}`)).data;
  assert.deepEqual(byArea.map((x) => x.id), [s.data.id]);
  const areas = (await sc.admin.get("/api/admin/students/areas")).data;
  assert.ok(areas.some((a) => a.area === "حي الروضة" && a.students === 1));
});

test("ربط ولي الأمر تلقائيًا: الأخ بنفس العائلة يُربط، والعائلة المختلفة تنتظر المراجعة", async () => {
  const phone = `0773${String(Date.now()).slice(-6)}`;
  const first = await sc.admin.post("/api/admin/students", { name: "خالد سعيد ناصر باوزير", class_id: sc.c1.id, guardian_phone: phone });
  const p = await sc.admin.post("/api/admin/parents", { name: "سعيد ناصر باوزير", phone, student_ids: [first.data.id] });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const brother = await sc.admin.post("/api/admin/students", { name: "فهد سعيد ناصر باوزير", class_id: sc.c2.id, guardian_phone: phone });
  const linked = (await sc.admin.get(`/api/admin/parents/of-student/${brother.data.id}`)).data;
  assert.equal(linked.length, 1, "الأخ يُربط بنفس الحساب تلقائيًا");
  const stranger = await sc.admin.post("/api/admin/students", { name: "سامي علي حسن العمري", class_id: sc.c2.id, guardian_phone: phone });
  assert.equal((await sc.admin.get(`/api/admin/parents/of-student/${stranger.data.id}`)).data.length, 0, "لا يُربط طالب من عائلة أخرى");
  const reqs = (await sc.admin.get("/api/admin/parents/requests")).data;
  assert.ok(reqs.some((r) => Number(r.student_id) === Number(stranger.data.id) && r.status === "pending"), "يصل للإدارة للمراجعة");
  const fam = (await sc.admin.get("/api/admin/parents/families")).data.find((g) => g.students.some((x) => x.id === first.data.id));
  assert.equal(fam.verified, false);
  assert.equal(fam.students.length, 3);
});

test("الطلبات المالية: الإدارة المدرسية تطلب، المحاسب يعتمد ويصرف بسند، والصلاحيات محترمة", async () => {
  const school = await staff("admin", { admin_scope: "school" });
  const acc = await staff("accountant", { can_approve_finance: true });
  const accNo = await staff("accountant");
  assert.equal((await school.get("/api/admin/ledger/summary")).status, 403, "الإدارة المدرسية لا تدخل المالية");
  assert.equal((await school.get("/api/admin/users")).status, 403);
  const me = (await school.get("/api/admin/me")).data;
  assert.equal(me.admin_scope, "school");

  const r = await school.post("/api/admin/finance-requests", { kind: "advance", title: "سلفة للأستاذ خالد", amount: 300, teacher_id: sc.teacherId });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.request_no, /^R-\d{5}$/);
  assert.equal((await school.post(`/api/admin/finance-requests/${r.data.id}/decide`, { decision: "approve" })).status, 403, "لا تعتمد الإدارة المدرسية");
  assert.equal((await accNo.post(`/api/accountant/finance-requests/${r.data.id}/decide`, { decision: "approve" })).status, 403, "محاسب بلا صلاحية الاعتماد");
  assert.equal((await acc.post(`/api/accountant/finance-requests/${r.data.id}/decide`, { decision: "reject" })).status, 400, "الرفض يحتاج سببًا");
  assert.equal((await acc.post(`/api/accountant/finance-requests/${r.data.id}/pay`, { account_id: 1 })).status, 409, "لا صرف قبل الاعتماد");
  assert.equal((await acc.post(`/api/accountant/finance-requests/${r.data.id}/decide`, { decision: "approve", approved_amount: 250 })).status, 200);
  const accounts = (await acc.get("/api/accountant/ledger/accounts")).data;
  const cash = (accounts.items || accounts).find((a) => a.kind === "cash" && a.is_active);
  const paid = await acc.post(`/api/accountant/finance-requests/${r.data.id}/pay`, { account_id: cash.id, method: "cash" });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.match(paid.data.entry_no, /^F-/);
  const one = (await school.get(`/api/admin/finance-requests/${r.data.id}`)).data;
  assert.equal(one.status, "paid");
  assert.equal(Number(one.approved_amount), 250);
  assert.match(one.requested_by, /وكيل المدرسة/);
  assert.match(one.decided_by, /محاسب المدرسة/);
  assert.match(one.paid_by, /محاسب المدرسة/);
  assert.equal(one.entry_no, paid.data.entry_no);

  const r2 = await school.post("/api/admin/finance-requests", { kind: "purchase", title: "أقلام سبورة", amount: 40 });
  assert.equal((await sc.admin.post(`/api/admin/finance-requests/${r2.data.id}/decide`, { decision: "reject", note: "يوجد مخزون كافٍ" })).status, 200, "الإدارة العامة تعتمد وترفض");
  assert.equal((await school.post(`/api/admin/finance-requests/${r2.data.id}/cancel`)).status, 409);
});

test("تأمين الكتب: يُستلم في صندوق مستقل ويُرد كاملًا أو بخصم بسند صرف", async () => {
  const st = sc.students[0];
  const book = await sc.admin.post("/api/admin/services/library/books", { title: "كتاب الرياضيات - الصف الأول", copies: 5 });
  const bookId = book.status === 201 || book.status === 200 ? book.data.id : null;
  const d1 = await sc.admin.post("/api/admin/book-deposits", { student_id: st.id, ...(bookId ? { book_id: bookId } : { book_title: "كتاب الرياضيات" }), amount: 100 });
  assert.equal(d1.status, 201, JSON.stringify(d1.data));
  const d2 = await sc.admin.post("/api/admin/book-deposits", { student_id: st.id, book_title: "كتاب العلوم", amount: 80 });
  let ov = (await sc.admin.get("/api/admin/book-deposits")).data;
  assert.equal(ov.held_count, 2);
  assert.equal(Number(ov.fund.balance), 180);
  assert.equal((await sc.admin.post(`/api/admin/book-deposits/${d1.data.id}/return`, { condition: "damaged", refund_amount: 60 })).status, 400, "الخصم يحتاج سببًا");
  const back1 = await sc.admin.post(`/api/admin/book-deposits/${d1.data.id}/return`, { condition: "damaged", refund_amount: 60, deduction_reason: "تمزق الغلاف وبعض الصفحات" });
  assert.equal(back1.status, 200, JSON.stringify(back1.data));
  assert.equal(back1.data.status, "partial");
  assert.match(back1.data.voucher_no, /^F-/);
  const back2 = await sc.admin.post(`/api/admin/book-deposits/${d2.data.id}/return`, { condition: "good", refund_amount: 80 });
  assert.equal(back2.data.status, "refunded");
  assert.equal((await sc.admin.post(`/api/admin/book-deposits/${d2.data.id}/return`, { condition: "good", refund_amount: 80 })).status, 409);
  ov = (await sc.admin.get("/api/admin/book-deposits")).data;
  assert.equal(Number(ov.fund.balance), 40, "يبقى في الصندوق مبلغ الخصم فقط");
  assert.equal(ov.held_count, 0);
  const v = (await sc.admin.get(`/api/admin/book-deposits/${d1.data.id}/voucher`)).data;
  assert.equal(Number(v.refund_amount), 60);
  assert.equal(v.condition, "damaged");
});

test("حسابات الإدارة: يبقى حساب إدارة عامة واحد، ولا يغيّر المستخدم صلاحيات نفسه", async () => {
  const list = (await sc.admin.get("/api/admin/users/admins")).data;
  const self = list.find((u) => u.me);
  assert.equal((await sc.admin.patch(`/api/admin/users/admins/${self.id}`, { admin_scope: "school" })).status, 409);
  const other = list.find((u) => !u.me && u.admin_scope === "school");
  assert.ok(other);
  assert.equal((await sc.admin.patch(`/api/admin/users/admins/${other.id}`, { admin_scope: "full" })).status, 200);
});

test("إدارة المدرسة لا ترى أرقام المالية في الرئيسية والتنبيهات والتحليلات والبحث", async () => {
  const school = await staff("school", { admin_scope: "school" });
  const st = await sc.admin.post("/api/admin/students", { name: "طالب الفاتورة المتأخرة", class_id: sc.c1.id });
  assert.equal((await sc.admin.post("/api/admin/finance/invoices", { target: "student", target_id: st.data.id, title: "رسوم متأخرة للاختبار", amount: 100, due_date: "2020-01-01" })).status, 201);

  const full = (await sc.admin.get("/api/admin/dashboard")).data;
  assert.ok("fees_paid" in full, "الإدارة العامة ترى الرسوم");
  const dash = (await school.get("/api/admin/dashboard")).data;
  assert.ok(!("fees_paid" in dash) && !("fees_remaining" in dash), "لا أرقام رسوم لإدارة المدرسة");
  assert.equal(dash.students, full.students, "وتبقى بقية الأرقام كما هي");

  const alerts = (await school.get("/api/admin/analytics/alerts")).data;
  assert.deepEqual(alerts.overdue, []);
  assert.equal(alerts.counts.overdue_invoices, 0);
  assert.ok((await sc.admin.get("/api/admin/analytics/alerts")).data.overdue.length > 0);

  const anr = await school.get("/api/admin/analytics");
  assert.equal(anr.status, 200, JSON.stringify(anr.data));
  const an = anr.data;
  assert.equal(an.fees, null);
  assert.deepEqual(an.fees_by_month, []);
  assert.ok((await sc.admin.get("/api/admin/analytics")).data.fees, "النسخة المخزنة للإدارة العامة كاملة");

  const found = (await school.get(`/api/admin/analytics/search?q=${encodeURIComponent("الفاتورة المتأخرة")}`)).data;
  assert.deepEqual(found.invoices, []);
  const notes = (await school.get("/api/admin/analytics/notifications")).data;
  assert.ok(!JSON.stringify(notes).includes("فواتير تجاوزت"), "لا تنبيه فواتير لإدارة المدرسة");
});
