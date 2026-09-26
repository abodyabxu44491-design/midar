// تحديد عدد المحاولات لمنع التخمين والإغراق
//
// على Firebase (Cloud Functions) تعمل عدة نسخ من الخادم وتُصفَّر عند كل بدء بارد، فالعدّاد في الذاكرة
// لا يُشارَك بين النسخ. لذلك نقاط الدخول الحساسة (دخول، معرّف الطالب، الدفع) تستخدم مخزنًا مشتركًا
// في قاعدة البيانات، أما الحد العام فيبقى في الذاكرة حتى لا نضيف كتابة في قاعدة البيانات لكل طلب.
import rateLimit from "express-rate-limit";
import { transaction } from "./db/pool.js";

// في بيئة الاختبار تُرفع الحدود حتى لا تتداخل مع الاختبارات الآلية، ويُستخدم مخزن الذاكرة
const isTest = process.env.NODE_ENV === "test";
const factor = isTest ? 100 : 1;

/**
 * مخزن عدّاد مشترك (نافذة ثابتة) على جدول rate_limits.
 * إذا تعذّر الوصول لقاعدة البيانات يُسمح بالطلب (الحماية الأساسية للحسابات في قاعدة البيانات أصلًا).
 */
export class PgStore {
  localKeys = false;                       // العدّاد مشترك بين النسخ
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

const make = (name, windowMin, limit, { shared = false, keyGenerator, skipSuccessfulRequests = false } = {}) => rateLimit({
  ...(keyGenerator ? { keyGenerator } : {}),
  skipSuccessfulRequests,
  windowMs: windowMin * 60_000,
  limit: limit * factor,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.", code: "rate_limited" },
  ...(shared && !isTest ? { store: new PgStore(name) } : {}),
});

export const limits = {
  api: make("api", 1, 180),                              // عام (في الذاكرة)
  site: make("site", 1, 120),                            // /api/site: استعلام قاعدة بيانات بلا تسجيل دخول
  health: make("health", 1, 20),                         // /healthz/db
  login: make("login", 15, 10, { shared: true }),        // الطلبات العامة الحساسة ودخول المالك
  // دخول الموظفين: موظفو المدرسة غالبًا على شبكة واحدة (عنوان واحد)، فالحد لكل حساب وليس لكل شبكة.
  // التخمين محمي أيضًا بقفل الحساب بعد 5 محاولات خاطئة. الدخول الناجح لا يُحسب.
  staffLogin: make("staffLogin", 15, 20, { shared: true, skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.school || "").toLowerCase()}|${String(req.body?.username || "").toLowerCase()}`.slice(0, 200) }),
  staffLoginNet: make("staffLoginNet", 15, 300, { shared: true, skipSuccessfulRequests: true }),   // سقف واسع للشبكة الواحدة
  studentKey: make("studentKey", 10, 20, { shared: true }),   // إدخال معرّف الطالب ورمز الصفحة
  payment: make("payment", 10, 20, { shared: true }),    // الدفع
};
