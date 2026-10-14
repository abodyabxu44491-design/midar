/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool, uid, readySchool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner, inst, admin, trainerA, trainerB, tA, tB, accountant;
const today = new Date().toISOString().slice(0, 10);
const I = "/api/admin/institute";

async function staff(id, username, password) {
  const c = client(srv.base);
  const r = await c.post("/api/staff/login", { school: id, username, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  // 1. A new institute
  inst = `in-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id: inst, name: "معهد المهارات للتدريب", org_type: "institute", max_students: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  admin = await staff(inst, "admin", r.data.credentials.password);
  await transaction({ tenantId: inst }, (q) => q("UPDATE users SET must_change_password = false"));
  // Trainers are teacher accounts with no school load
  const mk = async (name, username) => {
    const x = await admin.post("/api/admin/teachers", { name, username, load: [] });
    assert.equal(x.status, 201, JSON.stringify(x.data));
    return { id: x.data.id, c: await staff(inst, username, x.data.credentials.password) };
  };
  ({ id: tA, c: trainerA } = await mk("م. سامي الحداد", `tra${uid()}`));
  ({ id: tB, c: trainerB } = await mk("م. ليلى عمر", `trb${uid()}`));
  await transaction({ tenantId: inst }, (q) => q("UPDATE users SET must_change_password = false"));
});
after(async () => { await srv.close(); await endPool(); });

test("المعهد: من إنشاء البرنامج حتى الشهادة والتقرير المالي، مع العزل والصلاحيات", async () => {
  const me = (await admin.get("/api/admin/me")).data;
  assert.equal(me.org_type, "institute");
  assert.equal(me.setup_completed, true, "المعهد لا يمر بمعالج إعداد المدرسة");
  const meta = (await admin.get(`${I}/meta`)).data;
  assert.equal(meta.settings.terms.trainee, "متدرب");
  assert.equal(meta.staff_role, "director");

  // Custom terminology and required fields
  await admin.put(`${I}/settings`, { terms: { course: "مقرر", courses: "المقررات" }, required_fields: ["student_phone"], min_attendance: 75, pass_mark: 60 });
  assert.equal((await admin.get(`${I}/meta`)).data.settings.terms.course, "مقرر");

  // 2. Program and a course linked to it
  const prog = await admin.post(`${I}/programs`, { code: "web", name: "دبلوم تطوير الويب", department: "التقنية" });
  assert.equal(prog.status, 201, JSON.stringify(prog.data));
  const course = await admin.post(`${I}/courses`, { code: "WEB101", name: "أساسيات HTML و CSS", program_id: prog.data.id, trainer_id: tA,
    hours: 6, seats: 2, fee: 900, mode: "blended", status: "running", starts_on: today, grading: "score" });
  assert.equal(course.status, 201, JSON.stringify(course.data));
  const cid = course.data.id;
  assert.equal((await admin.post(`${I}/courses`, { code: "web101", name: "مكررة", hours: 3 })).status, 409, "رمز الدورة فريد");

  // 3. Trainers and groups
  const gA = (await admin.post(`${I}/courses/${cid}/groups`, { name: "المجموعة 1", trainer_id: tA, seats: 1 })).data;
  const gB = (await admin.post(`${I}/courses/${cid}/groups`, { name: "المجموعة 2", trainer_id: tB })).data;

  // 4. Trainees and enrollment (fee frozen per enrollment)
  assert.equal((await admin.post(`${I}/trainees`, { name: "بلا جوال" })).status, 400, "الحقول المطلوبة تفرضها إعدادات المعهد");
  const s1 = (await admin.post(`${I}/trainees`, { name: "ريم خالد العتيبي", student_phone: "0551112222", email: "reem@example.com", qualification: "بكالوريوس" })).data;
  const s2 = (await admin.post(`${I}/trainees`, { name: "فهد ناصر", student_phone: "0553334444", national_id: "1029384756" })).data;
  const s3 = (await admin.post(`${I}/trainees`, { name: "سارة يوسف", student_phone: "0555556666" })).data;
  assert.match(s1.student_no, /^T\d{5}$/, "رقم تعريفي تلقائي");
  assert.equal((await admin.post(`${I}/trainees`, { name: "مكرر", student_phone: "0550000000", national_id: "1029384756" })).status, 409, "رقم الهوية لا يتكرر");
  const e1 = await admin.post(`${I}/enrollments`, { student_id: s1.id, course_id: cid, group_id: gA.id });
  assert.equal(e1.status, 201, JSON.stringify(e1.data));
  assert.equal(Number(e1.data.fee), 900);
  assert.equal((await admin.post(`${I}/enrollments`, { student_id: s2.id, course_id: cid, group_id: gA.id })).status, 400, "مقاعد المجموعة محدودة");
  const e2 = (await admin.post(`${I}/enrollments`, { student_id: s2.id, course_id: cid, group_id: gB.id, discount: 200 })).data;
  assert.equal((await admin.post(`${I}/enrollments`, { student_id: s3.id, course_id: cid })).status, 400, "مقاعد الدورة محدودة");
  assert.equal((await admin.post(`${I}/enrollments`, { student_id: s1.id, course_id: cid })).status, 409, "لا تسجيل مكرر");
  // Course fee changes later do not touch enrolled trainees
  await admin.put(`${I}/courses/${cid}`, { ...course.data, fee: 1200, seats: 3, pass_mark: "", min_attendance: "" });
  const roster0 = (await admin.get(`${I}/courses/${cid}`)).data.enrollments;
  assert.equal(Number(roster0.find((e) => e.id === e1.data.id).fee), 900, "الرسوم المتفق عليها محفوظة");
  // Transfer with history
  await admin.post(`${I}/enrollments/${e2.id}/transfer`, { group_id: null, reason: "طلب المتدرب" });
  await admin.post(`${I}/enrollments/${e2.id}/transfer`, { group_id: gB.id, reason: "عودة لمجموعته" });

  // 5. Sessions and attendance by hours
  const ses = await admin.post(`${I}/courses/${cid}/sessions`, { group_id: gA.id, day: today, hours: 3, topic: "مقدمة" });
  assert.equal(ses.status, 201, JSON.stringify(ses.data));
  const sA1 = ses.data[0].id;
  const sA2 = (await admin.post(`${I}/courses/${cid}/sessions`, { group_id: gA.id, day: today, hours: 3, topic: "التنسيق" })).data[0].id;
  const sB1 = (await admin.post(`${I}/courses/${cid}/sessions`, { group_id: gB.id, day: today, hours: 3 })).data[0].id;
  // Trainer A records only their own group
  assert.equal((await trainerA.get(`/api/teacher/institute/sessions/${sB1}/attendance`)).status, 403, "المدرب لا يصل لجلسات غيره");
  const ros = (await trainerA.get(`/api/teacher/institute/sessions/${sA1}/attendance`)).data.roster;
  assert.deepEqual(ros.map((x) => x.full_name), ["ريم خالد العتيبي"]);
  assert.equal((await trainerA.put(`/api/teacher/institute/sessions/${sA1}/attendance`, { records: [{ enrollment_id: e1.data.id, status: "present" }] })).status, 200);
  assert.equal((await trainerA.put(`/api/teacher/institute/sessions/${sA2}/attendance`, { records: [{ enrollment_id: e1.data.id, status: "late", late_minutes: 10 }] })).status, 200);
  assert.equal((await trainerA.put(`/api/teacher/institute/sessions/${sA1}/attendance`, { records: [{ enrollment_id: e2.id, status: "present" }] })).status, 400, "لا يحضّر متدربًا من مجموعة أخرى");
  assert.equal((await trainerB.put(`/api/teacher/institute/sessions/${sB1}/attendance`, { records: [{ enrollment_id: e2.id, status: "absent" }] })).status, 200);
  // A trainer cannot reach the admin institute routes
  assert.equal((await trainerA.get(`${I}/trainees`)).status, 401);

  // 6. Assessments and scores, with change history
  const a1 = (await admin.post(`${I}/courses/${cid}/assessments`, { name: "اختبار نظري", kind: "theory", max_score: 50, weight: 40 })).data;
  const a2 = (await admin.post(`${I}/courses/${cid}/assessments`, { name: "مشروع عملي", kind: "project", max_score: 100, weight: 60 })).data;
  assert.equal((await admin.post(`${I}/courses/${cid}/assessments`, { name: "زائد", max_score: 10, weight: 10 })).status, 400, "الأوزان لا تتجاوز 100%");
  assert.equal((await trainerA.put(`/api/teacher/institute/assessments/${a1.id}/scores`, { scores: [{ enrollment_id: e1.data.id, score: 60 }] })).status, 400, "الدرجة لا تتجاوز القصوى");
  await trainerA.put(`/api/teacher/institute/assessments/${a1.id}/scores`, { scores: [{ enrollment_id: e1.data.id, score: 40 }] });
  await trainerA.put(`/api/teacher/institute/assessments/${a1.id}/scores`, { reason: "تصحيح خطأ رصد", scores: [{ enrollment_id: e1.data.id, score: 45 }] });
  assert.equal((await trainerA.put(`/api/teacher/institute/assessments/${a1.id}/scores`, { scores: [{ enrollment_id: e2.id, score: 30 }] })).status, 400, "لا يرصد لمتدرب ليس من مجموعته");
  await trainerA.put(`/api/teacher/institute/assessments/${a2.id}/scores`, { scores: [{ enrollment_id: e1.data.id, score: 80 }] });
  await admin.put(`${I}/assessments/${a1.id}/scores`, { scores: [{ enrollment_id: e2.id, score: 20 }] });

  // 7-8. Academic record and completion check
  let rec = (await admin.get(`${I}/trainees/${s1.id}/record`)).data;
  const p = rec.enrollments[0].progress;
  assert.equal(p.held_hours, 6);
  assert.equal(p.attended_hours, 6, "الحضور بالساعات الفعلية");
  assert.equal(p.attendance_pct, 100);
  assert.equal(p.final_score, 84, "النتيجة الموزونة 45/50×40% + 80/100×60%");
  assert.equal(p.eligible, true);
  assert.equal(rec.enrollments[0].score_changes.length, 1, "تعديل الدرجة محفوظ بقيمته السابقة");
  assert.equal(Number(rec.enrollments[0].score_changes[0].old_score), 40);
  const fin = await admin.post(`${I}/enrollments/${e1.data.id}/finalize`, {});
  assert.equal(fin.status, 200, JSON.stringify(fin.data));
  assert.equal(fin.data.status, "completed");
  const listed = (await admin.get(`${I}/trainees`)).data;
  assert.ok(listed.some((x) => x.id === s1.id), "المتدرب يبقى ظاهرًا بعد إكمال الدورة");
  // Trainee 2: absent and missing project → not eligible, cannot be finalized without force
  const f2 = await admin.post(`${I}/enrollments/${e2.id}/finalize`, {});
  assert.equal(f2.status, 400);
  assert.match(f2.data.error, /غير مرصودة/);

  // 9. Certificate with public verification; attendance letter for the other
  assert.equal((await admin.post(`${I}/enrollments/${e2.id}/certificate`, { kind: "course" })).status, 400, "لا شهادة قبل الاجتياز");
  const cert = await admin.post(`${I}/enrollments/${e1.data.id}/certificate`, { kind: "course" });
  assert.equal(cert.status, 201, JSON.stringify(cert.data));
  const pub = client(srv.base);
  const v = (await pub.get(`/api/public/verify/${cert.data.code}`)).data;
  assert.equal(v.student, "ريم خالد العتيبي");
  assert.equal(v.course, "أساسيات HTML و CSS");
  assert.equal(Number(v.hours), 6);
  assert.equal(v.org_type, "institute");
  assert.equal(v.revoked, false);
  assert.ok(!JSON.stringify(v).includes("0551112222") && !JSON.stringify(v).includes("reem@"), "التحقق لا يكشف بيانات حساسة");
  assert.equal((await admin.post(`${I}/enrollments/${e2.id}/certificate`, { kind: "attendance" })).status, 400, "لا إفادة بلا ساعات حضور");

  // 10. Fees and payments (partial, refund) through the existing invoices
  const fees = (await admin.get(`${I}/fees`)).data;
  const inv1 = fees.find((x) => x.enrollment_id === e1.data.id);
  assert.equal(Number(inv1.amount), 900);
  assert.equal(Number(fees.find((x) => x.enrollment_id === e2.id).amount), 700, "الخصم مسجل على التسجيل");
  const pay = (amount, k) => admin.post(`/api/admin/finance/invoices/${inv1.invoice_id}/payments`, { amount, method: "cash", idempotency_key: `pay-${k}-${uid()}` });
  assert.equal((await pay(500, "a")).status, 201);
  assert.equal((await pay(400, "b")).status, 201);
  rec = (await admin.get(`${I}/trainees/${s1.id}/record`)).data;
  assert.equal(rec.summary.balance, 0);
  assert.equal(rec.payments.length, 2);
  await admin.post(`${I}/enrollments/${e2.id}/discount`, { amount: 300, reason: "منحة تفوق" });
  assert.equal(Number((await admin.get(`${I}/fees`)).data.find((x) => x.enrollment_id === e2.id).amount), 600);

  // 11. Academic and financial reports, also as CSV
  const results = (await admin.get(`${I}/reports/results?course_id=${cid}`)).data;
  assert.equal(results.rows.length, 2);
  assert.ok(results.rows.some((r) => r.result === "اجتاز"));
  const money = (await admin.get(`${I}/reports/fees`)).data;
  assert.ok(money.rows.some((r) => r.course === "أساسيات HTML و CSS" && r.paid === 900));
  for (const k of ["record", "attendance", "hours", "trainers", "enrollments", "certificates", "withdrawals", "compare"]) {
    const q = k === "record" ? `?student_id=${s1.id}` : k === "attendance" ? `?course_id=${cid}` : "";
    const x = await admin.get(`${I}/reports/${k}${q}`);
    assert.equal(x.status, 200, `${k}: ${JSON.stringify(x.data)}`);
  }
  const csv = await fetch(`${srv.base}${I}/reports/results?course_id=${cid}&format=csv`, { headers: { Cookie: admin.cookie() } });
  assert.match(await csv.text(), /اجتاز/);
  const dash = (await admin.get(`${I}/dashboard`)).data;
  assert.equal(dash.running, 1);
  assert.equal(dash.certificates, 1);

  // Withdrawal keeps history; re-enrolling later is allowed
  await admin.post(`${I}/enrollments/${e2.id}/status`, { status: "withdrawn", reason: "ظروف عمل" });
  assert.equal((await admin.get(`${I}/reports/withdrawals`)).data.rows.length, 1);
  await admin.post(`${I}/trainees/${s2.id}/status`, { status: "deferred", reason: "سفر" });
  assert.ok((await admin.get(`${I}/trainees`)).data.some((x) => x.id === s2.id), "المتدرب المؤجل يبقى في القوائم بسجله");
  rec = (await admin.get(`${I}/trainees/${s2.id}/record`)).data;
  assert.ok(rec.enrollments[0].history.some((h) => h.kind === "transfer"), "سجل النقل محفوظ بعد الانسحاب");

  // Roles: registrar enrolls but cannot touch finance or settings; accountant sees fees but not academic changes
  const reg = await admin.post(`${I}/staff`, { name: "مسؤول التسجيل", username: `reg${uid()}`, staff_role: "registrar" });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  await transaction({ tenantId: inst }, (q) => q("UPDATE users SET must_change_password = false WHERE id = $1", [reg.data.id]));
  const rc = await staff(inst, reg.data.credentials.username, reg.data.credentials.password);
  assert.equal((await rc.get(`${I}/trainees`)).status, 200);
  assert.equal((await rc.post(`${I}/trainees`, { name: "متدرب من التسجيل", student_phone: "0557778888" })).status, 201);
  assert.equal((await rc.get(`${I}/fees`)).status, 403);
  assert.equal((await rc.put(`${I}/settings`, { pass_mark: 10 })).status, 403);
  assert.equal((await rc.post(`${I}/programs`, { code: "x1", name: "ممنوع" })).status, 403);
  assert.equal((await rc.put(`${I}/assessments/${a1.id}/scores`, { scores: [{ enrollment_id: e1.data.id, score: 1 }] })).status, 403);
  assert.equal((await rc.get("/api/admin/finance/invoices")).status, 403, "أقسام المدرسة مغلقة على أدوار المعهد");
  assert.equal((await rc.get(`${I}/reports/fees`)).status, 404);
  const acc = await admin.post("/api/admin/users", { name: "محاسب المعهد", username: `acc${uid()}` });
  assert.equal(acc.status, 201, JSON.stringify(acc.data));
  await transaction({ tenantId: inst }, (q) => q("UPDATE users SET must_change_password = false WHERE role = 'accountant'"));
  const ac = await staff(inst, acc.data.credentials.username, acc.data.credentials.password);
  assert.equal((await ac.get("/api/accountant/institute/fees")).status, 200);
  assert.equal((await ac.post("/api/accountant/institute/programs", { code: "x2", name: "ممنوع" })).status, 403);

  // 12. Isolation: another school sees nothing of the institute
  const sch = await readySchool(srv.base, { prefix: "is", students: 1 });
  assert.equal((await sch.admin.get(`${I}/courses`)).status, 404, "أقسام المعهد غير متاحة للمدرسة");
  const leak = await transaction({ tenantId: sch.id }, (q) => q("SELECT (SELECT count(*) FROM courses)::int AS c, (SELECT count(*) FROM enrollments)::int AS e"));
  assert.deepEqual(leak[0], { c: 0, e: 0 }, "عزل البيانات على مستوى قاعدة البيانات");
  assert.equal((await sch.admin.get(`${I}/trainees/${s1.id}/record`)).status, 404);
  // 13. School functions unchanged
  assert.equal((await sch.admin.get("/api/admin/me")).data.org_type, "school");
  assert.equal((await sch.admin.get("/api/admin/students")).status, 200);
});
