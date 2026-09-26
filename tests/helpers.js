// أدوات الاختبار: تشغيل التطبيق على منفذ عشوائي + متصفح مبسط بكوكيز
import { createApp } from "../src/app.js";
import { closePool } from "../src/core/db/pool.js";

export async function startServer() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

export function client(base, { origin } = {}) {
  const jar = new Map();
  async function call(method, path, body, extra = {}) {
    const headers = { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extra };
    if (origin) headers.Origin = origin;
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = pair.split("=");
      if (v) jar.set(k, v); else jar.delete(k);
    }
    let data = null;
    try { data = await res.json(); } catch { /* */ }
    return { status: res.status, data };
  }
  return {
    get: (p) => call("GET", p),
    post: (p, b = {}, h) => call("POST", p, b, h),
    patch: (p, b) => call("PATCH", p, b),
    put: (p, b) => call("PUT", p, b),
    del: (p) => call("DELETE", p),
    jar,
    cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

export const uid = () => Math.random().toString(36).slice(2, 8);
export const ownerPassword = process.env.TEST_OWNER_PASSWORD;
export const ownerPath = process.env.OWNER_PATH;
export const endPool = () => closePool();
