/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, endPool, uid, readySchool } from "./helpers.js";
import { transaction } from "../src/core/db/pool.js";
import * as Q from "../src/modules/shared/quran-data.js";

let srv, S, other, teacher2;
const A = "/api/admin/quran", T = "/api/teacher/quran";
const today = new Date().toISOString().slice(0, 10);

before(async () => {
  srv = await startServer();
  S = await readySchool(srv.base, { prefix: "qr", name: "مدرسة النور لتحفيظ القرآن", students: 4 });
  other = await readySchool(srv.base, { prefix: "qo", name: "مدرسة أخرى", students: 1 });
  // A school becomes a Quran school with its type's sections (the Quran circles among them).
  const ch = await S.owner.patch(`/api/owner/tenants/${S.id}/org-type`, { org_type_key: "quran_school", apply_sections: true });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  const t2 = await S.admin.post("/api/admin/teachers", { name: "أ. ياسر عمر", username: `tq${uid()}`, load: [] });
  teacher2 = client(srv.base);
  await teacher2.post("/api/staff/login", { school: S.id, username: t2.data.credentials.username, password: t2.data.credentials.password });
  await transaction({ tenantId: S.id }, (q) => q("UPDATE users SET must_change_password = false WHERE role = 'teacher'"));
  S.teacher2Id = t2.data.id;
});
after(async () => { await srv.close(); await endPool(); });

test("بيانات المصحف: 114 سورة و6236 آية، والأجزاء متتالية بأحجامها", () => {
  assert.equal(Q.SURAHS.length, 114);
  assert.equal(Q.TOTAL_AYAT, 6236);
  const sizes = Array.from({ length: 30 }, (_, k) => { const [a, b] = Q.juzRange(k + 1); return b - a + 1; });
  assert.equal(sizes.reduce((a, b) => a + b, 0), 6236);
  assert.equal(sizes[0], 148); assert.equal(sizes[29], 564);
  assert.deepEqual(Q.ayahAt(Q.indexOf(2, 255)), [2, 255]);
  assert.deepEqual(Q.merge([[10, 20], [1, 5], [6, 9], [30, 40], [35, 50]]), [[1, 20], [30, 50]]);
});

test("القسم موقوف في المدرسة العادية، ويعمل بعد تحويلها لمدرسة تحفيظ", async () => {
  assert.equal((await other.admin.get(`${A}/meta`)).status, 404);
  const meta = (await S.admin.get(`${A}/meta`)).data;
  assert.equal(meta.surahs.length, 114);
  assert.equal((await S.admin.get("/api/admin/me")).data.modules.quran, true);
});

test("الحلقات والمستويات والأعضاء والسجل والتقدم والشهادة وولي الأمر", async () => {
  const [s1, s2, s3, s4] = S.students;
  const lvl = await S.admin.post(`${A}/levels`, { name: "المستوى الأول", description: "جزء عمّ", sort: 1 });
  assert.equal(lvl.status, 201, JSON.stringify(lvl.data));
  assert.equal((await S.admin.post(`${A}/levels`, { name: "المستوى الأول" })).status, 409);
  const h1 = (await S.admin.post(`${A}/halaqat`, { name: "حلقة أبي بكر", teacher_id: S.teacherId, level_id: lvl.data.id, schedule: "بعد العصر", capacity: 3 })).data;
  const h2 = (await S.admin.post(`${A}/halaqat`, { name: "حلقة عمر", teacher_id: S.teacher2Id })).data;
  assert.equal((await S.admin.post(`${A}/halaqat/${h1.id}/members`, { student_ids: [s1.id, s2.id, s3.id, s4.id] })).status, 400, "السعة 3");
  const add = await S.admin.post(`${A}/halaqat/${h1.id}/members`, { student_ids: [s1.id, s2.id, s3.id], daily_target: 5 });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  assert.deepEqual(add.data, { added: 3, moved: 0 });
  assert.deepEqual((await S.admin.post(`${A}/halaqat/${h2.id}/members`, { student_ids: [s3.id, s4.id] })).data, { added: 2, moved: 1 }, "الطالب في حلقة واحدة");
  assert.ok(!(await S.admin.get(`${A}/unassigned`)).data.some((x) => [s1.id, s2.id, s3.id, s4.id].includes(x.id)));

  // The teacher sees only their circle, and records only for its students.
  const mine = (await S.teacher.get(`${T}/meta`)).data.halaqat;
  assert.deepEqual(mine.map((h) => h.id), [h1.id]);
  assert.equal((await S.teacher.get(`${T}/halaqat/${h2.id}`)).status, 403);
  assert.equal((await S.teacher.post(`${T}/records`, { student_id: s4.id, kind: "new", from_surah: 114 })).status, 403);

  // Juz 30 memorised for s1 in three passages (one graded «repeat» does not count until redone).
  const rec = (b) => S.teacher.post(`${T}/records`, { student_id: s1.id, ...b });
  let r = await rec({ kind: "new", from_surah: 78, from_ayah: 1, to_surah: 86, to_ayah: 17, grade: "excellent", mistakes: 0 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.ayat, Q.indexOf(86, 17) - Q.indexOf(78, 1) + 1);
  assert.equal((await rec({ kind: "new", from_surah: 87, to_surah: 114, grade: "repeat" })).status, 201);
  let p = (await S.teacher.get(`${T}/students/${s1.id}`)).data;
  assert.equal(p.progress.juz_complete.includes(30), false);
  assert.deepEqual(p.progress.next, { surah: 87, ayah: 1 }, "يكمل بعد آخر مقطع محفوظ");
  assert.equal((await rec({ kind: "new", from_surah: 87, to_surah: 114, grade: "very_good", mistakes: 2 })).status, 201);
  assert.equal((await rec({ kind: "review", juz: 30, grade: "good" })).status, 201);
  assert.equal((await rec({ kind: "new", from_surah: 2, from_ayah: 300 })).status, 400, "آية خارج السورة");
  assert.equal((await rec({ kind: "new", from_surah: 3, from_ayah: 5, to_surah: 2, to_ayah: 1 })).status, 400, "النهاية قبل البداية");
  assert.equal((await rec({ kind: "new" })).status, 400, "بلا مقطع");
  p = (await S.admin.get(`${A}/students/${s1.id}`)).data;
  assert.equal(p.progress.memorised, 564);
  assert.deepEqual(p.progress.juz_complete, [30]);
  assert.deepEqual(p.eligible.juz, [30]);

  // Memorising from the end backwards: after An-Nas comes Al-Falaq, skipping what is already memorised.
  const t2rec = (b) => teacher2.post(`${T}/records`, { student_id: s3.id, kind: "new", grade: "good", ...b });
  assert.equal((await t2rec({ from_surah: 114 })).status, 201);
  assert.deepEqual((await teacher2.get(`${T}/students/${s3.id}`)).data.progress.next, { surah: 113, ayah: 1 });
  assert.equal((await t2rec({ from_surah: 112 })).status, 201, "سورة الإخلاص قبل الفلق");
  assert.equal((await t2rec({ from_surah: 113 })).status, 201);
  assert.deepEqual((await teacher2.get(`${T}/students/${s3.id}`)).data.progress.next, { surah: 111, ayah: 1 }, "يتخطى المحفوظ");

  // Absences: once per day; a teacher deletes only today's own entries.
  const ab = await S.teacher.post(`${T}/absences`, { student_ids: [s2.id], kind: "absent" });
  assert.equal(ab.status, 201, JSON.stringify(ab.data));
  assert.equal((await S.teacher.post(`${T}/absences`, { student_ids: [s2.id], kind: "excused" })).status, 409);
  const s2rec = (await S.admin.get(`${A}/students/${s2.id}`)).data.records[0];
  assert.equal((await teacher2.del(`${T}/records/${s2rec.id}`)).status, 403);
  assert.equal((await S.teacher.del(`${T}/records/${s2rec.id}`)).status, 200);

  // Report for the circle and for the teachers.
  const rep = (await S.admin.get(`${A}/halaqat/${h1.id}/report?from=${today}&to=${today}`)).data;
  const row = rep.students.find((x) => x.student_id === s1.id);
  assert.equal(row.new_ayat, 564);
  assert.equal(row.review_ayat, 564);
  assert.equal(row.memorised_total, 564);
  const tr = (await S.admin.get(`${A}/reports/teachers?from=${today}&to=${today}`)).data.teachers.find((x) => x.id === S.teacherId);
  assert.equal(tr.new_ayat, 564);

  // The juz certificate comes from the log only, once, with a verification code the public can check.
  assert.equal((await S.admin.post(`${A}/achievements`, { student_id: s1.id, kind: "juz", juz: 29 })).status, 400);
  assert.equal((await S.admin.post(`${A}/achievements`, { student_id: s1.id, kind: "khatm" })).status, 400);
  const ach = await S.admin.post(`${A}/achievements`, { student_id: s1.id, kind: "juz", juz: 30 });
  assert.equal(ach.status, 201, JSON.stringify(ach.data));
  assert.match(ach.data.certificate.code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.equal((await S.admin.post(`${A}/achievements`, { student_id: s1.id, kind: "juz", juz: 30 })).status, 409);
  const v = (await client(srv.base).get(`/api/public/verify/${ach.data.certificate.code}`)).data;
  assert.equal(v.title, "شهادة إتمام حفظ الجزء 30");
  assert.doesNotMatch(JSON.stringify(v), /وزارة|معتمد/);

  // The parent sees the progress and the achievement; the other school sees nothing of it.
  const par = await client(srv.base).post(`/api/public/${S.id}/student/quran`, S.parent(s1));
  assert.equal(par.status, 200, JSON.stringify(par.data));
  assert.equal(par.data.progress.memorised, 564);
  assert.equal(par.data.membership.halaqa, "حلقة أبي بكر");
  assert.equal(par.data.achievements[0].title, "إتمام الجزء 30");
  assert.equal(par.data.records[0].created_by, undefined);
  const [{ n }] = await transaction({ tenantId: other.id }, (q) => q("SELECT count(*)::int AS n FROM quran_records"));
  assert.equal(n, 0);
  assert.equal((await other.admin.put("/api/admin/settings/modules", { quran: true })).status, 200);
  assert.equal((await other.admin.get(`${A}/students/${s1.id}`)).status, 404, "طالب مدرسة أخرى غير موجود عندها");

  // Archiving a circle ends its memberships but keeps every record.
  assert.equal((await S.admin.patch(`${A}/halaqat/${h1.id}`, { status: "archived" })).status, 200);
  const after = (await S.admin.get(`${A}/students/${s1.id}`)).data;
  assert.equal(after.membership, null);
  assert.equal(after.progress.memorised, 564);
});
