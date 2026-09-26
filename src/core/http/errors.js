// الأخطاء الموحدة: رسائل واضحة للمستخدم، وتفاصيل تقنية في السجل فقط
export class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;      // تفاصيل إضافية (مثل أخطاء أسطر الاستيراد)
  }
}
export const badRequest = (m, details) => new AppError(400, m, "bad_request", details);
export const unauthorized = (m = "سجّل الدخول أولًا") => new AppError(401, m, "unauthorized");
export const forbidden = (m = "غير مسموح") => new AppError(403, m, "forbidden");
export const notFound = (m = "غير موجود") => new AppError(404, m, "not_found");
export const conflict = (m) => new AppError(409, m, "conflict");

// تغليف المعالجات غير المتزامنة
export const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ترجمة أخطاء قاعدة البيانات إلى رسائل مفهومة
function fromDatabase(err) {
  switch (err.code) {
    case "P0001": return new AppError(400, err.message, "rule");               // قواعد الحماية داخل القاعدة
    case "23505": return new AppError(409, "هذه القيمة مسجلة من قبل", "duplicate");
    case "23503": return new AppError(409, "لا يمكن تنفيذ العملية لأن السجل مرتبط ببيانات أخرى", "in_use");
    case "23514": return new AppError(400, "إحدى القيم غير صالحة", "check");
    case "23502": return new AppError(400, "حقل مطلوب ناقص", "required");
    case "22P02": case "22007": case "22008": return new AppError(400, "صيغة إحدى القيم غير صحيحة", "format");
    case "40001": case "40P01": return new AppError(409, "تعارض مؤقت، أعد المحاولة", "retry");
    case "57014": return new AppError(503, "استغرقت العملية وقتًا طويلًا، أعد المحاولة", "timeout");
    default: return null;
  }
}

export function errorHandler(err, req, res, _next) {
  const known = err instanceof AppError ? err : fromDatabase(err);
  if (known) return res.status(known.status).json({ error: known.message, code: known.code, ...(known.details || {}) });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "صيغة الطلب غير صحيحة" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "حجم الطلب كبير" });
  const ref = Math.random().toString(36).slice(2, 10);
  console.error(`[error ${ref}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: `حدث خطأ في الخادم (مرجع ${ref})`, code: "server" });
}
