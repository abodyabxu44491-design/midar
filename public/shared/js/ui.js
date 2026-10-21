/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { $, h, mount } from "./dom.js";
import { api, APP_VERSION, announceUpdate, applyPendingUpdate } from "./api.js";
import { startAnalytics } from "./analytics.js";
import { icons } from "./icons.js";

export const DEV = "مدار MIDAR";
export { chime, soundOn, setSound } from "./chime.js";

// A text box prints only what fits inside it; for printing, its full text is shown in a plain block instead.
if (typeof window !== "undefined") {
  window.addEventListener("beforeprint", () => {
    for (const t of document.querySelectorAll("textarea")) {
      if (!t.value.trim() || !t.getClientRects().length) continue;
      t.classList.add("printing-hidden");
      t.after(Object.assign(document.createElement("div"), { className: "print-text", textContent: t.value }));
    }
  });
  window.addEventListener("afterprint", () => {
    document.querySelectorAll(".print-text").forEach((el) => el.remove());
    document.querySelectorAll("textarea.printing-hidden").forEach((t) => t.classList.remove("printing-hidden"));
  });
}

let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; refreshInstall(); });
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 15 * 60 * 1000);
  }).catch(() => {}));
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "midar:version" && e.data.version !== APP_VERSION) announceUpdate(e.data.version);
  });
}

const isStandalone = () => matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches
  || matchMedia("(display-mode: minimal-ui)").matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const INSTALLED_KEY = `midar_installed:${location.pathname.split("/").slice(0, 3).join("/")}`;
const installed = () => { try { return localStorage.getItem(INSTALLED_KEY) === "1"; } catch { return false; } };
const markInstalled = () => { try { localStorage.setItem(INSTALLED_KEY, "1"); } catch { /* */ } refreshInstall(); };
const canInstall = () => !isStandalone() && (Boolean(installEvent) || (isIOS() && !installed()));
function refreshInstall() {
  const on = canInstall();
  document.querySelectorAll(".install-ic:not(.floating)").forEach((b) => { b.hidden = !on; });
  if (floatingIc) floatingIc.hidden = !on || Boolean(document.querySelector(".install-ic:not(.floating)"));
}

function iosSteps() {
  dialog("تثبيت مدار على جهازك", h("div", { class: "install-steps" },
    h("p", {}, "من متصفح Safari:"),
    h("ol", {},
      h("li", {}, h("span", { class: "pill" }, "اضغط زر المشاركة", icons.share({ size: 16 }))),
      h("li", {}, "اختر «إضافة إلى الشاشة الرئيسية»"),
      h("li", {}, "اضغط «إضافة»، وستظهر أيقونة مدار على شاشتك"))));
}
export async function promptInstall() {
  if (isStandalone()) return toast("مدار مثبّت على هذا الجهاز");
  if (!installEvent) {
    if (isIOS()) return iosSteps();
    return toast("افتح قائمة المتصفح واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»");
  }
  const e = installEvent;
  installEvent = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === "accepted") markInstalled(); else { installEvent = e; refreshInstall(); }
}
export function installButton(cls = "") {
  const label = document.documentElement.dataset.app ? `ثبّت تطبيق ${document.documentElement.dataset.app}` : "ثبّت مدار على جهازك";
  return h("button", { type: "button", class: `install-ic ${cls}`.trim(), title: label, "aria-label": label, hidden: !canInstall(),
    onclick: () => promptInstall() }, icons.install({ size: 19, stroke: 2.2 }));
}
let floatingIc = null;
export function showInstallBar() {
  if (floatingIc) return;
  floatingIc = installButton("floating");
  document.body.append(floatingIc);
  const sync = () => {
    const inHeader = document.querySelector(".install-ic:not(.floating)");
    floatingIc.hidden = Boolean(inHeader) || !canInstall();
  };
  sync();
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
}

window.addEventListener("appinstalled", markInstalled);
matchMedia("(display-mode: standalone)").addEventListener?.("change", refreshInstall);

export function brandLogo(cls = "brand-logo", light = true, variant = "row") {
  const file = variant === "stacked"
    ? (light ? "/brand/logo-stacked-light.svg" : "/brand/logo-stacked.svg")
    : (light ? "/brand/logo-light.svg" : "/brand/logo.svg");
  const size = variant === "stacked" ? { width: 184, height: 160 } : { width: 150, height: 38 };
  return h("img", { src: file, alt: "مدار", class: cls, ...size });
}

const SVG_NS = "http://www.w3.org/2000/svg";
const AVATAR_TONES = { male: ["#E3F1F0", "#7FB5B1"], female: ["#EFEBF7", "#A79BC6"] };
export function personAvatar(gender, size = 40, cls = "") {
  const [bg, fg] = AVATAR_TONES[gender === "female" || gender === "girls" ? "female" : "male"];
  const el = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 44 44", width: size, height: size, "aria-hidden": "true", focusable: "false", class: `p-avatar ${cls}`.trim() })) el.setAttribute(k, v);
  const add = (tag, attrs) => { const n = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); el.append(n); };
  add("circle", { cx: 22, cy: 22, r: 22, fill: bg });
  add("circle", { cx: 22, cy: 17, r: 7.5, fill: fg });
  add("path", { d: "M8 38c2.5-7.5 7.5-11 14-11s11.5 3.5 14 11", fill: fg });
  return el;
}

export const schoolLogoUrl = (schoolId, logo, size) => (logo ? `/api/public/${encodeURIComponent(schoolId)}/logo?v=${logo}${size ? `&size=${size}` : ""}` : null);
export const schoolLogoImg = (url, cls = "school-logo") => (url ? h("img", { class: cls, src: url, alt: "", decoding: "async" }) : null);

export const teacherCards = (list) => h("div", { class: "t-cards" }, list.map((t) => h("div", { class: "t-card" },
  t.photo ? h("img", { class: "t-avatar", src: t.photo, alt: "", loading: "lazy", decoding: "async" })
    : h("span", { class: "t-avatar ph", "aria-hidden": "true" }, String(t.teacher || "؟").replace(/^(أ\.|د\.|م\.)\s*/, "").trim().charAt(0)),
  h("div", { class: "t-info" }, h("b", {}, t.teacher), h("small", {}, t.subject)))));

let currentLogo = null;
export const setSchoolLogo = (url) => { currentLogo = url || null; };
export const docLogo = (cls = "print-logo") => (currentLogo ? h("img", { class: `${cls} doc-school-logo`, src: currentLogo, alt: "" }) : brandLogo(cls, false));

export function topbar({ subtitle, school, onLogout, logo }) {
  if (logo) setSchoolLogo(logo);
  return h("header", { class: "topbar" }, h("div", { class: "in" },
    h("div", { class: "who" }, brandLogo("brand-logo", false),
      (school || subtitle) && h("div", { class: `school${logo ? " with-logo" : ""}` }, schoolLogoImg(logo),
        h("div", { class: "school-text" }, school && h("b", {}, school), subtitle && h("small", {}, subtitle)))),
    h("div", { class: "top-acts" }, installButton("on-dark"), onLogout && btn("خروج", onLogout, "ghost sm"))));
}
export const footer = () => h("footer", { class: "dev" }, h("small", { class: "app-version", title: "رقم إصدار المنصة" }, "الإصدار ", h("bdi", { dir: "ltr" }, APP_VERSION)));

export const field = (label, control, hint) => h("label", { class: "f" }, h("span", {}, label), control, hint && h("small", { class: "sub" }, hint));
const NUMERIC_MODES = new Set(["tel", "numeric", "decimal"]);
export const toAsciiDigits = (v) => String(v).replace(/[\u0660-\u0669]/g, (d) => d.charCodeAt(0) - 0x0660).replace(/[\u06F0-\u06F9]/g, (d) => d.charCodeAt(0) - 0x06F0);
export const input = (props = {}) => {
  const el = h("input", props);
  if (NUMERIC_MODES.has(props.inputMode) || props.type === "tel") {
    el.addEventListener("input", () => {
      const next = toAsciiDigits(el.value);
      if (next !== el.value) { const at = el.selectionStart; el.value = next; try { el.setSelectionRange(at, at); } catch { /* ignore */ } }
    });
  }
  return el;
};

export function passwordInput(props = {}) {
  const el = h("input", { autocapitalize: "none", autocorrect: "off", spellcheck: false, ...props, type: "password", class: `ltr ${props.class || ""}`.trim() });
  const toggle = h("button", { class: "pw-toggle", type: "button", tabindex: "-1" });
  const paint = () => {
    const visible = el.type === "text";
    toggle.replaceChildren(visible ? icons.eye({ size: 18 }) : icons.eyeOff({ size: 18 }));
    toggle.setAttribute("aria-label", visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
    toggle.setAttribute("title", visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
    toggle.setAttribute("aria-pressed", String(visible));
  };
  toggle.addEventListener("pointerdown", (e) => e.preventDefault());
  toggle.addEventListener("click", () => {
    el.type = el.type === "password" ? "text" : "password";
    paint();
    el.focus();
  });
  paint();
  const wrap = h("div", { class: "pw-wrap" }, el, toggle);
  Object.defineProperty(wrap, "value", { get: () => el.value, set: (v) => { el.value = v; } });
  wrap.focus = () => el.focus();
  wrap.inputEl = el;
  return wrap;
}
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
export const skeleton = (rows = 5) => h("div", { class: "skel", "aria-busy": "true", "aria-label": "جارٍ التحميل" },
  h("div", { class: "skel-line w40" }), Array.from({ length: rows }, (_, i) => h("div", { class: `skel-line ${["w90", "w75", "w85", "w60"][i % 4]}` })));
let GRAPH = null;
const VPREFIX = (import.meta.url.match(/^(.*?\/v\/[^/]+)\//) || [])[1] || "";
export function preloadModule(url) {
  if (!url || !VPREFIX) return;
  GRAPH ??= JSON.parse(document.getElementById("module-graph")?.textContent || "{}");
  const seen = new Set();
  const stack = [url.replace(/^\/v\/[^/]+/, "")];
  while (stack.length) {
    const u = stack.pop();
    if (seen.has(u)) continue;
    seen.add(u);
    for (const d of GRAPH[u] || []) stack.push(d);
  }
  for (const u of seen) {
    const href = `${VPREFIX}${u}`;
    if (!document.querySelector(`link[rel="modulepreload"][href="${href}"]`)) document.head.append(h("link", { rel: "modulepreload", href }));
  }
}
export const lazy = (load, url) => {
  const fn = async (ctx) => { preloadModule(url); return (await load()).default(ctx); };
  fn.preload = () => preloadModule(url);
  return fn;
};
export const badge = (text, cls = "") => h("span", { class: `badge ${cls}` }, text);
export const notice = (text, tone = "") => h("div", { class: `notice ${tone}`, role: tone === "err" ? "alert" : "status" }, text);
export const line = (...kids) => h("div", { class: "line" }, ...kids);
export const sub = (...kids) => h("div", { class: "sub" }, ...kids);
export const keyText = (text) => h("span", { class: "key" }, text);
export function kpiCard({ icon, tone = "teal", label, value, note, ratio = null, onClick }) {
  const fill = h("i");
  if (ratio !== null && Number.isFinite(ratio)) fill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  return h(onClick ? "button" : "div", { class: `kpi-card ${tone}`, type: onClick ? "button" : null, onclick: onClick || null },
    h("div", { class: "kpi-top" }, h("span", { class: "kpi-l" }, label), icon && icons[icon] ? h("span", { class: "kpi-ic" }, icons[icon]({ size: 18 })) : null),
    h("b", { class: "kpi-v" }, value),
    ratio !== null && Number.isFinite(ratio) ? h("div", { class: "kpi-bar", "aria-hidden": "true" }, fill) : null,
    note ? h("small", { class: "kpi-note" }, note) : null);
}
export const kpiGrid = (...cards) => h("div", { class: "kpi-grid" }, ...cards);

export const stats = (items) => h("div", { class: "stats" },
  items.filter(Boolean).map(([label, value, hint]) => h("div", { class: "stat" }, h("span", { class: "stat-l" }, label), h("b", {}, value), hint && sub(hint))));

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

export function sectionMenu({ title, items, render, intro }) {
  const box = h("div");

  const openMenu = () => {
    mount(box,
      intro ? notice(intro, "") : null,
      h("div", { class: "menu-grid" }, items.map((it) => h("button", {
        class: "menu-card", type: "button", onclick: () => open(it),
      },
        h("span", { class: "menu-text" },
          h("span", { class: "menu-name" }, it.name),
          it.note ? h("span", { class: "menu-note" }, it.note) : null),
        icons.chevronLeft({ size: 18 })))));
  };

  const open = async (item) => {
    const head = () => h("div", { class: "section-head" }, btn("رجوع", openMenu, "ghost sm"), h("h2", {}, item.name));
    mount(box, head(), h("p", { class: "empty" }, "جارٍ التحميل…"));
    try {
      const content = await render(item.key, { reload: () => open(item) });
      mount(box, head(), content);
    } catch (e) {
      mount(box, head(), notice(e.message, "err"));
    }
  };

  // Another page can send the user straight to one section (e.g. attendance → "who records attendance").
  let want = null;
  try { want = sessionStorage.getItem("midar_settings_section"); sessionStorage.removeItem("midar_settings_section"); } catch { /* storage unavailable */ }
  const target = want && items.find((it) => it.key === want);
  if (target) open(target); else openMenu();
  return title ? [h("h2", { class: "menu-title" }, title), box] : box;
}

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
  // An open modal dialog sits in the browser's top layer, above anything in the page whatever its z-index, so the
  // message goes inside the topmost open dialog (and back to the page if that dialog closes while it is showing).
  const top = [...document.querySelectorAll("dialog[open]")].at(-1);
  (top || document.body).append(el);
  top?.addEventListener("close", () => { if (el.parentNode === top) document.body.append(el); }, { once: true });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), isError ? 6000 : 3500);
}

export function confirmAction(message) {
  return window.confirm(message);
}

const TAB_ICONS = {
  dashboard: "home", home: "home", overview: "chart", students: "users", parents: "userPlus", teachers: "user", academic: "calendar",
  attendance: "check", distribution: "shuffle", timetable: "grid", exams: "clipboard", papers: "file", reports: "award",
  sheets: "print", analytics: "chart", finance: "wallet", fees: "wallet", ledger: "bank", admissions: "userPlus",
  announcements: "megaphone", subscription: "star", subscriptions: "star", settings: "settings", audit: "history",
  homework: "book", account: "user", requests: "userPlus", plans: "gift", schools: "building", create: "plus", deposits: "book", "money-requests": "clipboard",
  billing: "money", passwords: "key", danger: "lock",
  trainees: "users", programs: "book", courses: "clipboard", trainers: "briefcase", sessions: "calendar", icerts: "award", ifees: "wallet",
  ireports: "chart", istaff: "user", isettings: "settings", mycourses: "clipboard",
  communication: "message", staff: "briefcase", behavior: "star", calendar: "calendar", certificates: "award", services: "box",
  ai: "sparkle", chat: "message", testimonials: "star", groups: "building", lessons: "clipboard", meetings: "clock", surveys: "poll", me: "briefcase", sms: "message", "online-exams": "monitor",
};

// A section that needs the internet, opened without it: a clear card, a retry button, and it reloads by itself as soon
// as the connection returns. Attendance and grade entry keep working offline from their own pages.
function offlineCard(retry) {
  const card = h("div", { class: "offline-card" },
    h("span", { class: "oc-ic" }, icons.refresh({ size: 26 })),
    h("b", {}, "هذا القسم يحتاج اتصالًا بالإنترنت"),
    h("p", {}, "سيُحدَّث تلقائيًا عند عودة الاتصال. الحضور ورصد الدرجات يعملان بدون إنترنت ويُرسلان عند عودته."),
    h("button", { type: "button", class: "btn soft sm", onclick: () => retry() }, "إعادة المحاولة"));
  const back = () => { if (card.isConnected) retry(); };
  window.addEventListener("online", back, { once: true });
  return card;
}

export function tabs(list, views, ctx, { primary = [], top = false } = {}) {
  const bar = h("nav", { class: "tabs", role: "tablist", "aria-label": "أقسام اللوحة" });
  const body = h("div", { role: "tabpanel" });
  let current;
  const entries = list.filter(([k]) => k);
  const keys = new Set(entries.map(([k]) => k));
  const labelOf = Object.fromEntries(entries);
  const iconOf = (key, size) => (icons[TAB_ICONS[key]] ? icons[TAB_ICONS[key]]({ size }) : null);
  const badges = {};
  const fromHash = () => { const k = decodeURIComponent((location.hash.match(/^#\/([\w-]+)/) || [])[1] || ""); return keys.has(k) ? k : null; };

  const groups = [];
  for (const [key, label] of list) {
    if (key === null) groups.push({ title: label, items: [] });
    else { if (!groups.length) groups.push({ title: "", items: [] }); groups.at(-1).items.push(key); }
  }
  const all = entries.map(([k]) => k);
  const pinned = (primary.length ? primary.filter((k) => keys.has(k)) : all).slice(0, all.length <= 5 ? 5 : 4);
  const withMore = all.length > pinned.length;
  const bnav = h("nav", { class: "bnav", "aria-label": "التنقل السريع" });
  const badgeEl = (key) => h("span", { class: "nav-badge", "data-badge": key, hidden: !badges[key] }, badges[key] ? String(badges[key]) : "");

  const markActive = () => {
    for (const b of [...bar.querySelectorAll("button[data-k]"), ...bnav.querySelectorAll("button[data-k]")]) {
      b.setAttribute("aria-selected", String(b.dataset.k === current));
      b.classList.toggle("on", b.dataset.k === current);
    }
    bnav.querySelector(".bnav-more")?.classList.toggle("on", !pinned.includes(current));
  };

  const show = async (key, { push = true } = {}) => {
    if (current && applyPendingUpdate()) return;
    if (push && keys.has(key) && fromHash() !== key) history.pushState(null, "", `#/${key}`);
    current = key;
    markActive();
    const active = bar.querySelector(`[data-k="${key}"]`);
    if (active && bar.scrollWidth > bar.clientWidth + 4 && getComputedStyle(bar).flexDirection === "row") {
      active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
    mount(body, skeleton());
    const refresh = () => show(key);
    try {
      const out = await views[key]({ ...ctx, refresh });
      if (current === key) mount(body, out);
    } catch (e) {
      if (current === key) mount(body, e.status === 0 && e.code !== "timeout" ? offlineCard(refresh) : notice(e.message, "err"));
      if (e.status === 401) setTimeout(() => location.reload(), 1500);
    }
  };
  const tabBtn = (key, cls = "") => h("button", { type: "button", role: "tab", class: cls, "data-k": key, title: labelOf[key], onclick: () => show(key),
    onpointerdown: () => views[key]?.preload?.(), onfocus: () => views[key]?.preload?.() },
    iconOf(key, 18), h("span", { class: "tab-label" }, labelOf[key]), badgeEl(key));

  for (const g of groups) {
    if (!g.items.length) continue;
    if (g.title) bar.append(h("span", { class: "tabs-group", role: "presentation" }, g.title));
    for (const key of g.items) bar.append(tabBtn(key));
  }

  const openMore = () => {
    const sheet = h("dialog", { class: "sheet", "aria-label": "كل الأقسام" });
    const pick = (key) => { sheet.close(); show(key); };
    sheet.append(h("div", { class: "sheet-in" },
      h("div", { class: "sheet-head" }, h("h2", {}, "كل الأقسام"),
        h("button", { type: "button", class: "sheet-x", "aria-label": "إغلاق", onclick: () => sheet.close() }, icons.close({ size: 20 }))),
      groups.filter((g) => g.items.length).map((g) => h("section", { class: "sheet-group" },
        g.title ? h("h3", {}, g.title) : null,
        h("div", { class: "sheet-grid" }, g.items.map((key) => h("button", { type: "button", class: `sheet-item${key === current ? " on" : ""}`, onclick: () => pick(key) },
          h("span", { class: "sheet-ic" }, iconOf(key, 22)), h("span", {}, labelOf[key]), badgeEl(key))))))));
    sheet.addEventListener("close", () => sheet.remove());
    sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
    document.body.append(sheet);
    sheet.showModal();
  };
  if (!top) for (const key of pinned) bnav.append(tabBtn(key, "bnav-item"));
  if (withMore && !top) {
    bnav.append(h("button", { type: "button", class: "bnav-item bnav-more", onclick: openMore, "aria-haspopup": "dialog" },
      icons.grid({ size: 20 }), h("span", { class: "tab-label" }, "المزيد"), badgeEl("__more")));
  }
  if (!top) document.body.classList.add("has-bnav");

  const setBadge = (key, n) => {
    badges[key] = Number(n) || 0;
    const hiddenSum = all.filter((k) => !pinned.includes(k)).reduce((t, k) => t + (badges[k] || 0), 0);
    badges.__more = hiddenSum;
    for (const el of document.querySelectorAll(`[data-badge="${key}"], [data-badge="__more"]`)) {
      const v = badges[el.dataset.badge];
      el.hidden = !v; el.textContent = v ? (v > 99 ? "99+" : String(v)) : "";
    }
  };

  let home = null;
  window.addEventListener("popstate", () => { const k = fromHash() || home; if (k && k !== current) show(k, { push: false }); });
  const start = (fallback) => {
    home = fallback;
    const k = fromHash();
    if (!k && location.hash) history.replaceState(null, "", location.pathname + location.search);
    return show(k || fallback, { push: false });
  };
  // top: one horizontally scrollable bar above the content on every screen size, no bottom bar.
  return { el: h("div", { class: `tabs-layout${top ? " tabs-top" : ""}` }, bar, body, top ? null : bnav), show, start, setBadge };
}

export function sheetMenu(title, groups, { current, onPick } = {}) {
  const sheet = h("dialog", { class: "sheet", "aria-label": title });
  sheet.append(h("div", { class: "sheet-in" },
    h("div", { class: "sheet-head" }, h("h2", {}, title),
      h("button", { type: "button", class: "sheet-x", "aria-label": "إغلاق", onclick: () => sheet.close() }, icons.close({ size: 20 }))),
    groups.filter((g) => g.items.length).map((g) => h("section", { class: "sheet-group" },
      g.title ? h("h3", {}, g.title) : null,
      h("div", { class: "sheet-grid" }, g.items.map((it) => h("button", { type: "button", class: `sheet-item${it.key === current ? " on" : ""}`,
        onclick: () => { sheet.close(); onPick(it.key); } },
        h("span", { class: "sheet-ic" }, it.icon ? it.icon({ size: 22 }) : icons.list({ size: 22 })), h("span", {}, it.name),
        it.note ? h("small", { class: "sheet-note" }, it.note) : null)))))));
  sheet.addEventListener("close", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  document.body.append(sheet);
  sheet.showModal();
  return sheet;
}

export function dialog(title, content, actions = []) {
  const d = h("dialog", { "aria-label": title },
    h("div", { class: "d-in" }, h("h2", {}, title), content,
      h("div", { class: "row spaced" }, ...actions, h("button", { class: "btn ghost", type: "button", onclick: () => d.close() }, "إغلاق"))));
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

// Asks for a written reason in a dialog (instead of the browser prompt). Resolves to the text, or null if cancelled.
export function askReason({ title, explain = "", label = "السبب", action = "تأكيد", danger = false, value = "" }) {
  return new Promise((resolve) => {
    const ta = h("textarea", { rows: 3, maxLength: 200, value, "aria-label": label });
    const err = h("small", { class: "err" });
    let out = null;
    const d = dialog(title, h("div", { class: "ask-reason" }, explain ? h("p", { class: "sub" }, explain) : null, h("label", { class: "field" }, h("span", {}, label), ta), err),
      [h("button", { type: "button", class: `btn${danger ? " danger" : ""}`, onclick: () => {
        const v = ta.value.trim();
        if (v.length < 2) { err.textContent = "اكتب السبب (حرفان على الأقل)."; ta.focus(); return; }
        out = v; d.close();
      } }, action)]);
    d.addEventListener("close", () => resolve(out));
    setTimeout(() => ta.focus(), 50);
  });
}

const CRED_LABELS = { school: "رمز المدرسة", username: "اسم المستخدم", password: "كلمة المرور المؤقتة",
  access_key: "معرّف الطالب" };
export function passwordChangeScreen({ endpoint, logoutEndpoint, school, name }) {
  const cur = passwordInput({ autocomplete: "current-password" });
  const nxt = passwordInput({ autocomplete: "new-password" });
  const rep = passwordInput({ autocomplete: "new-password" });
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

export function showCredentials(title, all, note) {
  const creds = Object.fromEntries(Object.entries(all).filter(([k]) => k !== "directory_code"));
  const text = Object.entries(creds).map(([k, v]) => `${CRED_LABELS[k] || k}: ${v}`).join("\n");
  dialog(title, h("div", {},
    notice(note || "انسخها الآن وسلّمها لصاحبها. كلمة المرور لن تظهر مرة أخرى.", "warn"),
    Object.entries(creds).map(([k, v]) => line(h("span", {}, CRED_LABELS[k] || k), keyText(v)))),
    [btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); })]);
}

export function loginScreen({ role, endpoint, withSchool = true, withCode = false, onSuccess,
  title = "بوابة مالك المنصة", subtitle = "إدارة المدارس والاشتراكات من مكان واحد", points = [],
  schoolLabel = "رمز المدرسة", storeKey = "midar_school",
  recoveryText = "استعادة كلمة مرور المالك تتم من ملف الإعدادات على الخادم: npm run owner:password ثم تحديث OWNER_PASSWORD_HASH." }) {
  const school = input({ class: "ltr", autocomplete: "organization", value: localStorage.getItem(storeKey) || "", "aria-label": schoolLabel });
  const user = input({ class: "ltr", autocomplete: "username", placeholder: "اسم المستخدم", autocapitalize: "none", autocorrect: "off", spellcheck: false });
  const pass = passwordInput({ autocomplete: "current-password", placeholder: "كلمة المرور" });
  const code = input({ class: "ltr", inputMode: "numeric", autocomplete: "one-time-code", maxLength: 9, placeholder: "000000" });
  const remember = h("input", { type: "checkbox", id: "remember-me" });
  const msg = h("div");

  const submit = btn("تسجيل الدخول", async () => {
    mount(msg);
    try {
      const r = await api(endpoint, { school: school.value, username: user.value, password: pass.value, code: code.value, remember: remember.checked });
      if (withSchool) localStorage.setItem(storeKey, school.value.trim().toLowerCase());
      pass.value = "";
      onSuccess(r, { remember: remember.checked });
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "wide");
  for (const el of [school, user, pass, code]) el.addEventListener("keydown", (e) => e.key === "Enter" && submit.click());
  if (withSchool) startAnalytics(`login:${role}`);

  const recovery = h("div");

  return [
    h("div", { class: "gate" }, h("div", { class: "gate-wrap" },
      h("aside", { class: "gate-aside hide-sm" },
        brandLogo("hero-logo", true, "stacked"),
        h("h1", {}, title),
        h("p", {}, subtitle),
        points.length ? h("ul", { class: "gate-points" }, points.map((t2) => h("li", {}, icons.chevronLeft({ size: 16 }), t2))) : null),

      h("section", { class: "gate-card" },
        h("div", { class: "show-sm", style: "margin-bottom:10px" }, brandLogo("hero-logo", true, "stacked")),
        h("h2", {}, title),
        h("p", { class: "gate-sub" }, subtitle),

        withSchool ? field(schoolLabel, school) : null,
        field("اسم المستخدم", user),
        field("كلمة المرور", pass),
        withCode ? field("رمز التحقق (6 أرقام)", code, h("button", { type: "button", class: "au-link", onclick: (e) => {
          code.inputMode = "text"; code.placeholder = "XXXX-XXXX"; code.value = ""; code.focus(); e.target.remove();
        } }, "الجوال ليس معي؟ استخدم رمزًا احتياطيًا")) : null,

        h("div", { class: "gate-row" },
          h("label", {}, remember, h("span", {}, "تذكرني على هذا الجهاز")),
          h("button", { class: "gate-link", type: "button", onclick: () => mount(recovery,
            notice(recoveryText, "warn")) },
            "نسيت كلمة المرور؟")),

        recovery, msg, submit,

        h("div", { class: "gate-foot" },
          h("span", { class: "gate-badge" }, icons.lock({ size: 14 }), "وصول خاص وآمن")))),
    ),
  ];
}

async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0" }, text);
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  if (button) {
    const old = button.textContent;
    button.classList.add("done"); button.textContent = "تم النسخ";
    setTimeout(() => { button.classList.remove("done"); button.textContent = old; }, 1500);
  }
}
export function linkRow(label, url, { note, icon } = {}) {
  const copy = h("button", { type: "button", class: "btn copy sm", onclick: (e) => copyText(url, e.currentTarget) }, "نسخ");
  return h("div", { class: "link-row" },
    h("div", { class: "lr-text" }, h("b", {}, icon || null, label), note ? h("small", {}, note) : null,
      h("a", { class: "lr-url ltr", href: url, target: "_blank", rel: "noopener" }, url)),
    h("div", { class: "lr-acts" }, copy,
      h("a", { class: "btn open sm", href: url, target: "_blank", rel: "noopener" }, icons.external({ size: 14 }), "فتح")));
}
export function copyRow(label, value, { secret = false, note } = {}) {
  const shown = h("code", { class: "lr-val ltr" }, secret ? "••••••••" : value);
  const acts = [h("button", { type: "button", class: "btn copy sm", onclick: (e) => copyText(value, e.currentTarget) }, "نسخ")];
  if (secret) acts.unshift(h("button", { type: "button", class: "btn ghost sm", onclick: (e) => {
    const hidden = shown.textContent !== value;
    shown.textContent = hidden ? value : "••••••••";
    e.currentTarget.textContent = hidden ? "إخفاء" : "إظهار";
  } }, "إظهار"));
  return h("div", { class: "link-row" }, h("div", { class: "lr-text" }, h("b", {}, label), note ? h("small", {}, note) : null, shown), h("div", { class: "lr-acts" }, acts));
}

// A grade list saved after someone else changed some of its grades: the list of who changed what, and the choice
// to keep the other person's grades (reload) or save these over them.
export function scoreConflict(changed, { keepTheirs, keepMine }) {
  const v = (x) => (x === null || x === undefined ? "بلا درجة" : String(x));
  return h("div", { class: "notice warn score-clash" },
    h("b", {}, "عدّل شخص آخر هذه الدرجات بعد فتحك للصفحة:"),
    h("ul", {}, changed.map((c) => h("li", {}, `${c.name}: درجته الآن ${v(c.theirs)}${c.by ? ` (${c.by})` : ""}، ودرجتك ${v(c.yours)}`))),
    h("div", { class: "row" }, btn("إبقاء درجاتهم وإعادة التحميل", keepTheirs, "ghost sm"), btn("حفظ درجاتي فوقها", keepMine, "danger sm")));
}

