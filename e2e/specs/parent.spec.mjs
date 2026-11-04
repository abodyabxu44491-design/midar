/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// A parent opens the link from the school: the child's file opens without an account, and every section works.
import { test, expect } from "../support/test.mjs";
import { state } from "../support/state.mjs";

test("ولي الأمر: رابط ملف الابن يفتح مباشرة، وكل الأقسام تعمل بلا أخطاء", async ({ page }, info) => {
  const s = state();
  const child = info.project.name === "phone" ? s.students[1] : s.students[2];
  await page.goto(`/${s.school}?k=${child.key}`);
  await expect(page.getByText(child.name).first()).toBeVisible();
  // Every section the school shows for this child opens without an error (sections follow the school's settings).
  const tabs = page.locator("nav.profile-nav button");
  const count = await tabs.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).click();
    await expect(tabs.nth(i)).toHaveClass(/\bon\b/);
  }
  // The device keeps the file: opening the app again goes straight to it.
  await page.goto(`/${s.school}`);
  await expect(page.getByText(child.name).first()).toBeVisible();
});
