/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The teacher's first sign-in with the temporary password from the school, then the attendance screen.
import { test, expect } from "../support/test.mjs";
import { state } from "../support/state.mjs";

test("المعلم: أول دخول بكلمة مؤقتة، يختار كلمة خاصة، ثم يرى طلاب فصله في الحضور", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "first sign-in happens once; the phone run would find the password changed");
  const s = state();
  await page.goto(`/${s.school}/idara`);
  await page.locator("button", { hasText: /^\s*المعلم\s*$/ }).first().click();
  await page.getByPlaceholder("اسم المستخدم").fill(s.teacher.username);
  await page.getByPlaceholder("كلمة المرور").fill(s.teacher.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();

  await expect(page.getByRole("heading", { name: "اختر كلمة مرور خاصة بك" })).toBeVisible();
  const fields = page.locator("input[type=password]:visible");
  const fresh = "Teacher-New-2026x";
  await fields.nth(0).fill(s.teacher.password);
  await fields.nth(1).fill(fresh);
  await fields.nth(2).fill(fresh);
  await page.getByRole("button", { name: "حفظ ومتابعة" }).click();

  await page.locator("nav.tabs button", { hasText: /^\s*الحضور\s*$/ }).first().click();
  await expect(page.getByText(s.students[0].name).first()).toBeVisible();
});
