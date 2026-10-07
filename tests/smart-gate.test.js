// بوابة مِدار الذكية (المرحلة الأولى): رابط الحارس ← موافقة الإدارة، بطاقة حضور مستقلة،
// حاضر/متأخر بالدقائق، لا تكرار، رفض ما هو خارج المدرسة أو الوقت، «لم يسجل حضور» ← اعتماد الغياب ← إشعار،
// المسح بعد انقطاع الاتصال، والعزل بين المدارس.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport, deliveriesIdle } from "../src/modules/shared/notify.service.js";
import { parseCode, gateTickTenant } from "../src/modules/shared/gate.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B;
const pushes = [];
const TZ = "Asia/Aden";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const hm = (d = new Date()) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const sub = (n) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });
const settle = async () => { await new Promise((r) => setTimeout(r, 150)); await deliveriesIdle(); };
const everyDay = (S) => transaction({ tenantId: S.id }, (q) => q(
  `INSERT INTO timetable_settings (tenant_id, days) VALUES (app_tenant(), '{0,1,2,3,4,5,6}')
   ON CONFLICT (tenant_id) DO UPDATE SET days = EXCLUDED.days`));
const OPEN = { open_at: "00:00", late_after: "23:58", close_at: "23:59" };       // الآن: حاضر
const LATE = { open_at: "00:00", late_after: "00:00", close_at: "23:59" };       // الآن: متأخر
const CLOSED = { open_at: "00:00", late_after: "00:00", close_at: "00:01" };     // الآن: انتهى الوقت

/** جهاز بوابة: يفتح الرابط الذي أرسلته الإدارة، ثم يمسح */
function gateDevice(base, link) {
  const u = new URL(link);
  const school = u.pathname.split("/")[1];
  const [pid, code] = u.hash.replace("#p=", "").split(".");
  let secret = null;
  const call = async (path, body) => {
    const res = await fetch(`${base}/api/gate/${school}/${path}`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Gate-Device": pid, ...(secret ? { "X-Gate-Secret": secret } : {}) },
      body: JSON.stringify(body || {}) });
    let data = null; try { data = await res.json(); } catch { /* */ }
    return { status: res.status, data };
  };
  return {
    pid, school,
    pair: async () => { const r = await call("pair", { device: pid, code, info: { ua: "test-phone" } }); if (r.status === 200) secret = r.data.secret; return r; },
    status: () => call("status", { client_ts: Date.now() }),
    scan: (c, extra = {}) => call("scan", { event_id: crypto.randomUUID(), code: c, ...extra }),
    events: (events) => call("events", { events }),
    raw: call,
    setSecret: (s) => { secret = s; },
    get secret() { return secret; },
  };
}
const cards = async (S, q) => (await S.admin.get(`/api/admin/attendance/gate/cards?${q}`)).data;
const setWin = (S, w) => S.admin.put("/api/admin/attendance/gate/settings", w);

let gA, cardA, cardB;
before(async () => {
  srv = await startServer();
  setTransport({ push: async (s, p) => { pushes.push({ endpoint: s.endpoint, ...p }); return { statusCode: 201 }; }, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "sg", students: 4 });
  B = await readySchool(srv.base, { prefix: "sh", students: 1 });
  await everyDay(A); await everyDay(B);
  await transaction({ tenantId: A.id }, (q) => q("UPDATE academic_years SET start_date = CURRENT_DATE - 100, end_date = CURRENT_DATE + 100 WHERE is_current"));
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("بطاقة الحضور: رمز عشوائي مستقل عن معرّف ولي الأمر، ورابطها لا يكشف شيئًا", async () => {
  const c = await cards(A, `class_id=${A.c1.id}`);
  assert.equal(c.cards.length, 4);
  cardA = new Map(c.cards.map((x) => [x.id, x.qr]));
  for (const x of c.cards) {
    assert.match(x.qr, new RegExp(`/q/${A.id}/A1[0-9A-Z]{26}$`));
    assert.ok(!x.qr.includes(A.students.find((s) => s.id === x.id).access_key));
  }
  assert.equal(new Set(c.cards.map((x) => x.qr)).size, 4);
  // نفس البطاقة في كل مرة تُطبع (لا تتغير إلا بإعادة الإصدار)
  assert.equal((await cards(A, `student_id=${A.students[0].id}`)).cards[0].qr, cardA.get(A.students[0].id));
  cardB = (await cards(B, `class_id=${B.c1.id}`)).cards[0].qr;
  // في القاعدة: بصمة ونسخة مشفرة فقط، لا الرمز نفسه
  const tok = cardA.get(A.students[0].id).split("/").pop();
  const [row] = await transaction({ tenantId: A.id }, (q) => q("SELECT token_enc, encode(token_hash, 'hex') AS h FROM attendance_credentials WHERE student_id = $1 AND status = 'active'", [A.students[0].id]));
  assert.ok(!row.token_enc.includes(tok));
  assert.equal(row.h, crypto.createHash("sha256").update(tok).digest("hex"));
  const page = await fetch(cardA.get(A.students[0].id).replace(/^https?:\/\/[^/]+/, srv.base));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(!html.includes(A.students[0].full_name || "أحمد علي سالم"));
  // قراءة الرمز
  assert.deepEqual(parseCode(`https://x.app/q/${A.id}/${tok}`, A.id), { token: tok });
  assert.deepEqual(parseCode(tok.toLowerCase(), A.id), { token: tok });
  assert.deepEqual(parseCode(`https://x.app/q/other-school/${tok}`, A.id), { error: "other_school" });
  assert.deepEqual(parseCode(`https://x.app/${A.id}?k=AB23-CD45`, A.id), { legacy: "AB23-CD45" });
  assert.deepEqual(parseCode("hello world", A.id), { error: "bad_format" });
});

test("جهاز الحارس: رابط من الإدارة ← بانتظار الموافقة (لا يمسح) ← موافقة ← يمسح. الرابط لمرة واحدة", async () => {
  const r = await A.admin.post("/api/admin/attendance/gate/devices", { name: "جوال الحارس" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.link, new RegExp(`/${A.id}/gate#p=`));
  gA = gateDevice(srv.base, r.data.link);
  assert.equal((await gA.pair()).status, 200);
  assert.equal((await gA.status()).data.status, "pending");
  // فتح الرابط مرة ثانية (جوال آخر): مرفوض
  const thief = gateDevice(srv.base, r.data.link);
  assert.equal((await thief.pair()).status, 401);
  await setWin(A, OPEN);
  const s1 = A.students[0];
  assert.equal((await gA.scan(cardA.get(s1.id))).status, 403, "قبل الموافقة لا مسح");
  // الإدارة تشوف الجهاز بانتظار الموافقة
  const devs = (await A.admin.get("/api/admin/attendance/gate/devices")).data;
  const d = devs.find((x) => x.public_id === gA.pid);
  assert.equal(d.status, "pending");
  assert.equal(d.gate_name, "البوابة الرئيسية");
  assert.equal((await A.admin.post(`/api/admin/attendance/gate/devices/${d.id}/approve`)).status, 200);
  const st = (await gA.status()).data;
  assert.equal(st.status, "active");
  assert.equal(st.phase, "open");
  assert.ok(Math.abs(st.server_time - Date.now()) < 5000);
  // سر خاطئ
  const fake = gateDevice(srv.base, r.data.link);
  fake.setSecret("x".repeat(43));
  assert.equal((await fake.scan(cardA.get(s1.id))).status, 401);
});

test("المسح قبل وقت التأخر: حاضر + إشعار «وصل المدرسة»، والمسح الثاني والإعادة بنفس الهوية لا يكرران", async () => {
  const s1 = A.students[0];
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/student/push`, { ...A.parent(s1), subscription: sub("sg1") })).status, 200);
  const ev = { event_id: crypto.randomUUID(), code: cardA.get(s1.id) };
  const r = await gA.raw("scan", ev);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.result, "present");
  assert.equal(r.data.student.id, s1.id);
  assert.equal(r.data.status, "present");
  const replay = await gA.raw("scan", ev);
  assert.equal(replay.data.replay, true);
  assert.equal(replay.data.result, "present");
  const again = await gA.scan(cardA.get(s1.id));
  assert.equal(again.data.result, "duplicate");
  await settle();
  const p = pushes.filter((x) => x.endpoint.endsWith("/sg1"));
  assert.equal(p.length, 1, "إشعار واحد فقط");
  assert.match(p[0].title, /وصل .* المدرسة/);
  assert.match(p[0].body, /البوابة الرئيسية/);
  const [row] = await transaction({ tenantId: A.id }, (q) => q("SELECT status, source, gate_id, device_id, first_in_at FROM attendance WHERE student_id = $1 AND day = $2", [s1.id, today()]));
  assert.equal(row.source, "gate");
  assert.ok(row.gate_id && row.device_id && row.first_in_at);
  const [{ n }] = await transaction({ tenantId: A.id }, (q) => q("SELECT count(*)::int AS n FROM attendance_events WHERE student_id = $1", [s1.id]));
  assert.equal(n, 2, "المسح الإضافي يُحفظ حدثًا");
});

test("بعد وقت التأخر: متأخر بعدد الدقائق، ومن سجّله المعلم غائبًا ثم وصل يتحول لمتأخر ويُدقَّق", async () => {
  const [, s2] = A.students;
  await setWin(A, LATE);
  assert.equal((await A.teacher.post("/api/teacher/attendance", { date: today(), entries: [{ student_id: s2.id, status: "absent" }] })).status, 200);
  const r = await gA.scan(cardA.get(s2.id));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  if (hm() > "00:00") {
    assert.equal(r.data.result, "late");
    const [h, m] = hm().split(":").map(Number);
    assert.ok(Math.abs(r.data.minutes_late - (h * 60 + m)) <= 1);
  }
  const audit = (await A.admin.get(`/api/admin/attendance/gate/audit?student_id=${s2.id}`)).data;
  assert.equal(audit[0].old_status, "absent");
  assert.equal(audit[0].new_source, "gate");
});

test("الرفض: بطاقة مدرسة أخرى، رمز ملغى (مشبوه)، بطاقة ولي الأمر القديمة، طالب غير مقيد — والحدث يُحفظ", async () => {
  await setWin(A, OPEN);
  const [, , s3, s4] = A.students;
  const cross = await gA.scan(cardB);
  assert.equal(cross.data.result, "rejected");
  assert.equal(cross.data.reason, "other_school");
  // رمز مدرسة ب بدون رابط: غير معروف هنا (العزل)
  assert.equal((await gA.scan(cardB.split("/").pop())).data.reason, "unknown_token");
  // إعادة إصدار: البطاقة القديمة ملغاة ومشبوهة
  const old = cardA.get(s3.id);
  assert.equal((await A.admin.post(`/api/admin/attendance/gate/students/${s3.id}/token/reissue`, { reason: "فُقدت" })).status, 200);
  const rv = await gA.scan(old);
  assert.equal(rv.data.reason, "revoked_token");
  assert.equal(rv.data.suspicious, "revoked_card");
  const fresh = (await cards(A, `student_id=${s3.id}`)).cards[0];
  assert.notEqual(fresh.qr, old);
  assert.equal(fresh.version, 2);
  assert.equal((await gA.scan(fresh.qr)).data.result, "present");
  // بطاقة ولي الأمر القديمة (access_key): مغلقة افتراضيًا، وتُفتح فقط للفترة الانتقالية
  const legacy = `${srv.base}/${A.id}?k=${s4.access_key}`;
  assert.equal((await gA.scan(legacy)).data.reason, "legacy_disabled");
  // طالب منسحب
  await transaction({ tenantId: A.id }, (q) => q("UPDATE students SET status = 'withdrawn' WHERE id = $1", [s4.id]));
  assert.equal((await gA.scan(cardA.get(s4.id))).data.reason, "student_inactive");
  await transaction({ tenantId: A.id }, (q) => q("UPDATE students SET status = 'active' WHERE id = $1", [s4.id]));
  const sus = (await A.admin.get(`/api/admin/attendance/gate/suspicious?date=${today()}`)).data;
  assert.ok(sus.some((e) => e.suspicious === "revoked_card"));
  assert.equal((await A.admin.post(`/api/admin/attendance/gate/suspicious/${sus[0].id}`, { state: "dismissed" })).status, 200);
});

test("نفس البطاقة من بوابتين خلال ثوانٍ: الثانية مشبوهة", async () => {
  const g2 = (await A.admin.post("/api/admin/attendance/gate/gates", { name: "البوابة الشرقية" })).data;
  const r = await A.admin.post("/api/admin/attendance/gate/devices", { name: "تابلت الشرقية", gate_id: g2.id });
  const dev2 = gateDevice(srv.base, r.data.link);
  await dev2.pair();
  const id = (await A.admin.get("/api/admin/attendance/gate/devices")).data.find((x) => x.public_id === dev2.pid).id;
  await A.admin.post(`/api/admin/attendance/gate/devices/${id}/approve`);
  const s1 = A.students[0];
  const x = await dev2.scan(cardA.get(s1.id));
  assert.equal(x.data.result, "duplicate");
  assert.equal(x.data.suspicious, "two_gates");
  // إيقاف الجهاز: يرفض فورًا
  assert.equal((await A.admin.post(`/api/admin/attendance/gate/devices/${id}/disable`)).status, 200);
  assert.equal((await dev2.scan(cardA.get(s1.id))).status, 403);
  assert.equal((await A.admin.post(`/api/admin/attendance/gate/devices/${id}/revoke`)).status, 200);
  assert.equal((await dev2.status()).status, 401);
});

test("المسح بعد انقطاع الاتصال: يُقبل بوقته المصحح ويُعلَّم، وإعادة الدفعة لا تكرر، والوقت المستقبلي مرفوض", async () => {
  const [, , , s4] = A.students;
  await setWin(A, OPEN);
  const ev = { event_id: crypto.randomUUID(), code: cardA.get(s4.id), offline: true, client_ts: Date.now() - 60_000, skew_ms: 0 };
  const future = { event_id: crypto.randomUUID(), code: cardA.get(s4.id), offline: true, client_ts: Date.now() + 3600_000, skew_ms: 0 };
  const r = await gA.events([ev, future, ev]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const [a, b, c] = r.data.results;
  assert.equal(a.result, "present");
  assert.equal(a.offline, true);
  assert.equal(b.reason, "clock_invalid");
  assert.equal(c.replay, true);
  const again = await gA.events([ev]);
  assert.equal(again.data.results[0].replay, true);
  const [row] = await transaction({ tenantId: A.id }, (q) => q("SELECT offline FROM attendance WHERE student_id = $1 AND day = $2", [s4.id, today()]));
  assert.equal(row.offline, true);
});

test("العزل: جهاز مدرسة أ لا يعمل برابط مدرسة ب، ومدير ب لا يرى أجهزة أ ولا يوافق عليها", async () => {
  const res = await fetch(`${srv.base}/api/gate/${B.id}/scan`, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Gate-Device": gA.pid, "X-Gate-Secret": gA.secret },
    body: JSON.stringify({ event_id: crypto.randomUUID(), code: cardB }) });
  assert.equal(res.status, 401);
  assert.equal((await B.admin.get("/api/admin/attendance/gate/devices")).data.length, 0);
  const id = (await A.admin.get("/api/admin/attendance/gate/devices")).data[0].id;
  assert.equal((await B.admin.post(`/api/admin/attendance/gate/devices/${id}/disable`)).status, 409);
  assert.equal((await A.teacher.get("/api/admin/attendance/gate/devices")).status, 401);
});

test("بعد الإغلاق: «لم يسجل حضور» بلا غياب ولا إشعار ← استثناءات ← اعتماد ← إشعار الغياب مرة واحدة", async () => {
  // طالب خامس لم يمسح، وطالب سادس في رحلة
  const s5 = (await A.admin.post("/api/admin/students", { name: "خالد سالم علي", class_id: A.c1.id, guardian_phone: "771234999" })).data;
  const s6 = (await A.admin.post("/api/admin/students", { name: "ناصر عمر خالد", class_id: A.c1.id, guardian_phone: "771234998" })).data;
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/student/push`, { ...A.parent(s5), subscription: sub("sg5") })).status, 200);
  await setWin(A, { ...CLOSED, absence_notify_at: "00:00" });
  if (hm() <= "00:01") return;   // الاختبار يحتاج أن يكون الوقت بعد الإغلاق
  // المسح بعد الإغلاق مرفوض
  assert.equal((await gA.scan((await cards(A, `student_id=${s5.id}`)).cards[0].qr)).data.reason, "outside_window");
  const sum = (await A.admin.get(`/api/admin/attendance/gate/summary?date=${today()}`)).data;
  assert.equal(sum.phase, "closed");
  const un = (await A.admin.get(`/api/admin/attendance/gate/unrecorded?date=${today()}`)).data;
  assert.deepEqual(un.map((x) => x.id).sort(), [s5.id, s6.id].sort());
  assert.equal(un.find((x) => x.id === s5.id).last_rejected, "outside_window");
  // لا غياب ولا إشعار قبل الاعتماد (حتى بعد المهمة الدورية: تنبه الإدارة فقط)
  await transaction({ tenantId: A.id }, gateTickTenant);
  await settle();
  assert.equal(pushes.filter((x) => x.endpoint.endsWith("/sg5")).length, 0);
  const [{ n }] = await transaction({ tenantId: A.id }, (q) => q("SELECT count(*)::int AS n FROM attendance WHERE day = $1 AND status = 'absent' AND student_id = $2", [today(), s5.id]));
  assert.equal(n, 0);
  const inbox = (await A.admin.get("/api/admin/notifications")).data;
  assert.ok(JSON.stringify(inbox).includes("لم يسجل حضور"), "تنبيه المراجعة للإدارة");
  // استثناء: رحلة (بسبب إلزامي)
  assert.equal((await A.admin.post("/api/admin/attendance/gate/exceptions", { date: today(), status: "trip", student_ids: [s6.id] })).status, 400);
  assert.equal((await A.admin.post("/api/admin/attendance/gate/exceptions", { date: today(), status: "trip", reason: "رحلة الشعبة", student_ids: [s6.id] })).status, 200);
  const fin = await A.admin.post("/api/admin/attendance/gate/finalize", { date: today() });
  assert.equal(fin.status, 200, JSON.stringify(fin.data));
  assert.equal(fin.data.absent, 1);
  assert.equal(fin.data.notified, 1);
  await settle();
  const p = pushes.filter((x) => x.endpoint.endsWith("/sg5"));
  assert.equal(p.length, 1);
  assert.match(p[0].title, /غياب/);
  assert.equal((await A.admin.post("/api/admin/attendance/gate/finalize", { date: today() })).status, 409);
  await transaction({ tenantId: A.id }, gateTickTenant);
  await settle();
  assert.equal(pushes.filter((x) => x.endpoint.endsWith("/sg5")).length, 1, "لا تكرار");
  const after = (await A.admin.get(`/api/admin/attendance/gate/summary?date=${today()}`)).data;
  assert.equal(after.phase, "finalized");
  assert.equal(after.counts.unrecorded, 0);
});

test("يوم بلا حضور (يوم استثنائي): المسح مرفوض", async () => {
  const d = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: TZ });
  assert.equal((await B.admin.put("/api/admin/attendance/gate/day-mode", { date: d, mode: "custom_hours", open_at: "08:00", late_after: "07:00", close_at: "09:00" })).status, 400);
  assert.equal((await B.admin.put("/api/admin/attendance/gate/day-mode", { date: today(), mode: "no_attendance", note: "يوم مفتوح" })).status, 200);
  await setWin(B, OPEN);
  const r = await B.admin.post("/api/admin/attendance/gate/devices", { name: "جوال" });
  const dev = gateDevice(srv.base, r.data.link);
  await dev.pair();
  const id = (await B.admin.get("/api/admin/attendance/gate/devices")).data[0].id;
  await B.admin.post(`/api/admin/attendance/gate/devices/${id}/approve`);
  assert.equal((await dev.status()).data.phase, "no_school");
  assert.equal((await dev.scan(cardB)).data.reason, "no_school_day");
  // الإعدادات تتحقق من ترتيب الأوقات
  assert.equal((await setWin(B, { open_at: "08:00", late_after: "07:00", close_at: "09:00" })).status, 400);
});
