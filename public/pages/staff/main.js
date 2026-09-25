// باب منسوبي المدرسة: المدير والمعلم يدخلان من هنا،
// والنظام يفتح لكل واحد لوحته حسب دوره في هذه المدرسة.
import { h, $, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { brandLogo, footer, field, input, select, textarea, btn, notice, sub, dialog, showInstallBar, passwordInput } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { startAnalytics } from "../shared/js/analytics.js";


const app = $("#app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();

// كل لوحة تُحمّل بعد معرفة دور الحساب فقط (صفحة الدخول لا تحمل كود اللوحات الثلاث)
const open = {
  admin: async () => (await import("../admin/app.js")).startAdmin(),
  teacher: async () => (await import("../teacher/app.js")).startTeacher(),
  accountant: async () => (await import("../accountant/app.js")).startAccountant(),
};

async function start() {
  // لو كانت هناك جلسة سارية نفتح لوحتها مباشرة.
  // كوكي كل دور مقصور على مسار واجهته (/api/admin …)، فنسأل الدور الأخير أولًا (طلب واحد غالبًا)،
  // ثم بقية الأدوار معًا بالتوازي بدل واحد بعد الآخر.
  const last = sessionStorage.getItem("midar_role") || localStorage.getItem("midar_last_role");
  const roles = ["admin", "teacher", "accountant"];
  const probe = (role) => api(`/api/${role}/me`).then(() => role);
  let role = null;
  if (last && open[last]) role = await probe(last).catch(() => null);
  if (!role) role = await Promise.any(roles.filter((r) => r !== last).map(probe)).catch(() => null);
  if (role) { sessionStorage.setItem("midar_role", role); localStorage.setItem("midar_last_role", role); return open[role](); }
  showLogin();
}

function showLogin(error) {
  const user = input({ class: "ltr", autocomplete: "username", placeholder: "اسم المستخدم أو البريد الإلكتروني" });
  const pass = passwordInput({ autocomplete: "current-password", placeholder: "كلمة المرور" });
  const remember = h("input", { type: "checkbox", id: "remember-me" });
  const msg = h("div", {}, error ? notice(error, "err") : null);

  const submit = btn("تسجيل الدخول", async () => {
    mount(msg);
    try {
      const r = await api("/api/staff/login", { school, username: user.value, password: pass.value, remember: remember.checked });
      pass.value = "";
      sessionStorage.setItem("midar_role", r.role);
      localStorage.setItem("midar_last_role", r.role);
      localStorage.setItem("midar_school", school);
      mount(app, h("p", { class: "empty loading" }, "جارٍ فتح لوحتك…"));
      await open[r.role]();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "wide");
  for (const el of [user, pass]) el.addEventListener("keydown", (e) => e.key === "Enter" && submit.click());

  mount(app,
    h("div", { class: "gate" }, h("div", { class: "gate-wrap" },

      // الجانب التعليمي (يختفي على الجوال)
      h("aside", { class: "gate-aside hide-sm" },
        brandLogo("hero-logo", true, "stacked"),
        h("h1", {}, "بوابة إدارة المدرسة"),
        h("p", {}, "كل ما تحتاجه لإدارة مدرستك في مكان واحد."),
        h("ul", { class: "gate-points" },
          h("li", {}, icons.users({ size: 18 }), "الطلاب والفصول والحضور"),
          h("li", {}, icons.calendar({ size: 18 }), "الجداول والاختبارات والدرجات"),
          h("li", {}, icons.money({ size: 18 }), "الرسوم والفواتير والتقارير"))),

      // نموذج الدخول
      h("section", { class: "gate-card" },
        h("div", { class: "show-sm", style: "margin-bottom:10px" }, brandLogo("hero-logo", true, "stacked")),
        h("h2", {}, "بوابة إدارة المدرسة"),
        h("p", { class: "gate-sub" }, "كل ما تحتاجه لإدارة مدرستك في مكان واحد"),

        field("اسم المستخدم أو البريد الإلكتروني", user),
        field("كلمة المرور", pass),

        h("div", { class: "gate-row" },
          h("label", {}, remember, h("span", {}, "تذكرني")),
          h("button", { class: "gate-link", type: "button", onclick: () => requestDialog(school) }, "نسيت كلمة المرور؟")),

        msg, submit,

        h("div", { class: "gate-roles" },
          h("h3", {}, "اختر دورك في المدرسة"),
          h("div", { class: "role-cards" },
            h("div", { class: "role-card" }, "الإداري", h("small", {}, "الطلاب والفصول")),
            h("div", { class: "role-card" }, "المحاسب", h("small", {}, "الرسوم والمالية")),
            h("div", { class: "role-card" }, "المعلم", h("small", {}, "الدرجات والحضور"))),
          sub("يتعرف النظام على دورك تلقائيًا من حسابك بعد الدخول.")),

        h("div", { class: "gate-foot" },
          h("span", { class: "gate-badge" }, icons.lock({ size: 14 }), "وصول خاص وآمن"),
          h("div", { style: "margin-top:6px" }, "تحتاج مساعدة؟ تواصل مع إدارة المدرسة"))))));

  user.focus();
  startAnalytics("staff-login");
}

/* ---------- طلب تغيير كلمة المرور: يُراجَع من الإدارة ثم يعتمده مالك المنصة ---------- */
function requestDialog(schoolCode) {
  const f = {
    full_name: input({ placeholder: "الاسم الكامل كما في السجلات" }),
    username: input({ class: "ltr", placeholder: "اسم المستخدم أو البريد" }),
    phone: input({ class: "ltr", inputMode: "tel", placeholder: "رقم الجوال للتواصل" }),
    branch: input({ placeholder: "المدرسة أو الفرع (اختياري)" }),
    job_title: select([["admin", "إداري"], ["accountant", "محاسب"], ["teacher", "معلم"]]),
    contact_pref: select([["phone", "اتصال هاتفي"], ["whatsapp", "واتساب"], ["email", "بريد إلكتروني"]]),
    description: textarea({ rows: 3, placeholder: "اشرح سبب طلب تغيير كلمة المرور" }),
  };
  const msg = h("div");

  const d = dialog("طلب تغيير كلمة المرور", h("div", {},
    notice("سيُرسل طلبك إلى إدارة المدرسة للتحقق من بياناتك. بعد اعتماد الطلب، يرسل مالك المنصة رابطًا آمنًا لتغيير كلمة المرور.", "warn"),
    field("الاسم الكامل", f.full_name),
    h("div", { class: "row" }, field("اسم المستخدم", f.username), field("رقم الجوال", f.phone)),
    h("div", { class: "row" }, field("المسمى الوظيفي", f.job_title), field("وسيلة التواصل المفضلة", f.contact_pref)),
    field("المدرسة أو الفرع", f.branch),
    field("وصف المشكلة", f.description),
    msg),
  [btn("إرسال الطلب", async () => {
    mount(msg);
    try {
      const r = await api(`/api/public/${encodeURIComponent(schoolCode)}/password-request`, {
        full_name: f.full_name.value, username: f.username.value, phone: f.phone.value,
        branch: f.branch.value || null, job_title: f.job_title.value,
        description: f.description.value, contact_pref: f.contact_pref.value,
      });
      mount(msg, notice(`تم استلام طلبك. رقم الطلب: ${r.ref}. ستتواصل معك إدارة المدرسة للتحقق من بياناتك.`, ""));
      for (const el of [f.full_name, f.username, f.phone, f.branch, f.description]) el.value = "";
    } catch (e) { mount(msg, notice(e.message, "err")); }
  })]);
}

start();
showInstallBar();
