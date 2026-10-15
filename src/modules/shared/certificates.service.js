/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";
import { buildReportCard } from "./reports.service.js";
import * as results from "./results.service.js";
import * as design from "./cert-design.service.js";
import { featureSettings } from "./feature-settings.service.js";
import { notify } from "./notify.service.js";

const qrcode = createRequire(import.meta.url)("qrcode-generator");
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newCode = () => Array.from(crypto.randomBytes(10), (b) => ALPHA[b % ALPHA.length]).join("");

export const issueSchema = z.object({
  class_id: t.id,
  kind: z.enum(["term", "year"]),
  term_id: t.optId,
  student_ids: z.array(t.id).max(500).optional(),
  title: z.string().trim().min(2).max(120).optional(),
  template_id: t.optId,
  dry_run: z.boolean().default(false),
});

export const resultOf = results.resultResult;
const scopeOf = (q, b) => results.classScope(q, { class_id: b.class_id, scope: b.kind, term_id: b.term_id, year_id: b.year_id });

// Writes one certificate with the next serial number. When it replaces an earlier one, the earlier becomes
// «مستبدلة» and points to the new one; nothing is deleted or edited.
export async function writeCertificate(q, { studentId, kind, title, data, actor, termId = null, yearId = null, batchId = null, enrollmentId = null, replaces = null, reason = null }) {
  if (replaces) {
    await q(`UPDATE certificates SET status = 'replaced', revoke_reason = $2, revoked_by = $3 WHERE id = $1 AND status = 'issued'`,
      [replaces, reason || "استُبدلت بشهادة جديدة", actor]);
  }
  let row;
  for (let i = 0; i < 5 && !row; i++) {
    try {
      [row] = await q(`INSERT INTO certificates (tenant_id, code, serial, student_id, kind, title, term_id, year_id, data, issued_by, batch_id, enrollment_id, replaces)
        VALUES (app_tenant(), $1, next_certificate_serial(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, code, serial, title, kind, issued_at`,
      [newCode(), studentId, kind, title, termId, yearId, JSON.stringify(data), actor, batchId, enrollmentId, replaces]);
    } catch (e) { if (e.code !== "23505" || !String(e.constraint || "").includes("code")) throw e; }
  }
  if (!row) throw conflict("تعذر إنشاء رمز فريد للشهادة، أعد المحاولة");
  if (replaces) {
    await q("UPDATE certificates SET replaced_by = $2 WHERE id = $1", [replaces, row.id]);
    await certEvent(q, replaces, "replaced", actor, reason || `استُبدلت بالشهادة ${row.serial}`);
  }
  await certEvent(q, row.id, "issued", actor);
  return row;
}
export const certEvent = (q, id, action, actor, reason = null) => q(
  "INSERT INTO certificate_events (tenant_id, certificate_id, action, actor, reason) VALUES (app_tenant(), $1, $2, $3, $4)", [id, action, actor, reason]);

// Preview (dry run) shows the live results; issuing takes only approved results that still match.
export async function issue(q, b, actor, { reason = null } = {}) {
  const sc = await scopeOf(q, b);
  const title = b.title || (b.kind === "term" ? `شهادة نتيجة ${sc.label}` : `شهادة إتمام ${sc.label}`);
  if (b.dry_run) {
    const { rows, settings } = await results.classResults(q, sc);
    const batch = await results.findBatch(q, sc);
    return { title, scope: sc.label, pass_mark: settings.pass_mark, status: batch?.status || "none", status_label: results.STATUS[batch?.status || "none"],
      students: rows.filter((r) => !b.student_ids?.length || b.student_ids.includes(Number(r.card.student.id))).map((r) => ({
        id: r.card.student.id, name: r.card.student.name, percent: r.card.summary.percent, subjects: r.card.subjects.length,
        result: r.result, passed: r.passed, rank: r.card.rank?.position ?? null })) };
  }
  const ok = await results.approvedResults(q, sc);
  if (ok.stale) return { stale: true };
  let rows = ok.rows;
  if (b.student_ids?.length) rows = rows.filter((r) => b.student_ids.includes(Number(r.card.student.id)));
  const settings = ok.settings;
  const look = await design.layoutFor(q, b.kind, b.template_id ?? null);
  const issued = [];
  for (const r of rows) {
    if (!r.card.subjects.length) continue;
    const [prev] = await q(`SELECT id FROM certificates WHERE student_id = $1 AND kind = $2 AND COALESCE(term_id, 0) = COALESCE($3::bigint, 0)
                              AND COALESCE(year_id, 0) = COALESCE($4::bigint, 0) AND status = 'issued'`,
    [r.card.student.id, b.kind, sc.term_id, sc.year_id]);
    const data = {
      school: r.card.school, scope: sc.label,
      student: { name: r.card.student.name, class_name: r.card.student.class_name || sc.cls.name, guardian_name: r.card.student.guardian_name || null },
      subjects: r.card.subjects.map((s) => ({ subject: s.subject, score: s.score, max: s.max, percent: s.percent, grade: s.grade })),
      summary: r.card.summary, attendance: r.card.attendance,
      rank: settings.show_rank ? r.card.rank : null,
      result: r.result, passed: r.passed, pass_mark: settings.pass_mark,
      signer: { title: settings.signer_title, name: settings.signer_name }, footer_note: settings.footer_note || null,
      approval: { by: ok.batch.approved_by, at: ok.batch.approved_at, version: ok.batch.version },
      layout: look.layout, template: look.template,
    };
    const row = await writeCertificate(q, { studentId: r.card.student.id, kind: b.kind, title, data, actor, termId: sc.term_id, yearId: sc.year_id,
      batchId: ok.batch.id, replaces: prev?.id ?? null, reason: prev ? reason || "أُعيد إصدارها من النتائج المعتمدة" : null });
    issued.push({ ...row, student_id: r.card.student.id });
  }
  if (issued.length) {
    await results.issuedEvent(q, ok.batch.id, actor, issued.length);
    await notify(q, { event: "certificate", students: issued.map((x) => x.student_id), title: `صدرت ${title}`,
      body: "يمكنك عرضها وطباعتها من ملف الطالب.", link: "certificates" });
  }
  return { issued: issued.length, ids: issued.map((x) => x.id) };
}

// A certificate not tied to grades (appreciation, attendance...). Only approvers issue it (checked by the route).
export const customSchema = z.object({ student_id: t.id, title: t.shortText("عنوان الشهادة", 120), body: t.shortText("نص الشهادة", 600), template_id: t.optId });
export async function issueCustom(q, b, actor, { replaces = null, reason = null } = {}) {
  const card = await buildReportCard(q, b.student_id);
  if (!card) throw notFound("الطالب غير موجود");
  const settings = await featureSettings(q, "certificates");
  const look = await design.layoutFor(q, "custom", b.template_id ?? null);
  const data = { school: card.school, scope: null, student: { name: card.student.name, class_name: card.student.class_name }, body: b.body,
    signer: { title: settings.signer_title, name: settings.signer_name }, footer_note: settings.footer_note || null,
    layout: look.layout, template: look.template };
  const row = await writeCertificate(q, { studentId: b.student_id, kind: "custom", title: b.title, data, actor, replaces, reason });
  await notify(q, { event: "certificate", students: [b.student_id], title: `صدرت ${b.title}`, body: "يمكنك عرضها من ملف الطالب.", link: "certificates" });
  return row;
}

export const list = (q, { class_id = null, student_id = null } = {}) => q(
  `SELECT x.id, x.code, x.serial, x.status, x.kind, x.title, x.issued_at, x.issued_by, x.revoked_at, x.revoke_reason, x.revoked_by,
          x.replaces, x.replaced_by, r.serial AS replaced_by_serial, x.student_id,
          s.full_name AS student, c.name AS class_name, x.data ->> 'result' AS result
     FROM certificates x JOIN students s ON s.id = x.student_id LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN certificates r ON r.id = x.replaced_by
    WHERE ($1::bigint IS NULL OR s.class_id = $1) AND ($2::bigint IS NULL OR x.student_id = $2)
    ORDER BY x.issued_at DESC, s.full_name LIMIT 1000`, [class_id, student_id]);

export async function revoke(q, id, reason, actor = "النظام", { kinds = null } = {}) {
  const rows = await q(`UPDATE certificates SET status = 'revoked', revoke_reason = $2, revoked_by = $3
                         WHERE id = $1 AND status = 'issued' AND ($4::text[] IS NULL OR kind = ANY($4)) RETURNING id, code, serial`, [id, reason, actor, kinds]);
  if (!rows.length) throw notFound("الشهادة غير موجودة أو ملغاة");
  await certEvent(q, id, "revoked", actor, reason);
  return rows[0];
}

// Revoke and issue a replacement: grade certificates come again from the approved results; a custom one takes
// the corrected title and text.
export const replaceSchema = z.object({ reason: t.shortText("سبب الاستبدال", 200), title: t.optText(120), body: t.optText(600), template_id: t.optId });
export async function replace(q, id, b, actor) {
  const [c] = await q("SELECT x.*, s.class_id FROM certificates x JOIN students s ON s.id = x.student_id WHERE x.id = $1", [id]);
  if (!c || c.status !== "issued") throw notFound("الشهادة غير موجودة أو ملغاة");
  if (c.kind === "custom") {
    const row = await issueCustom(q, { student_id: c.student_id, title: b.title || c.title, body: b.body || c.data.body, template_id: b.template_id },
      actor, { replaces: c.id, reason: b.reason });
    return { issued: 1, ids: [row.id] };
  }
  if (!["term", "year"].includes(c.kind)) throw badRequest("استبدال هذه الشهادة يكون من صفحة الدورة");
  const [batch] = c.batch_id ? await q("SELECT class_id FROM result_batches WHERE id = $1", [c.batch_id]) : [];
  const classId = batch?.class_id ?? c.class_id;
  if (!classId) throw badRequest("الطالب ليس في شعبة حاليًا");
  const out = await issue(q, { class_id: classId, kind: c.kind, term_id: c.term_id, year_id: c.year_id, student_ids: [c.student_id], title: c.title, template_id: b.template_id, dry_run: false },
    actor, { reason: b.reason });
  if (!out.stale && !out.issued) throw badRequest("لا توجد نتيجة معتمدة لهذا الطالب لإصدار شهادة بديلة");
  return out;
}

export function qrDataUrl(text) {
  const g = qrcode(0, "M");
  g.addData(text);
  g.make();
  return `data:image/svg+xml;base64,${Buffer.from(g.createSvgTag({ cellSize: 4, margin: 1, scalable: true })).toString("base64")}`;
}

export async function forPrint(q, ids, origin, { studentId = null, actor = null } = {}) {
  const rows = await q(
    `SELECT id, code, serial, status, kind, title, data, issued_at, revoked_at FROM certificates
      WHERE id = ANY($1) AND ($2::bigint IS NULL OR student_id = $2) ORDER BY id`, [ids, studentId]);
  if (actor) for (const r of rows) await certEvent(q, r.id, "printed", actor);
  // Each design image travels once, with the first certificate that uses it; the page merges them.
  const all = await design.assetsFor(q, rows.map((r) => r.data?.layout));
  const sent = new Set();
  return rows.map((r) => {
    const url = `${origin}/verify/${r.code}`;
    const mine = {};
    for (const id of r.data?.layout ? [r.data.layout.page?.bgAsset, ...r.data.layout.els.map((e) => e.asset)] : []) {
      if (id && all[id] && !sent.has(id)) { mine[id] = all[id]; sent.add(id); }
    }
    return { ...r, verify_url: url, qr: qrDataUrl(url), assets: mine };
  });
}

export const forStudent = (q, studentId) => q(
  `SELECT id, code, serial, kind, title, issued_at, data ->> 'result' AS result FROM certificates
    WHERE student_id = $1 AND status = 'issued' ORDER BY issued_at DESC`, [studentId]);
