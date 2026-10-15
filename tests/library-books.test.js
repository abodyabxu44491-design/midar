/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readySchool, endPool } from "./helpers.js";

const LB = "/api/admin/services/library";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
let srv, A, B, meta, grade, subject, book;

before(async () => {
  srv = await startServer();
  A = await readySchool(srv.base, { prefix: "lb", students: 1 });
  B = await readySchool(srv.base, { prefix: "lc", students: 1 });
  for (const s of [A, B]) assert.equal((await s.admin.put("/api/admin/settings/modules", { library: true })).status, 200);
  meta = (await A.admin.get(`${LB}/meta`)).data;
  grade = meta.grades[0];
  subject = grade.subjects[0] || meta.subjects[0];
});
after(async () => { await srv.close(); await endPool(); });

test("كتاب مدرسي: الصف والمادة والجزء والطبعة والرف والنسخ", async () => {
  assert.ok(grade && subject, "الصفوف والمواد متاحة للاختيار");
  assert.deepEqual(Object.keys(meta.parts), ["first", "second", "combined"]);
  const r = await A.admin.post(`${LB}/books`, { title: `${subject.name} — الجزء الأول — ${grade.name}`, grade_id: grade.id, subject_id: subject.id,
    part: "first", source: "government", shelf: "أ-3", copies: 40 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  book = (await A.admin.get(`${LB}/books?grade_id=${grade.id}`)).data.find((b) => b.id === r.data.id);
  assert.equal(book.grade, grade.name);
  assert.equal(book.subject, subject.name);
  assert.deepEqual([book.part, book.source, book.shelf, book.copies, book.has_cover], ["first", "government", "أ-3", 40, false]);
  const dup = await A.admin.post(`${LB}/books`, { title: "نسخة مكررة", grade_id: grade.id, subject_id: subject.id, part: "first", copies: 1 });
  assert.equal(dup.status, 409, "لا يتكرر الكتاب نفسه، تُعدّل نسخه");
  assert.equal((await A.admin.post(`${LB}/books`, { title: "جزء بلا صف", part: "second" })).status, 400);
  assert.equal((await A.admin.post(`${LB}/books`, { title: "قصص الأنبياء", category: "قصص", source: "private", copies: 3 })).status, 200, "الكتاب العام بلا صف");
});

test("كتب صف كامل دفعة واحدة، وتكرار الإضافة يزيد النسخ", async () => {
  const items = [{ subject_id: subject.id, part: "first", copies: 10 }, { subject_id: subject.id, part: "second", copies: 35 }];
  const r = await A.admin.post(`${LB}/books/grade`, { grade_id: grade.id, source: "government", shelf: "ب-1", items });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { added: 1, increased: 1 });
  const list = (await A.admin.get(`${LB}/books?grade_id=${grade.id}`)).data;
  assert.equal(list.find((b) => b.id === book.id).copies, 50, "40 + 10");
  const second = list.find((b) => b.part === "second");
  assert.match(second.title, /الجزء الثاني/);
  assert.equal(second.copies, 35);
  assert.equal((await A.admin.post(`${LB}/books/grade`, { grade_id: grade.id, items: [] })).status, 400);
});

test("صورة الغلاف: نوع الملف يطابق محتواه، وتُعرض لمدرستها فقط", async () => {
  assert.equal((await A.admin.post(`${LB}/books/${book.id}/cover`, { mime: "image/png", data: Buffer.from("not an image at all, plain text").toString("base64") })).status, 400);
  assert.equal((await A.admin.post(`${LB}/books/${book.id}/cover`, { mime: "image/png", data: PNG })).status, 200);
  assert.equal((await A.admin.get(`${LB}/books?grade_id=${grade.id}`)).data.find((b) => b.id === book.id).has_cover, true);
  const img = await fetch(`${srv.base}${LB}/books/${book.id}/cover`, { headers: { Cookie: A.admin.cookie() } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal((await fetch(`${srv.base}${LB}/books/${book.id}/cover`, { headers: { Cookie: B.admin.cookie() } })).status, 404);
  assert.equal((await B.admin.post(`${LB}/books/${book.id}/cover`, { mime: "image/png", data: PNG })).status, 404);
  assert.ok(!(await B.admin.get(`${LB}/books`)).data.some((b) => b.id === book.id));
  assert.equal((await B.admin.post(`${LB}/books`, { title: "كتاب", grade_id: grade.id, subject_id: subject.id, part: "first" })).status >= 400, true, "لا يُربط بصف مدرسة أخرى");
  assert.equal((await A.admin.del(`${LB}/books/${book.id}/cover`)).status, 200);
  assert.equal((await A.admin.get(`${LB}/books?grade_id=${grade.id}`)).data.find((b) => b.id === book.id).has_cover, false);
});
