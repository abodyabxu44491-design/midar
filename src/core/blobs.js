/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// File contents (attachments, exam media and images, certificate assets, book covers, school backups).
//
// With R2 (Workers with an R2 binding, see workers/setup.js) the bytes go to R2 and the database row keeps only the key,
// so the database stays small (Neon's free tier has 0.5 GB). Without R2 (Node today, or before R2 is turned on) they
// stay in the database exactly as before. Reading works for both, so old and new rows live side by side.
//
// Access is decided by the database, not by R2: a key is only ever read from a row the caller can see through
// row-level security, and every key starts with that school's id, taken from the database (app_tenant()), never from
// the request.
import crypto from "node:crypto";
import { notFound } from "./http/errors.js";

const r2 = () => globalThis.__midarPlatform?.blobs;

// Returns where to store the bytes: { data, key } with exactly one of them set.
export async function keep(q, kind, buffer, mime) {
  const store = r2();
  if (!store) return { data: buffer, key: null };
  const [{ t }] = await q("SELECT app_tenant() AS t");
  if (!t) return { data: buffer, key: null };
  const key = `t/${t}/${kind}/${crypto.randomUUID()}`;
  await store.put(key, buffer, mime);
  return { data: null, key };
}

// The bytes of a row: from the row itself, or from R2 by its key.
export async function load(data, key) {
  if (data) return data;
  if (!key) return null;
  const store = r2();
  if (!store) throw new Error("ملف محفوظ في R2 والخدمة غير متاحة هنا");
  const bytes = await store.get(key);
  if (!bytes) throw notFound("الملف غير موجود");
  return bytes;
}

// After the transaction commits, the object of a deleted or replaced row is removed. A rolled-back transaction keeps it.
export function drop(q, ...keys) {
  const store = r2();
  for (const key of keys) if (key && store) q.afterCommit(() => store.del(key));
}
