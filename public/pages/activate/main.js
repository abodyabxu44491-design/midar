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
const STEPS = ["الجوال", "كلمة المرور", "الدخول"];

const shell = (...content) => h("div", { class: "gate" }, h("div", { class: "gate-wrap" },
  h("aside", { class: "gate-aside hide-sm" },
    brandLogo("hero-logo", true, "stacked"),
    h("h1", {}, "تفعيل حساب مدرستكم"),
    h("p", {}, "أدخلوا رقم جوال المدير، واكتبوا الرمز الذي يصلكم، ثم اختاروا كلمة المرور."),
    h("ul", { class: "gate-points" }, ["تحقق برسالة نصية", "الدخول برقم الجوال وكلمة المرور"]
      .map((x) => h("li", {}, icons.check({ size: 16 }), x)))),
  h("section", { class: "gate-card" },
    h("div", { class: "show-sm", style: "margin-bottom:10px" }, brandLogo("hero-logo", true, "stacked")),
    ...content)));

const stepper = (at) => h("ol", { class: "av-steps", "aria-label": "خطوات التفعيل" }, STEPS.map((s, i) =>
  h("li", { class: i < at ? "done" : i === at ? "on" : "", "aria-current": i === at ? "step" : null },
    h("span", {}, i < at ? icons.check({ size: 13 }) : String(i + 1)), h("b", {}, s))));

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
  return info.phone_verified ? passwordStep() : phoneStep();
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
  const sendBtn = btn("إرسال الرمز", () => send());
  const verifyBtn = btn("تحقق ومتابعة", () => verify());
  const resend = h("button", { type: "button", class: "gate-link", onclick: () => send() });
  const change = h("button", { type: "button", class: "gate-link", onclick: () => stage("phone") }, "تغيير الرقم");
  const links = h("div", { class: "gate-row av-links" }, resend, change);
  const stage = (k) => {
    const onCode = k === "code";
    phoneBox.hidden = onCode; sendBtn.hidden = onCode;
    codeBox.hidden = !onCode; verifyBtn.hidden = !onCode; links.hidden = !onCode; sentTo.hidden = !onCode;
    mount(msg);
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
      wait = 60; stage("code"); tick();
    } catch (e) { mount(msg, notice(e.message, "err")); }
    finally { sendBtn.disabled = false; }
  }
  async function verify() {
    mount(msg);
    if (!/^\d{6}$/.test(code.value.trim())) return mount(msg, notice("اكتبوا الرمز المكوّن من 6 أرقام.", "err"));
    verifyBtn.disabled = true;
    try { await api("/api/public/activation/verify", { token, code: code.value.trim() }); clearInterval(timer); passwordStep(); }
    catch (e) { mount(msg, notice(e.message, "err")); code.select(); }
    finally { verifyBtn.disabled = false; }
  }
  code.addEventListener("input", () => {
    code.value = digits(code.value).replace(/\D/g, "").slice(0, 6);
    if (code.value.length === 6) verify();
  });
  phone.addEventListener("keydown", (e) => e.key === "Enter" && send());
  mount(app, shell(stepper(0),
    h("h2", {}, "تحقق من الجوال"),
    identity({ ...info, phone: null }), phoneBox, sentTo, codeBox, msg, sendBtn, verifyBtn, links));
  if (info.code_sent) { sentTo.textContent = `أرسلنا رمزًا إلى ${info.phone}`; stage("code"); if (wait) tick(); else resend.textContent = "إعادة إرسال الرمز"; }
  else stage("phone");
}

function passwordStep() {
  const pass = passwordInput({ autocomplete: "new-password", placeholder: "كلمة المرور الجديدة" });
  const again = passwordInput({ autocomplete: "new-password", placeholder: "أعيدوا كتابتها" });
  const meter = h("div", { class: "sub" });
  const msg = h("div", { "aria-live": "polite" });
  pass.inputEl.addEventListener("input", () => { meter.textContent = pass.value ? `قوة كلمة المرور: ${strength(pass.value)}` : ""; });
  const save = btn("تفعيل الحساب والدخول", async () => {
    mount(msg);
    if (pass.value !== again.value) return mount(msg, notice("كلمتا المرور غير متطابقتين", "err"));
    save.disabled = true;
    try {
      const r = await api("/api/public/activation", { token, password: pass.value });
      try { localStorage.setItem("midar_school", info.school_id); } catch { /* storage unavailable */ }
      mount(app, shell(stepper(2),
        h("div", { class: "act-done" }, h("span", { class: "big" }, icons.check({ size: 34 })),
          h("h2", {}, "تم تفعيل حساب مدرستكم"),
          h("p", { class: "gate-sub" }, "سجّلوا الدخول لاحقًا برقم الجوال وكلمة المرور.")),
        btn("الدخول إلى لوحة المدرسة", () => { location.href = r.redirect; })));
      setTimeout(() => { location.href = r.redirect; }, 2200);
    } catch (e) { save.disabled = false; mount(msg, notice(e.message, "err")); }
  });
  for (const el of [pass, again]) el.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  mount(app, shell(stepper(1),
    h("h2", {}, "اختاروا كلمة المرور"),
    identity(info),
    field("كلمة المرور الجديدة", pass, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
    meter, field("أعيدوا كتابة كلمة المرور", again), msg, save));
  pass.inputEl.focus();
}

function fail(text) {
  mount(app, shell(h("h2", {}, "تعذر فتح رابط التفعيل"), notice(text, "err"),
    sub("اطلبوا رابطًا جديدًا من إدارة مدار.")));
}
start();
