/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { $, h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { brandLogo, field, btn, notice, sub, passwordInput } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";

const app = $("#app");
const token = new URLSearchParams(location.search).get("token") || "";

const shell = (...content) => h("div", { class: "gate" }, h("div", { class: "gate-wrap" },
  h("aside", { class: "gate-aside hide-sm" },
    brandLogo("hero-logo", true, "stacked"),
    h("h1", {}, "تفعيل حساب مدرستكم"),
    h("p", {}, "رقم جوال المدير، ثم رمز التحقق، ثم كلمة المرور.")),
  h("section", { class: "gate-card" },
    h("div", { class: "show-sm", style: "margin-bottom:10px" }, brandLogo("hero-logo", true, "stacked")),
    ...content)));

const identity = (info) => h("dl", { class: "av-id" },
  h("dt", {}, "المدرسة"), h("dd", {}, info.school),
  info.manager_name ? [h("dt", {}, "المدير"), h("dd", {}, info.manager_name)] : null,
  info.phone ? [h("dt", {}, "الجوال"), h("dd", { dir: "ltr", class: "av-phone" }, info.phone)] : null);

const strength = (v) => ["ضعيفة", "مقبولة", "جيدة", "قوية", "قوية جدًا"][
  [v.length >= 10, v.length >= 14, /[A-Za-z]/.test(v) && /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length];

let info;
async function start() {
  if (!/^[0-9a-f]{64}$/.test(token)) return fail("الرابط غير مكتمل. افتحوا رابط التفعيل كما وصلكم بالكامل.");
  try { info = await api(`/api/public/activation/check?token=${token}`); } catch (e) { return fail(e.message); }
  if (info.phone_verified) return passwordStep();
  return info.code_sent ? phoneStep() : introStep();
}

function introStep() {
  const row = (icon, title, text) => h("li", {}, h("span", { class: "av-ic" }, icon({ size: 18 })), h("div", {}, h("b", {}, title), h("small", {}, text)));
  const next = btn("التالي", () => phoneStep());
  mount(app, shell(h("h2", {}, "تفعيل حساب المدرسة"),
    h("p", { class: "gate-sub" }, "ثلاث خطوات سريعة، وتدخل لوحة مدرستك مباشرة."),
    identity({ ...info, phone: null }),
    h("ol", { class: "av-intro" },
      row(icons.phone, "رقم جوالك", "تكتب رقم جوال المدير وتضغط تفعيل."),
      row(icons.message, "رمز التحقق", "يصلك الرمز برسالة نصية ويُكتب تلقائيًا."),
      row(icons.lock, "كلمة المرور", "تختار كلمة مرور، وبها تدخل مع رقم جوالك.")),
    next));
  next.focus();
}

function phoneStep() {
  const msg = h("div", { "aria-live": "polite" });
  const phone = h("input", { type: "tel", inputmode: "tel", autocomplete: "tel", dir: "ltr", placeholder: "05xxxxxxxx", "aria-label": "رقم الجوال" });
  const code = h("input", { class: "av-otp", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, dir: "ltr",
    placeholder: "••••••", "aria-label": "رمز التحقق" });
  const phoneBox = h("div", {}, field("رقم جوال المدير", phone));
  const codeBox = h("div", {}, field("رمز التحقق", code));
  const sentTo = h("p", { class: "gate-sub av-sent" });
  let wait = info.resend_in || 0, timer;
  const sendBtn = btn("تفعيل", () => send());
  const verifyBtn = btn("متابعة", () => verify());
  const resend = h("button", { type: "button", class: "gate-link", onclick: () => send() });
  const change = h("button", { type: "button", class: "gate-link", onclick: () => stage("phone") }, "تغيير الرقم");
  const links = h("div", { class: "gate-row av-links" }, resend, change);
  // Android browsers read the SMS and fill the code by themselves (Web OTP); iOS offers it above the keyboard.
  let otpAbort = null;
  const autoFill = () => {
    if (!("OTPCredential" in window)) return;
    otpAbort?.abort(); otpAbort = new AbortController();
    navigator.credentials.get({ otp: { transport: ["sms"] }, signal: otpAbort.signal })
      .then((c) => { if (c?.code) { code.value = c.code; verify(); } }).catch(() => {});
  };
  const stage = (k) => {
    const onCode = k === "code";
    phoneBox.hidden = onCode; sendBtn.hidden = onCode;
    codeBox.hidden = !onCode; verifyBtn.hidden = !onCode; links.hidden = !onCode; sentTo.hidden = !onCode;
    stageText(onCode); mount(msg);
    (onCode ? code : phone).focus();
  };
  const tick = () => {
    clearInterval(timer);
    const paint = () => { resend.disabled = wait > 0; resend.textContent = wait > 0 ? `إعادة الإرسال بعد ${wait} ث` : "إعادة إرسال الرمز"; };
    paint();
    timer = setInterval(() => { wait = Math.max(0, wait - 1); paint(); if (!wait) clearInterval(timer); }, 1000);
  };
  const digits = (v) => v.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  async function send() {
    mount(msg);
    if (digits(phone.value).replace(/\D/g, "").length < 7) return mount(msg, notice("اكتبوا رقم الجوال.", "err"));
    sendBtn.disabled = true;
    try {
      const r = await api("/api/public/activation/send-code", { token, phone: digits(phone.value) });
      if (r.verified) return passwordStep();
      info.phone = r.phone;
      sentTo.textContent = `أرسلنا رمزًا إلى ${r.phone}`;
      wait = 60; stage("code"); tick(); autoFill();
    } catch (e) { mount(msg, notice(e.message, "err")); }
    finally { sendBtn.disabled = false; }
  }
  async function verify() {
    mount(msg);
    if (!/^\d{6}$/.test(code.value.trim())) return mount(msg, notice("اكتبوا الرمز المكوّن من 6 أرقام.", "err"));
    verifyBtn.disabled = true;
    try { await api("/api/public/activation/verify", { token, code: code.value.trim() }); clearInterval(timer); otpAbort?.abort(); passwordStep(); }
    catch (e) { mount(msg, notice(e.message, "err")); code.select(); }
    finally { verifyBtn.disabled = false; }
  }
  code.addEventListener("input", () => {
    code.value = digits(code.value).replace(/\D/g, "").slice(0, 6);
    if (code.value.length === 6) verify();
  });
  phone.addEventListener("keydown", (e) => e.key === "Enter" && send());
  const title = h("h2", {});
  const hint = h("p", { class: "gate-sub" });
  const stageText = (onCode) => {
    title.textContent = onCode ? "أدخل رمز التحقق" : "رقم جوال المدير";
    hint.textContent = onCode ? "" : `لتفعيل ${info.school}، يصلك رمز برسالة نصية.`;
    hint.hidden = onCode;
  };
  mount(app, shell(title, hint, phoneBox, sentTo, codeBox, msg, sendBtn, verifyBtn, links));
  if (info.code_sent) { sentTo.textContent = `أرسلنا رمزًا إلى ${info.phone}`; stage("code"); if (wait) tick(); else resend.textContent = "إعادة إرسال الرمز"; }
  else stage("phone");
}

function passwordStep() {
  const pass = passwordInput({ autocomplete: "new-password", placeholder: "كلمة المرور الجديدة" });
  const again = passwordInput({ autocomplete: "new-password", placeholder: "كرّر كلمة المرور" });
  const meter = h("div", { class: "sub" });
  const msg = h("div", { "aria-live": "polite" });
  pass.inputEl.addEventListener("input", () => { meter.textContent = pass.value ? `قوة كلمة المرور: ${strength(pass.value)}` : ""; });
  const save = btn("تفعيل", async () => {
    mount(msg);
    if (pass.value !== again.value) return mount(msg, notice("كلمتا المرور غير متطابقتين", "err"));
    save.disabled = true;
    try {
      const r = await api("/api/public/activation", { token, password: pass.value });
      try { localStorage.setItem("midar_school", info.school_id); } catch { /* storage unavailable */ }
      mount(app, shell(h("div", { class: "act-done" }, h("span", { class: "big" }, icons.check({ size: 34 })),
          h("h2", {}, "تم تفعيل المدرسة"),
          h("p", { class: "gate-sub" }, "تدخل لاحقًا برقم جوالك وكلمة المرور.")),
        btn("الدخول إلى لوحة المدرسة", () => { location.href = r.redirect; })));
      setTimeout(() => { location.href = r.redirect; }, 2200);
    } catch (e) { save.disabled = false; mount(msg, notice(e.message, "err")); }
  });
  for (const el of [pass, again]) el.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  mount(app, shell(h("h2", {}, "إنشاء كلمة المرور"),
    h("p", { class: "gate-sub" }, "بها تدخل لاحقًا مع رقم جوالك."),
    field("كلمة المرور الجديدة", pass, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
    meter, field("تأكيد كلمة المرور", again), msg, save));
  pass.inputEl.focus();
}

function fail(text) {
  mount(app, shell(h("h2", {}, "تعذر فتح رابط التفعيل"), notice(text, "err"),
    sub("اطلبوا رابطًا جديدًا من إدارة مدار.")));
}
start();
