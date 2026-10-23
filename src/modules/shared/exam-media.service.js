/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Sound for exam questions (uploaded by the teacher), and the files a student answers with in an online exam:
// a photo of the solution or a voice recording. Files are kept in the database like the exam images; videos are
// added as links (YouTube and the like) and never stored. Videos uploaded before this rule still play.
import { z } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";
import { matchesMime } from "./attachments.service.js";

export const MEDIA_MAX = 10 * 1024 * 1024;
export const ANSWER_MAX = 5 * 1024 * 1024;

const MEDIA_MIMES = ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "video/mp4", "video/webm"];
const ANSWER_MIMES = ["image/jpeg", "image/png", "image/webp", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/wav"];

const ftyp = (b) => b.length > 12 && b.subarray(4, 8).toString("latin1") === "ftyp";
const ebml = (b) => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
const ogg = (b) => b.length > 4 && b.subarray(0, 4).toString("latin1") === "OggS";
const mp3 = (b) => b.length > 3 && (b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));
const adts = (b) => b.length > 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0;
const wav = (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WAVE";
const SIGNATURES = {
  "audio/mpeg": mp3, "audio/mp4": ftyp, "audio/aac": (b) => adts(b) || ftyp(b), "audio/ogg": ogg, "audio/webm": ebml, "audio/wav": wav,
  "video/mp4": ftyp, "video/webm": ebml,
};
// Phones label the same files differently; these are the names the browser may send for a supported format.
const ALIASES = { "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "audio/mp3": "audio/mpeg", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "video/quicktime": "video/mp4" };
const canonical = (mime) => {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  return ALIASES[m] || m;
};
const fits = (buffer, mime) => (SIGNATURES[mime] ? SIGNATURES[mime](buffer) : matchesMime(buffer, mime));

const fileBody = (max) => z.object({
  mime: z.string().trim().min(3).max(80),
  data: z.string().min(16).max(Math.ceil(max * 1.37)),          // base64
  name: z.string().trim().max(150).optional(),
});
export const mediaUploadSchema = fileBody(MEDIA_MAX);
export const answerUploadSchema = fileBody(ANSWER_MAX).extend({ question_id: z.string().regex(/^[a-z]_[a-z0-9]{3,20}$/) });

function decode(file, allowed, max, what) {
  const mime = canonical(file.mime);
  if (!allowed.includes(mime)) throw badRequest(what === "media"
    ? "الملفات المسموحة: صوت (MP3 أو M4A أو OGG أو WAV)"
    : "الملفات المسموحة: صورة (JPG أو PNG) أو تسجيل صوتي");
  const buffer = Buffer.from(file.data, "base64");
  if (!buffer.length) throw badRequest("الملف فارغ");
  if (buffer.length > max) throw badRequest(`حجم الملف أكبر من ${Math.round(max / 1048576)} ميجابايت`);
  if (!fits(buffer, mime)) throw badRequest("محتوى الملف لا يطابق نوعه. ارفع ملفًا سليمًا");
  return { mime, buffer, kind: mime.split("/")[0] };
}

export async function saveMedia(q, { teacherId = null, file, actor }) {
  // Videos are added by link (YouTube, Vimeo, Google Drive) so the school's database stays light; only sound is uploaded.
  if (canonical(file.mime).startsWith("video/")) throw badRequest("الفيديو يُضاف برابط (يوتيوب أو فيميو أو قوقل درايف) ولا يُرفع. ارفع المقاطع الصوتية فقط");
  const { mime, buffer, kind } = decode(file, MEDIA_MIMES, MEDIA_MAX, "media");
  const [row] = await q(
    `INSERT INTO exam_media (tenant_id, kind, teacher_id, mime, size_bytes, data, name, uploaded_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id, kind, mime, size_bytes, name`,
    [kind, teacherId, mime, buffer.length, buffer, file.name || null, actor]);
  return row;
}

export async function readMedia(q, id) {
  const [row] = await q("SELECT kind, mime, data FROM exam_media WHERE id = $1", [id]);
  if (!row) throw notFound("الملف غير موجود");
  return row;
}

// Sends a stored file, honouring a byte range so phones can seek in a video or audio clip.
export function sendMedia(req, res, { mime, data }) {
  const buf = Buffer.from(data);
  res.set({ "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.get("range") || "");
  if (!m || (m[1] === "" && m[2] === "")) return res.send(buf);
  let start = m[1] === "" ? Math.max(0, buf.length - Number(m[2])) : Number(m[1]);
  let end = m[1] !== "" && m[2] !== "" ? Number(m[2]) : buf.length - 1;
  end = Math.min(end, buf.length - 1);
  if (start > end || start >= buf.length) { res.set("Content-Range", `bytes */${buf.length}`); return res.status(416).end(); }
  res.status(206).set("Content-Range", `bytes ${start}-${end}/${buf.length}`);
  return res.send(buf.subarray(start, end + 1));
}

/* ---------- the student's answer files ---------- */
export async function saveAnswerFile(q, attemptId, question, file) {
  const { mime, buffer, kind } = decode(file, ANSWER_MIMES, ANSWER_MAX, "answer");
  if (kind !== question.respond) throw badRequest(question.respond === "audio" ? "هذا السؤال يُجاب بتسجيل صوتي" : "هذا السؤال يُجاب بصورة");
  await q(
    `INSERT INTO online_answer_files (tenant_id, attempt_id, question_id, kind, mime, size_bytes, data)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (attempt_id, question_id) DO UPDATE SET kind = EXCLUDED.kind, mime = EXCLUDED.mime,
       size_bytes = EXCLUDED.size_bytes, data = EXCLUDED.data, created_at = now()`,
    [attemptId, question.id, kind, mime, buffer.length, buffer]);
  return { kind, size_bytes: buffer.length };
}

export async function readAnswerFile(q, attemptId, questionId) {
  const [row] = await q("SELECT kind, mime, data FROM online_answer_files WHERE attempt_id = $1 AND question_id = $2", [attemptId, questionId]);
  if (!row) throw notFound("لا يوجد ملف لهذا السؤال");
  return row;
}

export const answerFilesOf = async (q, attemptId) => new Set((await q(
  "SELECT question_id FROM online_answer_files WHERE attempt_id = $1", [attemptId])).map((r) => r.question_id));
