import { h, $, mount } from "./dom.js";
import { brandLogo, footer } from "./ui.js";
mount($("#app"),
  h("div", { class: "auth-hero" }, h("div", { class: "in" }, brandLogo("hero-logo"))),
  h("main", {}, h("div", { class: "auth-card" }, h("h2", {}, "الصفحة غير موجودة"),
    h("p", { class: "sub" }, "تأكد من الرابط، أو ارجع للصفحة الرئيسية."), h("a", { class: "btn wide", href: "/" }, "الصفحة الرئيسية"))),
  footer());
