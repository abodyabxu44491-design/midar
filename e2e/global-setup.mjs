/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Before the browser tests: a fresh school made through the app's own API, the way the owner and a principal
// would make it. The principal's email code is read from Mailpit. What the specs need is saved to e2e/.state.json.
import fs from "node:fs";
import { assertTestDatabase } from "./support/env.mjs";
import { api } from "./support/api.mjs";
import { waitForCode } from "./support/mailpit.mjs";
import { testEmail, password, student, uid } from "./support/data.mjs";

export const STATE = new URL("./.state.json", import.meta.url);

export default async function globalSetup() {
  assertTestDatabase();
  const { currentTotp } = await import("../src/core/auth/totp.js");
  const owner = api();
  await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: process.env.TEST_OWNER_PASSWORD,
    code: currentTotp(process.env.OWNER_TOTP_SECRET) });
  // The public website in marketing mode with free trials, as in production.
  await owner.must("PUT", "/api/owner/settings", { landing_mode: "marketing", trial_enabled: true });
  const school = `e2e-${uid()}`;
  const t = await owner.post("/api/owner/tenants", { id: school, name: "مدرسة الاختبار الآلي" });

  // The principal: a new account by email, its emailed code, then the school's setup link.
  const admin = api();
  const email = testEmail("principal"), pass = password();
  const token = new URL(t.setup.url).searchParams.get("token");
  const since = Date.now();
  await admin.post("/api/account/signup", { email, password: pass, name: "مدير المدرسة", setup: token });
  await admin.post("/api/account/signup/verify", { email, code: await waitForCode(email, { since }) });
  await admin.post("/api/account/setup/link", { token, via: "email" });

  await admin.post("/api/admin/setup/template", { template: "primary", sections_per_grade: 2, grade_set: "arabic_basic" });
  const classes = await admin.get("/api/admin/structure/classes");
  const subjects = await admin.get("/api/admin/structure/subjects");
  const c1 = classes[0], math = subjects[0];
  const teacher = await admin.post("/api/admin/teachers", { name: "أ. معلم الاختبار", username: `t${uid()}`,
    load: [{ class_id: c1.id, subject_id: math.id }] });
  const students = [];
  for (let i = 0; i < 4; i++) students.push(await admin.post("/api/admin/students", { ...student(), class_id: c1.id }));

  fs.writeFileSync(STATE, JSON.stringify({
    school, schoolName: "مدرسة الاختبار الآلي",
    admin: { email, password: pass },
    teacher: { username: teacher.credentials.username, password: teacher.credentials.password },
    className: c1.name,
    students: students.map((s) => ({ id: s.id, name: s.name, key: s.access_key })),
  }, null, 1));
}
