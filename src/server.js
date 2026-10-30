/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import path from "node:path";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { getPool, closePool, healthCheck } from "./core/db/pool.js";
import { runMaintenance } from "./core/auth/sessions.js";
import { dispatchAlertEmails, dispatchOwnerPush } from "./modules/shared/alerts.service.js";
import { failInterruptedJobs, drainJobs } from "./core/jobs.js";
import { runReminders } from "./modules/shared/reminders.service.js";
import { runGateTick } from "./modules/shared/gate.service.js";
import { ensureDemoSchool } from "./modules/owner/demo-provision.js";
import { gated } from "./core/activity.js";
import { migrate } from "./core/db/migrator.js";
import { isDatabaseDown } from "./core/http/errors.js";
import { startDeliveryWorker, kickDeliveries, deliveriesIdle } from "./modules/shared/notify.service.js";

// When the database is unreachable at boot, the server still starts: every request gets the maintenance message, and
// pending migrations and startup work run as soon as the database answers again (checked every minute).
async function checkDatabase() {
  await healthCheck();
  const [{ n }] = (await (await getPool()).query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'tenants'")).rows;
  if (!n) throw new Error("الجداول غير موجودة. شغّل: npm run migrate");
}
async function whenReady() {
  await failInterruptedJobs();
  if (process.env.DEMO_AUTO !== "false") ensureDemoSchool().catch((e) => console.error("[العرض التجريبي]", e.message));
}

let dbReady = false;
try {
  await checkDatabase();
  dbReady = true;
} catch (e) {
  if (!isDatabaseDown(e)) { console.error("✗ تعذر الاتصال بقاعدة البيانات:", e.message); process.exit(1); }
  console.error("✗ قاعدة البيانات غير متاحة الآن، والمنصة تعرض رسالة الصيانة حتى تعود:", e.message);
}
if (dbReady) await whenReady();
else {
  const retry = setInterval(async () => {
    try {
      if (env.MIGRATION_DATABASE_URL) await migrate({ connectionString: env.MIGRATION_DATABASE_URL, dir: path.resolve("db/migrations"), ssl: env.DATABASE_SSL });
      await checkDatabase();
    } catch (e) { console.error("[قاعدة البيانات] ما زالت غير متاحة:", e.message); return; }
    clearInterval(retry);
    console.log("✓ عادت قاعدة البيانات");
    await whenReady().catch((e) => console.error("[بدء التشغيل]", e.message));
  }, 60_000);
  retry.unref();
}

const server = createApp().listen(env.PORT, () => {
  console.log(`✓ مدار يعمل على المنفذ ${env.PORT}`);
  console.log("  /admin  إدارة المدرسة   |  /teacher  المعلمون   |  /<رمز-المدرسة>  صفحة الطلاب");
  console.log(`  ${env.OWNER_PATH}  لوحة المالك (سرّي)`);
});
const stopDeliveries = startDeliveryWorker();
kickDeliveries();
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

// Background work stays light when nobody is using the platform, so the database can sleep (see core/activity.js).
const timer = setInterval(gated(() => {
  runMaintenance().catch((e) => console.error("[purge]", e.message));
  runReminders().catch((e) => console.error("[تذكيرات]", e.message));
}, { activeEveryMs: 60 * 60 * 1000 }), 60 * 1000);
timer.unref();
const gateTimer = setInterval(gated(() => {
  runGateTick().catch((e) => console.error("[البوابة]", e.message));
  dispatchAlertEmails().catch((e) => console.error("[تنبيه أمني]", e.message));
}, { activeEveryMs: 5 * 60 * 1000 }), 60 * 1000);
gateTimer.unref();
const ownerPushTimer = setInterval(gated(() => dispatchOwnerPush().catch((e) => console.error("[إشعار المالك]", e.message))), 60 * 1000);
ownerPushTimer.unref();

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal}: إيقاف آمن...`);
  server.close(async () => {
    await drainJobs();
    stopDeliveries();
    await deliveriesIdle();
    await closePool().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 30_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
