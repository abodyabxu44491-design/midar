/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { $, h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { brandLogo, field, btn, notice, sub, passwordInput } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { ARAB_DIALS, guessDial, withDial, detectPhone } from "../shared/js/phone.js";

const app = $("#app");
const token = new URLSearchParams(location.search).get("token") || "";

const shell = (...content) => h("div", { class: "gate" }, h("div", { class: "gate-wrap" },
  h("aside", { class: "gate-aside hide-sm" },
    brandLogo("hero-logo", true, "stacked"),
    h("h1", {}, "تفعيل حساب المدرسة"),
    h("p", {}, "سجّل رقم جوالك، وأدخل رمز التحقق، ثم أنشئ كلمة المرور.")),
  h("section", { class: "gate-card" },
    h("div", { class: "show-sm", style: "margin-bottom:10px" }, brandLogo("hero-logo", true, "stacked")),
    ...content)));

const strength = (v) => ["ضعيفة", "مقبولة", "جيدة", "قوية", "قوية جدًا"][
  [v.length >= 10, v.length >= 14, /[A-Za-z]/.test(v) && /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length];

let info;
async function start() {
  if (!/^[0-9a-f]{64}$/.test(token)) return fail("رابط التفعيل غير مكتمل. افتح الرابط كما وصلك.");
  try { info = await api(`/api/public/activation/check?token=${token}`); } catch (e) { return fail(e.message); }
  if (info.phone_verified) return passwordStep();
  return info.code_sent ? phoneStep() : introStep();
}

function introStep() {
  const row = (icon, title, text) => h("li", {}, h("span", { class: "av-ic" }, icon({ size: 18 })), h("div", {}, h("b", {}, title), h("small", {}, text)));
  const next = btn("التالي", () => phoneStep());
  mount(app, shell(h("h2", {}, "تفعيل حساب المدرسة"),
    h("p", { class: "gate-sub" }, info.school),
    h("ol", { class: "av-intro" },
      row(icons.phone, "أدخل رقم الجوال", "سجّل رقم جوالك لتفعيل الحساب."),
      row(icons.message, "أدخل رمز التحقق", "سيصلك رمز التحقق برسالة نصية."),
      row(icons.lock, "أنشئ كلمة المرور", "لتسجيل الدخول برقم الجوال وكلمة المرور.")),
    next));
  next.focus();
}

function phoneStep() {
  const msg = h("div", { "aria-live": "polite" });
  const phone = h("input", { type: "tel", inputmode: "tel", autocomplete: "tel-national", dir: "ltr", placeholder: "رقم الجوال", "aria-label": "رقم الجوال" });
  const guess = guessDial();
  const dial = h("select", { class: "av-dial", "aria-label": "رمز الدولة", autocomplete: "tel-country-code" },
    ARAB_DIALS.map((c) => h("option", { value: c.dial, selected: c.dial === guess }, `${c.name} \u200E+${c.dial}`)),
    h("option", { value: "" }, "دولة أخرى (اكتب الرقم مع رمزه)"));
  if (!guess) dial.value = "";
  // A full international number pasted in the box moves the picker to its country.
  phone.addEventListener("input", () => {
    const v = digits(phone.value).trim();
    if (!/^(\+|00)/.test(v)) return;
    const d = v.replace(/\D/g, "").replace(/^00/, "");
    const hit = ARAB_DIALS.find((c) => d.startsWith(c.dial) && detectPhone(`+${d}`)?.ok);
    if (hit) { dial.value = hit.dial; phone.value = d.slice(hit.dial.length); }
  });
  const code = h("input", { class: "av-otp", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, dir: "ltr",
    placeholder: "••••••", "aria-label": "رمز التحقق" });
  const phoneBox = h("div", {}, field("رقم الجوال", h("div", { class: "av-tel", dir: "ltr" }, dial, phone)));
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
    const full = withDial(dial.value, digits(phone.value));
    if (full.replace(/\D/g, "").length < 7) return mount(msg, notice("أدخل رقم الجوال.", "err"));
    if (!detectPhone(full)?.ok) return mount(msg, notice("رقم الجوال غير صحيح. تأكد من الدولة والرقم.", "err"));
    sendBtn.disabled = true;
    try {
      const r = await api("/api/public/activation/send-code", { token, phone: full });
      if (r.verified) return passwordStep();
      info.phone = r.phone;
      sentTo.textContent = `أرسلنا رمزًا إلى ${r.phone}`;
      wait = 60; stage("code"); tick(); autoFill();
    } catch (e) { mount(msg, notice(e.message, "err")); }
    finally { sendBtn.disabled = false; }
  }
  async function verify() {
    mount(msg);
    if (!/^\d{6}$/.test(code.value.trim())) return mount(msg, notice("أدخل رمز التحقق المكوّن من 6 أرقام.", "err"));
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
    title.textContent = onCode ? "أدخل رمز التحقق" : "أدخل رقم الجوال";
    hint.textContent = onCode ? "" : "سيصلك رمز التحقق برسالة نصية.";
    hint.hidden = onCode;
  };
  mount(app, shell(title, hint, phoneBox, sentTo, codeBox, msg, sendBtn, verifyBtn, links));
  if (info.code_sent) { sentTo.textContent = `أرسلنا رمزًا إلى ${info.phone}`; stage("code"); if (wait) tick(); else resend.textContent = "إعادة إرسال الرمز"; }
  else stage("phone");
}

function passwordStep() {
  const pass = passwordInput({ autocomplete: "new-password", placeholder: "كلمة المرور" });
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
          h("p", { class: "gate-sub" }, "سجّل الدخول برقم الجوال وكلمة المرور.")),
        btn("الدخول إلى لوحة المدرسة", () => { location.href = r.redirect; })));
      setTimeout(() => { location.href = r.redirect; }, 2200);
    } catch (e) { save.disabled = false; mount(msg, notice(e.message, "err")); }
  });
  for (const el of [pass, again]) el.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  mount(app, shell(h("h2", {}, "أنشئ كلمة المرور"),
    h("p", { class: "gate-sub" }, "لتسجيل الدخول برقم الجوال وكلمة المرور."),
    field("كلمة المرور", pass, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
    meter, field("تأكيد كلمة المرور", again), msg, save));
  pass.inputEl.focus();
}

function fail(text) {
  mount(app, shell(h("h2", {}, "تعذر فتح رابط التفعيل"), notice(text, "err"),
    sub("تواصل مع إدارة مدار لطلب رابط جديد.")));
}
start();
