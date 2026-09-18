// باب منسوبي المدرسة: المدير والمعلم يدخلان من هنا،
// والنظام يفتح لكل واحد لوحته حسب دوره في هذه المدرسة.
import { h, $, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { brandLogo, footer, field, input, btn, notice, sub , showInstallBar} from "/shared/js/ui.js";
import { startAnalytics } from "/shared/js/analytics.js";
import { startAdmin } from "/admin/app.js";
import { startTeacher } from "/teacher/app.js";

const app = $("#app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();

const open = { admin: startAdmin, teacher: startTeacher };

async function start() {
  // لو كانت هناك جلسة سارية نفتح لوحتها مباشرة
  for (const role of ["admin", "teacher"]) {
    try { await api(`/api/${role}/me`); return open[role](); } catch { /* لا جلسة */ }
  }
  showLogin();
}

function showLogin(error) {
  const user = input({ class: "ltr", autocomplete: "username" });
  const pass = input({ class: "ltr", type: "password", autocomplete: "current-password" });
  const msg = h("div", {}, error ? notice(error, "err") : null);
  const submit = btn("تسجيل الدخول", async () => {
    mount(msg);
    try {
      const r = await api("/api/staff/login", { school, username: user.value, password: pass.value });
      pass.value = "";
      localStorage.setItem("midar_school", school);
      mount(app, h("p", { class: "empty loading" }, "جارٍ فتح لوحتك…"));
      await open[r.role]();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "wide");
  for (const el of [user, pass]) el.addEventListener("keydown", (e) => e.key === "Enter" && submit.click());

  mount(app,
    h("div", { class: "auth-hero" }, h("div", { class: "in" }, brandLogo("hero-logo", true, "stacked"), h("p", { class: "role" }, "دخول منسوبي المدرسة"))),
    h("main", {}, h("div", { class: "auth-card" },
      sub("للمدير والمعلمين. كل حساب يفتح لوحته الخاصة."),
      field("اسم المستخدم", user), field("كلمة المرور", pass), msg, submit)),
    footer());
  user.focus();
  startAnalytics("staff-login");
}

start();
showInstallBar();
