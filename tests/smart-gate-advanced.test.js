// بوابة مِدار الذكية (المراحل 2–4): قائمة الجهاز للعمل بلا اتصال، الحماية بالشبكة والموقع، الانصراف،
// أوقات المراحل، السجلات بالتصفية، صلاحيات المعلم، تنبيه انقطاع الجهاز، NFC، والأداء (500 طالب).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport, deliveriesIdle } from "../src/modules/shared/notify.service.js";
import { gateTickTenant, ensureTokens } from "../src/modules/shared/gate.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, L;
const pushes = [];
const TZ = "Asia/Aden";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const hm = () => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const sub = (n) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });
const settle = async () => { await new Promise((r) => setTimeout(r, 150)); await deliveriesIdle(); };
const prep = (S) => transaction({ tenantId: S.id }, async (q) => {
  await q(`INSERT INTO timetable_settings (tenant_id, days) VALUES (app_tenant(), '{0,1,2,3,4,5,6}')
           ON CONFLICT (tenant_id) DO UPDATE SET days = EXCLUDED.days`);
  await q("UPDATE academic_years SET start_date = CURRENT_DATE - 100, end_date = CURRENT_DATE + 100 WHERE is_current");
});
const OPEN = { open_at: "00:00", late_after: "23:58", close_at: "23:59" };
const G = "/api/admin/attendance/gate";

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
    pid,
    pair: async () => { const r = await call("pair", { device: pid, code }); secret = r.data?.secret; return r; },
    status: (b = {}) => call("status", { client_ts: Date.now(), ...b }),
    scan: (c, extra = {}) => call("scan", { event_id: crypto.randomUUID(), code: c, ...extra }),
    roster: () => call("roster", {}),
    raw: call,
  };
}
async function activeDevice(S, name, gateId) {
  const r = await S.admin.post(`${G}/devices`, { name, ...(gateId ? { gate_id: gateId } : {}) });
  const dev = gateDevice(srv.base, r.data.link);
  await dev.pair();
  const id = (await S.admin.get(`${G}/devices`)).data.find((x) => x.public_id === dev.pid).id;
  await S.admin.post(`${G}/devices/${id}/approve`);
  dev.id = id;
  return dev;
}
const cardsOf = async (S, cls) => new Map((await S.admin.get(`${G}/cards?class_id=${cls}`)).data.cards.map((c) => [c.id, c.qr]));

let dev, cards, gateId;
before(async () => {
  srv = await startServer();
  setTransport({ push: async (s, p) => { pushes.push({ endpoint: s.endpoint, ...p }); return { statusCode: 201 }; }, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "sa", students: 4 });
  L = await readySchool(srv.base, { prefix: "sl", students: 1 });
  await prep(A); await prep(L);
  await A.admin.put(`${G}/settings`, OPEN);
  dev = await activeDevice(A, "جوال الحارس");
  gateId = (await A.admin.get(`${G}/gates`)).data[0].id;
  cards = await cardsOf(A, A.c1.id);
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("قائمة الجهاز: بصمات الرموز والاسم والشعبة فقط، وتتغير نسختها عند إعادة إصدار بطاقة", async () => {
  const r = await dev.roster();
  assert.equal(r.status, 200);
  assert.equal(r.data.students.length, 4);
  const [s1] = A.students;
  const tok = cards.get(s1.id).split("/").pop();
  const row = r.data.students.find((x) => x.sid === s1.id);
  assert.equal(row.h, crypto.createHash("sha256").update(tok).digest("hex"));
  assert.deepEqual(Object.keys(row).sort(), ["cls", "h", "name", "sid", "stage"]);
  assert.ok(!JSON.stringify(r.data).includes(tok), "الرمز نفسه لا يصل للجهاز");
  const v1 = (await dev.status()).data.roster_version;
  assert.equal(v1, r.data.version);
  await A.admin.post(`${G}/students/${A.students[3].id}/token/reissue`, { reason: "اختبار" });
  assert.notEqual((await dev.status()).data.roster_version, v1);
  cards = await cardsOf(A, A.c1.id);
});

test("الحماية بالشبكة: «رفض» يرفض المسح من خارج شبكة المدرسة، و«تعليم» يقبله مشبوهًا، والعنوان الخاطئ مرفوض", async () => {
  assert.equal((await A.admin.put(`${G}/settings`, { allowed_networks: "abc" })).status, 400);
  assert.equal((await A.admin.put(`${G}/settings`, { location_mode: "block", allowed_networks: "10.9.9.0/24" })).status, 200);
  const [s1] = A.students;
  const r = await dev.scan(cards.get(s1.id));
  assert.equal(r.data.reason, "outside_network");
  await A.admin.put(`${G}/settings`, { location_mode: "flag" });
  const f = await dev.scan(cards.get(s1.id));
  assert.equal(f.data.result, "present");
  assert.equal(f.data.suspicious, "outside_network");
  // شبكة الاختبار نفسها مسموحة: لا اشتباه
  await A.admin.put(`${G}/settings`, { allowed_networks: "127.0.0.0/8, ::1" });
  assert.equal((await dev.scan(cards.get(s1.id))).data.suspicious, null);
});

test("الحماية بالموقع: جهاز بعيد عن البوابة يظهر للإدارة ويُعلَّم مسحه", async () => {
  assert.equal((await A.admin.patch(`${G}/gates/${gateId}`, { name: "البوابة الرئيسية", geo: { lat: 12.8, lng: 45.03, radius_m: 200 } })).status, 200);
  const far = await dev.status({ geo: { lat: 12.9, lng: 45.2, accuracy: 20 } });
  assert.equal(far.data.want_location, true);
  assert.match(far.data.place_warning, /بعيد/);
  const [, s2] = A.students;
  assert.equal((await dev.scan(cards.get(s2.id))).data.suspicious, "outside_geofence");
  const d = (await A.admin.get(`${G}/devices`)).data.find((x) => x.id === dev.id);
  assert.equal(d.outside, true);
  assert.ok(d.distance_m > 10000);
  // عاد للمدرسة
  assert.equal((await dev.status({ geo: { lat: 12.8001, lng: 45.0301, accuracy: 15 } })).data.place_warning, null);
  await A.admin.put(`${G}/settings`, { location_mode: "off", allowed_networks: "" });
});

test("الانصراف: بوابة «دخول وانصراف»، إشعار ولي الأمر، ولا انصراف لمن لم يحضر", async () => {
  await A.admin.patch(`${G}/gates/${gateId}`, { name: "البوابة الرئيسية", direction: "both", geo: null });
  await A.admin.put(`${G}/settings`, { notify_departure: true });
  const [s1, , s3] = A.students;
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/student/push`, { ...A.parent(s1), subscription: sub("sa1") })).status, 200);
  assert.equal((await dev.status()).data.direction, "both");
  const out = await dev.scan(cards.get(s1.id), { direction: "out" });
  assert.equal(out.data.result, "departed");
  assert.equal(out.data.direction, "out");
  assert.equal((await dev.scan(cards.get(s1.id), { direction: "out" })).data.result, "duplicate");
  assert.equal((await dev.scan(cards.get(s3.id), { direction: "out" })).data.reason, "no_arrival");
  await settle();
  assert.ok(pushes.some((p) => p.endpoint.endsWith("/sa1") && /انصرف/.test(p.title)));
  const rec = (await A.admin.get(`${G}/records?date=${today()}&q=${encodeURIComponent(s1.full_name || "أحمد")}`)).data;
  assert.ok(rec[0].out_time);
  const sum = (await A.admin.get(`${G}/summary?date=${today()}`)).data;
  assert.equal(sum.counts.departed, 1);
  await A.admin.patch(`${G}/gates/${gateId}`, { name: "البوابة الرئيسية", direction: "in" });
});

test("أوقات خاصة لمرحلة: يُحسب طالبها متأخرًا بأوقاتها لا بالأوقات العامة", async () => {
  if (hm() <= "00:01") return;
  const [, , s3] = A.students;
  const [{ stage_id }] = await transaction({ tenantId: A.id }, (q) => q(
    "SELECT gr.stage_id FROM students s JOIN classes c ON c.id = s.class_id JOIN grades gr ON gr.id = c.grade_id WHERE s.id = $1", [s3.id]));
  assert.equal((await A.admin.put(`${G}/stage-hours`, { stage_id, open_at: "08:00", late_after: "07:00", close_at: "09:00" })).status, 400);
  assert.equal((await A.admin.put(`${G}/stage-hours`, { stage_id, open_at: "00:00", late_after: "00:00", close_at: "23:59" })).status, 200);
  const r = await dev.scan(cards.get(s3.id));
  assert.equal(r.data.result, "late");
  assert.ok(r.data.minutes_late > 0);
  const roster = (await dev.roster()).data;
  assert.equal(roster.stage_hours.length, 1);
  assert.equal((await A.admin.del(`${G}/stage-hours/${stage_id}`)).status, 200);
});

test("السجلات بالتصفية: الحالة والمصدر ولم يسجل والاسم", async () => {
  const all = (await A.admin.get(`${G}/records?date=${today()}`)).data;
  assert.equal(all.length, 4);
  const un = (await A.admin.get(`${G}/records?date=${today()}&status=unrecorded`)).data;
  assert.equal(un.length, all.filter((r) => !r.status).length);
  const gate = (await A.admin.get(`${G}/records?date=${today()}&source=gate&gate_id=${gateId}`)).data;
  assert.ok(gate.length >= 2 && gate.every((r) => r.source === "gate" && r.in_time));
  assert.equal((await A.admin.get(`${G}/records?date=${today()}&status=bogus`)).status, 400);
  const f = (await A.admin.get(`${G}/filters`)).data;
  assert.ok(f.stages.length && f.grades.length && f.classes.length && f.gates.length);
});

test("المعلم: يرى وقت البوابة، ولا يعدّل سجل البوابة إن منعته المدرسة، ويضيف عذرًا", async () => {
  const [s1, , , s4] = A.students;
  const list = (await A.teacher.get(`/api/teacher/attendance?class_id=${A.c1.id}&date=${today()}`)).data;
  assert.ok(list.find((x) => x.id === s1.id).first_in_at);
  await A.admin.put(`${G}/settings`, { teacher_can_edit: false });
  const no = await A.teacher.post("/api/teacher/attendance", { date: today(), reason: "خطأ", entries: [{ student_id: s1.id, status: "absent" }] });
  assert.equal(no.status, 403);
  // طالب لم يسجله أحد: المعلم يسجله عاديًا
  assert.equal((await A.teacher.post("/api/teacher/attendance", { date: today(), entries: [{ student_id: s4.id, status: "absent" }] })).status, 200);
  assert.equal((await A.teacher.patch("/api/teacher/attendance/excuse", { student_id: s4.id, date: today(), excuse: "مريض" })).status, 200);
  await A.admin.put(`${G}/settings`, { teacher_can_excuse: false });
  assert.equal((await A.teacher.patch("/api/teacher/attendance/excuse", { student_id: s4.id, date: today(), excuse: "x" })).status, 403);
  await A.admin.put(`${G}/settings`, { teacher_can_edit: true, teacher_can_excuse: true });
  const ok = await A.teacher.post("/api/teacher/attendance", { date: today(), reason: "خرج مبكرًا", entries: [{ student_id: s1.id, status: "excused" }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const audit = (await A.admin.get(`${G}/audit?student_id=${s1.id}`)).data;
  assert.equal(audit[0].new_source, "teacher");
});

test("انقطاع جهاز البوابة أثناء الحضور: تنبيه الإدارة مرة واحدة", async () => {
  await transaction({ tenantId: A.id }, (q) => q("UPDATE gate_devices SET last_seen_at = now() - interval '30 minutes' WHERE id = $1", [dev.id]));
  const r1 = await transaction({ tenantId: A.id }, gateTickTenant);
  assert.equal(r1.offline_devices, 1);
  const r2 = await transaction({ tenantId: A.id }, gateTickTenant);
  assert.equal(r2.offline_devices, undefined, "مرة واحدة لليوم");
  const box = JSON.stringify((await A.admin.get("/api/admin/notifications")).data);
  assert.ok(box.includes("غير متصل"));
});

test("NFC: نفس الرمز من شريحة يُسجَّل ونوع الحدث nfc", async () => {
  const s = (await A.admin.post("/api/admin/students", { name: "طالب الشريحة", class_id: A.c1.id, guardian_phone: "771230001" })).data;
  const qr = (await A.admin.get(`${G}/cards?student_id=${s.id}`)).data.cards[0].qr;
  const r = await dev.scan(qr, { source: "nfc" });
  assert.equal(r.data.result, "present");
  const [ev] = await transaction({ tenantId: A.id }, (q) => q("SELECT kind FROM attendance_events WHERE student_id = $1", [s.id]));
  assert.equal(ev.kind, "nfc");
});

test("الأداء: 500 طالب عبر 3 أجهزة (مع 10% مسح مكرر): 500 سجل بالضبط بلا خطأ، وزمن الرد مقبول", async () => {
  await L.admin.put(`${G}/settings`, OPEN);
  const cls = L.c1.id;
  await transaction({ tenantId: L.id }, async (q) => {
    await q(`INSERT INTO students (tenant_id, full_name, class_id, access_key, guardian_phone)
             SELECT app_tenant(), 'طالب ' || g, $1,
                    translate(upper(substr(md5(g::text || 'a'), 1, 4)), '01', 'AB') || '-' || translate(upper(substr(md5(g::text || 'b'), 1, 4)), '01', 'AB'),
                    '77' || (1000000 + g)
               FROM generate_series(1, 499) g`, [cls]);
    await ensureTokens(q);
  });
  const all = [...(await cardsOf(L, cls)).values()];
  assert.equal(all.length, 500);
  const devs = [await activeDevice(L, "جهاز 1"), await activeDevice(L, "جهاز 2"), await activeDevice(L, "جهاز 3")];
  const work = [...all, ...all.slice(0, 50)];
  const times = [];
  let errors = 0, i = 0;
  const worker = async (w) => {
    while (i < work.length) {
      const code = work[i++];
      const t = performance.now();
      const r = await devs[w % 3].scan(code);
      times.push(performance.now() - t);
      if (r.status !== 200 || !["present", "late", "duplicate"].includes(r.data.result)) errors++;
    }
  };
  await Promise.all(Array.from({ length: 12 }, (_, w) => worker(w)));
  const [{ n }] = await transaction({ tenantId: L.id }, (q) => q("SELECT count(*)::int AS n FROM attendance WHERE day = $1", [today()]));
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(`# 550 مسح: p50=${times[Math.floor(times.length / 2)].toFixed(0)}ms p95=${p95.toFixed(0)}ms`);
  assert.equal(errors, 0);
  assert.equal(n, 500);
  assert.ok(p95 < 1500, `p95 = ${p95}`);
});
