// مدرسة العرض التجريبي: يدخلها زائر الصفحة الرئيسية بضغطة (مدير، معلم، محاسب، ولي أمر) للتصفح فقط.
// الحماية في الخادم: أي طلب تعديل على هذه المدرسة يُرفض، مهما كانت الواجهة.
import { transaction } from "../../core/db/pool.js";
import { AppError } from "../../core/http/errors.js";

export const DEMO_MESSAGE = "هذه مدرسة تجريبية للعرض فقط، والتعديل فيها غير متاح. اطلب تجربتك المجانية لتبدأ بمدرستك.";
export const demoReadonly = () => new AppError(403, DEMO_MESSAGE, "demo_readonly");

// طلبات POST للقراءة فقط في لوحة المدير (تقارير ومعاينات لا تغيّر شيئًا)
const ADMIN_READS = [/^\/ai\/report\/[\w-]+$/, /^\/academic\/promotion-preview$/];
export const staffWriteAllowed = (req, role) =>
  req.method === "GET" || req.method === "HEAD" || (role === "admin" && ADMIN_READS.some((re) => re.test(req.path)));

// صفحات ولي الأمر: أغلب القراءة بطلبات POST (المعرّف في جسم الطلب)، فنمنع الكتابة بالاسم
const PUBLIC_WRITES = [
  /^\/admissions$/, /^\/transfer-claims$/, /^\/password-request$/, /^\/student\/excuse$/,
  /^\/student\/surveys\/\d+$/, /^\/student\/meetings\/book$/, /^\/student\/meetings\/\d+\/cancel$/,
  /^\/student\/push$/, /^\/student\/inbox\/archive$/, /^\/student\/chat\/send$/, /^\/student\/notify-prefs\/save$/, /^\/student\/online-exams\/\d+\/(start|save|submit|image)$/,
];

// هل المدرسة مدرسة العرض؟ (كاش قصير: صفحات ولي الأمر تسأل في كل طلب)
const cache = new Map();
const TTL = 60_000;
export async function isDemoSchool(id) {
  const key = String(id || "").toLowerCase();
  if (!/^[a-z0-9-]{3,30}$/.test(key)) return false;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.demo;
  const [t] = await transaction({ tenantId: key }, (q) => q("SELECT is_demo FROM tenants WHERE id = $1", [key]));
  const demo = Boolean(t?.is_demo);
  cache.set(key, { demo, until: Date.now() + TTL });
  return demo;
}
export const forgetDemoCache = () => cache.clear();

// حارس صفحات ولي الأمر: يعلّم الاستجابة ويمنع التعديل في مدرسة العرض
export const publicDemoGuard = async (req, res, next) => {
  try {
    if (!(await isDemoSchool(req.params.school))) return next();
    res.set("X-Demo", "1");
    // المسار داخل المدرسة (بعد /:school)
    const sub = req.path;
    if (req.method !== "GET" && PUBLIC_WRITES.some((re) => re.test(sub))) throw demoReadonly();
    next();
  } catch (e) { next(e); }
};

// مدرسة العرض الحالية (إن وُجدت ومفعّلة)
export async function demoSchool() {
  const [t] = await transaction({ platform: true, actor: "زائر العرض التجريبي" }, (q) => q(
    "SELECT id, name FROM tenants WHERE is_demo AND status = 'active' AND emergency_locked_at IS NULL LIMIT 1"));
  return t || null;
}
