// الأبناء على هذا الجهاز:
//  - بحساب ولي الأمر (موصى به): جلسة واحدة لكل الأبناء، والخادم يتحقق من ارتباط كل طالب بالحساب. لا معرّفات محفوظة.
//  - أو بمعرّف كل طالب (الطريقة القديمة): المعرّف يُحفظ على هذا الجهاز فقط ويمكن إزالته في أي وقت.
const REM = (school) => `midar_children_${school}`;
const SESSION = (school) => `midar_student_${school}`;
const PARENT = (school) => `midar_parent_${school}`;
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

export const rememberedChildren = (school) => safe(() => JSON.parse(localStorage.getItem(REM(school)) || "[]"), []);
export function rememberChild(school, child) {
  if (!child.key) return;
  const list = rememberedChildren(school).filter((c) => c.id !== child.id);
  list.unshift({ id: child.id, key: child.key, name: child.name || "", class_name: child.class_name || "" });
  safe(() => localStorage.setItem(REM(school), JSON.stringify(list.slice(0, 8))));
}
export function forgetChild(school, id) {
  safe(() => localStorage.setItem(REM(school), JSON.stringify(rememberedChildren(school).filter((c) => c.id !== id))));
}
export const isRemembered = (school, id) => rememberedChildren(school).some((c) => c.id === id);

/* ---------- حساب ولي الأمر ---------- */
// علامة فقط (الجلسة نفسها في كوكي محمي لا تقرؤه الصفحة): لمعرفة أن هذا الجهاز مسجّل بحساب ولي أمر
export const parentSignedIn = (school) => safe(() => localStorage.getItem(PARENT(school)) === "1", false);
export const setParentSignedIn = (school, on) => safe(() => (on ? localStorage.setItem(PARENT(school), "1") : localStorage.removeItem(PARENT(school))));

/** الطالب المفتوح الآن: من الرابط (?s= من الإشعار أو من «أبنائي»)، أو من الجلسة، أو الابن الوحيد المحفوظ */
export function currentChild(school) {
  const fromUrl = Number(new URLSearchParams(location.search).get("s")) || null;
  const saved = rememberedChildren(school);
  if (fromUrl) {
    const c = saved.find((x) => x.id === fromUrl);
    if (c) { openChild(school, c); return { id: c.id, key: c.key }; }
    if (parentSignedIn(school)) { openChild(school, { id: fromUrl, key: null }); return { id: fromUrl, key: null }; }
  }
  const s = safe(() => JSON.parse(sessionStorage.getItem(SESSION(school)) || "null"), null);
  if (s) return s;
  if (saved.length === 1 && !parentSignedIn(school)) { openChild(school, saved[0]); return { id: saved[0].id, key: saved[0].key }; }
  return null;
}
export const openChild = (school, c) => safe(() => sessionStorage.setItem(SESSION(school), JSON.stringify({ id: c.id, key: c.key || null })));
export const closeChild = (school) => safe(() => sessionStorage.removeItem(SESSION(school)));
