// أبناء محفوظون على هذا الجهاز: ولي الأمر يفتح ملف ابنه مباشرة من التطبيق المثبّت أو من الإشعار، بلا إعادة إدخال المعرّف.
// المعرّف يُحفظ على هذا الجهاز فقط (لا يُرسل لأي مكان غير المدرسة)، ويمكن إزالته في أي وقت.
const REM = (school) => `midar_children_${school}`;
const SESSION = (school) => `midar_student_${school}`;
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

export const rememberedChildren = (school) => safe(() => JSON.parse(localStorage.getItem(REM(school)) || "[]"), []);
export function rememberChild(school, child) {
  const list = rememberedChildren(school).filter((c) => c.id !== child.id);
  list.unshift({ id: child.id, key: child.key, name: child.name || "", class_name: child.class_name || "" });
  safe(() => localStorage.setItem(REM(school), JSON.stringify(list.slice(0, 8))));
}
export function forgetChild(school, id) {
  safe(() => localStorage.setItem(REM(school), JSON.stringify(rememberedChildren(school).filter((c) => c.id !== id))));
}
export const isRemembered = (school, id) => rememberedChildren(school).some((c) => c.id === id);

/** الطالب المفتوح الآن: من الجلسة، أو من الرابط (?s= من الإشعار)، أو الابن الوحيد المحفوظ */
export function currentChild(school) {
  const fromUrl = Number(new URLSearchParams(location.search).get("s")) || null;
  const saved = rememberedChildren(school);
  if (fromUrl) {
    const c = saved.find((x) => x.id === fromUrl);
    if (c) { openChild(school, c); return { id: c.id, key: c.key }; }
  }
  const s = safe(() => JSON.parse(sessionStorage.getItem(SESSION(school)) || "null"), null);
  if (s) return s;
  if (saved.length === 1) { openChild(school, saved[0]); return { id: saved[0].id, key: saved[0].key }; }
  return null;
}
export const openChild = (school, c) => safe(() => sessionStorage.setItem(SESSION(school), JSON.stringify({ id: c.id, key: c.key })));
export const closeChild = (school) => safe(() => sessionStorage.removeItem(SESSION(school)));
