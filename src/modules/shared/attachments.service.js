// المرفقات: صورة الفاتورة أو الإيصال، محفوظة داخل قاعدة البيانات
// لا تحتاج حساب تخزين خارجي، وتُنسخ احتياطيًا مع بقية البيانات.
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";

export const MAX_BYTES = 2 * 1024 * 1024;
const MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export const uploadSchema = z.object({
  filename: t.shortText("اسم الملف", 160),
  mime: z.enum(MIMES, { errorMap: () => ({ message: "الملفات المسموحة: صورة JPG أو PNG أو WEBP أو ملف PDF" }) }),
  data: z.string().min(16).max(Math.ceil(MAX_BYTES * 1.4)),      // base64
});

export const list = (q, entityType, entityId) => q(
  `SELECT id, filename, mime, size_bytes, uploaded_by, created_at
     FROM attachments WHERE entity_type = $1 AND entity_id = $2 ORDER BY id`, [entityType, entityId]);

export const listForEntities = (q, entityType, ids) => (ids.length ? q(
  `SELECT id, entity_id, filename, mime, size_bytes FROM attachments
    WHERE entity_type = $1 AND entity_id = ANY($2::bigint[]) ORDER BY id`, [entityType, ids]) : []);

// نوع الملف يُتحقق منه من محتواه وليس مما يعلنه المرسل، حتى لا يُخزَّن ملف آخر بصفة صورة
const SIGNATURES = {
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "application/pdf": (b) => b.length > 5 && b.subarray(0, 5).toString("latin1") === "%PDF-",
};
export const matchesMime = (buffer, mime) => Boolean(SIGNATURES[mime]?.(buffer));

export async function upload(q, { entityType, entityId, file, actor }) {
  const buffer = Buffer.from(file.data, "base64");
  if (!buffer.length) throw badRequest("الملف فارغ");
  if (buffer.length > MAX_BYTES) throw badRequest("حجم الملف أكبر من 2 ميجابايت");
  if (!matchesMime(buffer, file.mime)) throw badRequest("محتوى الملف لا يطابق نوعه. ارفع صورة JPG أو PNG أو WEBP أو ملف PDF سليمًا");
  const [row] = await q(
    `INSERT INTO attachments (tenant_id, entity_type, entity_id, filename, mime, size_bytes, data, uploaded_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id, filename, mime, size_bytes`,
    [entityType, entityId, file.filename, file.mime, buffer.length, buffer, actor]);
  return row;
}

export async function download(q, id) {
  const [row] = await q("SELECT filename, mime, data FROM attachments WHERE id = $1", [id]);
  if (!row) throw notFound("المرفق غير موجود");
  return row;
}

export async function remove(q, id) {
  const rows = await q("DELETE FROM attachments WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("المرفق غير موجود");
}
