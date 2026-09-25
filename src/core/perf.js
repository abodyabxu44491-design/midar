// قياس الأداء لكل طلب: الزمن الكلي، وزمن قاعدة البيانات، وعدد الرحلات إليها.
// يظهر في ترويسة Server-Timing (أدوات المطور في المتصفح ← Network ← Timing)،
// والطلبات البطيئة تُسجَّل في سجل الخادم بمسارها وأرقامها، لتحديد سبب البطء بالقياس لا بالتخمين.
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export const perfStore = new AsyncLocalStorage();
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS || 400);

// يُستدعى من طبقة قاعدة البيانات لكل رحلة
export function recordQuery(ms) {
  const s = perfStore.getStore();
  if (s) { s.q += 1; s.db += ms; }
}
export function recordTx() {
  const s = perfStore.getStore();
  if (s) s.tx += 1;
}

export function perfMiddleware(req, res, next) {
  const store = { q: 0, db: 0, tx: 0, t0: performance.now() };
  perfStore.run(store, () => {
    const writeHead = res.writeHead;
    res.writeHead = function patched(...args) {
      const total = performance.now() - store.t0;
      if (!res.headersSent) {
        res.setHeader("Server-Timing", `total;dur=${total.toFixed(1)}, db;dur=${store.db.toFixed(1)};desc="${store.q} queries/${store.tx} tx"`);
      }
      return writeHead.apply(this, args);
    };
    res.on("finish", () => {
      const total = performance.now() - store.t0;
      if (total > SLOW_MS && req.originalUrl.startsWith("/api/")) {
        console.warn(`[slow] ${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} total=${total.toFixed(0)}ms db=${store.db.toFixed(0)}ms queries=${store.q} tx=${store.tx}`);
      }
    });
    next();
  });
}
