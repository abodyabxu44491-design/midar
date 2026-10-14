/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
//
import { openDb, deleteDb, dbName } from "./db.js";

const BASE = "/api/teacher/sync";
const keyOf = (o) => (o.type === "attendance.mark" ? `${o.payload.student_id}|${o.payload.day}` : `${o.payload.exam_id}|${o.payload.student_id}`);

const RETENTION_DAYS = 7;
const BATCH = 100;
const listeners = new Set();
let engine = null;

export const getSync = () => engine;
export const onSyncChange = (fn) => { listeners.add(fn); if (engine) fn(engine.state); return () => listeners.delete(fn); };

function deviceId() {
  let id = localStorage.getItem("midar_device_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("midar_device_id", id); }
  return id;
}

async function http(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), body ? 30_000 : 20_000);
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: ctrl.signal,
      headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) { const e = new Error(data?.error || "خطأ في المزامنة"); e.status = res.status; e.code = data?.code; throw e; }
    return data;
  } catch (e) {
    if (e.status) throw e;
    const n = new Error("لا يوجد اتصال"); n.status = 0; throw n;
  } finally { clearTimeout(timer); }
}

export async function startSync({ tenantId, userId, me }) {
  if (engine && engine.key === `${tenantId}:${userId}`) return engine;
  const name = dbName(tenantId, userId);
  const db = await openDb(name);
  const state = { online: navigator.onLine, syncing: false, pending: 0, conflicts: 0, lastSync: null, ready: false, error: null };
  const emit = () => { for (const fn of listeners) fn({ ...state }); };
  const set = (patch) => { Object.assign(state, patch); emit(); };
  let timer = null;

  const countQueue = async () => {
    const all = await db.all("queue");
    set({ pending: all.filter((o) => o.status === "pending" || o.status === "syncing").length, conflicts: all.filter((o) => o.status === "conflict").length });
  };

  async function bootstrap() {
    const b = await http(`${BASE}/bootstrap`);
    const pendingKeys = await pendingEntityKeys();
    await db.tx(["meta", "load", "students", "attendance", "exams", "scores"], "readwrite", (s) => {
      for (const n of ["load", "students", "attendance", "exams", "scores"]) s[n].clear();
      for (const l of b.load) s.load.put({ ...l, k: `${l.class_id}|${l.subject_id}` });
      for (const st of b.students) s.students.put(st);
      for (const a of b.attendance) { const k = `${a.student_id}|${a.day}`; if (!pendingKeys.has(`att:${k}`)) s.attendance.put({ ...a, k }); }
      for (const e of b.exams) s.exams.put(e);
      for (const sc of b.scores) { const k = `${sc.exam_id}|${sc.student_id}`; if (!pendingKeys.has(`score:${k}`)) s.scores.put({ ...sc, k, score: sc.score === null ? null : Number(sc.score) }); }
      s.meta.put({ key: "cursor", value: b.cursor });
      s.meta.put({ key: "lastSync", value: Date.now() });
    });
  }
  async function pendingEntityKeys() {
    const q = await db.all("queue");
    return new Set(q.filter((o) => o.status !== "rejected").map((o) => `${o.type === "attendance.mark" ? "att" : "score"}:${keyOf(o)}`));
  }

  async function pull() {
    let cursor = (await db.meta("cursor")) ?? 0;
    for (let i = 0; i < 20; i++) {
      const ch = await http(`${BASE}/changes?since=${cursor}&limit=500`);
      if (ch.reset) { await bootstrap(); return; }
      const pendingKeys = await pendingEntityKeys();
      await db.tx(["meta", "students", "attendance", "exams", "scores"], "readwrite", (s) => {
        for (const a of ch.attendance) { const k = `${a.student_id}|${a.day}`; if (!pendingKeys.has(`att:${k}`)) s.attendance.put({ ...a, k }); }
        for (const sc of ch.scores) { const k = `${sc.exam_id}|${sc.student_id}`; if (!pendingKeys.has(`score:${k}`)) s.scores.put({ ...sc, k, score: sc.score === null ? null : Number(sc.score) }); }
        for (const st of ch.students) s.students.put(st);
        for (const e of ch.exams) s.exams.put(e);
        for (const d of ch.deleted) {
          if (d.entity === "attendance" && !pendingKeys.has(`att:${d.key}`)) s.attendance.delete(d.key);
          if (d.entity === "score" && !pendingKeys.has(`score:${d.key}`)) s.scores.delete(d.key);
          if (d.entity === "student") s.students.delete(Number(d.key));
          if (d.entity === "exam") s.exams.delete(Number(d.key));
        }
        s.meta.put({ key: "cursor", value: ch.cursor });
        s.meta.put({ key: "lastSync", value: Date.now() });
      });
      cursor = ch.cursor;
      if (!ch.has_more) break;
    }
    const cutoff = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
    const old = (await db.all("attendance")).filter((a) => a.day < cutoff);
    if (old.length) await db.tx("attendance", "readwrite", (s) => { for (const a of old) s.attendance.delete(a.k); });
  }

  let flushing = null;
  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      const now = Date.now();
      const ops = (await db.all("queue")).filter((o) => o.status === "pending" && !o.after && (o.next_attempt || 0) <= now)
        .sort((a, b) => a.client_seq - b.client_seq).slice(0, BATCH);
      if (!ops.length) return;
      await db.tx("queue", "readwrite", (s) => { for (const o of ops) s.queue.put({ ...o, status: "syncing" }); });
      set({ syncing: true });
      try {
        const r = await http(`${BASE}/push`, { device_id: deviceId(), operations: ops.map(({ operation_id, type, payload, base_version, client_seq, client_time }) =>
          ({ operation_id, type, payload, base_version, client_seq, client_time })) });
        const byId = new Map(r.results.map((x) => [x.operation_id, x]));
        const rejected = [];
        const waiting = (await db.all("queue")).filter((x) => x.status === "pending");
        await db.tx(["queue", "attendance", "scores"], "readwrite", (s) => {
          for (const o of ops) {
            const res = byId.get(o.operation_id);
            if (!res) continue;
            if (res.status === "applied" || res.status === "resolved") {
              s.queue.delete(o.operation_id);
              const store = o.type === "attendance.mark" ? "attendance" : "scores";
              const k = keyOf(o);
              const later = waiting.filter((x) => x.after === o.operation_id);
              for (const x of later) s.queue.put({ ...x, base_version: res.version, after: null });
              if (!later.length && !waiting.some((x) => keyOf(x) === k)) {
                s[store].put(o.type === "attendance.mark"
                  ? { k, student_id: o.payload.student_id, day: o.payload.day, status: o.payload.status, version: res.version }
                  : { k, exam_id: o.payload.exam_id, student_id: o.payload.student_id, score: o.payload.score, version: res.version });
              }
            } else if (res.status === "conflict") {
              s.queue.put({ ...o, status: "conflict", server: res.server, local: res.local });
              for (const x of waiting.filter((w) => w.after === o.operation_id)) s.queue.put({ ...x, after: null });
            } else {
              s.queue.delete(o.operation_id);
              rejected.push({ ...o, error: res.error });
              for (const x of waiting.filter((w) => w.after === o.operation_id)) s.queue.put({ ...x, after: null });
            }
          }
        });
        if (rejected.length) set({ error: `رُفضت ${rejected.length} عملية: ${rejected[0].error}` });
        else if (state.error && state.error.startsWith("رُفضت")) set({ error: null });
        set({ online: true });
        if (rejected.length) await pull().catch(() => {});
      } catch (e) {
        if (e.status === 0) set({ online: false });
        else if (e.status === 401) set({ error: "انتهت الجلسة. سجّل الدخول لإكمال المزامنة (عملياتك محفوظة على الجهاز)." });
        else if (e.status === 403) set({ error: e.message });
        await db.tx("queue", "readwrite", (s) => {
          for (const o of ops) {
            const retry = (o.retry_count || 0) + 1;
            s.queue.put({ ...o, status: "pending", retry_count: retry, last_error: e.message, next_attempt: Date.now() + Math.min(300_000, 2000 * 2 ** (retry - 1)) });
          }
        });
      } finally { set({ syncing: false }); await countQueue(); }
    })();
    try { await flushing; } finally { flushing = null; }
    const more = (await db.all("queue")).some((o) => o.status === "pending" && (o.next_attempt || 0) <= Date.now());
    if (more && state.online) return flush();
  }

  async function syncNow() {
    if (!navigator.onLine) { set({ online: false }); return; }
    try {
      await flush();
      await pull();
      set({ online: true, lastSync: Date.now(), error: state.error?.startsWith("رُفضت") ? state.error : null });
    } catch (e) {
      if (e.status === 0) set({ online: false });
      else if (e.status === 401) set({ error: "انتهت الجلسة. سجّل الدخول لإكمال المزامنة." });
    }
    await countQueue();
  }

  async function enqueue(type, payload) {
    const seq = ((await db.meta("seq")) || 0) + 1;
    const isAtt = type === "attendance.mark";
    const k = isAtt ? `${payload.student_id}|${payload.day}` : `${payload.exam_id}|${payload.student_id}`;
    const store = isAtt ? "attendance" : "scores";
    const cur = await db.get(store, k);
    const all = await db.all("queue");
    const queued = all.find((o) => o.status === "pending" && o.type === type && keyOf(o) === k);
    const inflight = all.find((o) => o.status === "syncing" && o.type === type && keyOf(o) === k);
    const op = {
      operation_id: crypto.randomUUID(), type, payload,
      base_version: queued ? queued.base_version : (cur?.version ?? 0),
      after: queued ? queued.after : (inflight ? inflight.operation_id : null),
      client_seq: seq, client_time: new Date().toISOString(), status: "pending", retry_count: 0,
    };
    await db.tx(["queue", "meta", store], "readwrite", (s) => {
      if (queued) s.queue.delete(queued.operation_id);
      s.queue.put(op);
      s.meta.put({ key: "seq", value: seq });
      s[store].put(isAtt ? { k, student_id: payload.student_id, day: payload.day, status: payload.status, version: cur?.version ?? 0, pending: true }
        : { k, exam_id: payload.exam_id, student_id: payload.student_id, score: payload.score, version: cur?.version ?? 0, pending: true });
    });
    await countQueue();
    if (navigator.onLine) setTimeout(() => flush(), 50);
    return op;
  }

  async function conflicts() { return (await db.all("queue")).filter((o) => o.status === "conflict"); }
  async function resolveConflict(operationId, choice) {
    await http(`${BASE}/conflicts/${operationId}/resolve`, { choice });
    await db.del("queue", operationId);
    await syncNow();
  }

  const lastSync = await db.meta("lastSync");
  if (lastSync && Date.now() - lastSync > RETENTION_DAYS * 86400000 && !(await db.count("queue"))) {
    await db.clear(["load", "students", "attendance", "exams", "scores", "meta"]);
  }
  await db.meta("me", me);
  const stuck = (await db.all("queue")).filter((o) => o.status === "syncing");
  if (stuck.length) await db.tx("queue", "readwrite", (s) => { for (const o of stuck) s.queue.put({ ...o, status: "pending" }); });
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  engine = {
    key: `${tenantId}:${userId}`, db, state, enqueue, flush, pull, syncNow, conflicts, resolveConflict,
    hasData: async () => Boolean(await db.meta("cursor")),
    async stop() { clearInterval(timer); engine = null; },
  };

  const onOnline = () => { set({ online: true }); syncNow(); };
  const onOffline = () => set({ online: false });
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && navigator.onLine) syncNow(); });
  timer = setInterval(() => { if (navigator.onLine) syncNow(); }, 30_000);

  try {
    if (!(await db.meta("cursor")) && navigator.onLine) await bootstrap();
    set({ ready: true, lastSync: await db.meta("lastSync") });
    syncNow();
  } catch (e) {
    set({ ready: Boolean(await db.meta("cursor")), online: e.status !== 0 && navigator.onLine });
  }
  await countQueue();
  return engine;
}

export async function wipeLocal(tenantId, userId) {
  if (engine) { engine.db.close(); await engine.stop(); }
  await deleteDb(dbName(tenantId, userId));
  localStorage.removeItem("midar_offline_profile");
}

export const offlineProfile = () => { try { return JSON.parse(localStorage.getItem("midar_offline_profile") || "null"); } catch { return null; } };
export const saveOfflineProfile = (p) => localStorage.setItem("midar_offline_profile", JSON.stringify(p));

export function warmOfflineShell(prefixes = ["/teacher/", "/shared/js/"]) {
  const vprefix = (import.meta.url.match(/^(.*?\/v\/[^/]+)\//) || [])[1];
  if (!vprefix || !navigator.onLine || !("serviceWorker" in navigator)) return;
  let graph = {};
  try { graph = JSON.parse(document.getElementById("module-graph")?.textContent || "{}"); } catch { return; }
  const urls = new Set();
  for (const [k, deps] of Object.entries(graph)) for (const u of [k, ...deps]) if (prefixes.some((p) => u.startsWith(p))) urls.add(u);
  const run = async () => {
    for (const u of urls) { try { await fetch(`${vprefix}${u}`, { credentials: "same-origin" }); } catch { return; } }
  };
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 1500)))(() => run());
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "midar:cache-page", url: location.pathname })).catch(() => {});
}
