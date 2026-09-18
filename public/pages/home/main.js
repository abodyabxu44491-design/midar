// الصفحة الرئيسية: الشعار فقط، بلا أي روابط أو عناوين.
// كل مدرسة تدخل من رابطها الخاص الذي تسلّمه لها إدارة المنصة.
import { h, $, mount } from "/shared/js/dom.js";
import { brandLogo, footer } from "/shared/js/ui.js";
import { startAnalytics } from "/shared/js/analytics.js";

mount($("#app"),
  h("main", { class: "blank-home" }, brandLogo("hero-logo", false)),
  footer());

startAnalytics("home");
