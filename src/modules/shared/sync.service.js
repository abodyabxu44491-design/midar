// محرك المزامنة (الخادم): اللقطة الأولى، التغييرات منذ آخر نقطة، استقبال العمليات، والتعارضات
//
// قواعد ثابتة:
//   1) لا منطق مختلف بين الاتصال وعدمه: العمليات تُطبَّق عبر نفس دوال الحضور والدرجات التي تستخدمها الشاشات
//      (نفس الصلاحيات، نفس سبب التعديل المطلوب، نفس قفل الاختبار المُرسل للاعتماد).
//   2) هوية العملية (operation_id) تمنع تكرار الأثر: إعادة الإرسال تعيد النتيجة المحفوظة ولا تُطبّق مرتين.
//   3) لا كتابة صامتة فوق قيمة أحدث: إن تغيّر السجل بعد أن رآه الجهاز (الإصدار مختلف) فهو تعارض يُراجَع.
//   4) الجهاز لا يستلم إلا نطاقه: فصول المعلم المسندة له فقط، وبأقل الحقول اللازمة.
import { z, t } from "../../core/http/validate.js";
import { AppError, badRequest, forbidden, notFound } from "../../core/http/errors.js";
import * as attendance from "./attendance.service.js";
import * as exams from "./exams.service.js";

const ATTENDANCE_DAYS = 30;           // الحضور المحفوظ على الجهاز: آخر 30 يومًا فقط
export const CHANGES_RETENTION_DAYS = 30;

const myClasses = async (q, teacherId) =>
  (await q("SELECT DISTINCT class_id FROM teacher_assignments WHERE teacher_id = $1", [teacherId])).map((r) => Number(r.class_id));

/* ======================= اللقطة الأولى ======================= */
export async function bootstrap(q, teacherId) {
  // المؤشر يُقرأ قبل اللقطة: أي تغيير يحدث أثناءها يصل في الدفعة التالية (التكرار آمن لأن التطبيق upsert)
  const [{ cursor }] = await q("SELECT COALESCE(max(seq), 0)::bigint AS cursor FROM sync_changes");
  const classes = await myClasses(q, teacherId);
  const load = await q(
    `SELECT a.class_id, a.subject_id, c.name AS class_name, s.name AS subject_name
       FROM teacher_assignments a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id
      WHERE a.teacher_id = $1 ORDER BY c.id, s.id`, [teacherId]);
  const students = await q(
    `SELECT id, full_name AS name, class_id FROM students WHERE class_id = ANY($1::bigint[]) AND status = 'active' ORDER BY full_name`, [classes]);
  const att = await q(
    `SELECT a.student_id, a.day, a.status, a.version FROM attendance a JOIN students s ON s.id = a.student_id
      WHERE s.class_id = ANY($1::bigint[]) AND a.day > CURRENT_DATE - $2::int`, [classes, ATTENDANCE_DAYS]);
  const ex = await q(
    `SELECT e.id, e.title, e.class_id, e.subject_id, e.max_score, e.status, e.exam_date FROM exams e
       JOIN teacher_assignments a ON a.class_id = e.class_id AND a.subject_id = e.subject_id AND a.teacher_id = $1
      WHERE e.status IN ('draft', 'pending')`, [teacherId]);
  const sc = ex.length ? await q(
    `SELECT exam_id, student_id, score, version FROM scores WHERE exam_id = ANY($1::bigint[])`, [ex.map((e) => e.id)]) : [];
  return { cursor: Number(cursor), load, students, attendance: att.map(fmtAtt), exams: ex, scores: sc, attendance_days: ATTENDANCE_DAYS };
}
const fmtAtt = (r) => ({ student_id: Number(r.student_id), day: iso(r.day), status: r.status, version: r.version });
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/* ======================= التغييرات منذ آخر نقطة ======================= */
export const changesQuery = z.object({ since: z.coerce.number().int().min(0), limit: z.coerce.number().int().min(1).max(2000).default(500) });

export async function changes(q, teacherId, { since, limit }) {
  // مؤشر أقدم من المحفوظ: التغييرات حُذفت من السجل، فعلى الجهاز إعادة اللقطة
  if (since > 0) {
    const [{ min }] = await q("SELECT min(seq)::bigint AS min FROM sync_changes");
    if (min !== null && since < Number(min) - 1) return { reset: true };
  }
  const rows = await q("SELECT seq, entity, entity_key, class_id, op FROM sync_changes WHERE seq > $1 ORDER BY seq LIMIT $2", [since, limit]);
  const cursor = rows.length ? Number(rows[rows.length - 1].seq) : since;
  const classes = new Set(await myClasses(q, teacherId));
  // آخر حالة لكل سجل ضمن نطاق المعلم فقط (تغييرات الفصول الأخرى تُتخطّى والمؤشر يتقدم)
  const latest = new Map();
  for (const r of rows) if (r.class_id !== null && classes.has(Number(r.class_id))) latest.set(`${r.entity}:${r.entity_key}:${r.class_id}`, r);
  const keys = (entity) => [...latest.values()].filter((r) => r.entity === entity);
  const out = { cursor, has_more: rows.length === limit, attendance: [], scores: [], students: [], exams: [], deleted: [] };

  const att = keys("attendance");
  if (att.length) {
    const pairs = att.map((r) => r.entity_key.split("|"));
    const found = await q(
      `SELECT a.student_id, a.day, a.status, a.version FROM attendance a
        JOIN unnest($1::bigint[], $2::date[]) AS k(sid, d) ON a.student_id = k.sid AND a.day = k.d`,
      [pairs.map((p) => p[0]), pairs.map((p) => p[1])]);
    const have = new Set(found.map((r) => `${r.student_id}|${iso(r.day)}`));
    out.attendance = found.map(fmtAtt);
    for (const r of att) if (!have.has(r.entity_key)) out.deleted.push({ entity: "attendance", key: r.entity_key });
  }
  const sc = keys("score");
  if (sc.length) {
    const pairs = sc.map((r) => r.entity_key.split("|"));
    const found = await q(
      `SELECT s.exam_id, s.student_id, s.score, s.version FROM scores s
        JOIN unnest($1::bigint[], $2::bigint[]) AS k(eid, sid) ON s.exam_id = k.eid AND s.student_id = k.sid`,
      [pairs.map((p) => p[0]), pairs.map((p) => p[1])]);
    const have = new Set(found.map((r) => `${r.exam_id}|${r.student_id}`));
    out.scores = found;
    for (const r of sc) if (!have.has(r.entity_key)) out.deleted.push({ entity: "score", key: r.entity_key });
  }
  const st = keys("student");
  if (st.length) {
    const ids = st.map((r) => Number(r.entity_key));
    const found = await q(`SELECT id, full_name AS name, class_id, status FROM students WHERE id = ANY($1::bigint[])`, [ids]);
    for (const s of found) {
      if (s.status === "active" && classes.has(Number(s.class_id))) out.students.push({ id: s.id, name: s.name, class_id: s.class_id });
      else out.deleted.push({ entity: "student", key: String(s.id) });
    }
    for (const id of ids) if (!found.some((s) => Number(s.id) === id)) out.deleted.push({ entity: "student", key: String(id) });
  }
  const ex = keys("exam");
  if (ex.length) {
    const found = await q(
      `SELECT e.id, e.title, e.class_id, e.subject_id, e.max_score, e.status, e.exam_date FROM exams e
         JOIN teacher_assignments a ON a.class_id = e.class_id AND a.subject_id = e.subject_id AND a.teacher_id = $2
        WHERE e.id = ANY($1::bigint[])`, [ex.map((r) => Number(r.entity_key)), teacherId]);
    out.exams = found;
    for (const r of ex) if (!found.some((e) => String(e.id) === r.entity_key)) out.deleted.push({ entity: "exam", key: r.entity_key });
  }
  return out;
}

/* ======================= استقبال العمليات ======================= */
const opSchema = z.object({
  operation_id: z.string().uuid("هوية العملية غير صحيحة"),
  type: z.enum(["attendance.mark", "score.set"]),
  base_version: z.coerce.number().int().min(0).default(0),
  client_seq: z.coerce.number().int().min(0).optional(),
  client_time: z.string().datetime({ offset: true }).optional(),
  payload: z.record(z.any()),
});
export const pushSchema = z.object({
  device_id: z.string().uuid("هوية الجهاز غير صحيحة"),
  operations: z.array(opSchema).min(1).max(200),
});
const attPayload = z.object({ student_id: t.id, day: t.date, status: z.enum(attendance.STATUSES), reason: t.optText(300) });
const scorePayload = z.object({
  exam_id: t.id, student_id: t.id,
  score: z.union([z.coerce.number().min(0).max(1000), z.null()]),
});

async function registerDevice(q, deviceId, user, req) {
  const [d] = await q(
    `INSERT INTO sync_devices (tenant_id, device_id, user_id, user_agent, last_ip) VALUES (app_tenant(), $1, $2, $3, $4)
     ON CONFLICT (tenant_id, device_id) DO UPDATE SET last_seen = now(), last_ip = EXCLUDED.last_ip
     RETURNING user_id, revoked_at`, [deviceId, user.id, String(req.get("user-agent") || "").slice(0, 200), req.ip || null]);
  if (d.revoked_at) throw forbidden("هذا الجهاز موقوف من إدارة المدرسة. سجّل الدخول من جهاز آخر أو تواصل مع الإدارة.");
  if (Number(d.user_id) !== Number(user.id)) throw forbidden("هذا الجهاز مسجل لمستخدم آخر");
}

/**
 * يطبق عمليات جهاز بالترتيب. كل عملية مستقلة (نقطة حفظ خاصة بها): فشل واحدة لا يلغي غيرها.
 * يعيد نتيجة لكل عملية: applied | conflict | rejected (مع duplicate=true إن كانت مكررة).
 */
export async function push(q, { teacherId, user, actor, req }, body) {
  await registerDevice(q, body.device_id, user, req);
  const ops = [...body.operations].sort((a, b) => (a.client_seq ?? 0) - (b.client_seq ?? 0));
  const results = [];
  for (const op of ops) results.push(await applyOne(q, { teacherId, user, actor, deviceId: body.device_id }, op));
  return { results };
}

async function applyOne(q, ctx, op) {
  // المطالبة بالعملية: إن كانت موجودة (أُرسلت سابقًا) نعيد نتيجتها المحفوظة ولا نطبق شيئًا
  const key = op.type === "attendance.mark" ? `${op.payload.student_id}|${op.payload.day}` : `${op.payload.exam_id}|${op.payload.student_id}`;
  const claimed = await q(
    `INSERT INTO sync_operations (tenant_id, operation_id, device_id, user_id, actor, op_type, entity_key, payload, base_version, client_seq, client_time, status)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'processing')
     ON CONFLICT (tenant_id, operation_id) DO NOTHING RETURNING operation_id`,
    [op.operation_id, ctx.deviceId, ctx.user.id, ctx.actor, op.type, String(key).slice(0, 100), op.payload, op.base_version,
     op.client_seq ?? null, op.client_time ?? null]);
  if (!claimed.length) {
    const [prev] = await q("SELECT status, result, user_id FROM sync_operations WHERE operation_id = $1", [op.operation_id]);
    if (Number(prev.user_id) !== Number(ctx.user.id)) return { operation_id: op.operation_id, status: "rejected", error: "هوية عملية مستخدمة" };
    return { operation_id: op.operation_id, status: prev.status, ...prev.result, duplicate: true };
  }
  let outcome;
  await q("SAVEPOINT sync_op");
  try {
    outcome = op.type === "attendance.mark" ? await applyAttendance(q, ctx, op) : await applyScore(q, ctx, op);
    await q("RELEASE SAVEPOINT sync_op");
  } catch (e) {
    await q("ROLLBACK TO SAVEPOINT sync_op");
    if (!(e instanceof AppError) || e.status >= 500) throw e;
    outcome = { status: "rejected", result: { error: e.message } };
  }
  await q("UPDATE sync_operations SET status = $2, result = $3, class_id = $4 WHERE operation_id = $1",
    [op.operation_id, outcome.status, outcome.result, outcome.classId ?? null]);
  return { operation_id: op.operation_id, status: outcome.status, ...outcome.result };
}

async function applyAttendance(q, ctx, op, { force = false } = {}) {
  const p = attPayload.parse(op.payload);
  const [st] = await q("SELECT class_id FROM students WHERE id = $1", [p.student_id]);
  if (!st) throw notFound("الطالب غير موجود");
  const [cur] = await q("SELECT status, version, recorded_by FROM attendance WHERE student_id = $1 AND day = $2", [p.student_id, p.day]);
  if (cur && cur.status === p.status) return { status: "applied", classId: st.class_id, result: { version: cur.version, unchanged: true } };
  // تغيّر السجل بعد أن رآه الجهاز: تعارض (لا كتابة صامتة)
  if (cur && !force && cur.version !== op.base_version) {
    return { status: "conflict", classId: st.class_id,
      result: { server: { status: cur.status, version: cur.version, by: cur.recorded_by }, local: { status: p.status } } };
  }
  // نفس دالة شاشة الحضور: صلاحية الفصل، ومنع التاريخ المستقبلي، وسبب التعديل
  await attendance.mark(q, { date: p.day, reason: cur ? (p.reason || "تعديل تمت مزامنته من جهاز المعلم") : null,
    entries: [{ student_id: p.student_id, status: p.status }] }, {
    actor: ctx.actor, allowedClass: (classId) => classId !== null && teaches(q, ctx.teacherId, classId) });
  const [now] = await q("SELECT version FROM attendance WHERE student_id = $1 AND day = $2", [p.student_id, p.day]);
  return { status: "applied", classId: st.class_id, result: { version: now.version } };
}

async function applyScore(q, ctx, op, { force = false } = {}) {
  const p = scorePayload.parse(op.payload);
  const e = await exams.get(q, p.exam_id);
  if (!(await teachesPairQ(q, ctx.teacherId, e.class_id, e.subject_id))) throw forbidden("هذا الاختبار ليس ضمن موادك");
  if (e.status !== "draft") throw badRequest("لا يمكن التعديل بعد إرسال الاختبار للاعتماد");
  if (p.score !== null && p.score > Number(e.max_score)) throw badRequest(`الدرجة أكبر من الدرجة العظمى (${e.max_score})`);
  const [cur] = await q("SELECT score, version, updated_by FROM scores WHERE exam_id = $1 AND student_id = $2", [p.exam_id, p.student_id]);
  const same = cur && (cur.score === null ? p.score === null : Number(cur.score) === p.score);
  if (same) return { status: "applied", classId: e.class_id, result: { version: cur.version, unchanged: true } };
  if (cur && !force && cur.version !== op.base_version) {
    return { status: "conflict", classId: e.class_id,
      result: { server: { score: cur.score === null ? null : Number(cur.score), version: cur.version, by: cur.updated_by }, local: { score: p.score } } };
  }
  // نفس دالة شاشة الدرجات
  const n = await exams.saveScores(q, e, { [p.student_id]: p.score }, ctx.actor);
  if (!n) throw badRequest("الطالب ليس في فصل هذا الاختبار");
  const [now] = await q("SELECT version FROM scores WHERE exam_id = $1 AND student_id = $2", [p.exam_id, p.student_id]);
  return { status: "applied", classId: e.class_id, result: { version: now.version } };
}

const teaches = async (q, teacherId, classId) =>
  (await q("SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2 LIMIT 1", [teacherId, classId])).length > 0;
const teachesPairQ = async (q, teacherId, classId, subjectId) =>
  (await q("SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3", [teacherId, classId, subjectId])).length > 0;

/* ======================= التعارضات ======================= */
export async function listConflicts(q, userId = null) {
  return q(
    `SELECT o.operation_id, o.op_type, o.payload, o.result, o.actor, o.device_id, o.received_at, o.client_time,
            s.full_name AS student_name, c.name AS class_name
       FROM sync_operations o
       LEFT JOIN students s ON s.id = (o.payload ->> 'student_id')::bigint
       LEFT JOIN classes c ON c.id = o.class_id
      WHERE o.status = 'conflict' ${userId ? "AND o.user_id = $1" : ""}
      ORDER BY o.received_at DESC LIMIT 200`, userId ? [userId] : []);
}

export const resolveSchema = z.object({ choice: z.enum(["local", "server"]) });

// الحل: «local» يطبّق قيمة الجهاز (بنفس القواعد والصلاحيات) — «server» يبقي القيمة الحالية. كلاهما يُسجَّل.
export async function resolve(q, operationId, choice, { teacherId, userId, actor, admin }) {
  const [op] = await q("SELECT * FROM sync_operations WHERE operation_id = $1 AND status = 'conflict' FOR UPDATE", [operationId]);
  if (!op) throw notFound("التعارض غير موجود أو حُلّ مسبقًا");
  if (!admin && Number(op.user_id) !== Number(userId)) throw notFound("التعارض غير موجود أو حُلّ مسبقًا");   // لا نكشف وجود تعارضات الآخرين
  let applied = null;
  if (choice === "local") {
    const ctx = { teacherId: admin ? null : teacherId, actor };
    const run = op.op_type === "attendance.mark" ? applyAttendanceAs : applyScoreAs;
    applied = await run(q, ctx, op, admin);
  }
  await q(`UPDATE sync_operations SET status = 'resolved', resolved_by = $2, resolved_at = now(),
             result = result || jsonb_build_object('resolution', $3::text) WHERE operation_id = $1`, [operationId, actor, choice]);
  return { resolved: choice, applied };
}
// الإدارة تحل التعارض دون قيد «فصولي» (صلاحيتها على كل الفصول)، والمعلم ضمن فصوله فقط
async function applyAttendanceAs(q, ctx, op, admin) {
  if (!admin) return applyAttendance(q, ctx, { payload: op.payload, base_version: 0 }, { force: true });
  const p = attPayload.parse(op.payload);
  await attendance.mark(q, { date: p.day, reason: "حل تعارض مزامنة (الإدارة)", entries: [{ student_id: p.student_id, status: p.status }] },
    { actor: ctx.actor, allowedClass: async () => true });
  return { status: "applied" };
}
async function applyScoreAs(q, ctx, op, admin) {
  if (!admin) return applyScore(q, ctx, { payload: op.payload, base_version: 0 }, { force: true });
  const p = scorePayload.parse(op.payload);
  const e = await exams.get(q, p.exam_id);
  await exams.saveScores(q, e, { [p.student_id]: p.score }, ctx.actor);
  return { status: "applied" };
}

/* ======================= الأجهزة (للإدارة) ======================= */
export const listDevices = (q) => q(
  `SELECT d.device_id, d.user_id, u.full_name, u.role, d.user_agent, d.first_seen, d.last_seen, d.revoked_at,
          (SELECT count(*)::int FROM sync_operations o WHERE o.device_id = d.device_id) AS operations
     FROM sync_devices d JOIN users u ON u.id = d.user_id ORDER BY d.last_seen DESC LIMIT 500`);
export async function revokeDevice(q, deviceId, actor) {
  const rows = await q("UPDATE sync_devices SET revoked_at = now(), revoked_by = $2 WHERE device_id = $1 AND revoked_at IS NULL RETURNING device_id", [deviceId, actor]);
  if (!rows.length) throw notFound("الجهاز غير موجود أو موقوف مسبقًا");
}

/* ======================= مؤشرات المزامنة (للمراقبة) ======================= */
export async function stats(q) {
  const [r] = await q(
    `SELECT count(*) FILTER (WHERE status = 'applied')::int AS applied, count(*) FILTER (WHERE status = 'conflict')::int AS conflicts,
            count(*) FILTER (WHERE status = 'rejected')::int AS rejected, count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
            round(avg(EXTRACT(EPOCH FROM (received_at - client_time))) FILTER (WHERE client_time IS NOT NULL))::int AS avg_delay_seconds,
            (SELECT count(*)::int FROM sync_devices WHERE revoked_at IS NULL) AS devices
       FROM sync_operations WHERE received_at > now() - interval '30 days'`);
  return r;
}
