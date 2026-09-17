// الصفحة الرئيسية
import { h, $, mount } from "/shared/js/dom.js";
import { brandLogo, footer, field, input, btn } from "/shared/js/ui.js";
import { startAnalytics } from "/shared/js/analytics.js";

const code = input({ class: "ltr", placeholder: "مثال: alnoor", value: localStorage.getItem("midar_school") || "", autocomplete: "organization" });
const open = btn("فتح صفحة المدرسة", () => {
  const c = code.value.trim().toLowerCase();
  if (c) location.href = `/s/${encodeURIComponent(c)}`;
}, "wide");
code.addEventListener("keydown", (e) => e.key === "Enter" && open.click());

mount($("#app"),
  h("div", { class: "auth-hero" }, h("div", { class: "in" }, brandLogo("hero-logo"))),
  h("main", {}, h("div", { class: "auth-card" },
    h("h2", {}, "الطلاب وأولياء الأمور"),
    field("رمز المدرسة", code),
    open,
    h("div", { class: "spaced", style: "padding-top:12px;border-top:1px dashed var(--line)" },
      h("div", { class: "sub", style: "margin-bottom:8px" }, "دخول منسوبي المدرسة"),
      h("div", { class: "row" },
        h("a", { class: "btn ghost", href: "/admin/" }, "إدارة المدرسة"),
        h("a", { class: "btn ghost", href: "/teacher/" }, "المعلمون"))))),
  footer());

startAnalytics("home");
