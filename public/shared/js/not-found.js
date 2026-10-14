/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, $, mount } from "./dom.js";
import { brandLogo, footer } from "./ui.js";
mount($("#app"),
  h("div", { class: "auth-hero" }, h("div", { class: "in" }, brandLogo("hero-logo", true, "stacked"))),
  h("main", {}, h("div", { class: "auth-card" }, h("h2", {}, "الصفحة غير موجودة"),
    h("p", { class: "sub" }, "تأكد من الرابط، أو ارجع للصفحة الرئيسية."), h("a", { class: "btn wide", href: "/" }, "الصفحة الرئيسية"))),
  footer());
