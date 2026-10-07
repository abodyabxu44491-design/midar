// بوابة الحضور: مسح بطاقة الطالب يسجل حضوره (أو تأخره) ويبلغ ولي أمره، ولا يتكرر، ولا يقبل بطاقة مدرسة أخرى
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport, deliveriesIdle } from "../src/modules/shared/notify.service.js";
import { keyFromCode } from "../src/modules/shared/attendance.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B;
const pushes = [];
const hm = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Aden", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const sub = (n) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });
const settle = async () => { await new Promise((r) => setTimeout(r, 150)); await deliveriesIdle(); };
const card = (S, s) => `https://midar.example.com/${S.id}?k=${encodeURIComponent(s.access_key)}`;
// أيام الدراسة كل أيام الأسبوع، فيعمل الاختبار في أي يوم
const everyDay = (S) => transaction({ tenantId: S.id }, (q) => q(
  `INSERT INTO timetable_settings (tenant_id, days) VALUES (app_tenant(), '{0,1,2,3,4,5,6}')
   ON CONFLICT (tenant_id) DO UPDATE SET days = EXCLUDED.days`));

before(async () => {
  srv = await startServer();
  setTransport({ push: async (s, p) => { pushes.push({ endpoint: s.endpoint, ...p }); return { statusCode: 201 }; }, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "gt", students: 3 });
  B = await readySchool(srv.base, { prefix: "gu", students: 1 });
  await everyDay(A); await everyDay(B);
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("قراءة رمز البطاقة: الرابط أو المعرّف، ورفض بطاقة مدرسة أخرى", () => {
  assert.equal(keyFromCode("https://x.app/sch-1?k=AB12-CD34", "sch-1"), "AB12-CD34");
  assert.equal(keyFromCode("ab12cd34", "sch-1"), "AB12-CD34");
  assert.throws(() => keyFromCode("https://x.app/other?k=AB12-CD34", "sch-1"), /مدرسة أخرى/);
  assert.throws(() => keyFromCode("https://x.app/sch-1/student", "sch-1"), /ليس بطاقة/);
});

test("المسح قبل وقت التأخر: حاضر، وولي الأمر يصله «وصل المدرسة»، والمسح الثاني لا يكرر", async () => {
  const [s1] = A.students;
  const reg = await client(srv.base).post(`/api/public/${A.id}/student/push`, { ...A.parent(s1), subscription: sub("g1") });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  // وقت التأخر بعد الآن بساعة (حاضر)
  await A.admin.put("/api/admin/communication/features/gate", { late_after: "23:59" });
  const r = await A.admin.post("/api/admin/attendance/gate", { code: card(A, s1) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, "present");
  assert.equal(r.data.already, false);
  assert.equal(r.data.student.name, s1.full_name ?? r.data.student.name);
  await settle();
  const box = (await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(s1))).data;
  assert.ok(box.items.some((n) => n.kind === "arrival"), JSON.stringify(box.items.map((n) => n.kind)));
  const p = pushes.filter((x) => x.endpoint.endsWith("/g1"));
  assert.equal(p.length, 1);
  assert.match(p[0].title, /وصل .* المدرسة/);
  const again = await A.admin.post("/api/admin/attendance/gate", { code: card(A, s1) });
  assert.equal(again.data.already, true);
  await settle();
  assert.equal(pushes.filter((x) => x.endpoint.endsWith("/g1")).length, 1, "لا إشعار ثانٍ");
  const g = (await A.admin.get("/api/admin/attendance/gate")).data;
  assert.equal(g.count, 1);
  assert.equal(g.recent[0].status, "present");
});

test("بعد وقت التأخر: متأخر، ومن سُجّل غائبًا ثم وصل يتحول لمتأخر", async () => {
  const [, s2] = A.students;
  await A.admin.put("/api/admin/communication/features/gate", { late_after: "00:00" });
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Aden" });
  assert.equal((await A.admin.post("/api/admin/attendance", { date, entries: [{ student_id: s2.id, status: "absent" }] })).status, 200);
  const r = await A.admin.post("/api/admin/attendance/gate", { code: s2.access_key });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, hm(new Date()) > "00:00" ? "late" : "present");
  const [row] = await transaction({ tenantId: A.id }, (q) => q("SELECT status, note FROM attendance WHERE student_id = $1 AND day = $2", [s2.id, date]));
  assert.equal(row.status, r.data.status);
  assert.match(row.note, /البوابة/);
});

test("المعلم المناوب يمسح إن سمحت الإدارة فقط، وبطاقة مدرسة أخرى مرفوضة", async () => {
  const [, , s3] = A.students;
  await A.admin.put("/api/admin/communication/features/gate", { teacher_can_scan: false });
  assert.equal((await A.teacher.post("/api/teacher/attendance/gate", { code: card(A, s3) })).status, 403);
  assert.equal((await A.teacher.get("/api/teacher/attendance/gate")).data.allowed, false);
  await A.admin.put("/api/admin/communication/features/gate", { teacher_can_scan: true, late_after: "23:59" });
  assert.equal((await A.teacher.post("/api/teacher/attendance/gate", { code: card(A, s3) })).status, 200);
  // بطاقة طالب من مدرسة ب في مدرسة أ: رابطها لمدرسة أخرى، ومعرّفها وحده غير موجود هنا
  const [b1] = B.students;
  const cross = await A.admin.post("/api/admin/attendance/gate", { code: card(B, b1) });
  assert.equal(cross.status, 400);
  assert.match(cross.data.error, /مدرسة أخرى/);
  assert.equal((await A.admin.post("/api/admin/attendance/gate", { code: b1.access_key })).status, 404);
  assert.equal((await A.admin.post("/api/admin/attendance/gate", { code: "hello world" })).status, 400);
});
