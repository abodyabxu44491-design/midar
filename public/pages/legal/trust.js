/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The trust center page: every internal badge with its state and what proves it, and the certificate lookup.
import { h, mount } from "../shared/js/dom.js";
import { fmtDate } from "../shared/js/format.js";

const grid = document.querySelector("[data-badges]");

async function badges() {
  let t;
  try { t = await (await fetch("/api/public/trust")).json(); } catch { t = null; }
  if (!t?.badges) { mount(grid, h("p", { class: "lg-meta" }, "تعذّر تحميل الشارات الآن. أعد المحاولة بعد قليل.")); return; }
  mount(grid, t.badges.map((b) => h("article", { class: `tc-badge ${b.active ? "on" : "off"}` },
    h("div", { class: "tc-seal", "aria-hidden": "true" }, b.active ? "✓" : "…"),
    h("h3", {}, b.title),
    h("p", { class: "tc-state" }, b.active ? "نشطة" : "غير نشطة: لم يُنفَّذ الإجراء أو انتهت صلاحية آخر فحص",
      " · ", b.method === "automatic" ? "فحص آلي تجريه المنصة" : "إجراء موثّق بدليل"),
    h("p", { class: "tc-proves" }, h("b", {}, "ما الذي تثبته: "), b.proves),
    b.active ? h("p", { class: "tc-last" }, h("b", {}, "آخر فحص: "), `${fmtDate(b.checked_at)} — ${b.summary}`) : null,
    b.active ? h("p", { class: "tc-last" }, "صالحة حتى ", fmtDate(b.valid_until)) : null,
    b.certificate ? h("a", { class: "st-btn out", href: `/trust/verify/${b.certificate}` }, `الشهادة ${b.certificate}`) : null,
    h("small", { class: "tc-internal" }, "شارة داخلية من منصة مدار، وليست اعتمادًا حكوميًا أو شهادة من جهة خارجية."))));
}

async function official() {
  let s;
  try { s = await (await fetch("/api/site")).json(); } catch { return; }
  const box = document.querySelector("[data-official]");
  const accr = s.accreditations || [];
  const reg = s.company?.reg_no;
  if (!accr.length && !reg) return;
  mount(box,
    reg ? h("p", {}, "السجل التجاري: ", h("span", { class: "ltr" }, reg)) : null,
    accr.length ? h("ul", {}, accr.map((a) => h("li", {}, h("b", {}, a.title), ` — ${a.issuer}`,
      a.number ? [" · رقم ", h("span", { class: "ltr" }, a.number)] : null,
      a.verify_url ? [" · ", h("a", { href: a.verify_url, target: "_blank", rel: "noopener" }, "التحقق لدى الجهة المانحة")] : null))) : null);
}

document.querySelector("[data-verify]").addEventListener("submit", (e) => {
  e.preventDefault();
  const ref = new FormData(e.target).get("ref").trim().toUpperCase();
  location.href = `/trust/verify/${encodeURIComponent(ref)}`;
});
badges();
official();
