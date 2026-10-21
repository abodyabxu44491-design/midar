/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
//
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { transaction } from "./db/pool.js";
import { isDemoSchool } from "../modules/shared/demo.service.js";

const isTest = process.env.NODE_ENV === "test";
const factor = isTest ? 100 : 1;

export class PgStore {
  localKeys = false;
  constructor(prefix) { this.prefix = prefix; this.windowMs = 60_000; }
  init(options) { this.windowMs = options.windowMs; }
  key(k) { return `${this.prefix}:${k}`; }

  async increment(k) {
    try {
      const [row] = await transaction({}, (q) => q(
        `INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2::float8))
         ON CONFLICT (key) DO UPDATE SET
           hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
           reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
         RETURNING hits, reset_at`, [this.key(k), this.windowMs / 1000]));
      return { totalHits: row.hits, resetTime: row.reset_at };
    } catch (e) {
      console.error("[rate-limit] تعذّر الوصول للمخزن المشترك، سيُسمح بالطلب:", e.message);
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }
  async decrement(k) {
    await transaction({}, (q) => q("UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1", [this.key(k)])).catch(() => {});
  }
  async resetKey(k) {
    await transaction({}, (q) => q("DELETE FROM rate_limits WHERE key = $1", [this.key(k)])).catch(() => {});
  }
}

const make = (name, windowMin, limit, { shared = false, keyGenerator, skipSuccessfulRequests = false, skip } = {}) => rateLimit({
  ...(keyGenerator ? { keyGenerator } : {}),
  ...(skip ? { skip } : {}),
  skipSuccessfulRequests,
  windowMs: windowMin * 60_000,
  limit: typeof limit === "function" ? (req) => limit(req) * factor : limit * factor,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.", code: "rate_limited" },
  ...(shared && !isTest ? { store: new PgStore(name) } : {}),
});

// A signed-in user is counted on their own session, not on the address: a whole school (a computer lab, a staff
// room) often reaches the internet through one address, and must not share one allowance. Requests without a session
// are counted per address with an allowance that fits a school network.
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?(midar_[a-z]+|__session)=([^;]{16,})/;
export const sessionOrIp = (req) => {
  const m = SESSION_COOKIE.exec(req.headers.cookie || "");
  return m ? `s:${crypto.createHash("sha256").update(m[2]).digest("base64url").slice(0, 22)}` : `ip:${req.ip}`;
};
// Public pages and online exams: per student (or visitor) within the school, after the body is read.
const perStudent = (req) => `${req.ip}|${String(req.params?.school || "").toLowerCase()}|${Number(req.body?.student_id) || "-"}`.slice(0, 200);

export const limits = {
  api: make("api", 1, (req) => (sessionOrIp(req).startsWith("s:") ? 180 : 600), { keyGenerator: sessionOrIp }),
  publicApi: make("publicApi", 1, 120, { keyGenerator: perStudent }),
  site: make("site", 1, 120),
  health: make("health", 1, 20),                         // /healthz/db
  login: make("login", 15, 10, { shared: true }),
  staffLogin: make("staffLogin", 15, 20, { shared: true, skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.school || "").toLowerCase()}|${String(req.body?.username || "").toLowerCase()}`.slice(0, 200) }),
  staffLoginNet: make("staffLoginNet", 15, 300, { shared: true, skipSuccessfulRequests: true }),
  studentKey: make("studentKey", 10, 20, { shared: true,
    skip: (req) => (req.body && typeof req.body === "object" && !req.body.key && req.body.student_id ? true : isDemoSchool(req.params?.school).catch(() => false)) }),
  parentLogin: make("parentLogin", 15, 20, { shared: true, skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip}|${String(req.params?.school || "").toLowerCase()}|${String(req.body?.phone || "").slice(0, 25)}`.slice(0, 200) }),
  demo: make("demo", 10, 40, { shared: true }),
  payment: make("payment", 10, 20, { shared: true }),
  gatePair: make("gatePair", 15, 20, { shared: true }),
};
