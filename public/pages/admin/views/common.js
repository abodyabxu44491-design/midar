// أدوات مشتركة بين تبويبات الإدارة
import { api } from "../../shared/js/api.js";

// مسار الواجهة يتغير حسب الدور: مدير المدرسة أو المحاسب
export let A = "/api/admin";
export const setApiBase = (role) => { A = role === "accountant" ? "/api/accountant" : "/api/admin"; };
export const loadClasses = () => api(`${A}/structure/classes`);
export const loadSubjects = () => api(`${A}/structure/subjects`);
export const classOptions = (classes, emptyLabel) => [...(emptyLabel ? [["", emptyLabel]] : []), ...classes.map((c) => [c.id, c.name])];
export const directoryLink = (me) => `${location.origin}/${me.school.id}`;
export const staffLink = (me) => `${location.origin}/${me.school.id}/idara`;

/** طلب لقسم قد يكون موقوفًا: يعيد القيمة البديلة بدل أن يتعطل التبويب */
export const optional = (promise, fallback) => promise.catch(() => fallback);

/**
 * يحفظ آخر قيمة لحقل بحث/فلتر خلال هذي الجلسة (تختفي عند إغلاق المتصفح)،
 * حتى لا يفقد المستخدم بحثه أو فلتره كل ما ينتقل بين الأقسام أو يحدّث الشاشة.
 * الاستخدام: rememberField("students-search", q) بعد إنشاء عنصر الإدخال مباشرة.
 */
export function rememberField(key, el, { event = "input" } = {}) {
  const full = `midar_filter_${key}`;
  try {
    const saved = sessionStorage.getItem(full);
    if (saved !== null) { if (el.type === "checkbox") el.checked = saved === "1"; else el.value = saved; }
  } catch { /* التخزين غير متاح (وضع خاص مثلًا) — نكمل بدون حفظ */ }
  el.addEventListener(event, () => {
    try { sessionStorage.setItem(full, el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value); } catch { /* تجاهل */ }
  });
  return el;
}
