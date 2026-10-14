/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { $, h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { btn, notice, passwordInput } from "../shared/js/ui.js";
import { authShell, authHead, authField } from "../shared/js/auth.js";
import { icons } from "../shared/js/icons.js";

const app = $("#app");
const token = new URLSearchParams(location.search).get("token") || "";

const BRAND = {
  title: "تغيير كلمة المرور",
  text: "رابط آمن يُستخدم مرة واحدة، وينتهي بعد ساعتين من إصداره.",
  points: [[icons.shield, "تُنهى الجلسات السابقة بعد التغيير"], [icons.lock, "كلمة المرور محفوظة بتشفير قوي"]],
};
const page = (...content) => mount(app, authShell(BRAND, ...content));
const go = (label, onClick) => { const b = btn(label, onClick, "au-go"); b.append(icons.chevronLeft({ size: 18 })); return b; };
const strengthLevel = (v) => (v ? Math.max(1, [v.length >= 10, v.length >= 14, /[A-Za-z]/.test(v) && /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length) : 0);
const LEVELS = ["", "ضعيفة", "مقبولة", "جيدة", "قوية"];

async function start() {
  if (!token) return fail("الرابط غير مكتمل. افتح الرابط كما وصلك بالكامل.");
  let ref;
  try {
    ({ ref } = await api(`/api/public/password-reset/check?token=${encodeURIComponent(token)}`));
  } catch (e) { return fail(e.status === 400 ? "رابط تغيير كلمة المرور غير صالح. افتح الرابط كما وصلك بالكامل." : e.message); }

  const pass = passwordInput({ id: "rs-pass", autocomplete: "new-password", placeholder: "كلمة المرور الجديدة" });
  const again = passwordInput({ id: "rs-again", autocomplete: "new-password", placeholder: "أعد كتابة كلمة المرور" });
  const meter = h("div", { class: "au-meter", "data-l": "0", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"));
  const level = h("span");
  const msg = h("div", { "aria-live": "polite" });
  pass.inputEl.addEventListener("input", () => {
    const l = strengthLevel(pass.value);
    meter.dataset.l = String(l);
    level.textContent = l ? `قوة كلمة المرور: ${LEVELS[l]}` : "";
  });

  const save = go("حفظ كلمة المرور", async () => {
    mount(msg);
    if (!pass.value) { pass.focus(); return mount(msg, notice("أدخل كلمة المرور الجديدة.", "err")); }
    if (pass.value !== again.value) { again.focus(); return mount(msg, notice("كلمتا المرور غير متطابقتين.", "err")); }
    save.disabled = true;
    try {
      await api("/api/public/password-reset", { token, password: pass.value });
      page(h("div", { class: "au-done" }, h("span", { class: "big" }, icons.check({ size: 36 })),
        authHead("تم تغيير كلمة المرور", "يمكنك الآن الدخول بكلمة المرور الجديدة. أُنهيت جميع الجلسات السابقة لحسابك.")),
      go("الذهاب لصفحة الدخول", () => { location.href = "/"; }));
    } catch (e) { save.disabled = false; mount(msg, notice(e.message, "err")); }
  });
  for (const el of [pass, again]) el.addEventListener("keydown", (e) => e.key === "Enter" && save.click());

  page(authHead("اختر كلمة مرور جديدة", `طلب رقم ${ref}`),
    authField("كلمة المرور الجديدة", h("div", {}, pass, meter), { id: "rs-pass", hint: h("span", {}, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا. ", level) }),
    authField("تأكيد كلمة المرور", again, { id: "rs-again" }),
    msg, save);
  pass.focus();
}

const fail = (message) => page(authHead("الرابط غير صالح", null), notice(message, "err"),
  h("p", { class: "au-hint" }, "اطلب رابطًا جديدًا من إدارة مدرستك."));

start();
