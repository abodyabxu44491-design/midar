/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Imported first by the Worker entry, so it runs before any module of the app (see src/core/platform.js).
import { env, waitUntil } from "cloudflare:workers";
import build from "../dist/workers/build.json";
import { recordActivity } from "./schedule.js";

process.env.MIDAR_BUILD_HASH = build.hash;
process.env.MIDAR_BUILT_AT = build.builtAt;
// Hyperdrive gives the database address only inside a request (reading it while modules load is not allowed), so
// connections take it from databaseUrl() below. DATABASE_URL only has to pass the configuration check at start-up.
process.env.DATABASE_URL ||= "postgres://hyperdrive.invalid/set-per-request";

globalThis.__midarPlatform = {
  workers: true,
  waitUntil,
  databaseUrl: () => env.HYPERDRIVE?.connectionString,
  onActive: () => recordActivity(env, waitUntil),
};
