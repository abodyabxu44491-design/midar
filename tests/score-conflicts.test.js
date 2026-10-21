/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readySchool, endPool } from "./helpers.js";

let srv, S, exam;
before(async () => {
  srv = await startServer();
  S = await readySchool(srv.base, { prefix: "sx", students: 2 });
  exam = (await S.teacher.post("/api/teacher/exams", { class_id: S.c1.id, subject_id: S.math.id, title: "اختبار التعارض", max_score: 20 })).data.id;
  assert.equal((await S.teacher.put(`/api/teacher/exams/${exam}/scores`, { scores: { [S.students[0].id]: 10, [S.students[1].id]: 12 } })).status, 200);
});
after(async () => { await srv.close(); await endPool(); });

test("الدرجات: تعديل شخص آخر بعد فتح الصفحة لا يُستبدل بصمت", async () => {
  const [a, b] = S.students;
  const base = { [a.id]: 10, [b.id]: 12 };          // what the administration saw when it opened the sheet
  // Meanwhile the teacher corrects student a.
  assert.equal((await S.teacher.put(`/api/teacher/exams/${exam}/scores`, { scores: { [a.id]: 15, [b.id]: 12 }, base })).status, 200);

  // The administration saves its sheet (changing only b): a's 15 would silently go back to 10.
  const clash = await S.admin.put(`/api/admin/exams/${exam}/scores`, { scores: { [a.id]: 10, [b.id]: 13 }, base });
  assert.equal(clash.status, 409);
  assert.equal(clash.data.changed.length, 1);
  assert.equal(clash.data.changed[0].student_id, Number(a.id));
  assert.equal(clash.data.changed[0].theirs, 15);
  assert.equal(clash.data.changed[0].yours, 10);
  let rows = (await S.admin.get(`/api/admin/exams/${exam}/scores`)).data;
  assert.equal(Number(rows.find((r) => r.id === a.id).score), 15, "لم يُحفظ شيء عند التعارض");
  assert.equal(Number(rows.find((r) => r.id === b.id).score), 12);

  // A save that agrees with the new value, or that keeps the grade untouched by others, goes through.
  assert.equal((await S.admin.put(`/api/admin/exams/${exam}/scores`, { scores: { [a.id]: 15, [b.id]: 13 }, base })).status, 200);
  // The user chose "save mine over theirs": sent without the base, it is saved.
  assert.equal((await S.admin.put(`/api/admin/exams/${exam}/scores`, { scores: { [a.id]: 9 } })).status, 200);
  rows = (await S.admin.get(`/api/admin/exams/${exam}/scores`)).data;
  assert.equal(Number(rows.find((r) => r.id === a.id).score), 9);
});
