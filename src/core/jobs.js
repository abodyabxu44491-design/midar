// العمليات الطويلة في الخلفية: يُرد على الطلب فورًا برقم العملية، وتعمل العملية بعده،
// وتحدّث تقدمها في جدول jobs (في معاملة مستقلة قصيرة فتظهر فورًا)، والواجهة تسأل عنها كل ثانية.
// النتيجة السرية (كلمات مرور مؤقتة) لا تُكتب في القاعدة: تبقى في الذاكرة 30 دقيقة لصاحب العملية فقط.
import { transaction } from "./db/pool.js";
import { conflict, notFound, publicError } from "./http/errors.js";

const SECRET_TTL = 30 * 60_000;
const secrets = new Map();          // jobId ← { data, until }
const active = new Set();           // العمليات الجارية في هذه النسخة (ينتظرها الإيقاف الآمن)
const DONE_LABELS = { import_students: "استيراد الطلاب", import_teachers: "استيراد المعلمين" };
const scopeOf = (tenantId) => (tenantId ? { tenantId } : { platform: true });

/** صاحب العملية: المالك، أو مستخدم المدرسة الذي بدأها */
export const ownerKeyOf = (req) => (req.user ? `user:${req.user.id}` : "owner");

/**
 * يبدأ عملية في الخلفية ويعيد رقمها فورًا.
 * run({ progress }) يعيد { summary, secret }: summary يُحفظ ويُعرض، وsecret في الذاكرة فقط.
 * لا تُشغَّل عمليتان من النوع نفسه للمدرسة نفسها معًا (حماية من الضغط المزدوج).
 */
export async function startJob({ tenantId = null, kind, total = 0, step = null, req }, run) {
  const ownerKey = ownerKeyOf(req), actor = req.actor, ip = req.ip;
  const [job] = await transaction({ ...scopeOf(tenantId), actor, ip }, async (q) => {
    // عملية عالقة أكثر من ساعة تُعد متوقفة
    await q(`UPDATE jobs SET status = 'failed', error = 'توقفت العملية قبل اكتمالها.', finished_at = now()
              WHERE status = 'running' AND created_at < now() - interval '1 hour'`);
    const rows = await q(`INSERT INTO jobs (tenant_id, kind, total, step, owner_key, created_by) VALUES ($1, $2, $3, $4, $5, $6)
                           ON CONFLICT DO NOTHING RETURNING id`, [tenantId, kind, total, step, ownerKey, actor]);
    if (!rows.length) throw conflict("توجد عملية مماثلة قيد التنفيذ الآن. انتظر انتهاءها.");
    return rows;
  });

  // تحديث التقدم: بحد أقصى مرة كل نصف ثانية، ولا ينتظر العمل الأساسي عليه
  // (الكتابات متسلسلة فلا يصل تحديث قديم بعد أحدث منه)
  let last = 0, pending = Promise.resolve();
  const write = (done, tot, stp) => transaction({ ...scopeOf(tenantId), actor }, (q) =>
    q("UPDATE jobs SET done = $2, total = COALESCE($3, total), step = COALESCE($4, step) WHERE id = $1 AND status = 'running'",
      [job.id, Math.max(0, Math.round(done)), tot ?? null, stp ?? null])).catch(() => {});
  const progress = (done, tot = null, stp = null) => {
    const now = Date.now();
    if (now - last < 500 && !stp) return;
    last = now;
    pending = pending.then(() => write(done, tot, stp));
  };

  const task = (async () => {
    await new Promise((r) => setImmediate(r));      // الرد على الطلب أولًا
    let status = "done", summary = null, error = null;
    try {
      const out = (await run({ progress })) || {};
      summary = out.summary ?? null;
      if (out.secret) secrets.set(job.id, { data: out.secret, owner: ownerKey, until: Date.now() + SECRET_TTL });
    } catch (e) {
      status = "failed";
      const p = publicError(e);
      error = p.message;
      summary = p.details ? { details: p.details } : null;
    }
    await pending;
    await transaction({ ...scopeOf(tenantId), actor }, (q) =>
      q(`UPDATE jobs SET status = $2, summary = $3, error = $4, finished_at = now(), done = CASE WHEN $2 = 'done' THEN GREATEST(total, done) ELSE done END
          WHERE id = $1`, [job.id, status, summary, error])).catch((e) => console.error("job finish", e));
    // إشعار صاحب العملية باكتمالها أو فشلها (يصله حتى لو أغلق الصفحة)
    const label = DONE_LABELS[kind];
    if (label && tenantId && ownerKey.startsWith("user:")) {
      const { notify } = await import("../modules/shared/notify.service.js");
      await transaction({ tenantId, actor: "النظام" }, (q) => notify(q, { event: "system", users: [Number(ownerKey.slice(5))],
        title: status === "done" ? `اكتمل ${label}` : `تعذر ${label}`, priority: status === "done" ? 3 : 2,
        body: status === "done" ? "النتيجة جاهزة في صفحة الاستيراد." : String(error || "").slice(0, 300), dedupKey: `job-${job.id}` }))
        .catch((e) => console.error("job notify", e.message));
    }
  })();
  active.add(task);
  task.finally(() => active.delete(task));
  return { id: job.id };
}

/** حالة العملية لصاحبها فقط. عند الانتهاء تُسلَّم النتيجة السرية (إن وُجدت) مرة واحدة. */
export async function readJob({ tenantId = null, id, req }) {
  const [job] = await transaction({ ...scopeOf(tenantId), actor: req.actor }, (q) => q(
    `SELECT id, kind, status, done, total, step, summary, error, owner_key, created_at, finished_at FROM jobs
      WHERE id = $1 AND tenant_id IS NOT DISTINCT FROM $2`, [id, tenantId]));
  if (!job || job.owner_key !== ownerKeyOf(req)) throw notFound("العملية غير موجودة");
  const { owner_key, ...out } = job;
  if (job.status === "done") {
    const s = secrets.get(job.id);
    if (s && s.owner === owner_key && s.until > Date.now()) out.secret = s.data;
    secrets.delete(job.id);
  }
  return out;
}

// تنظيف دوري للنتائج السرية المنتهية
setInterval(() => { const now = Date.now(); for (const [k, v] of secrets) if (v.until < now) secrets.delete(k); }, 5 * 60_000).unref();

/** الإيقاف الآمن: انتظار العمليات الجارية (بحد أقصى) قبل إغلاق الاتصالات */
export async function drainJobs(ms = 25_000) {
  if (!active.size) return;
  await Promise.race([Promise.allSettled([...active]), new Promise((r) => setTimeout(r, ms))]);
}

/** عند تشغيل الخادم (نسخة واحدة): أي عملية كانت تعمل قبل إعادة التشغيل لن تكتمل */
export async function failInterruptedJobs() {
  await transaction({ platform: true, actor: "system" }, (q) =>
    q(`UPDATE jobs SET status = 'failed', error = 'توقف الخادم أثناء التنفيذ. تحقق من البيانات ثم أعد المحاولة إن لزم.', finished_at = now()
        WHERE status = 'running'`)).catch(() => {});
}
