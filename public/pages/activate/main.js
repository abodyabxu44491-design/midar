/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The school link the owner sends (/activate?token=…): the manager creates or signs in to a Midar account
// (email, Google or Apple), the account is linked to the school once, and the school opens.
// Also serves /account: the manager's schools, for a signed-in account.
import { $, h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { btn, notice, passwordInput, input } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { authShell, authHead, authField, codeField, strengthMeter, providerButtons, orDivider, OAUTH_MESSAGES } from "../shared/js/auth.js";

const app = $("#app");
const params = new URLSearchParams(location.search);
const accountPage = location.pathname.replace(/\/$/, "") === "/account";
const KEY = "midar_setup";
const store = (fn) => { try { return fn(); } catch { return null; } };
let token = params.get("token") || (params.get("resume") ? store(() => sessionStorage.getItem(KEY)) : "") || "";
if (params.get("token")) store(() => sessionStorage.setItem(KEY, token));
// The secret link leaves the address bar (and history); a refresh resumes from this tab's storage.
if (params.has("token") || params.has("oauth") || params.has("email")) history.replaceState(null, "", location.pathname + (token && !accountPage ? "?resume=1" : params.get("forgot") ? `?forgot=1${params.get("school") ? `&school=${encodeURIComponent(params.get("school"))}` : ""}` : ""));
const oauth = params.get("oauth");

let cfg = { email: true, google: false, apple: false };
let info = null;
const BRAND = {
  title: "أهلًا بك في مدار",
  text: "أنشئ حسابك مرة واحدة، ويرتبط بمدرستك. بعدها تدخل من أي جهاز بالبريد الإلكتروني أو Google أو Apple.",
  points: [[icons.shield, "حساب موثّق لك وحدك"], [icons.users, "كل منسوبي المدرسة في منصة واحدة"], [icons.chart, "تقارير جاهزة لحظة بلحظة"]],
};
const page = (...content) => mount(app, authShell({ ...BRAND, school: info?.school ? { name: info.school } : null, kicker: info?.recovery ? "استعادة الوصول" : "إعداد حساب المدير" }, ...content));
const go = (label, onClick, cls = "au-go") => { const b = btn(label, onClick, cls); if (cls === "au-go") b.append(icons.chevronLeft({ size: 18 })); return b; };
const ghost = (label, onClick) => h("button", { type: "button", class: "au-alt-btn", onclick: onClick }, label);
const back = (onClick) => h("button", { type: "button", class: "au-back", onclick: onClick }, icons.chevronLeft({ size: 16 }), "رجوع");
const msgBox = () => h("div", { "aria-live": "polite" });
const emailInput = (id, value = "") => input({ id, type: "email", class: "ltr", autocomplete: "email", inputMode: "email", placeholder: "name@example.com", value });
const providersFor = (purpose) => providerButtons(cfg, (p) => `/api/account/oauth/${p}/start?${new URLSearchParams(purpose === "setup" ? { purpose, setup: token } : { purpose })}`);
const school = () => (info?.school ? { name: info.school } : null);

async function start() {
  cfg = await api("/api/account/config").catch(() => cfg);
  if (accountPage && params.get("forgot")) {
    // From a school's sign-in page: recover the password, then open that school.
    const back = params.get("school");
    const then = async () => {
      if (!back) return accountHome();
      try { const r = await api("/api/account/enter", { school: back }); location.href = r.redirect; } catch { accountHome(); }
    };
    return resetFlow(params.get("email") || "", then, () => { location.href = back ? `/${encodeURIComponent(back)}/idara?role=admin` : "/account"; });
  }
  if (accountPage) return accountHome();
  if (!/^[0-9a-f]{64}$/.test(token)) return fail("رابط الإعداد غير مكتمل. افتح الرابط كما وصلك بالكامل.");
  try { info = await api("/api/account/setup", { token }); } catch (e) {
    store(() => sessionStorage.removeItem(KEY));
    return fail(e.message, e.code === "used");
  }
  return info.account ? continueAs() : welcome();
}

function welcome(note) {
  const providers = providersFor("setup");
  const first = String(info.manager_name || "").replace(/^(أ\.|د\.|م\.)\s*/, "").trim().split(/\s+/)[0];
  page(first ? authHead(`أهلًا، ${first}`, "مرحبًا بك في مدار. لبدء استخدام مدرستك، أنشئ حسابك أو اربط حسابًا لديك.", school())
    : authHead("مرحبًا بك في مدار", "لبدء استخدام مدرستك، أنشئ حسابك أو اربط حسابًا لديك.", school()),
    info.recovery ? notice("هذا رابط استعادة وصول: الحساب الذي تربطه الآن يصبح حساب إدارة المدرسة بدل الحساب السابق.", "warn") : null,
    oauth && OAUTH_MESSAGES[oauth] && !note ? notice(OAUTH_MESSAGES[oauth], oauth === "linked" ? "" : "err") : null,
    note ? notice(note, "err") : null,
    providers, providers ? orDivider() : null,
    go("إنشاء حساب بالبريد الإلكتروني", () => signupForm()),
    ghost("لدي حساب بالفعل — تسجيل الدخول", () => loginForm({ then: () => link("password"), backTo: () => welcome() })));
}

// Already signed in on this device: link this school to that account.
function continueAs() {
  const a = info.account;
  const msg = msgBox();
  const linkBtn = go("ربط المدرسة والدخول", async () => { linkBtn.disabled = true; try { await link("password"); } catch (e) { linkBtn.disabled = false; mount(msg, notice(e.message, "err")); } });
  page(authHead("مرحبًا بك في مدار", "أنت مسجّل الدخول على هذا الجهاز. اربط المدرسة بحسابك للمتابعة.", school()),
    meCard(a.name, a.email), msg, linkBtn,
    ghost("استخدام حساب آخر", async () => { await api("/api/account/logout", {}).catch(() => {}); info.account = null; welcome(); }));
}
const meCard = (name, email) => h("div", { class: "au-me" },
  h("span", { class: "av", "aria-hidden": "true" }, String(name || email || "؟").trim().charAt(0).toUpperCase()),
  h("div", { class: "au-me-t" }, h("b", {}, name || "حسابك في مدار"), h("small", {}, h("bdi", { dir: "ltr" }, email))));

function signupForm(prefill = {}) {
  const name = input({ id: "su-name", autocomplete: "name", placeholder: "الاسم الكامل", value: prefill.name || info?.manager_name || "" });
  const email = emailInput("su-email", prefill.email || "");
  const pass = passwordInput({ id: "su-pass", autocomplete: "new-password", placeholder: "كلمة المرور" });
  const again = passwordInput({ id: "su-again", autocomplete: "new-password", placeholder: "أعد كتابة كلمة المرور" });
  const meter = strengthMeter(pass);
  const msg = msgBox();
  const submit = go("إنشاء الحساب", async () => {
    mount(msg);
    if (!name.value.trim()) { name.focus(); return mount(msg, notice("اكتب اسمك.", "err")); }
    if (!email.value.trim()) { email.focus(); return mount(msg, notice("أدخل بريدك الإلكتروني.", "err")); }
    if (pass.value !== again.value) { again.focus(); return mount(msg, notice("كلمتا المرور غير متطابقتين.", "err")); }
    submit.disabled = true;
    const body = { email: email.value.trim(), password: pass.value, name: name.value.trim(), setup: token };
    try {
      const r = await api("/api/account/signup", body);
      codeStep(r.email, () => api("/api/account/signup", body), async (code) => {
        await api("/api/account/signup/verify", { email: r.email, code });
        await link("email");
      }, () => signupForm({ name: body.name, email: body.email }));
    } catch (e) {
      submit.disabled = false;
      if (e.code === "exists") {
        return mount(msg, notice(h("span", {}, e.message, " ",
          h("button", { type: "button", class: "au-link", onclick: () => loginForm({ email: body.email, then: () => link("password"), backTo: () => welcome() }) }, "تسجيل الدخول بهذا البريد")), "warn"));
      }
      mount(msg, notice(e.message, "err"));
    }
  });
  for (const el of [name, email, pass.inputEl, again.inputEl]) el.addEventListener("keydown", (e) => e.key === "Enter" && submit.click());
  page(back(() => welcome()), authHead("إنشاء حساب بالبريد الإلكتروني", "سيصلك رمز تأكيد على بريدك قبل إكمال الحساب.", school()),
    authField("الاسم", name, { id: "su-name" }),
    authField("البريد الإلكتروني", email, { id: "su-email" }),
    authField("كلمة المرور", h("div", {}, pass, meter.el), { id: "su-pass", hint: h("span", {}, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا. ", meter.label) }),
    authField("تأكيد كلمة المرور", again, { id: "su-again" }),
    msg, submit);
  (name.value ? email : name).focus();
}

// A six-digit code sent by email; `resend` sends another, `done(code)` finishes the step.
function codeStep(email, resend, done, backTo) {
  const msg = msgBox();
  let wait = 60, timer, busy = false;
  const again = h("button", { type: "button", class: "au-link" });
  const finish = async () => {
    if (busy) return;
    mount(msg);
    if (!/^\d{6}$/.test(code.value)) { code.invalid(); return mount(msg, notice("أدخل الرمز المكوّن من 6 أرقام.", "err")); }
    busy = true; next.disabled = true;
    try { await done(code.value); clearInterval(timer); } catch (e) { mount(msg, notice(e.message, "err")); code.invalid(); code.clear(); }
    finally { busy = false; next.disabled = false; }
  };
  const code = codeField({ onComplete: finish });
  const next = go("متابعة", finish);
  const tick = () => {
    clearInterval(timer);
    const paint = () => { again.disabled = wait > 0; again.textContent = wait > 0 ? `إعادة الإرسال بعد ${wait} ث` : "إعادة إرسال الرمز"; };
    paint();
    timer = setInterval(() => { wait = Math.max(0, wait - 1); paint(); if (!wait) clearInterval(timer); }, 1000);
  };
  again.addEventListener("click", async () => {
    mount(msg); again.disabled = true;
    try { await resend(); wait = 60; tick(); code.clear(); mount(msg, notice("أرسلنا رمزًا جديدًا.", "")); }
    catch (e) { mount(msg, notice(e.message, "err")); again.disabled = false; }
  });
  page(back(() => { clearInterval(timer); backTo(); }), authHead("تحقق من بريدك", h("span", {}, "أرسلنا رمزًا من 6 أرقام إلى:", h("b", { class: "au-mail", dir: "ltr" }, email), "تحقق من صندوق الوارد أو الرسائل غير المرغوبة."), school()),
    code.el, h("div", { class: "au-sent" }, again), msg, next);
  tick(); code.focus();
}

// Signing in to an existing account (email + password, or Google / Apple), then `then()`.
function loginForm({ email: pre = "", then, backTo }) {
  const email = emailInput("li-email", pre);
  const pass = passwordInput({ id: "li-pass", autocomplete: "current-password", placeholder: "كلمة المرور" });
  const msg = msgBox();
  const providers = providersFor(accountPage ? "login" : "setup");
  const submit = go("تسجيل الدخول", async () => {
    mount(msg);
    if (!email.value.trim() || !pass.value) return mount(msg, notice("أدخل البريد الإلكتروني وكلمة المرور.", "err"));
    submit.disabled = true;
    try { await api("/api/account/login", { email: email.value.trim(), password: pass.value }); await then(); }
    catch (e) { submit.disabled = false; mount(msg, notice(e.message, "err")); pass.inputEl.select(); }
  });
  for (const el of [email, pass.inputEl]) el.addEventListener("keydown", (e) => e.key === "Enter" && submit.click());
  page(backTo ? back(backTo) : null, authHead("تسجيل الدخول إلى حسابك", accountPage ? "ادخل لتصل إلى مدارسك." : "ادخل بحسابك في مدار لربطه بالمدرسة.", school()),
    oauth && OAUTH_MESSAGES[oauth] && accountPage ? notice(OAUTH_MESSAGES[oauth], oauth === "linked" ? "" : "err") : null,
    providers, providers ? orDivider("أو بالبريد الإلكتروني") : null,
    authField("البريد الإلكتروني", email, { id: "li-email" }),
    authField("كلمة المرور", pass, { id: "li-pass", aside: h("button", { type: "button", class: "au-link", onclick: () => resetFlow(email.value.trim(), then, () => loginForm({ email: email.value.trim(), then, backTo })) }, "نسيت كلمة المرور؟") }),
    msg, submit);
  (pre ? pass : email).focus();
}

// Forgotten password: code to the verified email, then a new password (signs in), then `then()`.
function resetFlow(pre, then, backTo) {
  const email = emailInput("rs-email", pre);
  const msg = msgBox();
  const send = go("إرسال رمز التحقق", async () => {
    mount(msg);
    if (!email.value.trim()) { email.focus(); return mount(msg, notice("أدخل بريدك الإلكتروني.", "err")); }
    send.disabled = true;
    const mail = email.value.trim();
    try {
      await api("/api/account/reset", { email: mail });
      codeStep(mail, () => api("/api/account/reset", { email: mail }), async (code) => {
        const { ticket } = await api("/api/account/reset/verify", { email: mail, code });
        newPassword(ticket, then);
      }, () => resetFlow(mail, then, backTo));
    } catch (e) { send.disabled = false; mount(msg, notice(e.message, "err")); }
  });
  email.addEventListener("keydown", (e) => e.key === "Enter" && send.click());
  page(back(backTo), authHead("استعادة كلمة المرور", "أدخل البريد المرتبط بحسابك، وسيصلك رمز تحقق إذا كان مسجّلًا.", school()),
    authField("البريد الإلكتروني", email, { id: "rs-email" }), msg, send);
  email.focus();
}
function newPassword(ticket, then) {
  const pass = passwordInput({ id: "np-pass", autocomplete: "new-password", placeholder: "كلمة المرور الجديدة" });
  const again = passwordInput({ id: "np-again", autocomplete: "new-password", placeholder: "أعد كتابة كلمة المرور" });
  const meter = strengthMeter(pass);
  const msg = msgBox();
  const save = go("حفظ كلمة المرور", async () => {
    mount(msg);
    if (pass.value !== again.value) { again.focus(); return mount(msg, notice("كلمتا المرور غير متطابقتين.", "err")); }
    save.disabled = true;
    try { await api("/api/account/reset/finish", { ticket, password: pass.value }); await then(); }
    catch (e) { save.disabled = false; mount(msg, notice(e.message, "err")); }
  });
  for (const el of [pass.inputEl, again.inputEl]) el.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  page(authHead("كلمة مرور جديدة", "ستُنهى الجلسات المفتوحة على الأجهزة الأخرى.", school()),
    authField("كلمة المرور الجديدة", h("div", {}, pass, meter.el), { id: "np-pass", hint: h("span", {}, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا. ", meter.label) }),
    authField("تأكيد كلمة المرور", again, { id: "np-again" }), msg, save);
  pass.focus();
}

// The signed-in account is linked to the school of this link, and the school opens.
async function link(via) {
  if (accountPage) return accountHome();
  const r = await api("/api/account/setup/link", { token, via });
  store(() => sessionStorage.removeItem(KEY));
  const enter = go("الدخول إلى المدرسة", () => { location.href = r.redirect; });
  page(h("div", { class: "au-done" }, h("span", { class: "big" }, icons.check({ size: 36 })),
    authHead("تم تفعيل حسابك بنجاح", "أصبح حسابك جاهزًا لإدارة مدرستك عبر منصة مدار.")), enter);
  setTimeout(() => { location.href = r.redirect; }, 2200);
}

// /account: the schools this account manages, or sign-in first.
async function accountHome() {
  let me;
  try { me = await api("/api/account/me"); } catch { return loginForm({ then: accountHome }); }
  const msg = msgBox();
  const list = me.schools.length ? h("div", { class: "au-schools" }, me.schools.map((s) => h("button", {
    type: "button", class: "au-school-row", onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { const r = await api("/api/account/enter", { school: s.id }); location.href = r.redirect; }
      catch (err) { e.currentTarget.disabled = false; mount(msg, notice(err.message, "err")); }
    },
  }, h("span", { class: "au-school-ic" }, icons.building({ size: 18 })), h("span", { class: "au-school-t" }, h("b", {}, s.name), h("small", { dir: "ltr" }, s.id)), icons.chevronLeft({ size: 16 }))))
    : notice("حسابك غير مرتبط بأي مدرسة بعد. افتح رابط الإعداد الذي وصلك من إدارة مدار.", "warn");
  page(authHead("مدارسي", "اختر المدرسة التي تريد إدارتها."), meCard(me.name, me.email), list, msg,
    ghost("تسجيل الخروج", async () => { await api("/api/account/logout", {}).catch(() => {}); accountHome(); }));
}

function fail(text, used = false) {
  page(authHead(used ? "اكتمل الإعداد من قبل" : "تعذر فتح الرابط", null), notice(text, used ? "" : "err"),
    used ? go("الذهاب إلى مدارسي", () => { location.href = "/account"; }) : h("p", { class: "au-hint" }, "تواصل مع إدارة مدار لطلب رابط جديد."));
}

start();
