// الخدمات: النقل (السعة، الصعود والنزول مع إشعار، الفوترة)، المكتبة (النسخ المتاحة، الحد، الإرجاع، التذكير)،
// العهد والمخزون (الصرف والعهدة والإرجاع والجرد)، العيادة (الزيارة والإشعار والملف الصحي)، والعزل والإيقاف
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";
import { remindersFor } from "../src/modules/shared/reminders.service.js";

let srv, A, B, busId, staffId;
const S = "/api/admin/services";
const inbox = async (s) => (await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(s))).data.items;
const profile = async (s) => (await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(s))).data;

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "sv", students: 3 });
  B = await readySchool(srv.base, { prefix: "sw", students: 1 });
  staffId = (await transaction({ tenantId: A.id }, (q) => q("SELECT id FROM staff LIMIT 1")))[0].id;
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("النقل: حافلة بسعة، الركاب، الصعود يُشعر ولي الأمر مرة واحدة، والفواتير", async () => {
  const b = await A.admin.post(`${S}/transport`, { name: "خط المنصورة", driver_name: "علي", driver_phone: "771234000", capacity: 2, fee: 5000 });
  assert.ok(b.data.id, JSON.stringify(b.data));
  busId = b.data.id;
  const [s1, s2, s3] = A.students;
  assert.equal((await A.admin.post(`${S}/transport/${busId}/riders`, { student_ids: [s1.id, s2.id, s3.id] })).status, 400, "السعة");
  assert.equal((await A.admin.post(`${S}/transport/${busId}/riders`, { student_ids: [s1.id, s2.id], stop: "جولة كالتكس", pickup_time: "6:30" })).status, 200);
  assert.equal((await A.admin.post(`${S}/transport/${busId}/events`, { kind: "boarded", student_ids: [s3.id] })).status, 400, "ليس من الركاب");
  const ev = await A.admin.post(`${S}/transport/${busId}/events`, { kind: "boarded", student_ids: [s1.id] });
  assert.equal(ev.data.recorded, 1);
  assert.equal((await A.admin.post(`${S}/transport/${busId}/events`, { kind: "boarded", student_ids: [s1.id] })).data.recorded, 0, "لا تكرار");
  assert.ok((await inbox(s1)).some((n) => n.kind === "transport" && /صعد الحافلة/.test(n.title)));
  const p = await profile(s1);
  assert.equal(p.features.transport.name, "خط المنصورة");
  assert.equal(p.features.transport.stop, "جولة كالتكس");
  const bill = await A.admin.post(`${S}/transport/${busId}/bill`, {});
  assert.equal(bill.data.invoices, 2);
  assert.equal((await A.admin.del(`${S}/transport/${busId}`)).status, 409, "فيها طلاب");
});

test("المكتبة: النسخ المتاحة، حد الإعارة، الإرجاع، وتذكير التأخر", async () => {
  const [s1, s2] = A.students;
  const bk = await A.admin.post(`${S}/library/books`, { title: "قصص الأنبياء", author: "ابن كثير", copies: 1 });
  assert.ok(bk.data.id);
  const l1 = await A.admin.post(`${S}/library/loans`, { book_id: bk.data.id, student_id: s1.id });
  assert.equal(l1.status, 200, JSON.stringify(l1.data));
  assert.equal((await A.admin.post(`${S}/library/loans`, { book_id: bk.data.id, student_id: s2.id })).status, 409, "لا نسخة متاحة");
  assert.equal((await A.admin.put(`${S}/library/books/${bk.data.id}`, { title: "قصص الأنبياء", copies: 0 })).status, 400, "النسخ أقل من المعار");
  await transaction({ tenantId: A.id }, (q) => q("UPDATE library_loans SET due_on = CURRENT_DATE - 2, loaned_on = CURRENT_DATE - 20 WHERE id = $1", [l1.data.id]));
  const r = await transaction({ tenantId: A.id }, remindersFor);
  assert.equal(r.library, 1);
  assert.ok((await inbox(s1)).some((n) => n.kind === "library"));
  assert.ok((await profile(s1)).features.library[0].overdue);
  assert.equal((await A.admin.post(`${S}/library/loans/${l1.data.id}/return`, {})).status, 200);
  assert.equal((await A.admin.post(`${S}/library/loans/${l1.data.id}/return`, {})).status, 404);
  // حد الإعارة (2 افتراضيًا)
  const b2 = await A.admin.post(`${S}/library/books`, { title: "كتاب آخر", copies: 5 });
  await A.admin.post(`${S}/library/loans`, { book_id: b2.data.id, student_id: s2.id });
  await A.admin.post(`${S}/library/loans`, { book_id: b2.data.id, student_id: s2.id });
  assert.equal((await A.admin.post(`${S}/library/loans`, { book_id: b2.data.id, student_id: s2.id })).status, 400);
  assert.equal((await A.admin.post(`${S}/library/loans`, { book_id: b2.data.id, staff_id: staffId })).status, 200, "إعارة لموظف");
});

test("المخزون والعهد: إضافة، صرف لا يتجاوز المتوفر، عهدة لموظف وإرجاعها، والجرد", async () => {
  const it = await A.admin.post(`${S}/inventory/items`, { name: "أقلام سبورة", unit: "علبة", min_quantity: 5 });
  const id = it.data.id;
  assert.equal((await A.admin.post(`${S}/inventory/items/${id}/move`, { kind: "in", qty: 20 })).data.quantity, 20);
  assert.equal((await A.admin.post(`${S}/inventory/items/${id}/move`, { kind: "out", qty: 25 })).status, 400);
  assert.equal((await A.admin.post(`${S}/inventory/items/${id}/move`, { kind: "custody", qty: 4 })).status, 400, "العهدة تحتاج موظفًا");
  assert.equal((await A.admin.post(`${S}/inventory/items/${id}/move`, { kind: "custody", qty: 4, staff_id: staffId })).data.quantity, 16);
  assert.equal((await A.admin.post(`${S}/inventory/items/${id}/move`, { kind: "return", qty: 5, staff_id: staffId })).status, 400, "أكثر من عهدته");
  assert.equal((await A.admin.post(`${S}/inventory/items/${id}/move`, { kind: "return", qty: 1, staff_id: staffId })).data.quantity, 17);
  const cust = (await A.admin.get(`${S}/inventory/custody`)).data;
  assert.equal(Number(cust.find((c) => c.item === "أقلام سبورة").qty), 3);
  assert.equal((await A.admin.post(`${S}/inventory/items/${id}/move`, { kind: "adjust", qty: 12 })).data.quantity, 12, "الجرد");
  assert.equal((await A.admin.get(`${S}/inventory/moves?item_id=${id}`)).data.length, 4, "المرفوض لا يُسجَّل");
});

test("العيادة: زيارة تُشعر ولي الأمر، والملف الصحي يظهر له حسب الإعداد", async () => {
  const [, , s3] = A.students;
  assert.equal((await A.admin.put(`${S}/clinic/students/${s3.id}`, { blood_type: "O+", allergies: "الفول السوداني" })).status, 200);
  const v = await A.admin.post(`${S}/clinic/visits`, { student_id: s3.id, complaint: "صداع", action: "راحة وماء", temperature: 37.8, sent_home: true });
  assert.ok(v.data.id);
  assert.ok((await inbox(s3)).some((n) => n.kind === "clinic" && /المغادرة/.test(n.title)));
  let p = await profile(s3);
  assert.equal(p.features.health.profile.allergies, "الفول السوداني");
  assert.equal(p.features.health.visits[0].complaint, "صداع");
  await A.admin.put("/api/admin/communication/features/clinic", { show_parent_profile: false });
  p = await profile(s3);
  assert.equal(p.features.health, undefined);
  assert.equal((await A.admin.put(`${S}/clinic/students/${s3.id}`, { blood_type: "Z" })).status, 400);
});

test("العزل والإيقاف", async () => {
  assert.equal((await B.admin.get(`${S}/transport/${busId}/riders`)).data.length, 0);
  assert.equal((await B.admin.post(`${S}/transport/${busId}/events`, { kind: "boarded", student_ids: [A.students[0].id] })).status, 400);
  assert.equal((await B.admin.get(`${S}/library/books`)).data.length, 0);
  assert.equal((await B.admin.post(`${S}/clinic/visits`, { student_id: A.students[0].id, complaint: "تجربة" })).status, 404);
  for (const m of ["transport", "library", "inventory", "clinic"]) {
    await A.admin.put("/api/admin/settings/modules", { [m]: false });
    const path = { transport: "transport", library: "library/books", inventory: "inventory/items", clinic: "clinic/visits" }[m];
    assert.equal((await A.admin.get(`${S}/${path}`)).status, 404, m);
    await A.admin.put("/api/admin/settings/modules", { [m]: true });
  }
});
