/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, $, mount } from "../shared/js/dom.js";
import { offlineProfile } from "../shared/js/offline/sync.js";
import { api } from "../shared/js/api.js";
import { field, input, select, textarea, btn, notice, dialog, showInstallBar, passwordInput, preloadModule, schoolLogoUrl } from "../shared/js/ui.js";
import { authShell, authHead, authField, phoneField, codeField, strengthMeter } from "../shared/js/auth.js";
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
  const profile = offlineProfile();
  if (netDown && (!pinned || pinned === "teacher") && profile?.role === "teacher" && profile.me?.school?.id === school && Date.now() - profile.savedAt < 7 * 86400000) {
    return enter("teacher", profile.me);
  }
  if (!netDown) await Promise.race([loadSchool(), new Promise((r) => setTimeout(r, 1500))]);
  showLogin(netDown ? "لا يوجد اتصال بالإنترنت. سجّل الدخول مرة واحدة متصلًا لتجهيز العمل بدون اتصال." : undefined);
}

// The account last used on this device; the next sign-in only asks for the password.
const ACCT_KEY = `midar_acct_${school}`;
const savedAccount = () => {
  try { const a = JSON.parse(localStorage.getItem(ACCT_KEY) || "null"); return a?.id && a?.role ? a : null; } catch { return null; }
};
const saveAccount = (a) => { try { localStorage.setItem(ACCT_KEY, JSON.stringify(a)); } catch { /* storage unavailable */ } };
const forgetAccount = () => { try { localStorage.removeItem(ACCT_KEY); } catch { /* storage unavailable */ } };
const ROLE_NAMES = { admin: "الإدارة", teacher: "المعلم", accountant: "المحاسب" };
const maskId = (a) => (a.by === "phone" ? `•••• ${String(a.id).replace(/\D/g, "").slice(-4)}` : a.id);

let schoolInfo = null;
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
  const fromLink = new URLSearchParams(location.search).get("role");
  let chosen = account?.role || (ROLE_NAMES[fromLink] ? fromLink : (localStorage.getItem("midar_last_role") || "admin"));
  if (!ROLE_NAMES[chosen]) chosen = "admin";
  // Managers sign in with their verified mobile number; teachers and accountants keep their usernames.
  let byPhone = localStorage.getItem("midar_admin_by") !== "username";
  const phone = phoneField({ id: "login-phone" });
  const user = input({ id: "login-user", class: "ltr", autocomplete: "username", placeholder: "اسم المستخدم", autocapitalize: "none", autocorrect: "off", spellcheck: false });
  const pass = passwordInput({ id: "login-pass", autocomplete: "current-password", placeholder: "كلمة المرور" });
  const remember = h("input", { type: "checkbox", checked: true });
  const who = h("div");
  const msg = h("div", { "aria-live": "polite" }, error ? notice(error, "err") : null);
  const usePhone = () => !account && chosen === "admin" && byPhone;
  const identity = () => (account ? account.id : usePhone() ? phone.value : user.value.trim());
  const firstField = () => (account ? pass : usePhone() ? phone : user);

  const drawWho = () => {
    if (account) {
      const initial = String(account.name || ROLE_NAMES[account.role]).replace(/^(أ\.|د\.|م\.)\s*/, "").trim().charAt(0);
      return mount(who, h("div", { class: "au-me" },
        h("span", { class: "av", "aria-hidden": "true" }, initial),
        h("div", { class: "au-me-t" }, h("b", {}, account.name ? `مرحبًا، ${account.name.split(" ")[0]}` : "مرحبًا بعودتك"),
          h("small", {}, ROLE_NAMES[account.role], " · ", h("bdi", { dir: "ltr" }, maskId(account)))),
        h("button", { type: "button", class: "au-link", onclick: () => { forgetAccount(); account = null; drawWho(); checkLock(); firstField().focus(); } }, "حساب آخر")));
    }
    const swap = chosen === "admin" ? h("button", { type: "button", class: "au-link", onclick: () => {
      byPhone = !byPhone;
      try { localStorage.setItem("midar_admin_by", byPhone ? "phone" : "username"); } catch { /* storage unavailable */ }
      drawWho(); firstField().focus(); checkLock();
    } }, byPhone ? "الدخول باسم المستخدم" : "الدخول برقم الجوال") : null;
    const seg = h("div", { class: "au-seg", role: "radiogroup", "aria-label": "نوع الحساب" }, Object.entries(ROLE_NAMES).map(([k, name]) => h("button", {
      type: "button", class: chosen === k ? "on" : "", role: "radio", "aria-checked": String(chosen === k),
      onclick: () => { chosen = k; drawWho(); checkLock(); firstField().focus(); },
    }, name)));
    mount(who, seg, usePhone()
      ? authField("رقم الجوال", phone.el, { id: "login-phone", aside: swap })
      : authField("اسم المستخدم", user, { id: "login-user", aside: swap }));
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
    mount(msg); phone.invalid(false);
    if (!account && (usePhone() ? phone.empty : !user.value.trim())) {
      firstField().focus();
      return mount(msg, notice(usePhone() ? "أدخل رقم الجوال." : "أدخل اسم المستخدم.", "err"));
    }
    if (usePhone() && !phone.valid) { phone.invalid(true); phone.focus(); return mount(msg, notice("رقم الجوال غير صحيح. تأكد من الدولة والرقم.", "err")); }
    if (!pass.value) { pass.focus(); return mount(msg, notice("أدخل كلمة المرور.", "err")); }
    submit.disabled = true;
    const id = identity();
    const by = account ? account.by : usePhone() ? "phone" : "username";
    try {
      const r = await api("/api/staff/login", { school, username: id, password: pass.value, remember: remember.checked });
      pass.value = "";
      if (remember.checked) saveAccount({ id, by, role: r.role, name: r.name || "" }); else forgetAccount();
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
      mount(msg, notice(e.message, "err"));
      pass.inputEl.select();
    }
  });
  for (const el of [user, phone.input, pass.inputEl]) el.addEventListener("keydown", (e) => e.key === "Enter" && submit.click());
  user.addEventListener("input", checkLock);
  phone.input.addEventListener("input", checkLock);
  // Administrators recover by SMS to their registered number; other staff ask the school administration.
  const forgot = () => ((account ? account.role : chosen) === "admin"
    ? showRecover(account?.by === "phone" ? account.id : usePhone() ? phone.value : "")
    : requestDialog(school));
  drawWho();

  page(authHead("تسجيل الدخول", account ? "أدخل كلمة المرور للمتابعة." : "أهلًا بعودتك. سجّل الدخول للمتابعة.", schoolInfo),
    who,
    authField("كلمة المرور", pass, { id: "login-pass" }),
    h("div", { class: "au-row" },
      h("label", { class: "au-check" }, remember, h("span", {}, "تذكرني")),
      h("button", { class: "au-link", type: "button", onclick: forgot }, "نسيت كلمة المرور؟")),
    msg, submit);
  setTimeout(checkLock, 0);
  firstField().focus();
  startAnalytics("staff-login");
}

// Forgotten password for administrators: registered number, SMS code, new password, then straight in.
function showRecover(prefill = "") {
  const back = h("button", { type: "button", class: "au-back", onclick: () => showLogin() }, icons.chevronLeft({ size: 16 }), "العودة لتسجيل الدخول");
  const phone = phoneField({ id: "rc-phone" });
  if (prefill) phone.set(prefill);
  const msg = h("div", { "aria-live": "polite" });
  const send = go("إرسال رمز التحقق", async () => {
    mount(msg); phone.invalid(false);
    if (phone.empty) { phone.invalid(true); phone.focus(); return mount(msg, notice("أدخل رقم الجوال.", "err")); }
    if (!phone.valid) { phone.invalid(true); phone.focus(); return mount(msg, notice("رقم الجوال غير صحيح. تأكد من الدولة والرقم.", "err")); }
    send.disabled = true;
    try { const r = await api("/api/staff/recover/start", { school, phone: phone.value }); codeStep(phone.value, r.resend_in || 60); }
    catch (e) { send.disabled = false; mount(msg, notice(e.message, "err")); }
  });
  phone.input.addEventListener("keydown", (e) => e.key === "Enter" && send.click());
  page(back, authHead("استعادة كلمة المرور", "أدخل رقم الجوال المسجّل لحسابك، وسيصلك رمز تحقق برسالة نصية."),
    authField("رقم الجوال", phone.el, { id: "rc-phone" }), msg, send);
  phone.focus();

  function codeStep(full, wait) {
    const m = h("div", { "aria-live": "polite" });
    let timer, busy = false, otpAbort = null;
    const resend = h("button", { type: "button", class: "au-link" });
    const verify = async () => {
      if (busy) return;
      mount(m);
      if (!/^\d{6}$/.test(code.value)) { code.invalid(); return mount(m, notice("أدخل رمز التحقق المكوّن من 6 أرقام.", "err")); }
      busy = true; next.disabled = true;
      try {
        const r = await api("/api/staff/recover/verify", { school, phone: full, code: code.value });
        clearInterval(timer); otpAbort?.abort();
        passwordStep(r.ticket, full);
      } catch (e) { mount(m, notice(e.message, "err")); code.invalid(); code.clear(); }
      finally { busy = false; next.disabled = false; }
    };
    const code = codeField({ onComplete: verify });
    const next = go("متابعة", verify);
    const tick = () => {
      clearInterval(timer);
      const paint = () => { resend.disabled = wait > 0; resend.textContent = wait > 0 ? `إعادة الإرسال بعد ${wait} ث` : "إعادة إرسال الرمز"; };
      paint();
      timer = setInterval(() => { wait = Math.max(0, wait - 1); paint(); if (!wait) clearInterval(timer); }, 1000);
    };
    const autoFill = () => {
      if (!("OTPCredential" in window)) return;
      otpAbort?.abort(); otpAbort = new AbortController();
      navigator.credentials.get({ otp: { transport: ["sms"] }, signal: otpAbort.signal })
        .then((c) => { if (c?.code) { code.value = c.code; verify(); } }).catch(() => {});
    };
    resend.addEventListener("click", async () => {
      mount(m); resend.disabled = true;
      try { await api("/api/staff/recover/start", { school, phone: full }); wait = 60; tick(); code.clear(); autoFill(); mount(m, notice("أرسلنا رمزًا جديدًا.", "")); }
      catch (e) { mount(m, notice(e.message, "err")); resend.disabled = false; }
    });
    page(back, authHead("أدخل رمز التحقق", h("span", {}, "إذا كان الرقم ", h("bdi", { dir: "ltr" }, `•••• ${full.replace(/\D/g, "").slice(-4)}`), " مسجّلًا لحسابك فسيصلك رمز من 6 أرقام.")),
      code.el,
      h("div", { class: "au-sent" }, resend, h("button", { type: "button", class: "au-link", onclick: () => { clearInterval(timer); otpAbort?.abort(); showRecover(full); } }, "تغيير الرقم")),
      m, next);
    tick(); autoFill(); code.focus();
  }

  function passwordStep(ticket, full) {
    const pass = passwordInput({ id: "rc-pass", autocomplete: "new-password", placeholder: "كلمة المرور الجديدة" });
    const again = passwordInput({ id: "rc-again", autocomplete: "new-password", placeholder: "أعد كتابة كلمة المرور" });
    const meter = strengthMeter(pass);
    const m = h("div", { "aria-live": "polite" });
    const save = go("حفظ والدخول", async () => {
      mount(m);
      if (!pass.value) { pass.focus(); return mount(m, notice("أدخل كلمة المرور الجديدة.", "err")); }
      if (pass.value !== again.value) { again.focus(); return mount(m, notice("كلمتا المرور غير متطابقتين.", "err")); }
      save.disabled = true;
      try {
        const r = await api("/api/staff/recover/reset", { school, ticket, password: pass.value });
        saveAccount({ id: full, by: "phone", role: "admin", name: r.name || "" });
        sessionStorage.setItem("midar_role", "admin");
        localStorage.setItem("midar_last_role", "admin");
        mount(app, h("p", { class: "empty loading" }, "جارٍ فتح لوحتك…"));
        await enter("admin");
      } catch (e) {
        save.disabled = false; mount(m, notice(e.message, "err"));
        if (e.status === 410) setTimeout(() => showRecover(full), 1800);
      }
    });
    for (const el of [pass, again]) el.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
    page(back, authHead("كلمة مرور جديدة", "اختر كلمة مرور جديدة لحسابك. ستُنهى الجلسات المفتوحة على الأجهزة الأخرى."),
      authField("كلمة المرور الجديدة", h("div", {}, pass, meter.el), { id: "rc-pass", hint: h("span", {}, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا. ", meter.label) }),
      authField("تأكيد كلمة المرور", again, { id: "rc-again" }),
      m, save);
    pass.focus();
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
