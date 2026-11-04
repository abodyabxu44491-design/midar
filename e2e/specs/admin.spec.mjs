/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The principal signs in by email on a new device: the code arrives by email (read from Mailpit).
import { test, expect } from "../support/test.mjs";
import { state } from "../support/state.mjs";
import { waitForCode } from "../support/mailpit.mjs";

test("المدير: دخول بالبريد ورمز الجهاز الجديد، ثم لوحة الإدارة وقائمة الطلاب", async ({ page }) => {
  const s = state();
  await page.goto(`/${s.school}/idara`);
  await page.getByPlaceholder("name@example.com").fill(s.admin.email);
  await page.getByPlaceholder("كلمة المرور").fill(s.admin.password);
  const since = Date.now();
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await expect(page.getByRole("heading", { name: "تأكيد الدخول من جهاز جديد" })).toBeVisible();
  // Six digits complete the sign-in by themselves.
  await page.getByRole("textbox").first().fill(await waitForCode(s.admin.email, { since }));

  // A new school opens on the setup wizard (until someone finishes or skips it); skipping leads to the dashboard.
  const skip = page.getByRole("button", { name: /تخطي المعالج/ });
  const welcome = page.getByRole("heading", { name: /أهلًا/ });
  await expect(skip.or(welcome).first()).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(welcome).toBeVisible();
  await expect(page.getByText(s.schoolName).first()).toBeVisible();

  // The notifications prompt (phones) is dismissed, then the students section from the menu (side or bottom bar).
  const ok = page.getByRole("button", { name: "حسنًا" });
  if (await ok.isVisible()) await ok.click();
  await page.locator("button:visible", { hasText: /^\s*الطلاب\s*$/ }).first().click();
  for (const st of s.students) await expect(page.getByText(st.name).first()).toBeVisible();
});
