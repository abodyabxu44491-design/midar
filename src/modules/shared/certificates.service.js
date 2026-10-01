// الشهادات الرسمية: نتيجة الفصل أو العام من الاختبارات المنشورة، بنسخة ثابتة ورمز تحقق QR
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";
import { classReportCards, buildReportCard } from "./reports.service.js";
import { featureSettings } from "./feature-settings.service.js";
import { notify } from "./notify.service.js";

const qrcode = createRequire(import.meta.url)("qrcode-generator");
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // بلا أحرف متشابهة (O و0، I و1)
const newCode = () => Array.from(crypto.randomBytes(10), (b) => ALPHA[b % ALPHA.length]).join("");

export const issueSchema = z.object({
  class_id: t.id,
  kind: z.enum(["term", "year"]),
  term_id: t.optId,
  student_ids: z.array(t.id).max(500).optional(),
  title: z.string().trim().min(2).max(120).optional(),
  dry_run: z.boolean().default(false),
});

/** النتيجة: ناجح إذا تجاوزت كل مادة حد النجاح */
export function resultOf(card, passMark) {
  if (!card.subjects.length) return { result: "لم تكتمل الدرجات", failed: [], passed: false };
  const failed = card.subjects.filter((s) => s.percent !== null && s.percent < passMark).map((s) => s.subject);
  return failed.length ? { result: `دور ثانٍ في: ${failed.join("، ")}`, failed, passed: false } : { result: "ناجح", failed: [], passed: true };
}

async function scopeOf(q, kind, termId) {
  if (kind === "term") {
    const [term] = await q(`SELECT t.id, t.name, t.year_id, y.name AS year_name FROM terms t JOIN academic_years y ON y.id = t.year_id
      WHERE ($1::bigint IS NULL AND t.is_current) OR t.id = $1`, [termId ?? null]);
    if (!term) throw badRequest("لا يوجد فصل دراسي حالي. حدد الفصل من «السنة الدراسية».");
    return { term_id: term.id, year_id: term.year_id, label: `${term.name} — ${term.year_name}`, cardTerm: term.id };
  }
  const [year] = await q("SELECT id, name FROM academic_years WHERE is_current");
  if (!year) throw badRequest("لا توجد سنة دراسية حالية.");
  return { term_id: null, year_id: year.id, label: `العام الدراسي ${year.name}`, cardTerm: null };
}

/** معاينة أو إصدار شهادات شعبة */
export async function issue(q, b, actor) {
  const [cls] = await q("SELECT id, name FROM classes WHERE id = $1", [b.class_id]);
  if (!cls) throw notFound("الشعبة غير موجودة");
  const scope = await scopeOf(q, b.kind, b.term_id);
  const settings = await featureSettings(q, "certificates");
  let cards = await classReportCards(q, b.class_id, scope.cardTerm);
  if (b.student_ids?.length) cards = cards.filter((c) => b.student_ids.includes(Number(c.student.id)));
  const title = b.title || (b.kind === "term" ? `شهادة نتيجة ${scope.label}` : `شهادة إتمام ${scope.label}`);
  const rows = cards.map((c) => ({ card: c, ...resultOf(c, settings.pass_mark) }));
  if (b.dry_run) {
    return { title, scope: scope.label, pass_mark: settings.pass_mark, students: rows.map((r) => ({
      id: r.card.student.id, name: r.card.student.name, percent: r.card.summary.percent, subjects: r.card.subjects.length,
      result: r.result, passed: r.passed, rank: r.card.rank?.position ?? null })) };
  }
  const issued = [];
  for (const r of rows) {
    if (!r.card.subjects.length) continue;   // لا شهادة بلا درجات منشورة
    await q(`UPDATE certificates SET revoked_at = now(), revoke_reason = 'أُعيد إصدارها'
              WHERE student_id = $1 AND kind = $2 AND COALESCE(term_id, 0) = COALESCE($3::bigint, 0) AND COALESCE(year_id, 0) = COALESCE($4::bigint, 0) AND revoked_at IS NULL`,
      [r.card.student.id, b.kind, scope.term_id, scope.year_id]);
    const data = {
      school: r.card.school, scope: scope.label,
      student: { name: r.card.student.name, class_name: r.card.student.class_name || cls.name, guardian_name: r.card.student.guardian_name || null },
      subjects: r.card.subjects.map((s) => ({ subject: s.subject, score: s.score, max: s.max, percent: s.percent, grade: s.grade })),
      summary: r.card.summary, attendance: r.card.attendance,
      rank: settings.show_rank ? r.card.rank : null,
      result: r.result, passed: r.passed, pass_mark: settings.pass_mark,
      signer: { title: settings.signer_title, name: settings.signer_name }, footer_note: settings.footer_note || null,
    };
    let row;
    for (let i = 0; i < 5 && !row; i++) {
      try {
        [row] = await q(`INSERT INTO certificates (tenant_id, code, student_id, kind, title, term_id, year_id, data, issued_by)
          VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, code`,
          [newCode(), r.card.student.id, b.kind, title, scope.term_id, scope.year_id, JSON.stringify(data), actor]);
      } catch (e) { if (e.code !== "23505" || !String(e.constraint || "").includes("code")) throw e; }
    }
    issued.push({ ...row, student_id: r.card.student.id });
  }
  if (issued.length) {
    await notify(q, { event: "certificate", students: issued.map((x) => x.student_id), title: `صدرت ${title}`,
      body: "يمكنك عرضها وطباعتها من ملف الطالب.", link: "certificates" });
  }
  return { issued: issued.length, ids: issued.map((x) => x.id) };
}

/** شهادة مخصصة لطالب واحد (تفوق، حسن سيرة، مشاركة…) */
export const customSchema = z.object({ student_id: t.id, title: t.shortText("عنوان الشهادة", 120), body: t.shortText("نص الشهادة", 600) });
export async function issueCustom(q, b, actor) {
  const card = await buildReportCard(q, b.student_id);
  if (!card) throw notFound("الطالب غير موجود");
  const settings = await featureSettings(q, "certificates");
  const data = { school: card.school, scope: null, student: { name: card.student.name, class_name: card.student.class_name }, body: b.body,
    signer: { title: settings.signer_title, name: settings.signer_name }, footer_note: settings.footer_note || null };
  const [row] = await q(`INSERT INTO certificates (tenant_id, code, student_id, kind, title, data, issued_by)
    VALUES (app_tenant(), $1, $2, 'custom', $3, $4, $5) RETURNING id, code`, [newCode(), b.student_id, b.title, JSON.stringify(data), actor]);
  await notify(q, { event: "certificate", students: [b.student_id], title: `صدرت ${b.title}`, body: "يمكنك عرضها من ملف الطالب.", link: "certificates" });
  return row;
}

export const list = (q, { class_id = null, student_id = null } = {}) => q(
  `SELECT x.id, x.code, x.kind, x.title, x.issued_at, x.issued_by, x.revoked_at, x.revoke_reason, x.student_id,
          s.full_name AS student, c.name AS class_name, x.data ->> 'result' AS result
     FROM certificates x JOIN students s ON s.id = x.student_id LEFT JOIN classes c ON c.id = s.class_id
    WHERE ($1::bigint IS NULL OR s.class_id = $1) AND ($2::bigint IS NULL OR x.student_id = $2)
    ORDER BY x.issued_at DESC, s.full_name LIMIT 1000`, [class_id, student_id]);

export async function revoke(q, id, reason) {
  const rows = await q("UPDATE certificates SET revoked_at = now(), revoke_reason = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id", [id, reason]);
  if (!rows.length) throw notFound("الشهادة غير موجودة أو ملغاة");
}

/** صورة QR (SVG) لرابط التحقق */
export function qrDataUrl(text) {
  const g = qrcode(0, "M");
  g.addData(text);
  g.make();
  return `data:image/svg+xml;base64,${Buffer.from(g.createSvgTag({ cellSize: 4, margin: 1, scalable: true })).toString("base64")}`;
}

/** بيانات الطباعة: الشهادات كاملة مع رابط التحقق وصورة QR */
export async function forPrint(q, ids, origin, { studentId = null } = {}) {
  const rows = await q(
    `SELECT id, code, kind, title, data, issued_at, revoked_at FROM certificates
      WHERE id = ANY($1) AND ($2::bigint IS NULL OR student_id = $2) ORDER BY id`, [ids, studentId]);
  return rows.map((r) => {
    const url = `${origin}/verify/${r.code}`;
    return { ...r, verify_url: url, qr: qrDataUrl(url) };
  });
}

export const forStudent = (q, studentId) => q(
  `SELECT id, code, kind, title, issued_at, data ->> 'result' AS result FROM certificates
    WHERE student_id = $1 AND revoked_at IS NULL ORDER BY issued_at DESC`, [studentId]);
