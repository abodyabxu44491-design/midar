// صفحة تغيير كلمة المرور برابط معتمد من مالك المنصة (يُستخدم مرة واحدة)
import { $, h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { brandLogo, field, btn, notice, sub, passwordInput } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";

const app = $("#app");
const token = new URLSearchParams(location.search).get("token") || "";

const shell = (...content) => h("div", { class: "gate" }, h("div", { class: "gate-wrap" },
  h("aside", { class: "gate-aside hide-sm" },
    brandLogo("hero-logo", true, "stacked"),
    h("h1", {}, "تغيير كلمة المرور"),
    h("p", {}, "رابط آمن يُستخدم مرة واحدة، وينتهي بعد ساعتين من إصداره.")),
  h("section", { class: "gate-card" },
    h("div", { class: "show-sm", style: "margin-bottom:10px" }, brandLogo("hero-logo", true, "stacked")),
    ...content)));

// مؤشر قوة كلمة المرور
function strengthOf(value) {
  let score = 0;
  if (value.length >= 10) score++;
  if (value.length >= 14) score++;
  if (/[A-Za-z]/.test(value) && /\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  return ["ضعيفة", "مقبولة", "جيدة", "قوية", "قوية جدًا"][score];
}

async function start() {
  if (!token) return fail("الرابط غير مكتمل. افتح الرابط كما وصلك بالكامل.");
  let ref;
  try {
    ({ ref } = await api(`/api/public/password-reset/check?token=${encodeURIComponent(token)}`));
  } catch (e) { return fail(e.message); }

  const pass = passwordInput({ autocomplete: "new-password", placeholder: "كلمة المرور الجديدة" });
  const again = passwordInput({ autocomplete: "new-password", placeholder: "أعد كتابتها" });
  const meter = h("div", { class: "sub" });
  const msg = h("div");

  pass.inputEl.addEventListener("input", () => {
    meter.textContent = pass.value ? `قوة كلمة المرور: ${strengthOf(pass.value)}` : "";
  });

  const save = btn("حفظ كلمة المرور", async () => {
    mount(msg);
    if (pass.value !== again.value) return mount(msg, notice("كلمتا المرور غير متطابقتين", "err"));
    try {
      await api("/api/public/password-reset", { token, password: pass.value });
      mount(app, shell(
        h("h2", {}, "تم تغيير كلمة المرور"),
        notice("يمكنك الآن الدخول بكلمة المرور الجديدة. أُنهيت جميع الجلسات السابقة لحسابك.", ""),
        btn("الذهاب لصفحة الدخول", () => { location.href = "/"; })));
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "wide");
  for (const el of [pass, again]) el.addEventListener("keydown", (e) => e.key === "Enter" && save.click());

  mount(app, shell(
    h("h2", {}, "اختر كلمة مرور جديدة"),
    h("p", { class: "gate-sub" }, `طلب رقم ${ref}`),
    field("كلمة المرور الجديدة", pass, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
    field("تأكيد كلمة المرور", again),
    meter, msg, save,
    h("div", { class: "gate-foot" }, h("span", { class: "gate-badge" }, icons.lock({ size: 14 }), "هذا الرابط يُستخدم مرة واحدة"))));
  pass.focus();
}

const fail = (message) => mount(app, shell(
  h("h2", {}, "الرابط غير صالح"),
  notice(message, "err"),
  sub("اطلب رابطًا جديدًا من إدارة مدرستك.")));

start();
