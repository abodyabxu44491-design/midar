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
