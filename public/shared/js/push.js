// الإشعارات الفورية من المتصفح: طلب الإذن، وتسجيل الجهاز لدى الخادم، وإلغاؤه.
// تعمل على أندرويد وأجهزة الكمبيوتر، وعلى الآيفون بعد تثبيت التطبيق على الشاشة الرئيسية (iOS 16.4+).
import { api } from "./api.js";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// الآيفون يحتاج تثبيت التطبيق أولًا
export const needsInstallFirst = () => isIOS() && !standalone();

const b64ToBytes = (b64) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration("/") || await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  return reg;
}

/** الحالة على هذا الجهاز: unsupported | ios-install | denied | on | off */
export async function pushStatus() {
  if (!pushSupported()) return needsInstallFirst() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = reg && await reg.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch { return "off"; }
}

/**
 * تفعيل الإشعارات: إذن المستخدم ثم الاشتراك بمفتاح الخادم ثم إرساله.
 * @param {string} key المفتاح العام من الخادم
 * @param {(subscription: object) => Promise<any>} save يرسل الاشتراك للخادم
 */
export async function enablePush(key, save) {
  if (!pushSupported()) throw new Error(needsInstallFirst() ? "على الآيفون: ثبّت التطبيق على الشاشة الرئيسية أولًا، ثم فعّل الإشعارات من داخله." : "هذا المتصفح لا يدعم الإشعارات.");
  if (!key) throw new Error("الإشعارات غير مفعّلة في هذه المدرسة.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("لم يُسمح بالإشعارات. يمكنك السماح بها من إعدادات المتصفح للموقع.");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // مفتاح مختلف (تغيّر على الخادم): اشتراك جديد
  const want = b64ToBytes(key);
  if (sub && sub.options?.applicationServerKey) {
    const have = new Uint8Array(sub.options.applicationServerKey);
    if (have.length !== want.length || have.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  await save(sub.toJSON());
  return true;
}

/** إيقاف الإشعارات لهذا الحساب على هذا الجهاز (يبقى الاشتراك للحسابات الأخرى على الجهاز نفسه) */
export async function disablePush(remove) {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) await remove(sub.endpoint);
}

/** للمنسوبين: تفعيل عبر واجهة اللوحة */
export const enableStaffPush = (base, key) => enablePush(key, (s) => api(`${base}/notifications/push`, s));
export const disableStaffPush = (base) => disablePush((endpoint) => api(`${base}/notifications/push/remove`, { endpoint }));
