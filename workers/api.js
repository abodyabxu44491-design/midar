/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Cloudflare Workers entry: the same Express app as src/server.js, served through the Workers Node.js HTTP layer.
// Static files are answered by Workers Static Assets before this code runs (scripts/build-workers.js).
import "./setup.js";
import { httpServerHandler } from "cloudflare:node";
import { createApp } from "../src/app.js";
import { runScheduled } from "./schedule.js";

const PORT = 3000;
createApp().listen(PORT);
const http = httpServerHandler({ port: PORT });

export default {
  ...http,
  // Cron Trigger (every five minutes): reminders, the gate, maintenance, notification retries (workers/schedule.js).
  scheduled(controller, env, ctx) { ctx.waitUntil(runScheduled(controller.scheduledTime, env)); },
};
