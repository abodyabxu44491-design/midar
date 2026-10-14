/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { $, h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { btn, notice, passwordInput } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { strengthMeter, authShell, authHead, authField, phoneField, codeField } from "../shared/js/auth.js";

const app = $("#app");
const token = new URLSearchParams(location.search).get("token") || "";

let info;
const BRAND = {
  title: "أهلًا بك في مدار",
  text: "فعّل حساب المدرسة في دقيقة، وابدأ إدارة الطلاب والحضور والدرجات والرسوم من مكان واحد.",
  points: [[icons.shield, "حسابك محمي برقم جوالك"], [icons.users, "كل منسوبي المدرسة في منصة واحدة"], [icons.chart, "تقارير جاهزة لحظة بلحظة"]],
};
const page = (...content) => mount(app, authShell({ ...BRAND, school: info?.school ? { name: info.school } : null, kicker: "تفعيل حساب المدرسة" }, ...content));
const go = (label, onClick) => {
  const b = btn(label, onClick, "au-go");
  b.append(icons.chevronLeft({ size: 18 }));
  return b;
};


async function start() {
  if (!/^[0-9a-f]{64}$/.test(token)) return fail("رابط التفعيل غير مكتمل. افتح الرابط كما وصلك.");
  try { info = await api(`/api/public/activation/check?token=${token}`); } catch (e) { return fail(e.message); }
  if (info.phone_verified) return passwordStep();
  return info.code_sent ? codeStep(info.phone, info.resend_in || 0) : introStep();
}

function introStep() {
  const step = (icon, title, text) => h("li", {}, h("span", { class: "n" }, icon({ size: 17 })), h("div", {}, h("b", {}, title), h("small", {}, text)));
  const next = go("التالي", () => phoneStep());
  page(authHead("تفعيل حساب المدرسة", "ثلاث خطوات لتفعيل الحساب.", { name: info.school }),
    h("ol", { class: "au-steps" },
      step(icons.phone, "أدخل رقم الجوال", "سجّل رقم جوالك لتفعيل الحساب."),
      step(icons.message, "أدخل رمز التحقق", "سيصلك رمز التحقق برسالة نصية."),
      step(icons.lock, "أنشئ كلمة المرور", "لتسجيل الدخول برقم الجوال وكلمة المرور.")),
    next);
  next.focus();
}

function phoneStep() {
  const phone = phoneField({ id: "act-phone" });
  const msg = h("div", { "aria-live": "polite" });
  const send = go("تفعيل", async () => {
    mount(msg); phone.invalid(false);
    if (phone.empty) { phone.invalid(true); phone.focus(); return mount(msg, notice("أدخل رقم الجوال.", "err")); }
    if (!phone.valid) { phone.invalid(true); phone.focus(); return mount(msg, notice("رقم الجوال غير صحيح. تأكد من الدولة والرقم.", "err")); }
    send.disabled = true;
    try {
      const r = await api("/api/public/activation/send-code", { token, phone: phone.value });
      if (r.verified) return passwordStep();
      codeStep(r.phone, 60);
    } catch (e) { mount(msg, notice(e.message, "err")); send.disabled = false; }
  });
  phone.input.addEventListener("keydown", (e) => e.key === "Enter" && send.click());
  page(authHead("أدخل رقم الجوال", "سيصلك رمز التحقق برسالة نصية.", { name: info.school }),
    authField("رقم الجوال", phone.el, { id: "act-phone" }), msg, send);
  phone.focus();
}

function codeStep(sentTo, wait) {
  const msg = h("div", { "aria-live": "polite" });
  let timer, otpAbort = null, busy = false;
  const resend = h("button", { type: "button", class: "au-link" });
  const verify = async () => {
    if (busy) return;
    mount(msg);
    if (!/^\d{6}$/.test(code.value)) { code.invalid(); return mount(msg, notice("أدخل رمز التحقق المكوّن من 6 أرقام.", "err")); }
    busy = true; next.disabled = true;
    try {
      await api("/api/public/activation/verify", { token, code: code.value });
      clearInterval(timer); otpAbort?.abort();
      passwordStep();
    } catch (e) { mount(msg, notice(e.message, "err")); code.invalid(); code.clear(); }
    finally { busy = false; next.disabled = false; }
  };
  const code = codeField({ onComplete: verify });
  const next = go("متابعة", verify);
  // Android browsers read the SMS and fill the code (Web OTP); iOS offers it above the keyboard.
  const autoFill = () => {
    if (!("OTPCredential" in window)) return;
    otpAbort?.abort(); otpAbort = new AbortController();
    navigator.credentials.get({ otp: { transport: ["sms"] }, signal: otpAbort.signal })
      .then((c) => { if (c?.code) { code.value = c.code; verify(); } }).catch(() => {});
  };
  const tick = () => {
    clearInterval(timer);
    const paint = () => { resend.disabled = wait > 0; resend.textContent = wait > 0 ? `إعادة الإرسال بعد ${wait} ث` : "إعادة إرسال الرمز"; };
    paint();
    timer = setInterval(() => { wait = Math.max(0, wait - 1); paint(); if (!wait) clearInterval(timer); }, 1000);
  };
  resend.addEventListener("click", async () => {
    mount(msg); resend.disabled = true;
    try { await api("/api/public/activation/send-code", { token }); wait = 60; tick(); code.clear(); autoFill(); mount(msg, notice("أرسلنا رمزًا جديدًا.", "")); }
    catch (e) { mount(msg, notice(e.message, "err")); resend.disabled = false; }
  });
  page(authHead("أدخل رمز التحقق", h("span", {}, "أرسلنا رمزًا من 6 أرقام إلى ", h("bdi", { dir: "ltr" }, sentTo || "")), { name: info.school }),
    code.el,
    h("div", { class: "au-sent" }, resend, h("button", { type: "button", class: "au-link", onclick: () => { clearInterval(timer); otpAbort?.abort(); phoneStep(); } }, "تغيير الرقم")),
    msg, next);
  tick(); autoFill(); code.focus();
}

function passwordStep() {
  const pass = passwordInput({ id: "act-pass", autocomplete: "new-password", placeholder: "كلمة المرور" });
  const again = passwordInput({ id: "act-again", autocomplete: "new-password", placeholder: "أعد كتابة كلمة المرور" });
  const meter = strengthMeter(pass);
  const msg = h("div", { "aria-live": "polite" });
  const save = go("تفعيل", async () => {
    mount(msg);
    if (!pass.value) { pass.focus(); return mount(msg, notice("أدخل كلمة المرور.", "err")); }
    if (pass.value !== again.value) { again.focus(); return mount(msg, notice("كلمتا المرور غير متطابقتين.", "err")); }
    save.disabled = true;
    try {
      const r = await api("/api/public/activation", { token, password: pass.value });
      try { localStorage.setItem("midar_school", info.school_id); } catch { /* storage unavailable */ }
      const enter = go("الدخول إلى لوحة المدرسة", () => { location.href = r.redirect; });
      page(h("div", { class: "au-done" }, h("span", { class: "big" }, icons.check({ size: 36 })),
        authHead("تم تفعيل المدرسة", "سجّل الدخول برقم الجوال وكلمة المرور.")), enter);
      setTimeout(() => { location.href = r.redirect; }, 2400);
    } catch (e) { save.disabled = false; mount(msg, notice(e.message, "err")); }
  });
  for (const el of [pass, again]) el.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  page(authHead("أنشئ كلمة المرور", "لتسجيل الدخول برقم الجوال وكلمة المرور.", { name: info.school }),
    authField("كلمة المرور", h("div", {}, pass, meter.el), { id: "act-pass", hint: h("span", {}, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا. ", meter.label) }),
    authField("تأكيد كلمة المرور", again, { id: "act-again" }),
    msg, save);
  pass.focus();
}

function fail(text) {
  page(authHead("تعذر فتح رابط التفعيل", null), notice(text, "err"),
    h("p", { class: "au-hint" }, "تواصل مع إدارة مدار لطلب رابط جديد."));
}
start();
