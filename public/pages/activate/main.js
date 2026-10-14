/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { $, h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { brandLogo, field, btn, notice, sub, passwordInput, keyText } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";

const app = $("#app");
const token = new URLSearchParams(location.search).get("token") || "";

const shell = (...content) => h("div", { class: "gate" }, h("div", { class: "gate-wrap" },
  h("aside", { class: "gate-aside hide-sm" },
    brandLogo("hero-logo", true, "stacked"),
    h("h1", {}, "مرحبًا بكم في مدار"),
    h("p", {}, "أنشئوا كلمة المرور الخاصة بمدير المدرسة، ثم سجّلوا الدخول وابدأوا إعداد مدرستكم."),
    h("ul", { class: "gate-points" }, ["كلمة مرور تختارونها بأنفسكم", "الرابط يُستخدم مرة واحدة", "تبدأون مباشرة بعد الحفظ"]
      .map((x) => h("li", {}, icons.check({ size: 16 }), x)))),
  h("section", { class: "gate-card" },
    h("div", { class: "show-sm", style: "margin-bottom:10px" }, brandLogo("hero-logo", true, "stacked")),
    ...content)));

const strength = (v) => ["ضعيفة", "مقبولة", "جيدة", "قوية", "قوية جدًا"][
  [v.length >= 10, v.length >= 14, /[A-Za-z]/.test(v) && /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length];

async function start() {
  if (!/^[0-9a-f]{64}$/.test(token)) return fail("الرابط غير مكتمل. افتح رابط التفعيل كما وصلكم بالكامل.");
  let info;
  try { info = await api(`/api/public/activation/check?token=${token}`); } catch (e) { return fail(e.message); }
  const pass = passwordInput({ autocomplete: "new-password", placeholder: "كلمة المرور الجديدة" });
  const again = passwordInput({ autocomplete: "new-password", placeholder: "أعد كتابتها" });
  const meter = h("div", { class: "sub" });
  const msg = h("div");
  pass.inputEl.addEventListener("input", () => { meter.textContent = pass.value ? `قوة كلمة المرور: ${strength(pass.value)}` : ""; });
  const save = btn("حفظ كلمة المرور والمتابعة", async () => {
    mount(msg);
    if (pass.value !== again.value) return mount(msg, notice("كلمتا المرور غير متطابقتين", "err"));
    try {
      const r = await api("/api/public/activation", { token, password: pass.value });
      try { localStorage.setItem("midar_school", info.school_id); } catch { /* ignore */ }
      mount(app, shell(
        h("div", { class: "act-done" }, h("span", { class: "big" }, icons.check({ size: 34 })),
          h("h2", {}, "تم تفعيل حساب مدرستكم"),
          h("p", { class: "gate-sub" }, "سجّلوا الدخول الآن بكلمة المرور التي اخترتموها."),
          h("div", { class: "act-cred" }, h("span", {}, "رمز المدرسة"), keyText(info.school_id), h("span", {}, "اسم المستخدم"), keyText(info.username))),
        btn("الذهاب لتسجيل الدخول", () => { location.href = r.login; }, "wide")));
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "wide");
  for (const el of [pass, again]) el.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  mount(app, shell(
    h("h2", {}, "تفعيل حساب المدرسة"),
    h("p", { class: "gate-sub" }, info.school),
    h("div", { class: "act-cred" }, h("span", {}, "رمز المدرسة"), keyText(info.school_id), h("span", {}, "اسم المستخدم"), keyText(info.username)),
    field("كلمة المرور الجديدة", pass, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
    meter, field("أعد كتابة كلمة المرور", again), msg, save,
    sub(`الرابط صالح حتى ${new Date(info.expires_at).toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric" })}، ويُستخدم مرة واحدة.`)));
}

function fail(text) {
  mount(app, shell(h("h2", {}, "تعذر فتح رابط التفعيل"), notice(text, "err"),
    sub("تواصلوا مع إدارة مدار لإصدار رابط جديد.")));
}
start();
