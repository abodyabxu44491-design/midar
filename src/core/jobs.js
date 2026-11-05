/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Long jobs (imports, the showcase school). The person who starts one gets its id at once and follows its progress.
//
// Node: the job runs in this process after the response, as before.
// Workers: work after a response is cut off after 30 seconds, so a job described by data (`input`, with a handler in
// job-handlers.js) is stored and sent to a queue; the queue consumer runs it (runQueuedJob) with up to 15 minutes.
// A queued job is claimed once: if the queue delivers it again after a crash it is marked stopped, never run twice
// (an import run twice would create every student twice).
import { transaction } from "./db/pool.js";
import { conflict, notFound, publicError } from "./http/errors.js";
import { background } from "./platform.js";
import { JOB_HANDLERS } from "./job-handlers.js";
import { sealSecret, openSecret } from "./auth/secret-box.js";

const SECRET_TTL = 30 * 60_000;
const secrets = new Map();          // jobId ← { data, until } (jobs run in this process)
const active = new Set();
const DONE_LABELS = { import_students: "استيراد الطلاب", import_teachers: "استيراد المعلمين" };
const STOPPED = "توقفت العملية قبل اكتمالها. تحقق من البيانات ثم أعد المحاولة إن لزم.";
const scopeOf = (tenantId) => (tenantId ? { tenantId } : { platform: true });
const PLATFORM = { platform: true, actor: "النظام" };

export const ownerKeyOf = (req) => (req.user ? `user:${req.user.id}` : "owner");

function progressWriter(jobId, tenantId, actor) {
  let last = 0, pending = Promise.resolve();
  const write = (done, tot, stp) => transaction({ ...scopeOf(tenantId), actor }, (q) =>
    q("UPDATE jobs SET done = $2, total = COALESCE($3, total), step = COALESCE($4, step) WHERE id = $1 AND status = 'running'",
      [jobId, Math.max(0, Math.round(done)), tot ?? null, stp ?? null])).catch(() => {});
  const progress = (done, tot = null, stp = null) => {
    const now = Date.now();
    if (now - last < 500 && !stp) return;
    last = now;
    pending = pending.then(() => write(done, tot, stp));
  };
  return { progress, flush: () => pending };
}

async function execute(jobId, { tenantId, kind, ownerKey, actor }, run, keepSecret) {
  const { progress, flush } = progressWriter(jobId, tenantId, actor);
  let status = "done", summary = null, error = null, secret = null;
  try {
    const out = (await run({ progress })) || {};
    summary = out.summary ?? null;
    secret = out.secret ?? null;
  } catch (e) {
    status = "failed";
    const p = publicError(e);
    error = p.message;
    summary = p.details ? { details: p.details } : null;
  }
  await flush();
  const sealed = secret ? await keepSecret(secret) : null;
  await transaction({ ...scopeOf(tenantId), actor }, (q) =>
    q(`UPDATE jobs SET status = $2, summary = $3, error = $4, finished_at = now(), input = NULL,
              secret_sealed = $5, secret_until = CASE WHEN $5::text IS NULL THEN NULL ELSE now() + make_interval(secs => $6) END,
              done = CASE WHEN $2 = 'done' THEN GREATEST(total, done) ELSE done END
        WHERE id = $1`, [jobId, status, summary, error, sealed, SECRET_TTL / 1000])).catch((e) => console.error("job finish", e));
  const label = DONE_LABELS[kind];
  if (label && tenantId && ownerKey.startsWith("user:")) {
    const { notify } = await import("../modules/shared/notify.service.js");
    await transaction({ tenantId, actor: "النظام" }, (q) => notify(q, { event: "system", users: [Number(ownerKey.slice(5))],
      title: status === "done" ? `اكتمل ${label}` : `تعذر ${label}`, priority: status === "done" ? 3 : 2,
      body: status === "done" ? "النتيجة جاهزة في صفحة الاستيراد." : String(error || "").slice(0, 300), dedupKey: `job-${jobId}` }))
      .catch((e) => console.error("job notify", e.message));
  }
}

// `run` runs the job in this process; or give `input` for a job with a handler in job-handlers.js, which can also run
// from the queue on Workers.
export async function startJob({ tenantId = null, kind, total = 0, step = null, req, input = null }, run = null) {
  const ownerKey = ownerKeyOf(req), actor = req.actor, ip = req.ip;
  const [job] = await transaction({ ...scopeOf(tenantId), actor, ip }, async (q) => {
    await q(`UPDATE jobs SET status = 'failed', error = 'توقفت العملية قبل اكتمالها.', finished_at = now(), input = NULL
              WHERE status = 'running' AND created_at < now() - interval '1 hour'`);
    await q("UPDATE jobs SET secret_sealed = NULL, secret_until = NULL WHERE secret_until < now()");
    const rows = await q(`INSERT INTO jobs (tenant_id, kind, total, step, owner_key, created_by) VALUES ($1, $2, $3, $4, $5, $6)
                           ON CONFLICT DO NOTHING RETURNING id`, [tenantId, kind, total, step, ownerKey, actor]);
    if (!rows.length) throw conflict("توجد عملية مماثلة قيد التنفيذ الآن. انتظر انتهاءها.");
    return rows;
  });

  const enqueue = globalThis.__midarPlatform?.enqueueJob;
  if (input && JOB_HANDLERS[kind] && enqueue) {
    await transaction({ ...scopeOf(tenantId), actor }, (q) => q("UPDATE jobs SET input = $2 WHERE id = $1", [job.id, input]));
    try { await enqueue({ id: job.id }); } catch (e) {
      await transaction({ ...scopeOf(tenantId), actor }, (q) => q(
        "UPDATE jobs SET status = 'failed', error = 'تعذر بدء العملية الآن. حاول مرة أخرى.', finished_at = now(), input = NULL WHERE id = $1", [job.id]));
      throw e;
    }
    return { id: job.id };
  }

  const runFn = run || ((ctx) => JOB_HANDLERS[kind](input, ctx));
  const keepInMemory = async (data) => { secrets.set(job.id, { data, owner: ownerKey, until: Date.now() + SECRET_TTL }); return null; };
  const task = (async () => {
    await new Promise((r) => setImmediate(r));
    await execute(job.id, { tenantId, kind, ownerKey, actor }, runFn, keepInMemory);
  })();
  startSweeper();
  background(task);
  active.add(task);
  task.finally(() => active.delete(task));
  return { id: job.id };
}

// Queue consumer (Workers). Safe to call more than once for the same job.
export async function runQueuedJob(id) {
  const [job] = await transaction(PLATFORM, (q) => q(
    `UPDATE jobs SET claimed_at = now() WHERE id = $1 AND status = 'running' AND claimed_at IS NULL AND input IS NOT NULL
      RETURNING id, tenant_id, kind, input, owner_key, created_by`, [id]));
  if (!job) {
    // Already claimed by an earlier delivery that did not finish (or already finished): never run it again.
    await transaction(PLATFORM, (q) => q(
      "UPDATE jobs SET status = 'failed', error = $2, finished_at = now(), input = NULL WHERE id = $1 AND status = 'running' AND claimed_at IS NOT NULL",
      [id, STOPPED]));
    return { ran: false };
  }
  const handler = JOB_HANDLERS[job.kind];
  // The one-time result (teachers' passwords) is kept encrypted with the platform key until read; without a key it
  // cannot be kept safely, so the job reports that instead of storing it in clear.
  const keepSealed = async (data) => sealSecret(JSON.stringify(data), `job:${job.id}`);
  await execute(job.id, { tenantId: job.tenant_id, kind: job.kind, ownerKey: job.owner_key, actor: job.created_by },
    async (ctx) => {
      const out = await handler(job.input, ctx);
      if (out.secret && !(await keepSealed({}))) return { summary: { ...out.summary, secret_unavailable: true } };
      return out;
    }, keepSealed);
  return { ran: true };
}

export async function readJob({ tenantId = null, id, req }) {
  const [job] = await transaction({ ...scopeOf(tenantId), actor: req.actor }, (q) => q(
    `SELECT id, kind, status, done, total, step, summary, error, owner_key, created_at, finished_at,
            CASE WHEN secret_until > now() THEN secret_sealed END AS secret_sealed FROM jobs
      WHERE id = $1 AND tenant_id IS NOT DISTINCT FROM $2`, [id, tenantId]));
  if (!job || job.owner_key !== ownerKeyOf(req)) throw notFound("العملية غير موجودة");
  const { owner_key, secret_sealed, ...out } = job;
  if (job.status === "done") {
    const s = secrets.get(job.id);
    if (s && s.owner === owner_key && s.until > Date.now()) out.secret = s.data;
    secrets.delete(job.id);
    if (secret_sealed) {
      const opened = openSecret(secret_sealed, `job:${job.id}`);
      if (opened) out.secret = JSON.parse(opened);
      // Shown once, like the in-process result.
      await transaction({ ...scopeOf(tenantId), actor: req.actor }, (q) => q(
        "UPDATE jobs SET secret_sealed = NULL, secret_until = NULL WHERE id = $1", [job.id]));
    }
  }
  return out;
}

// Started on the first job, not at import: Workers do not allow timers while a module loads.
let sweeper = null;
const startSweeper = () => {
  sweeper ??= setInterval(() => { const now = Date.now(); for (const [k, v] of secrets) if (v.until < now) secrets.delete(k); }, 5 * 60_000);
  sweeper.unref?.();
};

export async function drainJobs(ms = 25_000) {
  if (!active.size) return;
  await Promise.race([Promise.allSettled([...active]), new Promise((r) => setTimeout(r, ms))]);
}

export async function failInterruptedJobs() {
  await transaction({ platform: true, actor: "system" }, (q) =>
    q(`UPDATE jobs SET status = 'failed', error = 'توقف الخادم أثناء التنفيذ. تحقق من البيانات ثم أعد المحاولة إن لزم.', finished_at = now(), input = NULL
        WHERE status = 'running' AND input IS NULL AND claimed_at IS NULL`)).catch(() => {});   // not queued jobs (Workers)
}
