/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, $, mount } from "../shared/js/dom.js";
import { offlineProfile } from "../shared/js/offline/sync.js";
import { api } from "../shared/js/api.js";
import { field, input, select, textarea, btn, notice, dialog, showInstallBar, passwordInput, preloadModule, schoolLogoUrl } from "../shared/js/ui.js";
import { authShell, authHead, authField, phoneField } from "../shared/js/auth.js";
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
  showLogin(netDown ? "لا يوجد اتصال بالإنترنت. سجّل الدخول مرة واحدة متصلًا لتجهيز العمل بدون اتصال." : undefined);
}

function showLogin(error) {
  const ROLES = [["admin", "الإدارة"], ["teacher", "المعلم"], ["accountant", "المحاسب"]];
  const fromLink = new URLSearchParams(location.search).get("role");
  let chosen = ["admin", "teacher", "accountant"].includes(fromLink) ? fromLink : (localStorage.getItem("midar_last_role") || "admin");
  if (!ROLES.some(([k]) => k === chosen)) chosen = "admin";
  // Managers sign in with their verified mobile number; teachers and accountants keep their usernames.
  let byPhone = localStorage.getItem("midar_admin_by") !== "username";
  const phone = phoneField({ id: "login-phone" });
  const user = input({ id: "login-user", class: "ltr", autocomplete: "username", placeholder: "اسم المستخدم", autocapitalize: "none", autocorrect: "off", spellcheck: false });
  const pass = passwordInput({ id: "login-pass", autocomplete: "current-password", placeholder: "كلمة المرور" });
  const remember = h("input", { type: "checkbox", checked: true });
  const idBox = h("div");
  const seg = h("div", { class: "au-seg", role: "radiogroup", "aria-label": "نوع الحساب" });
  const msg = h("div", { "aria-live": "polite" }, error ? notice(error, "err") : null);
  const usePhone = () => chosen === "admin" && byPhone;
  const identity = () => (usePhone() ? phone.value : user.value.trim());

  const drawId = () => {
    const swap = chosen === "admin" ? h("button", { type: "button", class: "au-link", onclick: () => {
      byPhone = !byPhone;
      try { localStorage.setItem("midar_admin_by", byPhone ? "phone" : "username"); } catch { /* storage unavailable */ }
      drawId(); (usePhone() ? phone : user).focus(); checkLock();
    } }, byPhone ? "الدخول باسم المستخدم" : "الدخول برقم الجوال") : null;
    mount(idBox, usePhone()
      ? authField("رقم الجوال", phone.el, { id: "login-phone", aside: swap })
      : authField("اسم المستخدم", user, { id: "login-user", aside: swap }));
  };
  const drawRoles = () => {
    mount(seg, ROLES.map(([k, name]) => h("button", {
      type: "button", class: chosen === k ? "on" : "", role: "radio", "aria-checked": String(chosen === k),
      onclick: () => { chosen = k; drawRoles(); drawId(); checkLock(); (usePhone() ? phone : user).focus(); },
    }, name)));
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
  const submit = btn("تسجيل الدخول", async () => {
    if (lockTimer) return;
    mount(msg); phone.invalid(false);
    if (usePhone() ? phone.empty : !user.value.trim()) {
      (usePhone() ? phone : user).focus();
      return mount(msg, notice(usePhone() ? "أدخل رقم الجوال." : "أدخل اسم المستخدم.", "err"));
    }
    if (usePhone() && !phone.valid) { phone.invalid(true); phone.focus(); return mount(msg, notice("رقم الجوال غير صحيح. تأكد من الدولة والرقم.", "err")); }
    if (!pass.value) { pass.focus(); return mount(msg, notice("أدخل كلمة المرور.", "err")); }
    submit.disabled = true;
    try {
      const r = await api("/api/staff/login", { school, username: identity(), password: pass.value, remember: remember.checked });
      pass.value = "";
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
    }
  }, "au-go");
  submit.append(icons.chevronLeft({ size: 18 }));
  for (const el of [user, phone.input, pass.inputEl]) el.addEventListener("keydown", (e) => e.key === "Enter" && submit.click());
  user.addEventListener("input", checkLock);
  phone.input.addEventListener("input", checkLock);
  drawRoles(); drawId();
  setTimeout(checkLock, 0);

  const head = h("div", {}, authHead("تسجيل الدخول", "أهلًا بعودتك. سجّل الدخول للمتابعة."));
  mount(app, authShell({
    title: "إدارة مدرستك بوضوح وسهولة",
    text: "الطلاب والحضور والدرجات والرسوم والتقارير، في منصة واحدة آمنة.",
    points: [[icons.users, "الطلاب والفصول والحضور"], [icons.calendar, "الجداول والاختبارات والدرجات"], [icons.wallet, "الرسوم والفواتير والتقارير"]],
  },
  head, seg, idBox,
  authField("كلمة المرور", pass, { id: "login-pass" }),
  h("div", { class: "au-row" },
    h("label", { class: "au-check" }, remember, h("span", {}, "تذكرني")),
    h("button", { class: "au-link", type: "button", onclick: () => requestDialog(school) }, "نسيت كلمة المرور؟")),
  msg, submit,
  h("p", { class: "au-hint", style: "text-align:center;margin-top:16px" }, "تحتاج مساعدة؟ تواصل مع إدارة المدرسة.")));
  (usePhone() ? phone : user).focus();

  // The school's name and logo, when its public page is available.
  api(`/api/public/${encodeURIComponent(school)}/home`, {}).then((r) => {
    if (!r?.school?.name) return;
    mount(head, authHead("تسجيل الدخول", "أهلًا بعودتك. سجّل الدخول للمتابعة.",
      { name: r.school.name, logo: schoolLogoUrl(school, r.school.logo_v, "thumb") }));
  }).catch(() => {});
  startAnalytics("staff-login");
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
