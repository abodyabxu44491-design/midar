// أدوات مشتركة للواجهة العامة
import { transaction } from "../../core/db/pool.js";
import { notFound, unauthorized } from "../../core/http/errors.js";
import { safeEqual } from "../../core/auth/codes.js";
import { securityEvent, recentFailures, logEvent } from "../../core/audit.js";
import { parse, t, z } from "../../core/http/validate.js";

const schoolParam = z.string().toLowerCase().regex(/^[a-z0-9-]{3,30}$/);
const MAX_KEY_FAILS = 10;   // لكل طالب خلال 30 دقيقة (يمنع التخمين حتى من عناوين مختلفة)

// تنفيذ داخل سياق المدرسة بعد التأكد أنها مفعّلة
export async function inSchool(req, actor, fn) {
  const r = schoolParam.safeParse(req.params.school);
  if (!r.success) throw notFound("المدرسة غير موجودة");
  return transaction({ tenantId: r.data, actor, ip: req.ip }, async (q) => {
    const [tenant] = await q("SELECT id, name, status, directory_code, currency FROM tenants WHERE id = $1", [r.data]);
    if (!tenant || tenant.status !== "active") throw notFound("المدرسة غير متاحة");
    return fn(q, tenant);
  });
}

export const accessSchema = z.object({ access: z.string().trim().toUpperCase().min(4).max(20) });

export function checkAccess(tenant, access) {
  if (!safeEqual(access, tenant.directory_code)) throw unauthorized("رمز الصفحة غير صحيح");
}

export const studentAuthSchema = z.object({ student_id: t.id, key: t.studentKey });

/**
 * التحقق من معرّف الطالب. المحاولات الخاطئة تُسجل وتُحسب،
 * وبعد 10 محاولات يُقفل فتح ملف هذا الطالب 30 دقيقة.
 * ملاحظة: التسجيل يتم في معاملة مستقلة حتى لا يُلغى مع رسالة الخطأ.
 */
export async function verifyStudent(req, tenant, q, body) {
  const b = parse(studentAuthSchema, body);
  const subject = `${tenant.id}:${b.student_id}`;
  if ((await recentFailures(q, "student_key_failed", subject, 30)) >= MAX_KEY_FAILS) {
    throw unauthorized("تم إيقاف المحاولة مؤقتًا بسبب محاولات خاطئة كثيرة. حاول بعد 30 دقيقة أو تواصل مع المدرسة.");
  }
  const [s] = await q("SELECT * FROM students WHERE id = $1 AND status = 'active'", [b.student_id]);
  if (!s || !safeEqual(b.key, s.access_key)) {
    await transaction({ tenantId: tenant.id, actor: "زائر", ip: req.ip }, async (q2) => {
      await securityEvent(q2, { kind: "student_key_failed", subject, tenantId: tenant.id, ip: req.ip });
      await logEvent(q2, { tenantId: tenant.id, actor: "زائر", action: `محاولة فتح ملف الطالب #${b.student_id} بمعرّف خاطئ` });
    });
    throw unauthorized("معرّف الطالب غير صحيح");
  }
  return s;
}
