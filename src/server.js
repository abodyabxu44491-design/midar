// تشغيل الخادم مع إيقاف آمن (لا تنقطع عملية في منتصفها)
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { getPool, closePool, healthCheck } from "./core/db/pool.js";
import { runMaintenance } from "./core/auth/sessions.js";

try {
  await healthCheck();
  const [{ n }] = (await (await getPool()).query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'tenants'")).rows;
  if (!n) throw new Error("الجداول غير موجودة. شغّل: npm run migrate");
} catch (e) {
  console.error("✗ تعذر الاتصال بقاعدة البيانات:", e.message);
  process.exit(1);
}

const server = createApp().listen(env.PORT, () => {
  console.log(`✓ مِدار يعمل على المنفذ ${env.PORT}`);
  console.log("  /admin  إدارة المدرسة   |  /teacher  المعلمون   |  /s/<رمز>  صفحة الطلاب");
  console.log(`  ${env.OWNER_PATH}  لوحة المالك (سرّي)`);
});
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

const timer = setInterval(() => runMaintenance().catch((e) => console.error("[purge]", e.message)), 60 * 60 * 1000);
timer.unref();

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal}: إيقاف آمن...`);
  server.close(async () => {
    await closePool().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
