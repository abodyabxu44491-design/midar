// الاتصال بالخادم: منع الطلبات المكررة، كاش قصير للبيانات المرجعية، إعادة محاولة ذكية، مهلة زمنية،
// واكتشاف نشر إصدار جديد من المنصة.
export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message); this.status = status; this.code = code;
    if (details?.errors) this.errors = details.errors;   // أخطاء أسطر الاستيراد
  }
}

/* ======================= الإصدار والتحديث ======================= */
// إصدار الصفحة المفتوحة (يكتبه الخادم في HTML). كل استجابة API تحمل إصدار الخادم؛ إن اختلفا فهناك نشر جديد.
export const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || "dev";
let updateShown = false;
export function announceUpdate() {
  if (updateShown || APP_VERSION === "dev") return;
  updateShown = true;
  window.__midarUpdatePending = true;
  // شريط ثابت أعلى الصفحة (بدون الاعتماد على ui.js لتجنب الاستيراد الدائري)
  const bar = document.createElement("div");
  bar.className = "update-bar";
  bar.setAttribute("role", "status");
  const txt = document.createElement("span");
  txt.textContent = "يتوفر إصدار جديد من المنصة.";
  const b = document.createElement("button");
  b.type = "button"; b.className = "btn sm"; b.textContent = "تحديث الآن";
  b.addEventListener("click", () => location.reload());
  bar.append(txt, b);
  document.body.append(bar);
}
// نقطة آمنة للتحديث التلقائي: عند الانتقال بين الأقسام (لا يُقطع أي عمل مفتوح)
export function applyPendingUpdate() {
  if (window.__midarUpdatePending) { location.reload(); return true; }
  return false;
}

/* ======================= الطلبات ======================= */
const inflight = new Map();   // GET نفسه أثناء التنفيذ ← نفس الوعد (لا تكرار)
const cache = new Map();      // كاش قصير للبيانات المرجعية
// بيانات تتغير نادرًا وتطلبها أقسام كثيرة (الهيكل، السنة الدراسية، سياق الاختبارات…)
const CACHEABLE = [/\/api\/admin\/setup$/, /\/api\/admin\/academic$/, /\/api\/admin\/structure$/, /\/api\/(admin|teacher)\/papers\/context$/,
  /\/api\/admin\/custom-fields/, /\/api\/admin\/settings\/modules$/];
const CACHE_MS = 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(url, method, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch (e) {
    const timeout = e.name === "AbortError";
    throw new ApiError(timeout ? "استغرق الطلب وقتًا أطول من المتوقع. حاول مرة أخرى." : "تعذر الاتصال بالخادم. تحقق من الإنترنت.",
      0, timeout ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
  const v = res.headers.get("X-App-Version");
  if (v && APP_VERSION !== "dev" && v !== APP_VERSION) announceUpdate(v);
  let data = null;
  try { data = await res.json(); } catch { /* رد بدون محتوى */ }
  if (!res.ok) {
    // توقف الاشتراك أثناء الاستخدام: إعادة التحميل تُظهر شاشة الاشتراك بدل أخطاء متفرقة
    if (data?.code === "subscription_inactive" && !window.__midarLockReload) { window.__midarLockReload = true; setTimeout(() => location.reload(), 1200); }
    throw new ApiError(data?.error || "حدث خطأ غير متوقع", res.status, data?.code, data);
  }
  return data;
}

// إعادة المحاولة لطلبات القراءة فقط (آمنة للتكرار) عند انقطاع الشبكة أو ضغط مؤقت على الخادم.
// طلبات الكتابة لا تُعاد تلقائيًا حتى لا تتكرر عملية (والعمليات المالية لها مفتاح منع تكرار مستقل).
const RETRYABLE = new Set([0, 502, 503, 504]);
async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt >= 2 || !RETRYABLE.has(e.status) || e.code === "timeout") throw e;
      await sleep(attempt === 0 ? 400 : 1200);
    }
  }
}

export async function api(url, body, method) {
  const m = method || (body !== undefined ? "POST" : "GET");
  if (m !== "GET") {
    cache.clear();   // أي تعديل يبطل الكاش المرجعي فورًا (لا بيانات قديمة بعد الحفظ)
    return once(url, m, body, 60_000);
  }
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return structuredClone(hit.data);
  if (inflight.has(url)) return structuredClone(await inflight.get(url));
  const p = withRetry(() => once(url, "GET", undefined, 25_000));
  inflight.set(url, p);
  try {
    const data = await p;
    if (CACHEABLE.some((re) => re.test(url.split("?")[0]))) cache.set(url, { data, until: Date.now() + CACHE_MS });
    return structuredClone(data);
  } finally {
    inflight.delete(url);
  }
}
api.invalidate = () => cache.clear();

// مفتاح فريد لكل عملية مالية: لو ضُغط الزر مرتين أو انقطع الاتصال لا تتكرر العملية
export const idempotencyKey = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
