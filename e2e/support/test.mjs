/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Every browser test fails if the page throws a JavaScript error, or if the server answers 500 or more:
// what a user would see as a broken screen.
import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const problems = [];
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("response", (r) => { if (r.status() >= 500) problems.push(`server ${r.status()}: ${r.request().method()} ${new URL(r.url()).pathname}`); });
    await use(page);
    expect(problems, problems.join("\n")).toEqual([]);
  },
});
export { expect };
