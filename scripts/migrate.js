// تطبيق ترحيلات قاعدة البيانات: npm run migrate
import fs from "node:fs";
import dotenv from "dotenv";
dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });
import path from "node:path";
import { migrate } from "../src/core/db/migrator.js";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) { console.error("✗ عيّن MIGRATION_DATABASE_URL في .env.local"); process.exit(1); }
try {
  await migrate({ connectionString: url, dir: path.resolve("db/migrations"), ssl: process.env.DATABASE_SSL === "true" });
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
}
