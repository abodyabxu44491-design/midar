// Same platform hooks as the real Worker entry (workers/setup.js), installed before Midar modules load.
import { waitUntil } from "cloudflare:workers";
globalThis.__midarPlatform = { workers: true, waitUntil };
