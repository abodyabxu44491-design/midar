/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Shared layout and controls for the sign-in, activation and password pages.
import { h, mount } from "./dom.js";
import { brandLogo, toAsciiDigits } from "./ui.js";
import { icons } from "./icons.js";

const NS = "http://www.w3.org/2000/svg";
function orbitArt() {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 600 600");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("au-orbit");
  const add = (tag, attrs, parent = svg) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    parent.append(el);
    return el;
  };
  for (const [rx, ry, rot, cls] of [[270, 120, -18, "o1"], [210, 90, 24, "o2"], [150, 64, -40, "o3"]]) {
    const g = add("g", { class: `au-ring ${cls}`, transform: `rotate(${rot} 300 300)` });
    add("ellipse", { cx: 300, cy: 300, rx, ry }, g);
    add("circle", { cx: 300 + rx, cy: 300, r: cls === "o1" ? 7 : 5, class: cls === "o2" ? "dot gold" : "dot" }, g);
  }
  add("circle", { cx: 300, cy: 300, r: 34, class: "core" });
  return svg;
}

// The school's identity for the phone header: logo (or a building mark), name and a short line.
export const schoolHero = (school, kicker) => (school?.name ? [
  h("span", { class: "au-hero-logo" }, school.logo ? h("img", { src: school.logo, alt: "" }) : icons.building({ size: 30 })),
  h("b", {}, school.name), kicker ? h("small", {}, kicker) : null] : null);

// A two-panel page: the brand panel and the form panel (stacked on phones, with the school in the header).
export function authShell({ title, text, points = [], school, kicker }, ...content) {
  return h("div", { class: `au${school?.name ? " au-has-hero" : ""}` },
    h("aside", { class: "au-brand" }, orbitArt(),
      h("div", { class: "au-brand-in" },
        brandLogo("au-logo", true, "row"),
        h("div", { class: "au-hero-school" }, schoolHero(school, kicker)),
        h("div", { class: "au-brand-copy" },
          h("h2", {}, title),
          text && h("p", {}, text),
          points.length ? h("ul", { class: "au-points" }, points.map(([icon, label]) => h("li", {}, h("span", {}, icon({ size: 16 })), label))) : null)),
      h("small", { class: "au-copy" }, "مدار · منصة إدارة المدارس")),
    h("main", { class: "au-main" },
      h("div", { class: "au-panel" }, ...content,
        h("div", { class: "au-foot" }, icons.lock({ size: 13 }), "اتصال آمن ومشفّر"))));
}

export const authHead = (title, sub, school) => h("header", { class: "au-head" },
  school ? h("div", { class: "au-school" }, school.logo ? h("img", { src: school.logo, alt: "" }) : h("span", { class: "au-school-ic" }, icons.building({ size: 16 })), h("b", {}, school.name)) : null,
  h("h1", {}, title),
  sub ? h("p", {}, sub) : null);

// Labelled control without a <label> wrapper (so inner buttons don't steal clicks).
export const authField = (label, control, { hint, aside, id } = {}) => h("div", { class: "au-f" },
  h("div", { class: "au-f-top" }, h("label", { for: id || undefined }, label), aside || null),
  control, hint ? h("small", { class: "au-hint" }, hint) : null);

const SVGNS = "http://www.w3.org/2000/svg";
const svgMark = (viewBox, paths) => {
  const el = document.createElementNS(SVGNS, "svg");
  el.setAttribute("viewBox", viewBox); el.setAttribute("width", "20"); el.setAttribute("height", "20"); el.setAttribute("aria-hidden", "true");
  for (const [d, fill] of paths) { const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); p.setAttribute("fill", fill); el.append(p); }
  return el;
};
const googleMark = () => svgMark("0 0 48 48", [
  ["M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z", "#FFC107"],
  ["M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z", "#FF3D00"],
  ["M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z", "#4CAF50"],
  ["M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z", "#1976D2"],
]);
const appleMark = () => svgMark("0 0 24 24", [["M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.27-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74s1.78.74 2.99.72c1.24-.02 2.02-1.12 2.77-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.4-3.68zM14.09 5.84c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.75-.96 2.79 1.02.08 2.05-.52 2.68-1.27z", "currentColor"]]);

// "Continue with Google / Apple" buttons (each shown only when the owner has set it up).
export function providerButtons(enabled, hrefOf) {
  const out = [];
  if (enabled?.google) out.push(h("a", { class: "au-prov google", href: hrefOf("google") }, googleMark(), h("span", {}, "المتابعة باستخدام Google")));
  if (enabled?.apple) out.push(h("a", { class: "au-prov apple", href: hrefOf("apple") }, appleMark(), h("span", {}, "المتابعة باستخدام Apple")));
  return out.length ? h("div", { class: "au-provs" }, out) : null;
}
export const orDivider = (text = "أو") => h("div", { class: "au-or", role: "separator" }, h("span", {}, text));

// Messages for a provider round-trip that came back without signing in (?oauth=…).
export const OAUTH_MESSAGES = {
  cancelled: "أُلغيت العملية قبل اكتمالها.",
  expired: "انتهت مهلة العملية. حاول مرة أخرى.",
  failed: "تعذر التحقق من الحساب لدى المزوّد. حاول مرة أخرى.",
  off: "هذه الطريقة غير مفعّلة حاليًا.",
  not_linked: "هذا الحساب غير مرتبط بأي مدرسة في مدار. ادخل بالطريقة التي ربطت بها حسابك، أو اطلب رابط استعادة من إدارة مدار.",
  email_exists: "بريد هذا الحساب مسجّل في مدار بكلمة مرور. ادخل بالبريد وكلمة المرور، ثم اربط الحساب من «الدخول والأمان».",
  no_email: "لم يشارك المزوّد بريدًا موثّقًا. استخدم طريقة أخرى.",
  taken: "هذا الحساب مرتبط بحساب مدار آخر.",
  linked: "تم الربط بنجاح.",
  linked_other: "هذه المدرسة مرتبطة بحساب آخر. اطلب من إدارة مدار رابط استعادة الوصول.",
  link_failed: "تعذر ربط المدرسة. افتح رابط الإعداد مرة أخرى أو اطلب رابطًا جديدًا.",
};

// Six-digit code: one real input (so SMS autofill keeps working) drawn as six boxes.
export function codeField({ onComplete } = {}) {
  const inp = h("input", { class: "otp-in", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, dir: "ltr", "aria-label": "رمز التحقق" });
  const cells = Array.from({ length: 6 }, () => h("span", { class: "otp-cell" }));
  const el = h("div", { class: "otp", dir: "ltr" }, cells, inp);
  const paint = () => {
    const v = inp.value;
    const focused = document.activeElement === inp;
    cells.forEach((c, i) => {
      c.textContent = v[i] || "";
      c.classList.toggle("on", focused && (i === Math.min(v.length, 5)));
      c.classList.toggle("full", Boolean(v[i]));
    });
  };
  inp.addEventListener("input", () => {
    inp.value = toAsciiDigits(inp.value).replace(/\D/g, "").slice(0, 6);
    el.classList.remove("bad");
    paint();
    if (inp.value.length === 6) onComplete?.(inp.value);
  });
  for (const ev of ["focus", "blur", "keyup", "click"]) inp.addEventListener(ev, paint);
  paint();
  return {
    el, input: inp,
    get value() { return inp.value; },
    set value(v) { inp.value = String(v || "").slice(0, 6); paint(); },
    focus: () => inp.focus(),
    clear: () => { inp.value = ""; paint(); inp.focus(); },
    invalid: () => { el.classList.remove("bad"); void el.offsetWidth; el.classList.add("bad"); },
  };
}

// Four-step strength bar under a new password, with its word in the hint.
const LEVELS = ["", "ضعيفة", "مقبولة", "جيدة", "قوية"];
export const strengthLevel = (v) => (v ? Math.max(1, [v.length >= 10, v.length >= 14, /[A-Za-z]/.test(v) && /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length) : 0);
export function strengthMeter(pass) {
  const el = h("div", { class: "au-meter", "data-l": "0", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"));
  const label = h("span");
  (pass.inputEl || pass).addEventListener("input", () => {
    const l = strengthLevel(pass.value);
    el.dataset.l = String(l);
    label.textContent = l ? `قوة كلمة المرور: ${LEVELS[l]}` : "";
  });
  return { el, label };
}
