// مكونات الواجهة المشتركة — برمجة وتطوير: المبرمج عبدالله السكني
import { $, h, mount } from "./dom.js";
import { api } from "./api.js";
import { startAnalytics } from "./analytics.js";
import { icons } from "./icons.js";

export const DEV = "مِدار MIDAR — برمجة وتطوير: المبرمج عبدالله السكني";

// ===================== تثبيت التطبيق =====================
// مكان واحد ثابت في كل الصفحات: شريط سفلي بهوية المنصة.
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; showInstallBar(); });
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const DISMISS_KEY = "midar_install_dismissed";
const INSTALLED_KEY = "midar_installed";
const dismissed = () => Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now();
const dismiss = () => {
  localStorage.setItem(DISMISS_KEY, String(Date.now() + 30 * 24 * 3600 * 1000));
  document.querySelector(".install-bar")?.remove();
};

function iosSteps() {
  dialog("تثبيت مِدار على جهازك", h("div", { class: "install-steps" },
    h("p", {}, "من متصفح Safari:"),
    h("ol", {},
      h("li", {}, h("span", { class: "pill" }, "اضغط زر المشاركة", icons.share({ size: 16 }))),
      h("li", {}, "اختر «إضافة إلى الشاشة الرئيسية»"),
      h("li", {}, "اضغط «إضافة»، وستظهر أيقونة مِدار على شاشتك"))));
}

// الشريط الموحّد: يظهر مرة واحدة، ويمكن إخفاؤه لمدة شهر
export function showInstallBar() {
  if (isStandalone() || localStorage.getItem(INSTALLED_KEY) || dismissed() || document.querySelector(".install-bar")) return;
  if (!installEvent && !isIOS()) return;                 // متصفح لا يدعم التثبيت
  const action = btn(installEvent ? "تثبيت" : "طريقة التثبيت", async () => {
    if (!installEvent) return iosSteps();
    const e = installEvent;
    installEvent = null;
    e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === "accepted") {
      localStorage.setItem(INSTALLED_KEY, "1");
      document.querySelector(".install-bar")?.remove();
    }
  }, "sm");
  const close = h("button", { class: "install-close", type: "button", "aria-label": "إخفاء", onclick: dismiss }, icons.close({ size: 16 }));
  const bar = h("div", { class: "install-bar", role: "complementary", "aria-label": "تثبيت التطبيق" },
    h("img", { src: "/brand/mark.svg", alt: "", class: "install-mark", width: 34, height: 26 }),
    h("div", { class: "install-text" }, h("b", {}, "ثبّت مِدار كتطبيق"),
      h("span", {}, isIOS() ? "على شاشة جهازك، بخطوتين" : "على جوالك أو جهازك، بضغطة")),
    action, close);
  document.body.append(bar);
}

// بعد التثبيت لا يظهر الشريط مرة أخرى على هذا الجهاز
window.addEventListener("appinstalled", () => {
  localStorage.setItem(INSTALLED_KEY, "1");
  document.querySelector(".install-bar")?.remove();
});

/* ---------- الهوية ---------- */
/**
 * شعار المنصة.
 * variant: "row" (أفقي، للشريط العلوي) أو "stacked" (عمودي: العلامة ثم الاسم، للصفحات الرئيسية)
 */
export function brandLogo(cls = "brand-logo", light = true, variant = "row") {
  const file = variant === "stacked"
    ? (light ? "/brand/logo-stacked-light.svg" : "/brand/logo-stacked.svg")
    : (light ? "/brand/logo-light.svg" : "/brand/logo.svg");
  const size = variant === "stacked" ? { width: 184, height: 160 } : { width: 150, height: 38 };
  return h("img", { src: file, alt: "مِدار", class: cls, ...size });
}

export function topbar({ subtitle, school, onLogout }) {
  return h("header", { class: "topbar" }, h("div", { class: "in" },
    h("div", { class: "who" }, brandLogo(),
      (school || subtitle) && h("div", { class: "school" }, school && h("b", {}, school), subtitle && h("small", {}, subtitle))),
    onLogout && btn("خروج", onLogout, "ghost sm")));
}
export const footer = () => h("footer", { class: "dev" }, DEV);

/* ---------- عناصر ---------- */
export const field = (label, control, hint) => h("label", { class: "f" }, h("span", {}, label), control, hint && h("small", { class: "sub" }, hint));
export const input = (props = {}) => h("input", props);
export const textarea = (props = {}) => h("textarea", props);
export function select(options, props = {}) {
  const { value, ...rest } = props;
  const el = h("select", rest, options.map(([v, l]) => h("option", { value: v }, l)));
  if (value !== undefined && value !== null) el.value = String(value);
  return el;
}
export const btn = (text, onclick, cls = "") => h("button", { class: `btn ${cls}`, type: "button", onclick: guardClick(onclick) }, text);
export const panel = (title, action, ...kids) =>
  h("section", { class: "panel" }, (title || action) && h("div", { class: "panel-head" }, title && h("h2", {}, title), action), ...kids);
export const empty = (text) => h("p", { class: "empty" }, text);
export const badge = (text, cls = "") => h("span", { class: `badge ${cls}` }, text);
export const notice = (text, tone = "") => h("div", { class: `notice ${tone}`, role: tone === "err" ? "alert" : "status" }, text);
export const line = (...kids) => h("div", { class: "line" }, ...kids);
export const sub = (...kids) => h("div", { class: "sub" }, ...kids);
export const keyText = (text) => h("span", { class: "key" }, text);
export const stats = (items) => h("div", { class: "stats" },
  items.filter(Boolean).map(([label, value, hint]) => h("div", { class: "stat" }, h("b", {}, value), label, hint && sub(hint))));

// مفتاح تشغيل/إيقاف: onToggle يعيد false لإلغاء التغيير
export function switchBtn(on, label, onToggle) {
  const el = h("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(!!on), "aria-label": label });
  el.addEventListener("click", async () => {
    const next = el.getAttribute("aria-checked") !== "true";
    el.disabled = true;
    try {
      const ok = await onToggle(next);
      if (ok !== false) el.setAttribute("aria-checked", String(next));
    } catch (e) { toast(e.message, true); }
    finally { el.disabled = false; }
  });
  return el;
}

// يمنع الضغط المزدوج أثناء تنفيذ العملية ويعرض الأخطاء
function guardClick(fn) {
  if (!fn) return undefined;
  return async (ev) => {
    const b = ev.currentTarget;
    if (b.disabled) return;
    b.disabled = true;
    try { await fn(ev); }
    catch (e) { toast(e.message, true); }
    finally { if (b.isConnected) b.disabled = false; }
  };
}

let toastTimer;
export function toast(message, isError = false) {
  document.querySelector(".toast")?.remove();
  const el = h("div", { class: `toast${isError ? " err" : ""}`, role: isError ? "alert" : "status" }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), isError ? 6000 : 3500);
}

export function confirmAction(message) {
  return window.confirm(message);
}

/* ---------- التبويبات ---------- */
export function tabs(list, views, ctx) {
  const bar = h("nav", { class: "tabs", role: "tablist" });
  const body = h("div", { role: "tabpanel" });
  let current;
  const show = async (key) => {
    current = key;
    bar.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.k === key));
      b.classList.toggle("on", b.dataset.k === key);
    });
    mount(body, empty("جارٍ التحميل…"));
    const refresh = () => show(key);
    try {
      const out = await views[key]({ ...ctx, refresh });
      if (current === key) mount(body, out);
    } catch (e) {
      if (current === key) mount(body, notice(e.message, "err"));
      if (e.status === 401) setTimeout(() => location.reload(), 1500);
    }
  };
  for (const [key, label] of list) bar.append(h("button", { type: "button", role: "tab", "data-k": key, onclick: () => show(key) }, label));
  return { el: h("div", { class: "tabs-layout" }, bar, body), show };
}

/* ---------- النوافذ ---------- */
export function dialog(title, content, actions = []) {
  const d = h("dialog", { "aria-label": title },
    h("div", { class: "d-in" }, h("h2", {}, title), content,
      h("div", { class: "row spaced" }, ...actions, h("button", { class: "btn ghost", type: "button", onclick: () => d.close() }, "إغلاق"))));
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

const CRED_LABELS = { school: "رمز المدرسة", username: "اسم المستخدم", password: "كلمة المرور المؤقتة",
  directory_code: "رمز صفحة الطلاب", access_key: "معرّف الطالب" };
// شاشة إلزامية عند الدخول بكلمة مرور مؤقتة: لا يُفتح شيء في اللوحة قبل اختيار كلمة مرور خاصة
export function passwordChangeScreen({ endpoint, logoutEndpoint, school, name }) {
  const cur = input({ type: "password", class: "ltr", autocomplete: "current-password" });
  const nxt = input({ type: "password", class: "ltr", autocomplete: "new-password" });
  const rep = input({ type: "password", class: "ltr", autocomplete: "new-password" });
  const msg = h("div");
  mount($("#app"),
    topbar({ school, subtitle: name, onLogout: async () => { await api(logoutEndpoint, {}); location.reload(); } }),
    h("main", {}, panel("اختر كلمة مرور خاصة بك", null,
      notice("كلمة المرور الحالية مؤقتة وصلتك من الإدارة. غيّرها للمتابعة.", "warn"),
      field("كلمة المرور المؤقتة", cur),
      field("كلمة المرور الجديدة", nxt, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
      field("أعد كتابة الجديدة", rep), msg,
      btn("حفظ ومتابعة", async () => {
        mount(msg);
        if (nxt.value !== rep.value) return mount(msg, notice("كلمتا المرور الجديدتان غير متطابقتين", "err"));
        try { await api(endpoint, { current: cur.value, next: nxt.value }); location.reload(); }
        catch (e) { mount(msg, notice(e.message, "err")); }
      }))),
    footer());
}

export function showCredentials(title, creds, note) {
  const text = Object.entries(creds).map(([k, v]) => `${CRED_LABELS[k] || k}: ${v}`).join("\n");
  dialog(title, h("div", {},
    notice(note || "انسخها الآن وسلّمها لصاحبها. كلمة المرور لن تظهر مرة أخرى.", "warn"),
    Object.entries(creds).map(([k, v]) => line(h("span", {}, CRED_LABELS[k] || k), keyText(v)))),
    [btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); })]);
}

/* ---------- شاشة الدخول ---------- */
export function loginScreen({ role, endpoint, withSchool = true, withCode = false, onSuccess }) {
  const school = input({ class: "ltr", autocomplete: "organization", value: localStorage.getItem("midar_school") || "", "aria-label": "رمز المدرسة" });
  const user = input({ class: "ltr", autocomplete: "username" });
  const pass = input({ class: "ltr", type: "password", autocomplete: "current-password" });
  const code = input({ class: "ltr", inputMode: "numeric", autocomplete: "one-time-code", maxLength: 6 });
  const msg = h("div");
  const submit = btn("تسجيل الدخول", async () => {
    mount(msg);
    try {
      await api(endpoint, { school: school.value, username: user.value, password: pass.value, code: code.value });
      if (withSchool) localStorage.setItem("midar_school", school.value.trim().toLowerCase());
      pass.value = "";
      onSuccess();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "wide");
  for (const el of [school, user, pass, code]) el.addEventListener("keydown", (e) => e.key === "Enter" && submit.click());
  if (withSchool) startAnalytics(`login:${role}`);   // لا تحليلات على دخول المالك
  return [
    h("div", { class: "auth-hero" }, h("div", { class: "in" }, brandLogo("hero-logo", true, "stacked"), h("p", { class: "role" }, role))),
    h("main", {}, h("div", { class: "auth-card" },
      withSchool && field("رمز المدرسة", school), field("اسم المستخدم", user), field("كلمة المرور", pass),
      withCode && field("رمز التحقق (6 أرقام)", code), msg, submit)),
    footer(),
  ];
}
