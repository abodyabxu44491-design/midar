// المسار الكامل مع تفعيل المفتاح: الحفظ المشفّر ثم العرض للمدير ما دام لم يغيّر المعلم كلمته.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.CREDENTIAL_KEY = crypto.randomBytes(32).toString("hex");
const { sealCredential, credentialsEnabled } = await import("../src/core/auth/secret-box.js");
const { revealInitialCredentials, account } = await import("../src/modules/shared/teacher-file.service.js");

test("عرض بيانات الدخول الأولية بعد الإنشاء", async () => {
  assert.equal(credentialsEnabled(), true);
  const enc = sealCredential("AB12-CD34-56", "school1");
  const q = async () => [{ id: 1, username: "t100", initial_password_enc: enc, must_change_password: true }];
  assert.deepEqual(await revealInitialCredentials(q, 5, "school1"), { username: "t100", password: "AB12-CD34-56", school: "school1" });
  await assert.rejects(revealInitialCredentials(q, 5, "school2"), /تعذر فك/);   // مدرسة أخرى لا تفكّها
});

test("بعد تغيير المعلم لكلمته (يمسحها الـ trigger) لا تُعرض", async () => {
  const enc = sealCredential("AB12-CD34-56", "school1");
  const cleared = async () => [{ id: 1, username: "t100", initial_password_enc: null, must_change_password: false }];
  await assert.rejects(revealInitialCredentials(cleared, 5, "school1"), /غيّر المعلم/);
  // حتى لو بقيت نسخة بالخطأ، must_change_password=false يمنع العرض
  const stale = async () => [{ id: 1, username: "t100", initial_password_enc: enc, must_change_password: false }];
  await assert.rejects(revealInitialCredentials(stale, 5, "school1"), /غيّر المعلم/);
});

test("حالة الحساب: الإتاحة تتبع وجود النسخة والحالة الأولية فقط", async () => {
  const T0 = "2026-09-01T08:00:00Z";
  const row = (o) => async () => [{ id: 7, username: "t1", is_active: true, must_change_password: true, last_login_at: null, password_changed_at: T0,
    created_at: T0, username_changed_at: null, locked: false, locked_until: null, failed_logins: 0, has_initial: true, ...o }];
  assert.equal((await account(row({}), 1)).initial_password_available, true);
  assert.equal((await account(row({ has_initial: false }), 1)).initial_password_available, false);
  assert.equal((await account(row({ must_change_password: false, password_changed_at: "2026-09-02T09:00:00Z", has_initial: true }), 1)).initial_password_available, false);
});
