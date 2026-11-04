/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Safety for every browser and load test: only a local database whose name ends in _test (or the CI database
// on the runner) is accepted, so a test can never reach production data.
export const MAILPIT = { smtpHost: "127.0.0.1", smtpPort: 1025, api: process.env.MAILPIT_API || "http://127.0.0.1:8025" };
export const BASE = `http://127.0.0.1:${process.env.E2E_PORT || 4100}`;

export function assertTestDatabase(url = process.env.DATABASE_URL) {
  let u;
  try { u = new URL(url); } catch { throw new Error("DATABASE_URL is missing or invalid"); }
  const local = ["127.0.0.1", "localhost", "::1"].includes(u.hostname);
  const name = u.pathname.slice(1);
  const ci = process.env.CI === "true" && name === "midar";
  if (!local || !(name.endsWith("_test") || ci)) {
    throw new Error(`Refusing to run tests against ${u.hostname}/${name}: use a local *_test database.`);
  }
}
