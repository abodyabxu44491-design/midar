/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { api } from "./api.js";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const needsInstallFirst = () => isIOS() && !standalone();

const b64ToBytes = (b64) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

// Turning notifications off on this device is remembered, so the automatic renewal never turns them back on.
const OFF = "midar_push_off";
const offHere = () => { try { return localStorage.getItem(OFF) === "1"; } catch { return false; } };
const markOff = (on) => { try { on ? localStorage.setItem(OFF, "1") : localStorage.removeItem(OFF); } catch { /* private mode */ } };

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration("/") || await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function pushStatus() {
  if (!pushSupported()) return needsInstallFirst() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = reg && await reg.pushManager.getSubscription();
    return sub && Notification.permission === "granted" && !offHere() ? "on" : "off";
  } catch { return "off"; }
}

export async function enablePush(key, save) {
  if (!pushSupported()) throw new Error(needsInstallFirst() ? "على الآيفون: ثبّت التطبيق على الشاشة الرئيسية أولًا، ثم فعّل الإشعارات من داخله." : "هذا المتصفح لا يدعم الإشعارات.");
  if (!key) throw new Error("الإشعارات غير مفعّلة في هذه المدرسة.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("لم يُسمح بالإشعارات. يمكنك السماح بها من إعدادات المتصفح للموقع.");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  const want = b64ToBytes(key);
  if (sub && sub.options?.applicationServerKey) {
    const have = new Uint8Array(sub.options.applicationServerKey);
    if (have.length !== want.length || have.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  await save(sub.toJSON());
  markOff(false);
  return true;
}

// This device's subscription address, sent on sign out so the server stops notifying a phone that left.
export async function currentEndpoint() {
  try {
    const reg = pushSupported() && await navigator.serviceWorker.getRegistration("/");
    return (reg && (await reg.pushManager.getSubscription())?.endpoint) || null;
  } catch { return null; }
}

export async function disablePush(remove) {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) await remove(sub.endpoint);
  markOff(true);
}

export const enableStaffPush = (base, key) => enablePush(key, (s) => api(`${base}/notifications/push`, s));
export const disableStaffPush = (base) => disablePush((endpoint) => api(`${base}/notifications/push/remove`, { endpoint }));

// Called whenever the app opens. Once the parent has allowed notifications, the device keeps a working subscription
// without asking again: a lost subscription (cleared by the browser) or one made with an older key is renewed quietly,
// and the server is told the current one, so notifications keep arriving with the app closed.
export async function refreshPush(save, key = null) {
  if (!pushSupported() || Notification.permission !== "granted" || offHere()) return false;
  const reg = key ? await registration() : await navigator.serviceWorker.getRegistration("/");
  let sub = reg && await reg.pushManager.getSubscription();
  if (key && reg) {
    const want = b64ToBytes(key);
    if (sub && sub.options?.applicationServerKey) {
      const have = new Uint8Array(sub.options.applicationServerKey);
      if (have.length !== want.length || have.some((b, i) => b !== want[i])) { await sub.unsubscribe().catch(() => {}); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want }).catch(() => null);
  }
  if (!sub) return false;
  await save(sub.toJSON());
  return true;
}
