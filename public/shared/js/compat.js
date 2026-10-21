/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Runs before the platform on every page, in old-style JavaScript that any browser understands. A browser too old
// for the platform (older than Chrome/Edge 98, Safari 15.4, Firefox 94) gets a clear message instead of a page that
// stays on «جارٍ التحميل» forever.
(function () {
  var ok = true;
  try {
    ok = "noModule" in document.createElement("script")
      && typeof window.structuredClone === "function"
      && typeof Array.prototype.at === "function"
      && typeof Object.hasOwn === "function"
      && !!(window.CSS && CSS.supports && CSS.supports("height", "1dvh"));
  } catch (e) { ok = false; }
  if (ok) return;
  var show = function () {
    // The platform's own scripts may still start in a partly old browser, so the message lives outside #app and
    // #app stays hidden (html.unsupported): nothing half-working is shown behind it.
    document.documentElement.className += " unsupported";
    var box = document.createElement("div");
    box.className = "compat-box";
    box.setAttribute("dir", "rtl");
    box.innerHTML = "<h1>المتصفح قديم ولا يدعم مدار</h1>"
      + "<p>حدّث المتصفح إلى آخر إصدار، أو افتح الرابط من متصفح حديث مثل Chrome أو Safari أو Edge أو Firefox.</p>"
      + "<p class=\"compat-note\">على الآيفون: حدّث النظام من الإعدادات ← عام ← تحديث البرنامج (iOS 15.4 أو أحدث).</p>";
    document.body.appendChild(box);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
  else show();
})();
