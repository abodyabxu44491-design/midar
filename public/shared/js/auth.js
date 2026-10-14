/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Shared layout and controls for the sign-in, activation and password pages.
import { h, mount } from "./dom.js";
import { brandLogo, toAsciiDigits } from "./ui.js";
import { icons } from "./icons.js";
import { ARAB_DIALS, guessDial, withDial, detectPhone } from "./phone.js";

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

// A two-panel page: the brand panel and the form panel (stacked on phones).
export function authShell({ title, text, points = [] }, ...content) {
  return h("div", { class: "au" },
    h("aside", { class: "au-brand" }, orbitArt(),
      h("div", { class: "au-brand-in" },
        brandLogo("au-logo", true, "row"),
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

// Phone number with a country-code picker inside the same box.
export function phoneField({ id = "au-phone", autofocus = false } = {}) {
  let dial = guessDial();
  const num = h("input", { id, type: "tel", inputmode: "tel", autocomplete: "tel-national", dir: "ltr", class: "pf-num",
    placeholder: "رقم الجوال", autofocus: autofocus || null });
  const code = h("b", { dir: "ltr" });
  const trigger = h("button", { type: "button", class: "pf-cc", "aria-haspopup": "listbox", "aria-expanded": "false" }, code, icons.chevronDown({ size: 14 }));
  const search = h("input", { type: "search", class: "pf-search", placeholder: "ابحث عن الدولة", "aria-label": "ابحث عن الدولة", autocomplete: "off" });
  const list = h("div", { class: "pf-list", role: "listbox", "aria-label": "رمز الدولة" });
  const pop = h("div", { class: "pf-pop", hidden: true }, h("div", { class: "pf-search-row" }, icons.search({ size: 16 }), search), list);
  const box = h("div", { class: "pf-box", dir: "ltr" }, trigger, h("i", { class: "pf-sep" }), num);
  const el = h("div", { class: "pf" }, box, pop);

  const paint = () => {
    const c = ARAB_DIALS.find((x) => x.dial === dial);
    code.textContent = c ? `+${c.dial}` : "+ دولي";
    trigger.title = c ? c.name : "رقم دولي";
    trigger.setAttribute("aria-label", `رمز الدولة: ${c ? c.name : "رقم دولي"}`);
    num.placeholder = c ? "رقم الجوال" : "+ رمز الدولة ثم الرقم";
  };
  const options = () => [...ARAB_DIALS.map((c) => ({ dial: c.dial, name: c.name })), { dial: null, name: "دولة أخرى" }];
  const drawList = () => {
    const q = search.value.trim().replace(/^\+/, "");
    const rows = options().filter((c) => !q || c.name.includes(q) || (c.dial && c.dial.startsWith(q)));
    mount(list, rows.length ? rows.map((c) => h("button", {
      type: "button", class: `pf-opt${c.dial === dial ? " on" : ""}`, role: "option", "aria-selected": String(c.dial === dial),
      onclick: () => { dial = c.dial; paint(); close(); num.focus(); },
    }, h("span", { class: "pf-name" }, c.name), h("span", { class: "pf-dial", dir: "ltr" }, c.dial ? `+${c.dial}` : ""),
      c.dial === dial ? icons.check({ size: 15 }) : h("i", { class: "pf-tick" }))) : h("p", { class: "pf-none" }, "لا توجد دولة بهذا الاسم"));
  };
  const onDoc = (e) => { if (!el.contains(e.target)) close(); };
  function open() {
    pop.hidden = false; trigger.setAttribute("aria-expanded", "true"); el.classList.add("open");
    search.value = ""; drawList();
    document.addEventListener("pointerdown", onDoc, true);
    requestAnimationFrame(() => { search.focus({ preventScroll: true }); list.querySelector(".on")?.scrollIntoView({ block: "nearest" }); });
  }
  function close() {
    pop.hidden = true; trigger.setAttribute("aria-expanded", "false"); el.classList.remove("open");
    document.removeEventListener("pointerdown", onDoc, true);
  }
  trigger.addEventListener("click", () => (pop.hidden ? open() : close()));
  search.addEventListener("input", drawList);
  const moveFocus = (step) => {
    const opts = [...list.querySelectorAll(".pf-opt")];
    const at = opts.indexOf(document.activeElement);
    opts[Math.max(0, Math.min(opts.length - 1, at + step))]?.focus();
  };
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); trigger.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
    else if (e.key === "Enter" && document.activeElement === search) { e.preventDefault(); list.querySelector(".pf-opt")?.click(); }
  });
  // Digits only; a full international number pasted in the box moves the picker to its country.
  num.addEventListener("input", () => {
    const v = toAsciiDigits(num.value).replace(/[^\d+]/g, "");
    if (/^(\+|00)/.test(v)) {
      const d = v.replace(/\D/g, "").replace(/^00/, "");
      const hit = ARAB_DIALS.find((c) => d.startsWith(c.dial) && detectPhone(`+${d}`)?.ok);
      if (hit) { dial = hit.dial; paint(); num.value = d.slice(hit.dial.length); return; }
    }
    if (num.value !== v) num.value = v;
  });
  box.addEventListener("click", (e) => { if (e.target === box) num.focus(); });
  paint();

  return {
    el, input: num,
    get value() { return withDial(dial, num.value); },
    get empty() { return !num.value.replace(/\D/g, ""); },
    get valid() { return Boolean(detectPhone(withDial(dial, num.value))?.ok); },
    focus: () => num.focus(),
    invalid: (on) => box.classList.toggle("bad", on),
  };
}

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
