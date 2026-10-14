/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message); this.status = status; this.code = code;
    if (details?.errors) this.errors = details.errors;
    if (details?.invalid) this.invalid = details.invalid;
    if (details?.retry_after) this.retryAfter = Number(details.retry_after);
    if (details?.tenant_id) this.data = { tenant_id: details.tenant_id };
  }
}

export const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || "dev";
let updateShown = false;
export function announceUpdate() {
  if (updateShown || APP_VERSION === "dev") return;
  updateShown = true;
  window.__midarUpdatePending = true;
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
export function applyPendingUpdate() {
  if (window.__midarUpdatePending) { location.reload(); return true; }
  return false;
}

let demoShown = false;
function announceDemo() {
  if (demoShown) return;
  demoShown = true;
  document.documentElement.classList.add("demo-mode");
  const bar = document.createElement("div");
  bar.className = "demo-bar";
  bar.setAttribute("role", "note");
  const txt = document.createElement("span");
  txt.textContent = "أنت تتصفح مدرسة تجريبية للعرض — التعديل غير متاح.";
  const go = document.createElement("a");
  go.className = "btn sm"; go.href = "/?trial=1"; go.textContent = "اطلب تجربتك المجانية";
  const out = document.createElement("a");
  out.className = "btn ghost sm"; out.href = "/#demo"; out.textContent = "أدوار أخرى";
  bar.append(txt, go, out);
  document.body.append(bar);
}

const inflight = new Map();
const cache = new Map();
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
  if (res.headers.get("X-Demo") === "1") announceDemo();
  const v = res.headers.get("X-App-Version");
  if (v && APP_VERSION !== "dev" && v !== APP_VERSION) announceUpdate(v);
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    if (data?.code === "subscription_inactive" && !window.__midarLockReload) { window.__midarLockReload = true; setTimeout(() => location.reload(), 1200); }
    throw new ApiError(data?.error || "حدث خطأ غير متوقع", res.status, data?.code, data);
  }
  return data;
}

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
    cache.clear();
    return once(url, m, body, 60_000);
  }
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return structuredClone(hit.data);
  if (inflight.has(url)) { const shared = inflight.get(url); shared.shared = true; return structuredClone(await shared); }
  const p = withRetry(() => once(url, "GET", undefined, 25_000));
  inflight.set(url, p);
  try {
    const data = await p;
    const cacheable = CACHEABLE.some((re) => re.test(url.split("?")[0]));
    if (cacheable) cache.set(url, { data, until: Date.now() + CACHE_MS });
    return cacheable || p.shared ? structuredClone(data) : data;
  } finally {
    inflight.delete(url);
  }
}
api.invalidate = () => cache.clear();

export const idempotencyKey = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
