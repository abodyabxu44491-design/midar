// الاتصال بقاعدة البيانات
// كل عملية تتم داخل معاملة (Transaction): إما تنجح كاملة أو تُلغى كاملة.
import pg from "pg";
import { env } from "../../config/env.js";

// الأرقام المالية تُقرأ كنص ثم تحول بحذر (تجنب أخطاء الكسور)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));   // numeric
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));     // bigint (المعرفات أقل بكثير من الحد الآمن)
pg.types.setTypeParser(1082, (v) => v);                                  // date كنص YYYY-MM-DD

const common = {
  max: env.CLOUD_SQL_INSTANCE ? 5 : 20,   // على Firebase كل نسخة من الخادم لها اتصالات قليلة
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  application_name: "midar",
};

let poolPromise = null;
let connector = null;

async function createPool() {
  let pool;
  if (env.CLOUD_SQL_INSTANCE) {
    // الاتصال بـ Cloud SQL عبر الموصل الرسمي من Google (اتصال مشفر ومصادق بحساب الخدمة)
    const { Connector } = await import("@google-cloud/cloud-sql-connector");
    const url = new URL(env.DATABASE_URL);
    connector = new Connector();
    const opts = await connector.getOptions({ instanceConnectionName: env.CLOUD_SQL_INSTANCE, ipType: "PUBLIC" });
    pool = new pg.Pool({
      ...opts, ...common,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
    });
  } else {
    pool = new pg.Pool({ ...common, connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : false });
  }
  pool.on("error", (err) => console.error("[db] خطأ في اتصال خامل:", err.message));
  return pool;
}

export function getPool() {
  poolPromise ??= createPool().catch((e) => { poolPromise = null; throw e; });
  return poolPromise;
}

export async function closePool() {
  if (!poolPromise) return;
  const p = await poolPromise;
  await p.end();
  connector?.close();
  poolPromise = null;
}

/**
 * تنفيذ دالة داخل معاملة مع سياق محدد.
 * @param {{tenantId?: string|null, actor?: string, ip?: string|null, platform?: boolean}} ctx
 * @param {(q: (sql: string, params?: any[]) => Promise<any[]>, client: pg.PoolClient) => Promise<T>} fn
 * @template T
 */
export async function transaction(ctx, fn) {
  const client = await (await getPool()).connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    // إعدادات محلية للمعاملة فقط (تُمسح تلقائيًا عند الانتهاء)
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor', $2, true),
              set_config('app.ip', $3, true), set_config('app.platform', $4, true)`,
      [ctx.tenantId || "", ctx.actor || "system", ctx.ip || "", ctx.platform ? "on" : "off"],
    );
    const q = async (sql, params = []) => (await client.query(sql, params)).rows;
    const result = await fn(q, client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// اختصار: تنفيذ في سياق مدرسة
export const inTenant = (req, fn) =>
  transaction({ tenantId: req.tenantId, actor: req.actor, ip: req.ip }, fn);

export async function healthCheck() {
  const r = await (await getPool()).query("SELECT 1 AS ok");
  return r.rows[0].ok === 1;
}
