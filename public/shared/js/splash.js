// شاشة افتتاحية (3 ثوانٍ) لشعار مدار: تظهر مرة واحدة في كل جلسة عند فتح الموقع أو صفحة المدرسة.
// سكربت عادي صغير يُحمَّل مبكرًا (قبل الصفحة) فلا يظهر محتوى ثم يختفي. الحركة كلها CSS (ملف splash.css).
// الضغط أو أي مفتاح يتخطاها، ومن يفضّل تقليل الحركة يراها مختصرة.
(() => {
  const KEY = "midar_splash";
  try { if (sessionStorage.getItem(KEY)) return; sessionStorage.setItem(KEY, "1"); } catch { /* التخزين غير متاح: نعرضها */ }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  root.classList.add("splash-on");
  const el = document.createElement("div");
  el.id = "splash";
  el.setAttribute("aria-hidden", "true");
  if (reduced) el.className = "reduced";
  // نفس مسارات الشعار الرسمي، مقسّمة لأجزاء تتحرك كلٌ في وقتها
  el.innerHTML = `
  <div class="sp-glow"></div><div class="sp-ring"></div>
  <div class="sp-logo">
    <svg class="sp-mark" viewBox="24 96 464 330">
      <defs><mask id="sp-m"><rect x="-100" y="-100" width="800" height="800" fill="#fff"/><rect x="83.9" y="112" width="344.2" height="248" fill="#000"/></mask>
        <clipPath id="sp-c"><rect class="sp-reveal" x="0" y="96" width="520" height="330"/></clipPath></defs>
      <path class="sp-back" pathLength="1" d="M 42 318 A 214 58 0 0 1 470 318" fill="none" stroke-width="18" stroke-linecap="round" transform="rotate(-14 256 318)" mask="url(#sp-m)"/>
      <g clip-path="url(#sp-c)"><path class="sp-shape" d="M25 0 133 -180Q143 -160 163.0 -150.0Q183 -140 201 -140H358L418 0ZM418 0Q372 0 333.0 -23.0Q294 -46 270.5 -85.0Q247 -124 247 -170Q247 -217 268.0 -252.5Q289 -288 322.5 -310.0Q356 -332 391 -338Q396 -355 410.5 -373.0Q425 -391 432 -398Q514 -349 551.0 -295.0Q588 -241 588 -170Q588 -123 565.0 -84.5Q542 -46 503.5 -23.0Q465 0 418 0ZM418 -140Q431 -140 439.0 -148.5Q447 -157 447 -170Q447 -183 439.0 -191.5Q431 -200 418 -200Q405 -200 396.0 -191.5Q387 -183 387 -170Q387 -157 396.0 -148.5Q405 -140 418 -140Z" transform="translate(77.34 352.00) scale(0.5829)"/></g>
      <path class="sp-gap" pathLength="1" d="M 470 318 A 214 58 0 0 1 42 318" fill="none" stroke-width="40" transform="rotate(-14 256 318)"/>
      <path class="sp-front" pathLength="1" d="M 470 318 A 214 58 0 0 1 42 318" fill="none" stroke-width="18" stroke-linecap="round" transform="rotate(-14 256 318)"/>
      <g class="sp-dot"><circle cx="432.8" cy="245.9" r="28" stroke-width="10"/></g>
    </svg>
    <div class="sp-word">مدار</div>
    <div class="sp-latin">MIDAR</div>
  </div>`;
  const mount = () => document.body.prepend(el);
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount, { once: true });
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    el.classList.add("out");
    setTimeout(() => { el.remove(); root.classList.remove("splash-on"); }, 520);
  };
  setTimeout(finish, reduced ? 900 : 2500);
  el.addEventListener("click", finish);
  addEventListener("keydown", finish, { once: true });
})();
