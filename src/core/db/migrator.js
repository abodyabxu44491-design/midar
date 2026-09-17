// منفّذ الترحيلات: يطبق ملفات db/migrations بالترتيب، مرة واحدة فقط،
// ويرفض التشغيل إذا تغير ملف سبق تطبيقه (حماية من العبث بالأساس).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

export async function migrate({ connectionString, dir, ssl = false, log = console.log }) {
  const client = new pg.Client({ connectionString, ssl: ssl ? { rejectUnauthorized: true } : false });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727274)"); // يمنع تشغيل ترحيلين معًا
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map((await client.query("SELECT filename, checksum FROM schema_migrations")).rows.map((r) => [r.filename, r.checksum]));
    const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    let count = 0;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      const sum = crypto.createHash("sha256").update(sql).digest("hex");
      if (applied.has(file)) {
        if (applied.get(file) !== sum) throw new Error(`الملف ${file} تغيّر بعد تطبيقه. لا تعدّل ترحيلًا قديمًا، أنشئ ترحيلًا جديدًا.`);
        continue;
      }
      log(`→ تطبيق ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [file, sum]);
        await client.query("COMMIT");
        count++;
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`فشل ${file}: ${e.message}`);
      }
    }
    log(count ? `✓ تم تطبيق ${count} ترحيل` : "✓ قاعدة البيانات محدّثة");
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    await client.end();
  }
}
