// محرك الإشعارات: منع التكرار، اختيارات ولي الأمر والإلزامي، ساعات الهدوء، طابور التسليم وإعادة المحاولة،
// حذف الجهاز الملغى، أكثر من ابن على جهاز واحد، الإرسال الجماعي بفئات وتأكيد، مركز الإشعارات، حد الإرسال، والعزل بين المدارس
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport, processDeliveries, deliveriesIdle, quietDelayMinutes, backoffSeconds, MAX_ATTEMPTS, notify, PUSH_HOURLY_LIMIT }
  from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B;
const pushes = [];
const fail = new Map();   // نهاية رابط الجهاز → رمز الخطأ الذي يرده المزوّد
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const sub = (n) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });
const settle = async () => { await new Promise((r) => setTimeout(r, 150)); await deliveriesIdle(); await new Promise((r) => setTimeout(r, 50)); };
const pushesTo = (n) => pushes.filter((p) => p.endpoint.endsWith(`/${n}`));
const inbox = (S, s, filter) => client(srv.base).post(`/api/public/${S.id}/student/inbox`, { ...S.parent(s), filter });

before(async () => {
  srv = await startServer();
  setTransport({
    push: async (s, payload) => {
      const code = [...fail.entries()].find(([k]) => s.endpoint.endsWith(`/${k}`))?.[1];
      if (code) throw Object.assign(new Error(`HTTP ${code}`), { statusCode: code });
      pushes.push({ endpoint: s.endpoint, ...payload });
      return { statusCode: 201 };
    },
    sms: async () => {},
  });
  A = await readySchool(srv.base, { prefix: "ne", students: 4 });
  B = await readySchool(srv.base, { prefix: "nf", students: 1 });
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("منع التكرار: تبديل الحالة ذهابًا وإيابًا لا يكرر التنبيه، ويُحدَّث الإشعار نفسه", async () => {
  const [s1] = A.students;
  await client(srv.base).post(`/api/public/${A.id}/student/push`, { ...A.parent(s1), subscription: sub("dup1") });
  const mark = (status, reason) => A.admin.post("/api/admin/attendance", { date: today, reason, entries: [{ student_id: s1.id, status }] });
  assert.equal((await mark("absent")).status, 200);
  await settle();
  assert.equal(pushesTo("dup1").length, 1);
  await mark("present", "تصحيح");
  await mark("absent", "تصحيح");
  await settle();
  assert.equal(pushesTo("dup1").length, 1, "لا تنبيه ثانٍ لنفس الغياب في نفس اليوم");
  const box = (await inbox(A, s1)).data;
  const abs = box.items.filter((n) => n.kind === "absence");
  assert.equal(abs.length, 1);
  assert.equal(abs[0].repeats, 2);
  assert.equal(abs[0].priority, 1, "الغياب عاجل");
  assert.equal(abs[0].category, "attendance");
  assert.equal(pushesTo("dup1")[0].priority, 1);
  assert.ok(pushesTo("dup1")[0].badge >= 1, "رقم غير المقروء يُرسل للجهاز");
});

test("اختيارات ولي الأمر: يكتم التأخر فلا يصل للجوال ويبقى في المركز، والغياب الإلزامي لا يُكتم", async () => {
  const [, s2] = A.students;
  const anon = client(srv.base);
  await anon.post(`/api/public/${A.id}/student/push`, { ...A.parent(s2), subscription: sub("pref2") });
  const p0 = (await anon.post(`/api/public/${A.id}/student/notify-prefs`, A.parent(s2))).data;
  assert.equal(p0.topics.absence.mandatory, true, "الغياب إلزامي افتراضيًا");
  assert.equal(p0.topics.late.mandatory, false);
  assert.equal(p0.devices, 1);
  const saved = await anon.post(`/api/public/${A.id}/student/notify-prefs/save`, { ...A.parent(s2), muted: ["late", "absence", "not_a_topic"] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.muted.sort(), ["absence", "late"]);
  await A.admin.post("/api/admin/attendance", { date: yesterday, entries: [{ student_id: s2.id, status: "late" }] });
  await settle();
  assert.equal(pushesTo("pref2").length, 0, "التأخر مكتوم");
  assert.ok((await inbox(A, s2)).data.items.some((n) => n.kind === "late"), "لكنه في مركز الإشعارات");
  await A.admin.post("/api/admin/attendance", { date: today, entries: [{ student_id: s2.id, status: "absent" }] });
  await settle();
  assert.equal(pushesTo("pref2").length, 1, "الغياب إلزامي من المدرسة فيصل رغم الكتم");
  // المدرسة تلغي الإلزام: يصبح الكتم نافذًا
  await A.admin.put("/api/admin/communication/notify", { absence: { mandatory: false } });
  const p1 = (await anon.post(`/api/public/${A.id}/student/notify-prefs`, A.parent(s2))).data;
  assert.equal(p1.topics.absence.mandatory, false);
  await A.admin.put("/api/admin/communication/notify", { absence: { mandatory: true } });
});

test("ساعات الهدوء: غير العاجل يتأجل لنهايتها، والعاجل يصل فورًا", async () => {
  assert.equal(quietDelayMinutes({ quiet_start: "22:00", quiet_end: "06:00", timezone: "UTC" }, new Date("2026-01-01T23:30:00Z")), 390);
  assert.equal(quietDelayMinutes({ quiet_start: "22:00", quiet_end: "06:00", timezone: "UTC" }, new Date("2026-01-01T12:00:00Z")), 0);
  assert.equal(quietDelayMinutes({ quiet_start: "13:00", quiet_end: "14:00", timezone: "UTC" }, new Date("2026-01-01T13:15:00Z")), 45);
  assert.equal(quietDelayMinutes({ quiet_start: null, quiet_end: null }), 0);
  // نافذة هدوء تغطي الآن بتوقيت المدرسة
  const hm = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Aden", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const start = hm(new Date(Date.now() - 60 * 60000)), end = hm(new Date(Date.now() + 60 * 60000));
  assert.equal((await A.admin.put("/api/admin/communication/notify/quiet", { quiet_start: start, quiet_end: end })).status, 200);
  assert.equal((await A.admin.put("/api/admin/communication/notify/quiet", { quiet_start: start, quiet_end: null })).status, 400);
  const [, , s3] = A.students;
  await client(srv.base).post(`/api/public/${A.id}/student/push`, { ...A.parent(s3), subscription: sub("quiet3") });
  await A.admin.post("/api/admin/attendance", { date: yesterday, entries: [{ student_id: s3.id, status: "late" }] });
  await settle();
  assert.equal(pushesTo("quiet3").length, 0, "التأخر (مهم) مؤجل");
  const [d] = await transaction({ tenantId: A.id }, (q) => q(`SELECT d.status, d.next_attempt_at > now() + interval '30 minutes' AS later
    FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id WHERE n.student_id = $1 AND n.kind = 'late'`, [s3.id]));
  assert.equal(d.status, "pending");
  assert.equal(d.later, true);
  await A.admin.post("/api/admin/attendance", { date: today, entries: [{ student_id: s3.id, status: "absent" }] });
  await settle();
  assert.equal(pushesTo("quiet3").length, 1, "الغياب (عاجل) وصل فورًا");
  // انتهاء ساعات الهدوء: العامل الدوري يرسل المؤجل
  await transaction({ tenantId: A.id }, (q) => q("UPDATE notification_deliveries SET next_attempt_at = now() WHERE status = 'pending'"));
  await processDeliveries();
  assert.equal(pushesTo("quiet3").length, 2);
  await A.admin.put("/api/admin/communication/notify/quiet", { quiet_start: null, quiet_end: null });
});

test("طابور التسليم: خطأ مؤقت يُعاد بانتظار متزايد، والدائم يفشل بسبب واضح، والجهاز الملغى يُحذف", async () => {
  assert.deepEqual([1, 2, 3, 6, 9].map(backoffSeconds), [30, 60, 120, 960, 3600]);
  // خطأ مؤقت ثم نجاح
  assert.equal((await A.admin.post("/api/admin/notifications/push", sub("flaky"))).status, 200);
  fail.set("flaky", 503);
  await A.admin.post("/api/admin/communication/notify/test", {});
  await settle();
  const st = () => transaction({ tenantId: A.id }, (q) => q(`SELECT d.status, d.attempts, d.error, d.provider_status, d.next_attempt_at > now() AS waiting
    FROM notification_deliveries d JOIN push_subscriptions p ON p.id = d.subscription_id WHERE p.endpoint LIKE '%/flaky' ORDER BY d.id DESC LIMIT 1`));
  let [d] = await st();
  assert.equal(d.status, "retrying");
  assert.equal(d.attempts, 1);
  assert.equal(d.provider_status, 503);
  assert.equal(d.waiting, true);
  assert.match(d.error, /مؤقتًا/);
  fail.delete("flaky");
  await transaction({ tenantId: A.id }, (q) => q("UPDATE notification_deliveries SET next_attempt_at = now() WHERE status = 'retrying'"));
  await processDeliveries();
  [d] = await st();
  assert.equal(d.status, "sent");
  assert.equal(d.attempts, 2);
  assert.equal(pushesTo("flaky").length, 1);

  // يفشل دائمًا: بعد آخر محاولة تصبح الحالة «فشل»
  fail.set("flaky", 500);
  await A.admin.post("/api/admin/communication/notify/test", {});
  await settle();
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    await transaction({ tenantId: A.id }, (q) => q("UPDATE notification_deliveries SET next_attempt_at = now() WHERE status = 'retrying'"));
    await processDeliveries();
  }
  [d] = await st();
  assert.equal(d.status, "failed");
  assert.equal(d.attempts, MAX_ATTEMPTS);
  fail.delete("flaky");

  // الجهاز ألغى الاشتراك (410): يُحذف فورًا، والتسليم «فشل» بسبب مفهوم
  assert.equal((await A.admin.post("/api/admin/notifications/push", sub("gone"))).status, 200);
  fail.set("gone", 410);
  await A.admin.post("/api/admin/communication/notify/test", {});
  await settle();
  const left = await transaction({ tenantId: A.id }, (q) => q("SELECT 1 FROM push_subscriptions WHERE endpoint LIKE '%/gone'"));
  assert.equal(left.length, 0, "حُذف الجهاز الملغى");
  const log = (await A.admin.get("/api/admin/communication/notify/log?status=failed")).data;
  assert.ok(log.items.some((n) => n.deliveries.some((x) => /ألغى الاشتراك/.test(x.error || ""))), "السبب في سجل الإشعارات");
  assert.ok(log.stats.failed >= 1);
  fail.delete("gone");
});

test("ولي أمر لديه ابنان على نفس الجهاز: إشعار كل ابن باسمه، والإعلان العام يصل مرة واحدة", async () => {
  const [, , , s4] = A.students;
  const sib = (await A.admin.post("/api/admin/students", { name: "حمزة علي سالم", class_id: A.c2.id, guardian_phone: "771234999" })).data;
  const anon = client(srv.base);
  for (const s of [s4, sib]) await anon.post(`/api/public/${A.id}/student/push`, { ...A.parent(s), subscription: sub("family") });
  await A.admin.post("/api/admin/attendance", { date: today, entries: [{ student_id: sib.id, status: "absent" }] });
  await settle();
  const fam = pushesTo("family");
  assert.equal(fam.length, 1);
  assert.match(fam[0].title, /حمزة/);
  assert.ok(fam[0].url.includes(`s=${sib.id}`), "يفتح ملف الابن الصحيح");
  // إعلان لكل المدرسة: تنبيه واحد للجهاز، وإشعار في مركز كل ابن
  pushes.length = 0;
  const r = await A.admin.post("/api/admin/announcements", { title: "إجازة يوم الخميس", body: "بمناسبة اليوم الوطني", target: { type: "all", ids: [] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await settle();
  assert.equal(pushesTo("family").length, 1, "لا يتكرر لنفس الجهاز");
  for (const s of [s4, sib]) assert.ok((await inbox(A, s)).data.items.some((n) => n.kind === "announcement"));
});

test("الإرسال الجماعي: معاينة العدد لكل فئة، ورفض الإرسال إذا تغيّر العدد، والإعلان يظهر للفئة فقط", async () => {
  const dry = (target, kind = "announcement") => A.admin.post("/api/admin/announcements", { title: "اختبار", kind, target, dry_run: true });
  const tg = (await A.admin.get("/api/admin/announcements/targets")).data;
  const grade1 = tg.grades.find((g) => g.name === "الأول");
  const c1Count = (await A.admin.get("/api/admin/structure/classes")).data.find((c) => c.id === A.c1.id).students;
  assert.equal((await dry({ type: "class", ids: [A.c1.id] })).data.recipients.parents, c1Count);
  assert.equal((await dry({ type: "grade", ids: [grade1.id] })).data.recipients.parents, c1Count + 1);
  assert.equal((await dry({ type: "stage", ids: [tg.stages[0].id] })).data.recipients.parents, c1Count + 1);
  assert.equal((await dry({ type: "students", ids: [A.students[0].id, A.students[1].id] })).data.recipients.parents, 2);
  assert.equal((await dry({ type: "teachers", ids: [] })).data.recipients.staff, 1);
  assert.equal((await dry({ type: "staff", ids: [] })).data.recipients.staff, 2);
  assert.equal((await dry({ type: "class", ids: [] })).status, 400, "لا بد من اختيار الشعبة");
  // العدد تغيّر بعد المعاينة: يُرفض
  const bad = await A.admin.post("/api/admin/announcements", { title: "رحلة الصف", target: { type: "class", ids: [A.c2.id] }, expected: 99 });
  assert.equal(bad.status, 409);
  const ok = await A.admin.post("/api/admin/announcements", { title: "رحلة الشعبة ب", target: { type: "class", ids: [A.c2.id] }, expected: 1 });
  assert.equal(ok.status, 201);
  const [s1] = A.students;   // في الشعبة أ
  const prof = (await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(s1))).data;
  assert.ok(!prof.announcements.some((a) => a.title === "رحلة الشعبة ب"), "لا يظهر لشعبة أخرى");
  // إعلان للمعلمين فقط: لا يظهر لأولياء الأمور، ويصل لمركز المعلم
  await A.admin.post("/api/admin/announcements", { title: "اجتماع المعلمين", target: { type: "teachers", ids: [] } });
  const prof2 = (await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(s1))).data;
  assert.ok(!prof2.announcements.some((a) => a.title === "اجتماع المعلمين"));
  assert.ok((await A.teacher.get("/api/teacher/announcements")).data.some((a) => a.title === "اجتماع المعلمين"));
  assert.ok((await A.teacher.get("/api/teacher/notifications")).data.items.some((n) => /اجتماع المعلمين/.test(n.title)));
  // رسالة (إشعار فقط) لطالب محدد: لا تُحفظ إعلانًا
  const before = (await A.admin.get("/api/admin/announcements")).data.length;
  const m = await A.admin.post("/api/admin/announcements", { title: "راجعنا بخصوص الزي", kind: "message", target: { type: "students", ids: [s1.id] } });
  assert.equal(m.status, 201);
  assert.equal(m.data.id, null);
  assert.equal((await A.admin.get("/api/admin/announcements")).data.length, before);
  assert.ok((await inbox(A, s1)).data.items.some((n) => n.kind === "message" && n.category === "messages"));
});

test("مركز الإشعارات: التصفية بالتصنيف وغير المقروء والبحث، والقراءة والأرشفة", async () => {
  const [s1] = A.students;
  const all = (await inbox(A, s1)).data;
  assert.ok(all.categories.some((c) => c.key === "attendance"));
  assert.ok(all.unread >= 2);
  const att = (await inbox(A, s1, { category: "attendance" })).data;
  assert.ok(att.items.length && att.items.every((n) => n.category === "attendance"));
  const found = (await inbox(A, s1, { q: "الزي" })).data;
  assert.equal(found.items.length, 1);
  const anon = client(srv.base);
  await anon.post(`/api/public/${A.id}/student/inbox/read`, { ...A.parent(s1), ids: [found.items[0].id] });
  const unread = (await inbox(A, s1, { unread: true })).data;
  assert.ok(!unread.items.some((n) => n.id === found.items[0].id));
  assert.equal((await anon.post(`/api/public/${A.id}/student/inbox/archive`, { ...A.parent(s1), ids: [found.items[0].id] })).data.archived, 1);
  assert.equal((await inbox(A, s1, { q: "الزي" })).data.items.length, 0, "المؤرشف لا يظهر");
  // ولي أمر طالب آخر لا يستطيع أرشفة إشعار ليس له
  const other = A.students[1];
  assert.equal((await anon.post(`/api/public/${A.id}/student/inbox/archive`, { ...A.parent(other), ids: [all.items[0].id] })).data.archived, 0);
  // المنسوب: نفس المركز
  const staff = (await A.admin.get("/api/admin/notifications?category=system")).data;
  assert.ok(staff.items.every((n) => n.category === "system"));
  assert.equal((await A.admin.put("/api/admin/notifications/prefs", { muted: ["system"] })).status, 200);
  assert.deepEqual((await A.admin.get("/api/admin/notifications/prefs")).data.muted, ["system"]);
  await A.admin.put("/api/admin/notifications/prefs", { muted: [] });
});

test("حد الإرسال: أكثر من الحد في الساعة لنفس المستلم يبقى في المركز ولا يزعج الجوال", async () => {
  const [{ id: uid }] = await transaction({ tenantId: A.id }, (q) => q("SELECT id FROM users WHERE role = 'teacher'"));
  assert.equal((await A.teacher.post("/api/teacher/notifications/push", sub("busy"))).status, 200);
  await transaction({ tenantId: A.id }, async (q) => {
    for (let i = 0; i < PUSH_HOURLY_LIMIT + 3; i++) {
      await notify(q, { event: "substitute", users: [uid], title: `حصة انتظار ${i}`, dedupKey: `rate-${i}` });
    }
  });
  const rows = await transaction({ tenantId: A.id }, (q) => q(`SELECT d.status, count(*)::int AS n FROM notification_deliveries d
    JOIN push_subscriptions p ON p.id = d.subscription_id WHERE p.endpoint LIKE '%/busy' GROUP BY 1`));
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  assert.equal(by.skipped, 3);
  assert.equal((await A.teacher.get("/api/teacher/notifications")).data.unread >= PUSH_HOURLY_LIMIT + 3, true, "كلها في المركز");
  await settle();
});

test("العزل بين المدارس: لا جهاز ولا سجل ولا إعلان يعبر من مدرسة لأخرى", async () => {
  const [b1] = B.students;
  await client(srv.base).post(`/api/public/${B.id}/student/push`, { ...B.parent(b1), subscription: sub("schoolB") });
  pushes.length = 0;
  await A.admin.post("/api/admin/announcements", { title: "إعلان مدرسة أ فقط", target: { type: "all", ids: [] } });
  await settle();
  assert.equal(pushesTo("schoolB").length, 0);
  const seen = await transaction({ tenantId: B.id }, (q) => q(`SELECT
    (SELECT count(*) FROM notification_deliveries)::int AS d, (SELECT count(*) FROM notifications WHERE title LIKE '%مدرسة أ%')::int AS n`));
  assert.deepEqual(seen[0], { d: 0, n: 0 });
  // معرّف طالب من مدرسة أ على مدرسة ب
  assert.equal((await client(srv.base).post(`/api/public/${B.id}/student/notify-prefs`, A.parent(A.students[0]))).status, 401);
  assert.equal((await B.admin.get("/api/admin/communication/notify/log")).data.items.length, 0);
});

test("أحداث جديدة: اعتماد الدرجات للإدارة والمعلم، وتغيّر الجدول مرة واحدة، والحضور لا يُرسل إلا إذا فعّلته المدرسة", async () => {
  const exr = await A.teacher.post("/api/teacher/exams", { class_id: A.c1.id, subject_id: A.math.id, title: "اختبار قصير", max_score: 10 });
  assert.equal(exr.status, 201, JSON.stringify(exr.data));
  const ex = exr.data;
  assert.equal((await A.teacher.put(`/api/teacher/exams/${ex.id}/scores`, { scores: { [A.students[0].id]: 9 } })).status, 200);
  assert.equal((await A.teacher.post(`/api/teacher/exams/${ex.id}/submit`, {})).status, 200);
  assert.ok((await A.admin.get("/api/admin/notifications?category=grades")).data.items.some((n) => n.kind === "grades_review"), "طلب اعتماد للإدارة");
  assert.equal((await A.admin.post(`/api/admin/exams/${ex.id}/status`, { status: "published" })).status, 200);
  assert.ok((await A.teacher.get("/api/teacher/notifications")).data.items.some((n) => /اعتُمدت/.test(n.title)), "المعلم عرف بالاعتماد");
  assert.ok((await inbox(A, A.students[0], { category: "grades" })).data.items.some((n) => /9 من 10/.test(n.body)), "ولي الأمر وصلته الدرجة");
  // تعديلات متتالية على جدول شعبة: إشعار واحد
  for (const period of [1, 2, 3]) {
    await A.admin.put("/api/admin/timetable/slot", { class_id: A.c1.id, day: 0, period, subject_id: A.math.id, teacher_id: A.teacherId });
  }
  const tt = (await inbox(A, A.students[0], { category: "timetable" })).data.items;
  assert.equal(tt.length, 1);
  assert.ok(tt[0].repeats >= 2);
  // الحضور: معطّل افتراضيًا
  await A.admin.post("/api/admin/attendance", { date: yesterday, entries: [{ student_id: A.students[3].id, status: "present" }] });
  assert.ok(!(await inbox(A, A.students[3])).data.items.some((n) => n.kind === "present"));
  await A.admin.put("/api/admin/communication/notify", { present: { push: true } });
  await A.admin.post("/api/admin/attendance", { date: today, entries: [{ student_id: A.students[3].id, status: "present" }] });
  assert.ok((await inbox(A, A.students[3])).data.items.some((n) => n.kind === "present"));
});
