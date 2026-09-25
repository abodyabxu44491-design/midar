// روابط المدرسة: تُولَّد من رابط المنصة (PUBLIC_URL) والمسارات الفعلية في الخادم، وليست مكتوبة يدويًا في الواجهة.
// تغيير النطاق (مثلًا من onrender.com إلى نطاق خاص) يكفيه تعديل PUBLIC_URL فقط.
import { env } from "../config/env.js";

export const baseUrl = (req) => (env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

// public: صفحة الطلاب وأولياء الأمور (عامة) — staff: دخول المنسوبين (خاص، لا يظهر في الصفحة العامة)
export function schoolLinks(req, schoolId) {
  const b = `${baseUrl(req)}/${encodeURIComponent(schoolId)}`;
  return {
    public: { home: b, students: `${b}#/students` },
    staff: { admin: `${b}/idara?role=admin`, teacher: `${b}/idara?role=teacher`, accountant: `${b}/idara?role=accountant` },
  };
}
