/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// A small HTTP client with a cookie jar, used to prepare data through the app's own API before the browser runs.
import { BASE } from "./env.mjs";

export function api() {
  const jar = new Map();
  const call = async (method, path, body) => {
    const headers = body !== undefined ? { "Content-Type": "application/json" } : {};
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";"); const i = pair.indexOf("=");
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (v) jar.set(k, v); else jar.delete(k);
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, data };
  };
  const must = async (method, path, body, ok = [200, 201]) => {
    const r = await call(method, path, body);
    if (!ok.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return { call, must, get: (p) => must("GET", p), post: (p, b = {}) => must("POST", p, b) };
}
