/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// A visitor on the website and on a school's public page.
import { test, expect } from "../support/test.mjs";
import { state } from "../support/state.mjs";

test("الموقع: الصفحة الرئيسية ونموذج طلب التجربة بأنواع المؤسسات", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/مدار/);
  await page.getByRole("button", { name: /ابدأ تجربتك المجانية/ }).first().click();
  const type = page.locator("dialog select").first();
  await expect(type).toBeVisible();
  const options = await type.locator("option").allTextContents();
  expect(options).toEqual(expect.arrayContaining(["مدرسة أهلية", "روضة أطفال", "معهد تدريبي", "نوع آخر"]));
});

test("صفحة المدرسة العامة تفتح وتعرض اسمها وفتح الملف بالمعرّف", async ({ page }) => {
  const s = state();
  await page.goto(`/${s.school}`);
  await expect(page.getByText(s.schoolName).first()).toBeVisible();
  await expect(page.getByPlaceholder(/XXXX/).first()).toBeVisible();
});
