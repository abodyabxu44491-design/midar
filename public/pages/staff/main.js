/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, $, mount } from "../shared/js/dom.js";
import { offlineProfile } from "../shared/js/offline/sync.js";
import { api } from "../shared/js/api.js";
import { field, input, select, textarea, btn, notice, dialog, showInstallBar, passwordInput, preloadModule, schoolLogoUrl } from "../shared/js/ui.js";
import { authShell, authHead, authField, providerButtons, orDivider, OAUTH_MESSAGES } from "../shared/js/auth.js";
import { icons } from "../shared/js/icons.js";
import { startAnalytics } from "../shared/js/analytics.js";

const app = $("#app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();

const portal = (rel, fn) => async (...args) => {
  preloadModule(new URL(rel, import.meta.url).pathname);
  return (await import(rel))[fn](...args);
};
const open = {
  admin: portal("../admin/app.js", "startAdmin"),
  teacher: portal("../teacher/app.js", "startTeacher"),
  accountant: portal("../accountant/app.js", "startAccountant"),
};

const urlRole = new URLSearchParams(location.search).get("role");
function setAppRole(role) {
  const u = new URL(location.href);
  if (u.searchParams.get("role") !== role) {
    u.searchParams.set("role", role);
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
  }
  const link = document.querySelector('link[rel="manifest"]');
  const href = `/${encodeURIComponent(school)}/app.webmanifest?as=${role}`;
  if (link && link.getAttribute("href") !== href) link.setAttribute("href", href);
  document.documentElement.dataset.app = { admin: "الإدارة", teacher: "المعلم", accountant: "المحاسب" }[role];
  document.querySelectorAll(".install-ic").forEach((b) => { b.title = `ثبّت تطبيق ${document.documentElement.dataset.app}`; b.setAttribute("aria-label", b.title); });
}
const enter = (role, ...args) => { setAppRole(role); return open[role](...args); };

async function start() {
  const pinned = open[urlRole] ? urlRole : null;
  const last = pinned || sessionStorage.getItem("midar_role") || localStorage.getItem("midar_last_role");
  const roles = ["admin", "teacher", "accountant"];
  let netDown = !navigator.onLine;
  const probe = (role) => api(`/api/${role}/me`).then(() => role, (e) => {
    if (e.code === "network" || e.code === "timeout") netDown = true;
    throw e;
  });
  let role = null;
  if (navigator.onLine) {
    if (last && open[last]) role = await probe(last).catch(() => null);
    if (!role && !pinned) role = await Promise.any(roles.filter((r) => r !== last).map(probe)).catch(() => null);
  }
  if (role) { sessionStorage.setItem("midar_role", role); localStorage.setItem("midar_last_role", role); return enter(role); }
  // The manager's account is still signed in on this device: open the school without asking again.
  if (navigator.onLine && (!pinned || pinned === "admin")) {
    const me = await api("/api/account/me").catch(() => null);
    if (me?.schools?.some((x) => x.id === school)) {
      const opened = await api("/api/account/enter", { school }).then(() => true, () => false);
      if (opened) { sessionStorage.setItem("midar_role", "admin"); localStorage.setItem("midar_last_role", "admin"); return enter("admin"); }
    }
  }
  const profile = offlineProfile();
  if (netDown && (!pinned || pinned === "teacher") && profile?.role === "teacher" && profile.me?.school?.id === school && Date.now() - profile.savedAt < 7 * 86400000) {
    return enter("teacher", profile.me);
  }
  if (!netDown) await Promise.race([Promise.all([loadSchool(), loadConfig(), loadManager()]), new Promise((r) => setTimeout(r, 1500))]);
  showLogin(netDown ? "لا يوجد اتصال بالإنترنت. سجّل الدخول مرة واحدة متصلًا لتجهيز العمل بدون اتصال." : undefined);
}

// The account last used on this device; the next sign-in only asks for the password.
const ACCT_KEY = `midar_acct_${school}`;
const savedAccount = () => {
  // Accounts remembered before managers moved to Midar accounts (phone sign-in) are dropped.
  try { const a = JSON.parse(localStorage.getItem(ACCT_KEY) || "null"); return a?.id && a?.role && a.by !== "phone" ? a : null; } catch { return null; }
};
const saveAccount = (a) => { try { localStorage.setItem(ACCT_KEY, JSON.stringify(a)); } catch { /* storage unavailable */ } };
const forgetAccount = () => { try { localStorage.removeItem(ACCT_KEY); } catch { /* storage unavailable */ } };
const ROLE_NAMES = { admin: "الإدارة", teacher: "المعلم", accountant: "المحاسب" };

let schoolInfo = null;
let cfg = { google: false, apple: false };
const loadConfig = () => api("/api/account/config").then((c) => { cfg = c; }).catch(() => {});
// false while this school's manager has not created a Midar account yet (first sign-in after the move).
let managerLinked = true;
const loadManager = () => api(`/api/staff/manager?school=${encodeURIComponent(school)}`).then((r) => { managerLinked = r.account !== false; }).catch(() => {});
const BRAND = () => ({
  title: "إدارة مدرستك بوضوح وسهولة",
  text: "الطلاب والحضور والدرجات والرسوم والتقارير، في منصة واحدة آمنة.",
  points: [[icons.users, "الطلاب والفصول والحضور"], [icons.calendar, "الجداول والاختبارات والدرجات"], [icons.wallet, "الرسوم والفواتير والتقارير"]],
  school: schoolInfo, kicker: "بوابة منسوبي المدرسة",
});
const go = (label, onClick) => { const b = btn(label, onClick, "au-go"); b.append(icons.chevronLeft({ size: 18 })); return b; };
const page = (...content) => mount(app, authShell(BRAND(), ...content));
const loadSchool = () => (schoolInfo ? Promise.resolve(schoolInfo) : api(`/api/public/${encodeURIComponent(school)}/home`, {})
  .then((r) => (schoolInfo = r?.school?.name ? { name: r.school.name, logo: schoolLogoUrl(school, r.school.logo_v, "thumb") } : null))
  .catch(() => null));

function showLogin(error) {
  let account = savedAccount();
  const q = new URLSearchParams(location.search);
  const fromLink = q.get("role");
  let chosen = account?.role || (ROLE_NAMES[fromLink] ? fromLink : (localStorage.getItem("midar_last_role") || "admin"));
  if (!ROLE_NAMES[chosen]) chosen = "admin";
  // The school's manager signs in with a Midar account (email, Google or Apple); deputies, teachers and
  // accountants keep their usernames.
  let deputy = localStorage.getItem("midar_admin_by") === "username";
  const email = input({ id: "login-email", type: "email", class: "ltr", autocomplete: "email", inputMode: "email", placeholder: "name@example.com" });
  const user = input({ id: "login-user", class: "ltr", autocomplete: "username", placeholder: "اسم المستخدم", autocapitalize: "none", autocorrect: "off", spellcheck: false });
  const pass = passwordInput({ id: "login-pass", autocomplete: "current-password", placeholder: "كلمة المرور" });
  const remember = h("input", { type: "checkbox", checked: true });
  const who = h("div");
  const oauthNote = q.get("oauth") && OAUTH_MESSAGES[q.get("oauth")];
  if (q.has("oauth")) history.replaceState(null, "", location.pathname + (fromLink ? `?role=${fromLink}` : ""));
  const msg = h("div", { "aria-live": "polite" }, error ? notice(error, "err") : oauthNote ? notice(oauthNote, "err") : null);
  const managerMode = () => !account && chosen === "admin" && !deputy;
  // An existing school whose manager has no Midar account yet: the current username and password, once.
  const firstTime = () => managerMode() && !managerLinked;
  const usesAccount = () => (account ? account.by === "email" : managerMode() && !firstTime());
  const identity = () => (account ? account.id : usesAccount() ? email.value.trim() : user.value.trim());
  const firstField = () => (account ? pass : usesAccount() ? email : user);

  const drawWho = () => {
    if (account) {
      const initial = String(account.name || account.id).replace(/^(أ\.|د\.|م\.)\s*/, "").trim().charAt(0).toUpperCase();
      return mount(who, h("div", { class: "au-me" },
        h("span", { class: "av", "aria-hidden": "true" }, initial),
        h("div", { class: "au-me-t" }, h("b", {}, account.name ? `مرحبًا، ${account.name.split(" ")[0]}` : "مرحبًا بعودتك"),
          h("small", {}, ROLE_NAMES[account.role], " · ", h("bdi", { dir: "ltr" }, account.id))),
        h("button", { type: "button", class: "au-link", onclick: () => { forgetAccount(); account = null; drawWho(); checkLock(); firstField().focus(); } }, "حساب آخر")));
    }
    const seg = h("div", { class: "au-seg", role: "radiogroup", "aria-label": "نوع الحساب" }, Object.entries(ROLE_NAMES).map(([k, name]) => h("button", {
      type: "button", class: chosen === k ? "on" : "", role: "radio", "aria-checked": String(chosen === k),
      onclick: () => { chosen = k; drawWho(); checkLock(); firstField().focus(); },
    }, name)));
    creds.hidden = firstTime();
    if (firstTime()) {
      // The school has no manager account yet: its own link is where the manager creates it.
      const to = `/activate?school=${encodeURIComponent(school)}`;
      return mount(who, seg, h("div", { class: "au-first" },
        h("b", {}, "أول دخول لمدير المدرسة"),
        h("p", {}, "أنشئ حساب المدير مرة واحدة بالبريد المسجل لدى مدار، أو تابع بحساب Google بنفس البريد. بعدها تدخل من هذا الرابط بأي جهاز.")),
      go("إنشاء حساب المدير", () => { location.href = to; }),
      h("p", { class: "au-tabs-note" }, h("a", { class: "au-link", href: to }, "لديك حساب مدار؟ سجّل الدخول وارِبطه بالمدرسة")));
    }
    if (managerMode()) {
      const providers = providerButtons(cfg, (p) => `/api/account/oauth/${p}/start?purpose=login&school=${encodeURIComponent(school)}`);
      return mount(who, seg, providers, providers ? orDivider("أو بالبريد الإلكتروني") : null, authField("البريد الإلكتروني", email, { id: "login-email" }));
    }
    const swap = chosen === "admin" ? h("button", { type: "button", class: "au-link", onclick: () => {
      deputy = false;
      try { localStorage.setItem("midar_admin_by", "account"); } catch { /* storage unavailable */ }
      drawWho(); firstField().focus(); checkLock();
    } }, "مدير المدرسة؟ ادخل بحسابك") : null;
    mount(who, seg, authField("اسم المستخدم", user, { id: "login-user", aside: swap }));
  };

  const lockKey = () => `midar_lock_${school}_${identity().toLowerCase()}`;
  let lockTimer = null;
  const runLock = (until) => {
    clearInterval(lockTimer);
    submit.disabled = true;
    const time = h("b", { class: "lock-time", dir: "ltr" });
    const bar = h("i");
    const total = Math.max(1, Math.round((until - Date.now()) / 1000));
    mount(msg, h("div", { class: "lock-box", role: "timer", "aria-live": "polite" },
      h("div", { class: "lock-title" }, "تم إيقاف الدخول مؤقتًا بسبب محاولات خاطئة متكررة"),
      h("div", { class: "lock-sub" }, "يمكنك المحاولة مرة أخرى بعد"), time, h("div", { class: "lock-bar" }, bar),
      h("div", { class: "lock-sub" }, "نسيت كلمة المرور؟ استخدم «نسيت كلمة المرور».")));
    const tick = () => {
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(lockTimer); lockTimer = null;
        sessionStorage.removeItem(lockKey());
        submit.disabled = false;
        return mount(msg, notice("انتهى الإيقاف. يمكنك المحاولة الآن.", ""));
      }
      submit.disabled = true;
      time.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
      bar.style.width = `${Math.min(100, (left / total) * 100)}%`;
    };
    tick();
    lockTimer = setInterval(tick, 250);
  };
  function checkLock() {
    const until = Number(sessionStorage.getItem(lockKey()) || 0);
    if (until > Date.now()) runLock(until);
    else if (lockTimer) { clearInterval(lockTimer); lockTimer = null; submit.disabled = false; mount(msg); }
  }
  const submit = go("تسجيل الدخول", async () => {
    if (lockTimer) return;
    mount(msg);
    if (!account && !identity()) { firstField().focus(); return mount(msg, notice(usesAccount() ? "أدخل بريدك الإلكتروني." : "أدخل اسم المستخدم.", "err")); }
    if (!pass.value) { pass.focus(); return mount(msg, notice("أدخل كلمة المرور.", "err")); }
    submit.disabled = true;
    const id = identity();
    try {
      if (usesAccount()) {
        // The manager's Midar account, then this school (the server checks the link).
        const a = await api("/api/account/login", { email: id, password: pass.value });
        pass.value = "";
        if (remember.checked) saveAccount({ id, by: "email", role: "admin", name: a.name || "" }); else forgetAccount();
        return await openManagedSchool();
      }
      const r = await api("/api/staff/login", { school, username: id, password: pass.value, remember: remember.checked });
      pass.value = "";
      if (r.setup) {
        // The manager confirmed the school's current credentials: on to creating the Midar account.
        forgetAccount();
        try { localStorage.setItem("midar_admin_by", "account"); } catch { /* storage unavailable */ }
        mount(app, h("p", { class: "empty loading" }, "جارٍ تجهيز حسابك…"));
        location.href = r.setup;
        return;
      }
      if (remember.checked) saveAccount({ id, by: "username", role: r.role, name: r.name || "" }); else forgetAccount();
      sessionStorage.setItem("midar_role", r.role);
      localStorage.setItem("midar_last_role", r.role);
      localStorage.setItem("midar_school", school);
      mount(app, h("p", { class: "empty loading" }, "جارٍ فتح لوحتك…"));
      await enter(r.role);
    } catch (e) {
      submit.disabled = false;
      if (e.code === "locked" && e.retryAfter) {
        const until = Date.now() + e.retryAfter * 1000;
        sessionStorage.setItem(lockKey(), String(until));
        return runLock(until);
      }
      if (e.code === "use_account") { deputy = false; chosen = "admin"; managerLinked = true; drawWho(); }
      mount(msg, notice(e.message, "err"));
      pass.inputEl.select();
    }
  });
  for (const el of [user, email, pass.inputEl]) el.addEventListener("keydown", (e) => e.key === "Enter" && submit.click());
  user.addEventListener("input", checkLock);
  // Managers recover their account by email; other staff ask the school administration.
  const forgot = () => (firstTime()
    ? mount(msg, notice("لاستعادة الدخول، تواصل مع إدارة مدار لترسل لك رابط إعداد حسابك.", "warn"))
    : usesAccount()
    ? (location.href = `/account?forgot=1&school=${encodeURIComponent(school)}${identity() ? `&email=${encodeURIComponent(identity())}` : ""}`)
    : requestDialog(school));
  const creds = h("div", { class: "au-creds" },
    authField("كلمة المرور", pass, { id: "login-pass" }),
    h("div", { class: "au-row" },
      h("label", { class: "au-check" }, remember, h("span", {}, "تذكرني")),
      h("button", { class: "au-link", type: "button", onclick: forgot }, "نسيت كلمة المرور؟")),
    msg, submit);
  drawWho();

  page(authHead("تسجيل الدخول", account ? "أدخل كلمة المرور للمتابعة." : "أهلًا بعودتك. سجّل الدخول للمتابعة.", schoolInfo),
    who, creds,
    !account && chosen === "admin" && !deputy && managerLinked ? h("p", { class: "au-tabs-note" }, h("button", { type: "button", class: "au-link", onclick: () => {
      deputy = true;
      try { localStorage.setItem("midar_admin_by", "username"); } catch { /* storage unavailable */ }
      showLogin();
    } }, "مستخدم إداري باسم مستخدم؟ ادخل من هنا")) : null);
  setTimeout(checkLock, 0);
  firstField().focus();
  startAnalytics("staff-login");
}

// After the manager's account is signed in: open this school, or say which schools the account manages.
async function openManagedSchool() {
  try {
    await api("/api/account/enter", { school });
    sessionStorage.setItem("midar_role", "admin");
    localStorage.setItem("midar_last_role", "admin");
    localStorage.setItem("midar_school", school);
    mount(app, h("p", { class: "empty loading" }, "جارٍ فتح لوحتك…"));
    return enter("admin");
  } catch (e) {
    if (e.status !== 403) throw e;
    const me = await api("/api/account/me").catch(() => null);
    page(authHead("حسابك غير مرتبط بهذه المدرسة", "اختر مدرسة من مدارسك، أو ادخل بحساب آخر.", schoolInfo),
      me?.schools?.length ? h("div", { class: "au-schools" }, me.schools.map((s) => h("a", { class: "au-school-row", href: `/${encodeURIComponent(s.id)}/idara?role=admin` },
        h("span", { class: "au-school-ic" }, icons.building({ size: 18 })), h("span", { class: "au-school-t" }, h("b", {}, s.name), h("small", { dir: "ltr" }, s.id)), icons.chevronLeft({ size: 16 }))))
        : notice("حسابك غير مرتبط بأي مدرسة بعد. افتح رابط الإعداد الذي وصلك من إدارة مدار.", "warn"),
      h("button", { type: "button", class: "au-alt-btn", onclick: async () => { await api("/api/account/logout", {}).catch(() => {}); forgetAccount(); showLogin(); } }, "الدخول بحساب آخر"));
    return null;
  }
}

function requestDialog(schoolCode) {
  const f = {
    full_name: input({ placeholder: "الاسم الكامل كما في السجلات" }),
    username: input({ class: "ltr", placeholder: "اسم المستخدم", autocapitalize: "none", autocorrect: "off", spellcheck: false }),
    phone: input({ class: "ltr", inputMode: "tel", placeholder: "رقم الجوال للتواصل" }),
    branch: input({ placeholder: "المدرسة أو الفرع (اختياري)" }),
    job_title: select([["teacher", "معلم"], ["accountant", "محاسب"], ["admin", "مدير المدرسة (الإدارة)"]], { value: localStorage.getItem("midar_last_role") || "teacher" }),
    contact_pref: select([["whatsapp", "واتساب"], ["phone", "اتصال هاتفي"], ["email", "بريد إلكتروني"]]),
    description: textarea({ rows: 3, placeholder: "اشرح سبب الطلب (مثلًا: نسيت كلمة المرور)" }),
  };
  const who = h("div");
  const drawWho = () => mount(who, notice(f.job_title.value === "admin"
    ? "طلبك يصل إلى إدارة المنصة. بعد التحقق من هويتك يُرسل لك رابط آمن لتغيير كلمة المرور."
    : "طلبك يصل إلى إدارة مدرستك. بعد التحقق من هويتك تُرسل لك رابطًا آمنًا لتغيير كلمة المرور.", "warn"));
  f.job_title.addEventListener("change", drawWho);
  drawWho();
  const msg = h("div");

  const d = dialog("نسيت كلمة المرور", h("div", {},
    h("div", { class: "row" }, field("أنا", f.job_title), field("وسيلة التواصل المفضلة", f.contact_pref)),
    who,
    field("الاسم الكامل", f.full_name),
    h("div", { class: "row" }, field("اسم المستخدم", f.username), field("رقم الجوال", f.phone)),
    field("المدرسة أو الفرع", f.branch),
    field("وصف المشكلة", f.description),
    msg),
  [btn("إرسال الطلب", async (e) => {
    const button = e.currentTarget;
    mount(msg);
    button.disabled = true;
    try {
      const r = await api(`/api/public/${encodeURIComponent(schoolCode)}/password-request`, {
        full_name: f.full_name.value, username: f.username.value, phone: f.phone.value,
        branch: f.branch.value || null, job_title: f.job_title.value,
        description: f.description.value, contact_pref: f.contact_pref.value,
      });
      mount(msg, notice(`تم استلام طلبك. رقم الطلب: ${r.ref}. ${f.job_title.value === "admin" ? "ستتواصل معك إدارة المنصة" : "ستتواصل معك إدارة المدرسة"} للتحقق من بياناتك ثم ترسل لك رابط التغيير.`, ""));
      for (const el of [f.full_name, f.username, f.phone, f.branch, f.description]) el.value = "";
    } catch (err) { mount(msg, notice(err.message, "err")); }
    button.disabled = false;
  }, "primary")]);
}

start();
showInstallBar();
