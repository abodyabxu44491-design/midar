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
const STEPS = ["التحقق من الجوال", "كلمة المرور", "الدخول"];

const shell = (...content) => h("div", { class: "gate" }, h("div", { class: "gate-wrap" },
  h("aside", { class: "gate-aside hide-sm" },
    brandLogo("hero-logo", true, "stacked"),
    h("h1", {}, "تفعيل حساب مدرستكم"),
    h("p", {}, "خطوتان فقط: نتحقق من جوال المدير المعتمد لدى مدار، ثم تختارون كلمة المرور وتدخلون لوحة المدرسة."),
    h("ul", { class: "gate-points" }, ["لا اسم مستخدم ولا كلمة مرور مؤقتة", "الدخول لاحقًا برقم الجوال وكلمة المرور", "الرابط شخصي ويُستخدم مرة واحدة"]
      .map((x) => h("li", {}, icons.check({ size: 16 }), x)))),
  h("section", { class: "gate-card" },
    h("div", { class: "show-sm", style: "margin-bottom:10px" }, brandLogo("hero-logo", true, "stacked")),
    ...content)));

const stepper = (at) => h("ol", { class: "av-steps", "aria-label": "خطوات التفعيل" }, STEPS.map((s, i) =>
  h("li", { class: i < at ? "done" : i === at ? "on" : "", "aria-current": i === at ? "step" : null },
    h("span", {}, i < at ? icons.check({ size: 13 }) : String(i + 1)), h("b", {}, s))));

const identity = (info) => h("dl", { class: "av-id" },
  h("dt", {}, "المدرسة"), h("dd", {}, info.school),
  h("dt", {}, "المدير"), h("dd", {}, info.manager_name || "—"),
  h("dt", {}, "الجوال المعتمد"), h("dd", { dir: "ltr", class: "av-phone" }, info.phone));

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
  const code = h("input", { class: "av-otp", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, dir: "ltr",
    placeholder: "••••••", "aria-label": "رمز التحقق المكوّن من 6 أرقام" });
  const codeBox = h("div", { class: "av-code" }, field("رمز التحقق", code, "6 أرقام وصلتكم برسالة نصية"));
  codeBox.hidden = !info.code_sent;
  let wait = info.resend_in || 0, timer;
  const sendBtn = btn(info.code_sent ? "إعادة إرسال الرمز" : "إرسال رمز التحقق", () => send(), info.code_sent ? "ghost" : "");
  const verifyBtn = btn("تحقق ومتابعة", () => verify());
  verifyBtn.hidden = !info.code_sent;
  const tick = () => {
    clearInterval(timer);
    const paint = () => {
      sendBtn.disabled = wait > 0;
      sendBtn.textContent = wait > 0 ? `إعادة الإرسال بعد ${wait} ث` : (codeBox.hidden ? "إرسال رمز التحقق" : "إعادة إرسال الرمز");
    };
    paint();
    timer = setInterval(() => { wait = Math.max(0, wait - 1); paint(); if (!wait) clearInterval(timer); }, 1000);
  };
  const showCode = () => { codeBox.hidden = false; verifyBtn.hidden = false; sendBtn.classList.add("ghost"); code.focus(); };
  async function send() {
    mount(msg);
    sendBtn.disabled = true;
    try {
      const r = await api("/api/public/activation/send-code", { token });
      if (r.verified) return passwordStep();
      mount(msg, notice(`أرسلنا الرمز إلى ${r.phone}. صالح ${r.expires_minutes} دقائق.`, "ok"));
      wait = 60; showCode();
    } catch (e) {
      mount(msg, notice(e.message, "err"));
      if (e.status === 503) {
        // SMS is down: the platform can read the manager a one-time code after a verified call.
        mount(msg, notice(e.message, "err"), sub("إذا زوّدتكم إدارة مدار برمز تحقق، اكتبوه هنا."));
        showCode();
      }
    }
    tick();
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
    code.value = code.value.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/\D/g, "").slice(0, 6);
    if (code.value.length === 6) verify();
  });
  mount(app, shell(stepper(0),
    h("h2", {}, "تحقق من جوال المدير"),
    h("p", { class: "gate-sub" }, "نرسل رمزًا إلى الجوال المعتمد لدى مدار لهذه المدرسة فقط."),
    identity(info), codeBox, msg, verifyBtn, sendBtn,
    sub("الرقم غير صحيح أو لا يصلكم الرمز؟ تواصلوا مع إدارة مدار لتحديثه.")));
  if (wait) tick();
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
          h("p", { class: "gate-sub" }, "ندخلكم الآن إلى لوحة المدرسة. في المرات القادمة سجّلوا الدخول برقم الجوال وكلمة المرور.")),
        btn("الدخول إلى لوحة المدرسة", () => { location.href = r.redirect; })));
      setTimeout(() => { location.href = r.redirect; }, 2200);
    } catch (e) { save.disabled = false; mount(msg, notice(e.message, "err")); }
  });
  for (const el of [pass, again]) el.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  mount(app, shell(stepper(1),
    h("h2", {}, "اختاروا كلمة المرور"),
    h("p", { class: "gate-sub" }, `تم التحقق من الجوال ${info.phone}`),
    identity(info),
    field("كلمة المرور الجديدة", pass, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
    meter, field("أعيدوا كتابة كلمة المرور", again), msg, save));
  pass.inputEl.focus();
}

function fail(text) {
  mount(app, shell(h("h2", {}, "تعذر فتح رابط التفعيل"), notice(text, "err"),
    sub("تواصلوا مع إدارة مدار لإصدار رابط جديد.")));
}
start();
