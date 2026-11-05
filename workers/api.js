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
import { runQueuedJob } from "../src/core/jobs.js";

const PORT = 3000;
createApp().listen(PORT);
const http = httpServerHandler({ port: PORT });

export default {
  ...http,
  // Cron Trigger (every five minutes): reminders, the gate, maintenance, notification retries (workers/schedule.js).
  scheduled(controller, env, ctx) { ctx.waitUntil(runScheduled(controller.scheduledTime, env)); },
  // Queue consumer for long jobs (imports): one job per message, up to 15 minutes each.
  async queue(batch) {
    for (const msg of batch.messages) {
      try { await runQueuedJob(Number(msg.body.id)); msg.ack(); }
      catch (e) { console.error("[عملية طويلة]", e?.message || e); msg.retry({ delaySeconds: 30 }); }
    }
  },
};
