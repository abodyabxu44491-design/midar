/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Official transcripts (كشف الدرجات): viewed live from the results at any time (marked as a draft), and issued
// officially only from internally approved results. An issued transcript is kept as a certificate record of kind
// "transcript" (serial number, verification code, status); issuing again after a correction makes a new version
// and the previous one stays in the record as replaced.
import { z, t } from "../../core/http/validate.js";
import { notFound } from "../../core/http/errors.js";
import * as results from "./results.service.js";
import { writeCertificate } from "./certificates.service.js";
import { notify } from "./notify.service.js";
import { buildXlsx } from "../../core/xlsx.js";

// What a transcript shows, chosen by each school (saved with the certificates settings).
export const OPTIONS = {
  tr_components: "توزيع الدرجة (أعمال السنة، النهائي…) عند وجوده",
  tr_percent: "النسبة لكل مادة",
  tr_grade: "التقدير لكل مادة",
  tr_subject_result: "حالة كل مادة (ناجح / دور ثانٍ)",
  tr_absence: "الحضور والغياب",
  tr_guardian_sign: "توقيع ولي الأمر",
};

export const transcriptSchema = results.classKeySchema.extend({
  student_ids: z.array(t.id).min(1).max(1000).optional(),
  notes: z.record(z.string().regex(/^\d{1,18}$/), z.string().trim().max(300)).optional(),
  reason: t.optText(200),
});
const scopeOf = (q, b) => results.classScope(q, { class_id: b.class_id, scope: b.scope, term_id: b.term_id, year_id: b.year_id });
const scopeTitle = (sc) => `كشف درجات ${sc.label}`;

async function studentInfo(q, ids) {
  if (!ids.length) return new Map();
  const rows = await q(
    `SELECT s.id, s.student_no, g.name AS grade, st.name AS stage FROM students s
       LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN stages st ON st.id = g.stage_id
      WHERE s.id = ANY($1)`, [ids]);
  return new Map(rows.map((r) => [Number(r.id), r]));
}

// The content of one student's transcript, from his results row.
function contentOf(row, sc, settings, info, note) {
  const c = row.card;
  const pass = settings.pass_mark;
  return {
    school: c.school, scope: sc.label, scope_kind: sc.scope,
    student: {
      name: c.student.name, class_name: c.student.class_name || sc.cls.name, guardian_name: c.student.guardian_name || null,
      student_no: info?.student_no || null, grade: info?.grade || null, stage: info?.stage || null,
    },
    subjects: c.subjects.map((s) => ({
      subject: s.subject, score: s.score, max: s.max, percent: s.percent, grade: s.grade,
      passed: s.percent === null ? null : s.percent >= pass,
      components: s.components ? s.components.map((p) => ({ name: p.name, weight: p.weight, earned: p.earned })) : null,
    })),
    summary: c.summary,
    attendance: { absent: c.attendance.absent, late: c.attendance.late, rate: c.attendance.rate },
    rank: settings.show_rank ? c.rank : null,
    result: row.result, passed: row.passed, pass_mark: pass,
    options: Object.fromEntries(Object.keys(OPTIONS).map((k) => [k, settings[k] !== false])),
    note: note || null,
    signer: { title: settings.signer_title, name: settings.signer_name },
    footer_note: settings.footer_note || null,
  };
}

const currentOf = (q, ids, sc) => (ids.length ? q(
  `SELECT id, student_id, serial, issued_at, COALESCE((data ->> 'version')::int, 1) AS version FROM certificates
    WHERE kind = 'transcript' AND status = 'issued' AND student_id = ANY($1)
      AND COALESCE(term_id, 0) = COALESCE($2::bigint, 0) AND COALESCE(year_id, 0) = COALESCE($3::bigint, 0)`,
  [ids, sc.term_id, sc.year_id]) : []);

// The live transcripts of a class (all students, or the chosen ones), with the approval state and what is already issued.
export async function preview(q, b) {
  const sc = await scopeOf(q, b);
  const live = await results.classResults(q, sc);
  const batch = await results.findBatch(q, sc);
  const ids = live.rows.map((r) => Number(r.card.student.id));
  const info = await studentInfo(q, ids);
  const issued = new Map((await currentOf(q, ids, sc)).map((x) => [Number(x.student_id), x]));
  const status = batch?.status || "none";
  const [grade] = sc.cls.grade_id ? await q("SELECT id, name FROM grades WHERE id = $1", [sc.cls.grade_id]) : [];
  const chosen = b.student_ids?.length ? new Set(b.student_ids.map(Number)) : null;
  return {
    title: scopeTitle(sc), scope: sc.label, class_name: sc.cls.name, grade_id: grade?.id ?? null, grade_name: grade?.name ?? null, status, status_label: results.STATUS[status],
    ready: status === "approved" && batch.snapshot_hash === live.hash,
    pass_mark: live.settings.pass_mark, options: Object.fromEntries(Object.keys(OPTIONS).map((k) => [k, live.settings[k] !== false])),
    show_rank: live.settings.show_rank,
    students: live.rows.map((r) => {
      const id = Number(r.card.student.id), x = issued.get(id);
      return { id, name: r.card.student.name, student_no: info.get(id)?.student_no || null, subjects: r.card.subjects.length,
        percent: r.card.summary.percent, result: r.result, passed: r.passed,
        issued: x ? { id: x.id, serial: x.serial, version: x.version, issued_at: x.issued_at } : null };
    }),
    transcripts: live.rows.filter((r) => r.card.subjects.length && (!chosen || chosen.has(Number(r.card.student.id))))
      .map((r) => contentOf(r, sc, live.settings, info.get(Number(r.card.student.id)), b.notes?.[r.card.student.id])),
  };
}

// Issues official transcripts from the approved results (a new version for students who already have one).
export async function issue(q, b, actor) {
  const sc = await scopeOf(q, b);
  const ok = await results.approvedResults(q, sc);
  if (ok.stale) return { stale: true };
  let rows = ok.rows.filter((r) => r.card.subjects.length);
  if (b.student_ids?.length) { const set = new Set(b.student_ids.map(Number)); rows = rows.filter((r) => set.has(Number(r.card.student.id))); }
  const ids = rows.map((r) => Number(r.card.student.id));
  const info = await studentInfo(q, ids);
  const current = new Map((await currentOf(q, ids, sc)).map((x) => [Number(x.student_id), x]));
  const out = [];
  for (const r of rows) {
    const id = Number(r.card.student.id), prev = current.get(id);
    const data = {
      ...contentOf(r, sc, ok.settings, info.get(id), b.notes?.[id]),
      version: (prev?.version || 0) + 1,
      approval: { by: ok.batch.approved_by, at: ok.batch.approved_at, version: ok.batch.version },
    };
    const row = await writeCertificate(q, { studentId: id, kind: "transcript", title: scopeTitle(sc), data, actor,
      termId: sc.term_id, yearId: sc.year_id, batchId: ok.batch.id, replaces: prev?.id ?? null,
      reason: prev ? b.reason || "نسخة جديدة من كشف الدرجات بعد تصحيح النتائج" : null });
    out.push({ ...row, student_id: id, version: data.version });
  }
  if (out.length) {
    await notify(q, { event: "certificate", students: out.map((x) => x.student_id), title: `صدر ${scopeTitle(sc)}`,
      body: "يمكنك عرضه وطباعته من ملف الطالب.", link: "certificates" });
  }
  return { issued: out.length, new_versions: out.filter((x) => x.version > 1).length, ids: out.map((x) => x.id) };
}

// Issued transcripts of a scope for a whole grade (all its classes) or one class, for printing together.
export async function issuedIds(q, { grade_id = null, class_id = null, scope, term_id = null }) {
  const sc = await results.classScope(q, { class_id: class_id ?? (await firstClass(q, grade_id)), scope, term_id });
  const rows = await q(
    `SELECT x.id FROM certificates x JOIN students s ON s.id = x.student_id JOIN classes c ON c.id = s.class_id
      WHERE x.kind = 'transcript' AND x.status = 'issued' AND COALESCE(x.term_id, 0) = COALESCE($1::bigint, 0) AND COALESCE(x.year_id, 0) = COALESCE($2::bigint, 0)
        AND (($3::bigint IS NOT NULL AND c.id = $3) OR ($3::bigint IS NULL AND c.grade_id = $4))
      ORDER BY c.name, s.full_name`, [sc.term_id, sc.year_id, class_id, grade_id]);
  return rows.map((r) => r.id);
}
async function firstClass(q, gradeId) {
  const [c] = await q("SELECT id FROM classes WHERE grade_id = $1 ORDER BY name LIMIT 1", [gradeId]);
  if (!c) throw notFound("لا توجد شعب في هذا الصف");
  return c.id;
}

// The class results as an Excel workbook: one row per student, the subjects' details, and what the file is.
export async function workbook(q, b) {
  const p = await preview(q, b);
  const subjects = [];
  for (const tr of p.transcripts) for (const s of tr.subjects) if (!subjects.includes(s.subject)) subjects.push(s.subject);
  const n = (v) => (v === null || v === undefined ? "" : v);
  const summary = {
    name: "النتائج",
    headers: ["م", "الطالب", "الرقم التعريفي", ...subjects, "المجموع", "من", "النسبة %", "التقدير", "النتيجة", p.show_rank ? "الترتيب" : null, "أيام الغياب"].filter((x) => x !== null),
    rows: p.transcripts.map((tr, i) => [i + 1, tr.student.name, n(tr.student.student_no),
      ...subjects.map((name) => n(tr.subjects.find((s) => s.subject === name)?.score)),
      n(tr.summary.total), n(tr.summary.max), n(tr.summary.percent), n(tr.summary.grade), tr.result,
      ...(p.show_rank ? [tr.rank ? tr.rank.position : ""] : []), n(tr.attendance.absent)]),
    widths: [6, 28, 14, ...subjects.map(() => 12), 10, 8, 10, 12, 26, 9, 11],
    textColumns: [2],
  };
  const compNames = [];
  for (const tr of p.transcripts) for (const s of tr.subjects) for (const c of s.components || []) if (!compNames.includes(c.name)) compNames.push(c.name);
  const detail = {
    name: "تفصيل المواد",
    headers: ["الطالب", "المادة", ...compNames, "الدرجة", "من", "النسبة %", "التقدير", "الحالة"],
    rows: p.transcripts.flatMap((tr) => tr.subjects.map((s) => [tr.student.name, s.subject,
      ...compNames.map((c) => n(s.components?.find((x) => x.name === c)?.earned)), n(s.score), n(s.max), n(s.percent), n(s.grade),
      s.passed === null ? "" : s.passed ? "ناجح" : "دور ثانٍ"])),
    widths: [28, 20, ...compNames.map(() => 14), 10, 8, 10, 12, 12],
  };
  const about = {
    name: "معلومات",
    headers: ["البند", "القيمة"],
    rows: [["المؤسسة", p.transcripts[0]?.school || ""], ["الشعبة", p.class_name], ["النطاق", p.scope],
      ["حالة النتائج", p.ready ? "معتمدة داخليًا" : `${p.status_label} — ليست نسخة رسمية`], ["حد النجاح في كل مادة", `${p.pass_mark}%`],
      ["عدد الطلاب", String(p.transcripts.length)], ["تاريخ التصدير", new Date().toISOString().slice(0, 10)]],
    widths: [24, 50],
  };
  return { buffer: buildXlsx([summary, detail, about]), filename: `نتائج-${p.class_name}-${p.scope}.xlsx`.replace(/[\\/:*?"<>|]/g, "-") };
}
