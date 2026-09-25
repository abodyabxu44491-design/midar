// طلبات تغيير كلمة المرور: طلب ← تحقق الإدارة ← اعتماد المالك ← رابط لمرة واحدة
import crypto from "node:crypto";
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";
import { hashPassword } from "../../core/auth/password.js";

export const JOBS = { admin: "إداري", accountant: "محاسب", teacher: "معلم" };
export const CONTACTS = { phone: "اتصال هاتفي", whatsapp: "واتساب", email: "بريد إلكتروني" };
export const STATUSES = {
  new: "جديد — بانتظار مراجعة الإدارة",
  referred: "محال إلى مالك المنصة",
  approved: "معتمد — أُرسل الرابط",
  used: "تم تغيير كلمة المرور",
  rejected: "مرفوض",
  expired: "انتهت صلاحية الرابط",
};

const TOKEN_HOURS = 2;

export const requestSchema = z.object({
  full_name: t.name("الاسم الكامل"),
  username: t.shortText("اسم المستخدم أو البريد", 120),
  phone: z.string().trim().regex(/^[0-9+ ]{6,20}$/, "رقم الجوال غير صحيح"),
  branch: t.optText(120),
  job_title: z.enum(["admin", "accountant", "teacher"]),
  description: z.string().trim().min(5, "اشرح سبب الطلب").max(600),
  contact_pref: z.enum(["phone", "whatsapp", "email"]).default("phone"),
});

export const adminReviewSchema = z.object({
  decision: z.enum(["refer", "reject"]),
  note: t.optText(400),
});

export const ownerReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: t.optText(400),
});

export const resetSchema = z.object({
  token: z.string().trim().length(64, "الرابط غير صحيح"),
  password: t.password,
});

const SELECT = `SELECT r.id, r.ref, r.tenant_id, r.full_name, r.username, r.phone, r.branch, r.job_title,
    r.description, r.contact_pref, r.status, r.admin_note, r.owner_note, r.reviewed_by, r.approved_by,
    r.token_expires_at, r.used_at, r.created_at, r.updated_at
  FROM password_requests r`;

export const listForSchool = (q) => q(`${SELECT} ORDER BY r.status = 'new' DESC, r.id DESC LIMIT 200`);

export const listForOwner = (q) => q(
  `${SELECT.replace("FROM password_requests r", "")}, t.name AS school_name
     FROM password_requests r JOIN tenants t ON t.id = r.tenant_id
    WHERE r.status <> 'new'
    ORDER BY r.status = 'referred' DESC, r.id DESC LIMIT 300`);

export const submit = async (q, b) => {
  const [row] = await q("SELECT submit_password_request($1::jsonb) AS ref", [JSON.stringify(b)]);
  return { ref: row.ref };
};

/** الإدارة تتحقق من هوية صاحب الطلب ثم تحيله للمالك أو ترفضه */
export async function adminReview(q, id, b, actor) {
  const [r] = await q("SELECT id, status, username FROM password_requests WHERE id = $1 FOR UPDATE", [id]);
  if (!r) throw notFound("الطلب غير موجود");
  if (r.status !== "new") throw badRequest("الطلب خرج من مرحلة مراجعة الإدارة");

  // ربط الطلب بالحساب إن وُجد باسم المستخدم (لا نكشف للمستخدم وجوده من عدمه)
  const [user] = await q("SELECT id FROM users WHERE username = $1", [r.username]);
  const status = b.decision === "refer" ? "referred" : "rejected";
  await q(
    `UPDATE password_requests SET status = $2, admin_note = $3, reviewed_by = $4, user_id = COALESCE(user_id, $5)
      WHERE id = $1`, [id, status, b.note ?? null, actor, user?.id ?? null]);
  return { status, matched_account: Boolean(user) };
}

/**
 * المالك يعتمد: يُنشأ رمز عشوائي يُحفظ مجزّأً فقط، ويُعاد نصه مرة واحدة
 * ليسلّمه المالك عبر القناة المعتمدة (واتساب أو اتصال).
 */
export async function ownerReview(q, id, b, actor, baseUrl) {
  const [r] = await q("SELECT * FROM password_requests WHERE id = $1 FOR UPDATE", [id]);
  if (!r) throw notFound("الطلب غير موجود");
  if (r.status !== "referred") throw badRequest("هذا الطلب ليس بانتظار اعتمادك");

  if (b.decision === "reject") {
    await q("UPDATE password_requests SET status = 'rejected', owner_note = $2, approved_by = $3 WHERE id = $1",
      [id, b.note ?? null, actor]);
    return { status: "rejected" };
  }

  if (!r.user_id) {
    const [user] = await q("SELECT id FROM users WHERE username = $1 AND tenant_id = $2", [r.username, r.tenant_id]);
    if (!user) throw badRequest("لا يوجد حساب بهذا الاسم في هذه المدرسة");
    await q("UPDATE password_requests SET user_id = $2 WHERE id = $1", [id, user.id]);
  }

  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  await q(
    `UPDATE password_requests SET status = 'approved', owner_note = $2, approved_by = $3,
        token_hash = $4, token_expires_at = now() + make_interval(hours => $5) WHERE id = $1`,
    [id, b.note ?? null, actor, hash, TOKEN_HOURS]);

  return {
    status: "approved",
    link: `${baseUrl}/reset?token=${token}`,     // يُعرض مرة واحدة للمالك
    expires_hours: TOKEN_HOURS,
  };
}

/** فتح صفحة التغيير: يتحقق من الرمز دون كشف بيانات الحساب */
export async function checkToken(q, token) {
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const [row] = await q("SELECT password_reset_check($1) AS ref", [hash]);
  return { ref: row.ref };
}

/** تنفيذ التغيير: مرة واحدة، ثم تُنهى كل جلسات الحساب */
export async function reset(q, b) {
  const hash = crypto.createHash("sha256").update(b.token).digest("hex");
  const passwordHash = await hashPassword(b.password);
  const [row] = await q("SELECT password_reset_apply($1, $2) AS ref", [hash, passwordHash]);
  return { ok: true, ref: row.ref };
}
