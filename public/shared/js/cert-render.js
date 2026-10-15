/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// One renderer for certificate designs: the designer, the on-screen preview and print draw the same page
// in real millimetres, so what is designed is exactly what prints. Text is set as text, never as HTML.
import { h } from "./dom.js";
import { docLogo } from "./ui.js";
import { fmtDate } from "./format.js";
import { PAGE, FONTS, presetLayout, presetFor } from "./cert-presets.js";
import { transcriptPage, fitTranscripts } from "./transcript-render.js";

const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
};

// ---------- Values ----------
export function valuesOf(c) {
  const d = c.data || {}, T = d.terms || {};
  const school = typeof d.school === "string" ? d.school : d.school?.name || "";
  const pct = (v) => (v === null || v === undefined || v === "" ? "" : `${Number(v)}%`);
  return {
    school, student: d.student?.name || "", class_name: d.student?.class_name || "", title: c.title || "", scope: d.scope || "",
    result: d.result || "", percent: pct(d.summary?.percent), grade: d.summary?.grade || "",
    total: d.summary?.total ?? "", max: d.summary?.max ?? "", rank: d.rank ? `${d.rank.position} من ${d.rank.of}` : "",
    attendance: d.attendance?.rate != null ? pct(d.attendance.rate) : pct(d.attendance_pct), absent: d.attendance?.absent ?? "",
    body: d.body || "", course: d.course?.name || "",
    program: d.course?.program ? ` ضمن ${T.program || "البرنامج"}: ${d.course.program}` : "",
    hours: d.course?.hours != null ? String(Number(d.course.hours)) : "", completed_on: d.course?.completed_on ? fmtDate(d.course.completed_on) : "",
    mode: d.course?.mode || "", serial: c.serial || "", code: c.code || "", issued_at: c.issued_at ? fmtDate(c.issued_at) : "",
    signer_title: d.signer?.title || "", signer_name: d.signer?.name || "",
    approval_note: d.approval?.at ? `النتائج معتمدة داخليًا من إدارة ${school} بتاريخ ${fmtDate(d.approval.at)}` : "",
    footer_note: d.footer_note || "", verify_url: c.verify_url || "",
  };
}

// Realistic sample data for designing and previewing.
export const SAMPLE = {
  title: "شهادة نتيجة الفصل الدراسي الأول — 2025/2026", serial: "2026-000128", code: "K7M2Q9XRT4", issued_at: new Date().toISOString(),
  data: {
    school: "مدرسة النخبة النموذجية", scope: "الفصل الدراسي الأول — 2025/2026",
    student: { name: "عبدالرحمن خالد سعيد العمودي", class_name: "الصف السادس - أ" },
    subjects: [["القرآن الكريم", 48, 50], ["التربية الإسلامية", 46, 50], ["اللغة العربية", 91, 100], ["الرياضيات", 88, 100], ["العلوم", 45, 50],
      ["الدراسات الاجتماعية", 42, 50], ["اللغة الإنجليزية", 44, 50]].map(([subject, score, max]) => ({ subject, score, max, percent: Math.round((score / max) * 1000) / 10,
      grade: score / max >= 0.9 ? "ممتاز" : score / max >= 0.8 ? "جيد جدًا" : "جيد" })),
    summary: { total: 404, max: 450, percent: 89.8, grade: "جيد جدًا" }, rank: { position: 3, of: 32 },
    attendance: { rate: 97.5, absent: 2 }, result: "ناجح", passed: true,
    body: "تقديرًا لتفوقه وحسن سيرته وسلوكه، متمنين له دوام التوفيق والنجاح.",
    course: { name: "دورة أساسيات البرمجة", program: "برنامج التقنية", hours: 40, completed_on: new Date().toISOString().slice(0, 10), mode: "حضوري" },
    attendance_pct: 96, terms: { program: "برنامج" },
    signer: { title: "مدير المدرسة", name: "أ. سالم عبدالله باوزير" }, approval: { at: new Date().toISOString() },
  },
};

const fill = (text, values) => String(text || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (values?.[k] ?? `{{${k}}}`));
const onlyEmptyFields = (text, values) => /\{\{\w+\}\}/.test(text || "") && !String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values?.[k] || "").replace(/[\s:—\-–.،,]+/g, "").trim();
const sampleQr = () => {
  const s = svg("svg", { viewBox: "0 0 21 21", width: "100%", height: "100%" });
  let seed = 7;
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    seed = (seed * 9301 + 49297) % 233280;
    const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    const on = finder ? (x % 6 === 0 || y % 6 === 0 || (x % 14 > 1 && x % 14 < 5 && y % 14 > 1 && y % 14 < 5)) : seed / 233280 > 0.55;
    if (on) s.append(svg("rect", { x, y, width: 1, height: 1, fill: "#1A2233" }));
  }
  return s;
};

// ---------- Page frame ----------
function frame(page) {
  const b = page.border || { style: "none" };
  const { w, h: H } = PAGE[page.orientation];
  if (b.style === "none") return null;
  const box = h("div", { class: "cp-frame" });
  const at = (inset, width, color, style = "solid", extra = "") => h("div", { class: "cp-fr", style:
    `inset:${inset}mm;border:${width}mm ${style} ${color};${extra}` });
  if (b.style === "line") box.append(at(b.inset, b.width, b.color));
  if (b.style === "double") box.append(at(b.inset, b.width * 2.2, b.color, "double"));
  if (b.style === "band") box.append(at(0, Math.max(b.inset, 4), b.color), at(Math.max(b.inset, 4) + 1.5, b.width * 0.5, b.accent));
  if (b.style === "classic" || b.style === "ornate") {
    box.append(at(b.inset, b.width, b.color), at(b.inset + 2.4, b.width * 0.45, b.accent));
    const s = svg("svg", { class: "cp-orn", viewBox: `0 0 ${w} ${H}`, width: `${w}mm`, height: `${H}mm` });
    const c = b.inset + 2.4, k = b.style === "ornate" ? 16 : 7;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x0 = sx > 0 ? c : w - c, y0 = sy > 0 ? c : H - c;
      if (b.style === "classic") {
        s.append(svg("rect", { x: x0 - (sx > 0 ? 0 : k), y: y0 - (sy > 0 ? 0 : k), width: k, height: k, fill: "none", stroke: b.accent, "stroke-width": b.width * 0.6 }));
        s.append(svg("rect", { x: x0 - (sx > 0 ? -2 : k - 2), y: y0 - (sy > 0 ? -2 : k - 2), width: k - 4, height: k - 4, fill: b.accent, opacity: 0.85 }));
      } else {
        const p = (dx, dy) => `${x0 + sx * dx} ${y0 + sy * dy}`;
        s.append(svg("path", { d: `M ${p(0, k)} C ${p(0, k * 0.35)} ${p(k * 0.35, 0)} ${p(k, 0)}`, fill: "none", stroke: b.color, "stroke-width": b.width * 0.7 }));
        s.append(svg("path", { d: `M ${p(3, k * 0.8)} C ${p(3, k * 0.4)} ${p(k * 0.4, 3)} ${p(k * 0.8, 3)}`, fill: "none", stroke: b.accent, "stroke-width": b.width * 0.4 }));
        s.append(svg("circle", { cx: x0 + sx * 6.5, cy: y0 + sy * 6.5, r: 1.6, fill: b.color }));
        s.append(svg("circle", { cx: x0 + sx * k * 0.98, cy: y0 + sy * 1.2, r: 0.9, fill: b.accent }));
        s.append(svg("circle", { cx: x0 + sx * 1.2, cy: y0 + sy * k * 0.98, r: 0.9, fill: b.accent }));
      }
    }
    if (b.style === "ornate") {
      const mid = (x, y, rot) => s.append(svg("path", { d: `M ${x - 10} ${y} Q ${x} ${y - 3} ${x + 10} ${y} Q ${x} ${y + 3} ${x - 10} ${y} Z`, fill: b.color, opacity: 0.85, transform: `rotate(${rot} ${x} ${y})` }));
      mid(w / 2, c, 0); mid(w / 2, H - c, 0); mid(c, H / 2, 90); mid(w - c, H / 2, 90);
    }
    box.append(s);
  }
  return box;
}

// ---------- Elements ----------
function textBox(e, values, opts) {
  const s = e.style || {};
  const shown = opts.fieldNames ? e.text : fill(e.text, values);
  const inner = h("div", { class: `cp-txt${s.fit ? " cp-fit" : ""}`, style: [
    `font-family:${FONTS[s.font] || FONTS.plex}`, `font-size:${s.size || 12}pt`, `font-weight:${s.bold ? 700 : 400}`, `font-style:${s.italic ? "italic" : "normal"}`,
    `color:${s.color || "#1A2233"}`, `text-align:${s.align || "center"}`, `line-height:${s.lh || 1.5}`, `letter-spacing:${s.ls || 0}pt`,
    `justify-content:${{ top: "flex-start", bottom: "flex-end" }[s.valign] || "center"}`].join(";") }, shown);
  return inner;
}

function table(e, data) {
  const s = e.style || {};
  const subjects = data?.subjects || [];
  const cols = [["subject", "المادة", true], ["score", "الدرجة", s.score !== false], ["max", "من", s.max !== false],
    ["percent", "النسبة", s.percent !== false], ["grade", "التقدير", s.grade !== false]].filter((c) => c[2]);
  const cell = (tag, v, st = "") => h(tag, { style: `border-color:${s.line || "#C9D1DE"};${st}` }, v === null || v === undefined ? "—" : String(v));
  const head = `background:${s.headBg || "#E8ECF4"};color:${s.headColor || "#16244A"}`;
  return h("table", { class: `cp-table${s.zebra ? " zebra" : ""}`, style: `font-size:${s.size || 10}pt;font-family:${FONTS[s.font] || FONTS.plex};color:${s.color || "#1A2233"}` },
    h("thead", {}, h("tr", {}, cols.map(([, label]) => cell("th", label, head)))),
    h("tbody", {}, subjects.length ? subjects.map((x) => h("tr", {}, cols.map(([k]) => cell("td", k === "percent" ? (x.percent == null ? "—" : `${x.percent}%`) : x[k]))))
      : h("tr", {}, h("td", { colspan: cols.length, style: `border-color:${s.line || "#C9D1DE"}` }, "لا توجد درجات"))),
    s.total !== false && data?.summary ? h("tfoot", {}, h("tr", {}, cols.map(([k]) => cell("th", {
      subject: "المجموع", score: data.summary.total, max: data.summary.max, percent: data.summary.percent == null ? "—" : `${data.summary.percent}%`, grade: data.summary.grade }[k], head)))) : null);
}

function elementBox(e, ctx) {
  const s = e.style || {};
  const box = h("div", { class: `cp-el cp-${e.type}`, "data-id": e.id, style: [
    `left:${e.x}mm`, `top:${e.y}mm`, `width:${e.w}mm`, `height:${e.h}mm`, e.rot ? `transform:rotate(${e.rot}deg)` : "", s.op != null && s.op < 1 ? `opacity:${s.op}` : ""].filter(Boolean).join(";") });
  const values = ctx.values;
  switch (e.type) {
    case "text":
      if (!ctx.editable && onlyEmptyFields(e.text, values)) return null;
      box.append(textBox(e, values, ctx));
      if (s.bg && s.bg !== "transparent") box.style.background = s.bg;
      break;
    case "image": {
      const src = e.asset ? ctx.assetSrc(e.asset) : null;
      box.append(src ? h("img", { src, alt: "", style: `object-fit:${s.fitImg || "contain"}` }) : h("div", { class: "cp-empty" }, "صورة"));
      if (s.br) box.style.borderRadius = `${s.br}mm`;
      break;
    }
    case "logo": box.append(docLogo("cp-logo")); break;
    case "qr": box.append(ctx.qr ? h("img", { src: ctx.qr, alt: "رمز التحقق" }) : sampleQr()); break;
    case "table": box.append(table(e, ctx.data)); break;
    case "line":
      if (!s.dash || s.dash === "solid") box.style.background = s.color || "#16244A";
      else { box.style.borderTop = `${Math.max(e.h, 0.2)}mm ${s.dash} ${s.color || "#16244A"}`; box.style.height = "0"; }
      break;
    case "rect":
      box.style.background = s.bg || "transparent";
      if (s.bw) box.style.border = `${s.bw}mm ${s.dash || "solid"} ${s.bc || "#16244A"}`;
      if (s.br) box.style.borderRadius = `${s.br}mm`;
      break;
    case "signature": {
      const font = `font-family:${FONTS[s.font] || FONTS.plex};font-size:${s.size || 11}pt;color:${s.color || "#1A2233"}`;
      box.append(h("div", { class: "cp-sign", style: font },
        h("div", {}, ctx.fieldNames ? "{{signer_title}}" : values?.signer_title || "مدير المدرسة"),
        h("i", { style: `border-color:${s.color || "#1A2233"}` }),
        h("b", {}, ctx.fieldNames ? "{{signer_name}}" : values?.signer_name || "")));
      break;
    }
    default: return null;
  }
  if (e.hidden && !ctx.editable) return null;
  if (e.hidden) box.classList.add("cp-hidden");
  return box;
}

/**
 * Draws one certificate page.
 * @param {object} layout
 * @param {object} ctx  { values, data, qr, assetSrc(id), editable, fieldNames, voidText }
 */
export function renderPage(layout, ctx = {}) {
  const page = layout.page;
  const { w, h: H } = PAGE[page.orientation];
  const el = h("div", { class: `cp cp-${page.orientation}`, style: `width:${w}mm;height:${H}mm;background:${page.bg || "#FFFFFF"}` });
  if (page.bgAsset) {
    const src = ctx.assetSrc?.(page.bgAsset);
    if (src) el.append(h("img", { class: "cp-bg", src, alt: "", style: `object-fit:${page.bgFit || "cover"};opacity:${page.bgOp ?? 1}` }));
  }
  const fr = frame(page);
  if (fr) el.append(fr);
  for (const e of layout.els) {
    const box = elementBox(e, ctx);
    if (box) el.append(box);
  }
  if (ctx.voidText) el.append(h("div", { class: "cp-void" }, ctx.voidText));
  return el;
}

// Shrinks text that does not fit its box (long names), once fonts are loaded and the page is in the document.
export async function fitText(root) {
  try { await document.fonts.ready; } catch { /* fonts API unavailable */ }
  for (const t of root.querySelectorAll(".cp-fit")) {
    let size = parseFloat(t.style.fontSize);
    for (let i = 0; i < 40 && size > 5 && (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1); i++) {
      size -= 0.5; t.style.fontSize = `${size}pt`;
    }
  }
  fitTranscripts(root);
  // A grades table with many subjects shrinks to stay inside its box instead of running into what follows.
  for (const t of root.querySelectorAll(".cp-el.cp-table > table")) {
    const box = t.parentElement;
    let size = parseFloat(t.style.fontSize);
    for (let i = 0; i < 40 && size > 5 && t.offsetHeight > box.clientHeight + 1; i++) {
      size -= 0.25; t.style.fontSize = `${size}pt`;
    }
  }
}

// A printed or previewed certificate: its stored design, or the standard design for its kind (older certificates).
// Transcripts have their own fixed official layout.
export function certificatePage(c, assets = {}) {
  if (c.kind === "transcript") return transcriptPage(c);
  const layout = c.data?.layout || presetLayout(presetFor(c.kind));
  const voidText = c.status === "replaced" ? "مستبدلة" : c.revoked_at ? "ملغاة" : null;
  return renderPage(layout, { values: valuesOf(c), data: c.data, qr: c.qr, assetSrc: (id) => assets[id], voidText });
}

// Scales pages to the width available on screen (they stay in real millimetres for print).
export function fitToWidth(holder) {
  const apply = () => {
    for (const wrap of holder.querySelectorAll(".cp-wrap")) {
      const page = wrap.firstElementChild;
      const scale = Math.min(1, wrap.clientWidth / page.offsetWidth);
      page.style.transform = `scale(${scale})`;
      wrap.style.height = `${page.offsetHeight * scale}px`;
    }
  };
  requestAnimationFrame(apply);
  if ("ResizeObserver" in window) new ResizeObserver(apply).observe(holder);
  return apply;
}

export function certificateSheet(rows) {
  const assets = Object.assign({}, ...rows.map((r) => r.assets || {}));
  const sheet = h("div", { class: "cp-sheet" }, rows.map((c) => h("div", { class: "cp-wrap" }, certificatePage(c, assets))));
  requestAnimationFrame(() => { fitToWidth(sheet); fitText(sheet).then(() => fitToWidth(sheet)); });
  return sheet;
}

// Prints certificates on their own A4 pages (portrait or landscape each), nothing else from the page.
export async function printCertificateSheet(rows) {
  const assets = Object.assign({}, ...rows.map((r) => r.assets || {}));
  const sheet = h("div", { class: "cp-print" }, rows.map((c) => certificatePage(c, assets)));
  document.body.append(sheet);
  document.body.classList.add("cp-printing");
  await fitText(sheet);
  await Promise.all([...sheet.querySelectorAll("img")].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
  const done = () => { sheet.remove(); document.body.classList.remove("cp-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(() => { if (!matchMedia("print").matches) done(); }, 1500); }, 80);
}
