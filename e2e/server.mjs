/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The app for browser tests: the real server code on the throwaway test database, with email going to the
// local Mailpit catcher. It refuses to start against anything that is not a local test database.
import { assertTestDatabase, MAILPIT } from "./support/env.mjs";

assertTestDatabase();
const { createApp } = await import("../src/app.js");
const { transaction } = await import("../src/core/db/pool.js");
await transaction({ platform: true }, (q) => q(
  "UPDATE mail_gateway SET enabled = true, host = $1, port = $2, secure = false, username = '', from_email = 'no-reply@midar.test' WHERE id = 1",
  [MAILPIT.smtpHost, MAILPIT.smtpPort]));
const port = Number(process.env.E2E_PORT || 4100);
createApp().listen(port, "127.0.0.1", () => console.log(`e2e server on ${port}`));
