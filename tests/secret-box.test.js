// تشفير كلمات المرور المؤقتة: ذهابًا وإيابًا، الكشف عن العبث، ربط المدرسة، وغياب المفتاح. بلا قاعدة بيانات.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createBox } from "../src/core/auth/secret-box.js";
import { revealInitialCredentials, account } from "../src/modules/shared/teacher-file.service.js";

const KEY = crypto.randomBytes(32).toString("hex");
const box = createBox(KEY);

test("seal/open ذهابًا وإيابًا، والنص الصريح لا يظهر في الناتج", () => {
  const blob = box.seal("K7P2-QX9M-42", "school1");
  assert.match(blob, /^v1\./);
  assert.ok(!blob.includes("K7P2"));
  assert.equal(box.open(blob, "school1"), "K7P2-QX9M-42");
  assert.notEqual(box.seal("K7P2-QX9M-42", "school1"), blob);   // iv عشوائي
});
test("مدرسة أخرى أو مفتاح آخر أو عبث بالبيانات: لا فك", () => {
  const blob = box.seal("secret-pass", "school1");
  assert.equal(box.open(blob, "school2"), null);
  assert.equal(createBox(crypto.randomBytes(32).toString("hex")).open(blob, "school1"), null);
  const parts = blob.split("."); parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
  assert.equal(box.open(parts.join("."), "school1"), null);
  assert.equal(box.open("garbage", "school1"), null);
});
test("بلا مفتاح: الميزة معطلة ولا يُحفظ شيء", () => {
  for (const bad of [undefined, "", "abc", "z".repeat(64)]) {
    const b = createBox(bad);
    assert.equal(b.enabled(), false);
    assert.equal(b.seal("x", "s"), null);
    assert.equal(b.open("v1.a.b.c", "s"), null);
  }
});

// reveal يعتمد على المفتاح الافتراضي للبيئة (غير مضبوط في الاختبار): نتحقق من مساراته دون مفتاح
test("reveal: رفض عندما لا توجد نسخة محفوظة أو غيّر المعلم كلمته", async () => {
  const mk = (row) => async (sql) => (sql.includes("FROM users WHERE teacher_id") ? (row ? [row] : []) : []);
  await assert.rejects(revealInitialCredentials(mk(null), 1, "s"), /المعلم غير موجود/);
  await assert.rejects(revealInitialCredentials(mk({ id: 1, username: "a", initial_password_enc: null, must_change_password: true }), 1, "s"), /غيّر المعلم/);
  await assert.rejects(revealInitialCredentials(mk({ id: 1, username: "a", initial_password_enc: "v1.a.b.c", must_change_password: false }), 1, "s"), /غيّر المعلم/);
  await assert.rejects(revealInitialCredentials(mk({ id: 1, username: "a", initial_password_enc: "v1.a.b.c", must_change_password: true }), 1, "s"), /تعذر فك/);
});
test("account: لا تُرسل كلمة المرور ولا النسخة المشفّرة أبدًا", async () => {
  const T0 = "2026-09-01T08:00:00Z";
  const q = async () => [{ id: 7, username: "t1", is_active: true, must_change_password: true, last_login_at: null, password_changed_at: T0, created_at: T0,
    username_changed_at: null, locked: false, locked_until: null, failed_logins: 0, has_initial: true, initial_password_enc: "v1.SECRET.x.y", password_hash: "scrypt$x" }];
  const acc = await account(q, 1);
  assert.equal(acc.initial_password_available, true);
  assert.ok(!JSON.stringify(acc).match(/SECRET|scrypt|initial_password_enc|password_hash/));
});
