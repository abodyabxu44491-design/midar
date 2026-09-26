// طلبات «نسيت كلمة المرور» — المعتمد حسب الدور الفعلي للحساب:
//   المعلم والمحاسب ← إدارة المدرسة تتحقق وتعتمد وتُصدر الرابط
//   مدير المدرسة    ← مالك المنصة يتحقق ويعتمد ويُصدر الرابط
// الرابط لمرة واحدة ولمدة ساعتين، ويُحفظ مجزّأً فقط ويُعرض لمن اعتمده مرة واحدة ليرسله لصاحب الطلب.
import crypto from "node:crypto";
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";
import { hashPassword } from "../../core/auth/password.js";

export const JOBS = { admin: "إداري", accountant: "محاسب", teacher: "معلم" };
export const CONTACTS = { phone: "اتصال هاتفي", whatsapp: "واتساب", email: "بريد إلكتروني" };
export const STATUSES = {
  new: "جديد — بانتظار الاعتماد",
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
  decision: z.enum(["approve", "reject"]),
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

const SELECT = `SELECT r.id, r.ref, r.tenant_id, r.full_name, r.username, r.phone, r.branch, r.job_title, r.route, r.account_role,
    r.description, r.contact_pref, r.status, r.admin_note, r.owner_note, r.reviewed_by, r.approved_by,
    r.token_expires_at, r.used_at, r.created_at, r.updated_at
  FROM password_requests r`;

// الإدارة: طلبات المعلمين والمحاسبين فقط (طلبات الحساب الإداري عند المالك)
export const listForSchool = (q) => q(`${SELECT} WHERE r.route = 'school' ORDER BY r.status = 'new' DESC, r.id DESC LIMIT 200`);

export const listForOwner = (q) => q(
  `${SELECT.replace("FROM password_requests r", "")}, t.name AS school_name
     FROM password_requests r JOIN tenants t ON t.id = r.tenant_id
    WHERE r.route = 'owner'
    ORDER BY r.status IN ('new', 'referred') DESC, r.id DESC LIMIT 300`);

export const submit = async (q, b) => {
  const [row] = await q("SELECT submit_password_request($1::jsonb) AS ref", [JSON.stringify(b)]);
  return { ref: row.ref };
};

// إصدار الرابط (مشترك بين الإدارة والمالك): رمز عشوائي يُحفظ مجزّأً فقط، ونصه يُعاد مرة واحدة
async function issueLink(q, id, userId, patch, baseUrl) {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  await q(
    `UPDATE password_requests SET status = 'approved', user_id = $2, token_hash = $3,
        token_expires_at = now() + make_interval(hours => $4), ${patch.cols} WHERE id = $1`,
    [id, userId, hash, TOKEN_HOURS, ...patch.values]);
  return { status: "approved", link: `${baseUrl}/reset?token=${token}`, expires_hours: TOKEN_HOURS };
}

/**
 * إدارة المدرسة: تعتمد طلبات المعلمين والمحاسبين فقط (أو ترفض).
 * الدور يُفحص من الحساب الفعلي لحظة الاعتماد: إن تبيّن أنه حساب إداري يُحال للمالك تلقائيًا ولا يُصدر رابط.
 */
export async function adminReview(q, id, b, actor, baseUrl) {
  const [r] = await q("SELECT id, status, username, route FROM password_requests WHERE id = $1 FOR UPDATE", [id]);
  if (!r || r.route !== "school") throw notFound("الطلب غير موجود");
  if (r.status !== "new") throw badRequest("تمت معالجة هذا الطلب مسبقًا");
  if (b.decision === "reject") {
    await q("UPDATE password_requests SET status = 'rejected', admin_note = $2, reviewed_by = $3 WHERE id = $1", [id, b.note ?? null, actor]);
    return { status: "rejected" };
  }
  const [user] = await q("SELECT id, role, is_active FROM users WHERE username = lower(trim($1))", [r.username]);
  if (!user) throw badRequest("لا يوجد حساب بهذا الاسم في مدرستك. تحقق من اسم المستخدم مع صاحب الطلب، أو ارفض الطلب.");
  if (user.role === "admin") {
    await q("UPDATE password_requests SET route = 'owner', account_role = 'admin', user_id = $2, admin_note = $3, reviewed_by = $4 WHERE id = $1",
      [id, user.id, b.note ?? null, actor]);
    return { status: "new", escalated: true };
  }
  if (!user.is_active) throw badRequest("هذا الحساب موقوف. فعّله أولًا من «المستخدمون» أو «المعلمون».");
  await q("UPDATE password_requests SET account_role = $2 WHERE id = $1", [id, user.role]);
  return issueLink(q, id, user.id, { cols: "admin_note = $5, reviewed_by = $6, approved_by = $6", values: [b.note ?? null, actor] }, baseUrl);
}

/**
 * مالك المنصة: يعتمد طلبات مديري المدارس (وأي طلب قديم أُحيل إليه قبل هذا التعديل).
 */
export async function ownerReview(q, id, b, actor, baseUrl) {
  const [r] = await q("SELECT * FROM password_requests WHERE id = $1 FOR UPDATE", [id]);
  if (!r || r.route !== "owner") throw notFound("الطلب غير موجود");
  if (!["new", "referred"].includes(r.status)) throw badRequest("هذا الطلب ليس بانتظار اعتمادك");

  if (b.decision === "reject") {
    await q("UPDATE password_requests SET status = 'rejected', owner_note = $2, approved_by = $3 WHERE id = $1",
      [id, b.note ?? null, actor]);
    return { status: "rejected" };
  }
  // الحساب ودوره سُجّلا عند تقديم الطلب بدالة قاعدة البيانات (جدول المستخدمين معزول لكل مدرسة حتى عن المالك)
  if (!r.user_id) throw badRequest("لا يوجد حساب بهذا الاسم في هذه المدرسة");
  // طلب جديد عند المالك يجب أن يكون لحساب إداري (المعلمون والمحاسبون مسؤولية إدارة المدرسة)
  if (r.status === "new" && r.account_role !== "admin") throw badRequest("هذا ليس حسابًا إداريًا؛ تعتمده إدارة المدرسة.");
  return issueLink(q, id, r.user_id, { cols: "owner_note = $5, approved_by = $6", values: [b.note ?? null, actor] }, baseUrl);
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
