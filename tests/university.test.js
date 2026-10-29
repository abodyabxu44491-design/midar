/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool, uid, setupAdmin, readySchool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner, admin, id, instructor, instructor2, school;
const U = "/api/admin/university";

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  id = `un-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id, name: "جامعة المستقبل", org_type_key: "university", max_students: 500 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  admin = await setupAdmin(client(srv.base), r.data.setup.url);
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false"));
  const mk = async (name) => {
    const x = await admin.post("/api/admin/teachers", { name, username: `in${uid()}`, load: [] });
    assert.equal(x.status, 201, JSON.stringify(x.data));
    const c = client(srv.base);
    await c.post("/api/staff/login", { school: id, username: x.data.credentials.username, password: x.data.credentials.password });
    return { id: x.data.id, c };
  };
  instructor = await mk("د. سامي الحربي");
  instructor2 = await mk("د. منى الشهري");
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false"));
  school = await readySchool(srv.base, { prefix: "us", students: 1 });
});
after(async () => { await srv.close(); await endPool(); });

test("الجامعة لا تظهر للعامة، والمالك وحده ينشئها للتجربة، ولوحتها جامعية", async () => {
  const site = (await client(srv.base).get("/api/site")).data;
  assert.ok(!(site.org_types || []).some((t) => t.key === "university"));
  const types = (await owner.get("/api/owner/org-types")).data;
  assert.equal((await owner.patch(`/api/owner/org-types/university`, { status: "beta" })).status, 400, "لا تُتاح للعامة قبل اكتمالها");
  assert.ok(types.engines.find((e) => e.key === "university").live);
  const me = (await admin.get("/api/admin/me")).data;
  assert.equal(me.org_type, "university");
  assert.equal(me.setup_completed, true);
  assert.equal(me.terms.org, "الجامعة");
  assert.equal(me.terms.course, "مقرر");
  assert.equal((await school.admin.get(`${U}/structure`)).status, 404, "المدرسة لا تصل لمسارات الجامعة");
});

test("من الهيكل إلى المعدل التراكمي: متطلبات سابقة، سعة، حد ساعات، رصد وتسليم، إعادة مقرر، وكشف أكاديمي", async () => {
  const col = (await admin.post(`${U}/colleges`, { code: "eng", name: "كلية الهندسة" })).data;
  assert.equal(col.code, "ENG");
  assert.equal((await admin.post(`${U}/colleges`, { code: "ENG", name: "مكرر" })).status, 409);
  const dep = (await admin.post(`${U}/departments`, { college_id: col.id, code: "CS", name: "علوم الحاسب" })).data;
  const prog = (await admin.post(`${U}/programs`, { department_id: dep.id, code: "BCS", name: "بكالوريوس علوم الحاسب", total_credits: 132, years: 4 })).data;
  const c101 = (await admin.post(`${U}/courses`, { department_id: dep.id, code: "CS101", name: "مقدمة في البرمجة", credits: 3 })).data;
  const c102 = (await admin.post(`${U}/courses`, { department_id: dep.id, code: "CS102", name: "البرمجة المتقدمة", credits: 3, prerequisites: [c101.id] })).data;
  const m101 = (await admin.post(`${U}/courses`, { department_id: dep.id, code: "MATH101", name: "تفاضل وتكامل", credits: 4 })).data;
  assert.equal((await admin.patch(`${U}/courses/${c101.id}`, { prerequisites: [c101.id] })).status, 400, "لا يكون متطلبًا لنفسه");
  assert.equal((await admin.put(`${U}/programs/${prog.id}/plan`, { courses: [{ course_id: c101.id, level: 1 }, { course_id: m101.id, level: 1 }, { course_id: c102.id, level: 2 }] })).status, 200);

  const t1 = (await admin.post(`${U}/terms`, { name: "الفصل الأول 2026", starts_on: "2026-09-01", ends_on: "2027-01-15", status: "registration" })).data;
  const s101 = (await admin.post(`${U}/sections`, { term_id: t1.id, course_id: c101.id, teacher_id: instructor.id, capacity: 2, schedule: "أحد وثلاثاء 8-9:30" })).data;
  const s102 = (await admin.post(`${U}/sections`, { term_id: t1.id, course_id: c102.id, teacher_id: instructor.id })).data;
  const sm = (await admin.post(`${U}/sections`, { term_id: t1.id, course_id: m101.id, teacher_id: instructor2.id })).data;

  const admitted = [];
  for (const name of ["خالد العمري", "نورة القحطاني", "فهد الدوسري"]) {
    const a = await admin.post(`${U}/students`, { name, program_id: prog.id, admitted_term_id: t1.id });
    assert.equal(a.status, 201, JSON.stringify(a.data));
    admitted.push(a.data.student_id);
  }
  const [st1, st2, st3] = admitted;
  const reg = (student_id, section_id, extra = {}) => admin.post(`${U}/registrations`, { student_id, section_id, ...extra });
  assert.equal((await reg(st1, s102.id)).status, 400, "المتطلب السابق لم يُجتز");
  assert.equal((await reg(st1, s101.id)).status, 201);
  assert.equal((await reg(st1, s101.id)).status, 409);
  assert.equal((await reg(st2, s101.id)).status, 201);
  const full = await reg(st3, s101.id);
  assert.equal(full.status, 400); assert.match(full.data.error, /ممتلئة/);
  assert.equal((await reg(st3, s101.id, { override: true })).status, 201, "القبول والتسجيل يتجاوز السعة");
  assert.equal((await reg(st1, sm.id)).status, 201);
  await admin.put(`${U}/settings`, { max_credits: 6 });
  assert.equal((await reg(st2, sm.id)).status, 400, "الحد الأعلى للساعات");
  await admin.put(`${U}/settings`, { max_credits: 21 });
  assert.equal((await reg(st2, sm.id)).status, 201);

  // The instructor sees only their sections; marks wait for the term to start, then become letters and points.
  const mine = (await instructor.c.get("/api/teacher/university/sections")).data.map((s) => s.id).sort();
  assert.deepEqual(mine, [s101.id, s102.id].sort());
  assert.equal((await instructor2.c.get(`/api/teacher/university/sections/${s101.id}/roster`)).status, 403);
  let ros = (await instructor.c.get(`/api/teacher/university/sections/${s101.id}/roster`)).data;
  const regOf = (sid) => ros.students.find((x) => x.student_id === sid).id;
  assert.equal((await instructor.c.put(`/api/teacher/university/sections/${s101.id}/marks`, { marks: [{ id: regOf(st1), mark: 92 }] })).status, 400, "قبل بدء الفصل");
  await admin.patch(`${U}/terms/${t1.id}`, { status: "running" });
  assert.equal((await instructor.c.put(`/api/teacher/university/sections/${s101.id}/marks`, { marks: [{ id: regOf(st1), mark: 92 }, { id: regOf(st2), mark: 55 }], submit: true })).status, 400, "التسليم يحتاج كل الدرجات");
  const ok = await instructor.c.put(`/api/teacher/university/sections/${s101.id}/marks`, { marks: [{ id: regOf(st1), mark: 92 }, { id: regOf(st2), mark: 55 }, { id: regOf(st3), mark: 81 }], submit: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  ros = (await admin.get(`${U}/sections/${s101.id}/roster`)).data;
  assert.deepEqual(ros.students.map((x) => [x.letter, Number(x.points)]).sort(), [["A", 4], ["B", 3], ["F", 0]].sort());
  assert.equal((await instructor.c.put(`/api/teacher/university/sections/${s101.id}/marks`, { marks: [{ id: regOf(st2), mark: 70 }] })).status, 403, "بعد التسليم للقبول والتسجيل فقط");
  const smRos = (await instructor2.c.get(`/api/teacher/university/sections/${sm.id}/roster`)).data;
  await instructor2.c.put(`/api/teacher/university/sections/${sm.id}/marks`, { marks: smRos.students.map((x) => ({ id: x.id, mark: x.student_id === st1 ? 76 : 66 })), submit: true });

  // st1: CS101 A (3 h × 4) + MATH101 C+ (4 h × 2.5) = 22 / 7 = 3.14
  let tr = (await admin.get(`${U}/students/${st1}/transcript`)).data;
  assert.equal(tr.cgpa, 3.14);
  assert.equal(tr.earned, 7);
  assert.equal(tr.terms[0].gpa, 3.14);
  assert.deepEqual(tr.remaining.map((c) => c.code), ["CS102"]);
  assert.equal(tr.standing_name, "منتظم");
  // st2 failed CS101 (F) and got D+ in MATH101: (0×3 + 1.5×4) / 7 = 0.86, on probation; CS102 still locked.
  tr = (await admin.get(`${U}/students/${st2}/transcript`)).data;
  assert.equal(tr.cgpa, 0.86);
  assert.equal(tr.standing_name, "إنذار أكاديمي");
  { const rr = await reg(st1, s102.id); assert.equal(rr.status, 201, `اجتاز المتطلب: ${JSON.stringify(rr.data)}`); }

  // A failed course is repeated next term; only the latest attempt counts in the cumulative GPA.
  const t2 = (await admin.post(`${U}/terms`, { name: "الفصل الثاني 2027", starts_on: "2027-02-01", ends_on: "2027-06-15", status: "registration" })).data;
  const s101b = (await admin.post(`${U}/sections`, { term_id: t2.id, course_id: c101.id, teacher_id: instructor.id })).data;
  assert.equal((await reg(st1, s101b.id)).status, 400, "اجتاز المقرر من قبل");
  assert.equal((await reg(st2, s101b.id)).status, 201);
  await admin.patch(`${U}/terms/${t2.id}`, { status: "running" });
  const r2 = (await instructor.c.get(`/api/teacher/university/sections/${s101b.id}/roster`)).data;
  await instructor.c.put(`/api/teacher/university/sections/${s101b.id}/marks`, { marks: [{ id: r2.students[0].id, mark: 85 }], submit: true });
  tr = (await admin.get(`${U}/students/${st2}/transcript`)).data;
  assert.equal(tr.terms.length, 2);
  assert.equal(tr.terms[1].gpa, 3.5);
  assert.equal(tr.cgpa, 2.36, "(3.5×3 + 1.5×4) / 7");
  assert.equal(tr.earned, 7);

  // The student (and parent) sees the record in the student file; another institution sees nothing.
  const [s] = await transaction({ tenantId: id }, (q) => q("SELECT access_key FROM students WHERE id = $1", [st1]));
  const pub = await client(srv.base).post(`/api/public/${id}/student`, { student_id: st1, key: s.access_key });
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.equal(pub.data.features.transcript.cgpa, 3.14);
  const [{ n }] = await transaction({ tenantId: school.id }, (q) => q("SELECT count(*)::int AS n FROM uni_registrations"));
  assert.equal(n, 0);

  const list = (await admin.get(`${U}/students?program_id=${prog.id}`)).data;
  assert.equal(list.length, 3);
  assert.equal(list.find((x) => x.id === st1).cgpa, 3.14);
  const dash = (await admin.get(`${U}/dashboard`)).data;
  assert.equal(dash.counts.students, 3);
});
