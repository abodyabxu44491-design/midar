/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// What differs between running on a Node server (Render) and on Cloudflare Workers. The Workers entry
// (workers/setup.js) installs the hooks below before the app loads; on Node none are set and nothing changes.
//
// - background(): work that continues after the response (notifications, after-commit jobs). Node keeps it alive by
//   itself; Workers cancel it when the response ends unless it is handed to waitUntil().
// - databaseUrl(): Hyperdrive gives the connection string per request on Workers; on Node it is DATABASE_URL.
// - perRequestConnections: on Workers a socket opened in one request cannot be used by another, so every transaction
//   opens its own connection (Hyperdrive keeps the real pool). On Node the shared pg.Pool stays.

const hooks = globalThis.__midarPlatform || {};

export const isWorkers = Boolean(hooks.workers);
export const perRequestConnections = isWorkers;

export function background(promise) {
  const p = Promise.resolve(promise).catch((e) => console.error("[background]", e?.message || e));
  if (hooks.waitUntil) hooks.waitUntil(p);
  return p;
}

export const databaseUrl = (fallback) => (hooks.databaseUrl ? hooks.databaseUrl() : null) || fallback;
