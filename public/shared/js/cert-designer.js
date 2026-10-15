/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Certificate designer: an A4 page where every element is placed by hand (drag, resize, rotate, layers),
// with data fields, an image library (logos, stamps, signatures, background paper), page frames and
// colours, undo/redo, and a live preview with sample data. Works with a mouse and with touch.
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { btn, badge, empty, notice, sub, toast, dialog, field, input, select, confirmAction } from "./ui.js";
import { PAGE, FONTS, FONT_LABELS, BORDERS, KINDS, FIELDS, presetLayout } from "./cert-presets.js";
import { renderPage, fitText, SAMPLE, valuesOf } from "./cert-render.js";

const PX = 96 / 25.4; // CSS pixels per millimetre
const clone = (v) => JSON.parse(JSON.stringify(v));
const r1 = (v) => Math.round(v * 10) / 10;
const uid = () => `e${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1296).toString(36)}`;
const TYPE_LABEL = { text: "نص", image: "صورة", logo: "شعار المؤسسة", qr: "رمز التحقق QR", table: "جدول الدرجات", line: "خط", rect: "مستطيل / إطار", signature: "توقيع" };
const SAMPLE_CERT = { ...SAMPLE, kind: "term", qr: null };
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
// Saturation and lightness of a #RRGGBB colour (to tell brand colours from greys and pale tints).
function sl(c) {
  const [r, g, b] = rgb(c), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  return [max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1)), l];
}
const mix = (a, b, t) => `#${rgb(a).map((v, i) => Math.round((v * (1 - t) + rgb(b)[i] * t) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

// ---------- Image library ----------
const asDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
// Reads a chosen image (the page's security policy allows data: images, not blob:), scaling it down
// only when it is very large, and keeping transparency (PNG/WEBP) for stamps and signatures.
async function readImage(file) {
  const src = await asDataUrl(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("تعذر قراءة الصورة")); i.src = src; });
  let { naturalWidth: w, naturalHeight: hh } = img;
  const scale = Math.min(1, 3200 / Math.max(w, hh));
  let mime = file.type === "image/jpeg" ? "image/jpeg" : file.type === "image/webp" ? "image/webp" : "image/png";
  let data = src.split(",")[1];
  if (scale < 1 || file.size > 2.5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    w = Math.round(w * scale); hh = Math.round(hh * scale);
    const c = Object.assign(document.createElement("canvas"), { width: w, height: hh });
    c.getContext("2d").drawImage(img, 0, 0, w, hh);
    for (const [m, qlt] of [[mime, 0.92], ["image/webp", 0.9], ["image/jpeg", 0.85]]) {
      const url = c.toDataURL(m, qlt);
      mime = url.slice(5, url.indexOf(";")); data = url.split(",")[1];
      if (data.length * 0.75 <= 2.6 * 1024 * 1024) break;
    }
  }
  return { mime, data, width: w, height: hh, name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "صورة" };
}

export function pickAsset(base, { canEdit, title = "مكتبة الصور" } = {}) {
  return new Promise((resolve) => {
    const grid = h("div", { class: "cd-lib" });
    let chosen = null;
    const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
    const load = async () => {
      mount(grid, empty("جارٍ التحميل…"));
      const list = await api(`${base}/designs/assets`);
      mount(grid, list.length ? list.map((a) => h("button", { type: "button", class: "cd-lib-item", onclick: () => { chosen = a; d.close(); } },
        h("img", { src: `${base}/designs/assets/${a.id}`, alt: a.name, loading: "lazy" }), h("small", {}, a.name),
        canEdit ? h("span", { class: "cd-lib-x", title: "إخفاء من المكتبة", onclick: async (e) => {
          e.stopPropagation();
          if (!confirmAction("إخفاء الصورة من المكتبة؟ الشهادات التي تستخدمها تبقى كما هي.")) return;
          await api(`${base}/designs/assets/${a.id}/hide`, {}); load();
        } }, "×") : null))
        : empty("لا توجد صور بعد. ارفع شعارًا أو ختمًا أو توقيعًا أو خلفية."));
    };
    fileIn.addEventListener("change", async () => {
      const f = fileIn.files?.[0];
      if (!f) return;
      try {
        toast("جارٍ رفع الصورة…");
        const a = await api(`${base}/designs/assets`, await readImage(f));
        chosen = a; d.close();
      } catch (e) { toast(e.message, true); }
      fileIn.value = "";
    });
    const d = dialog(title, h("div", {}, sub("PNG بخلفية شفافة أفضل للأختام والتوقيعات والشعارات. الحد الأقصى نحو 2.8 ميجابايت للصورة."), grid, fileIn),
      canEdit ? [btn("رفع صورة جديدة", () => fileIn.click())] : []);
    d.classList.add("dialog-lg");
    d.addEventListener("close", () => resolve(chosen));
    load();
  });
}

// ---------- The designer ----------
export function openDesigner({ base, template, canEdit, onSaved }) {
  const S = {
    id: template.id, name: template.name, kind: template.kind, layout: clone(template.layout),
    sel: null, past: [], future: [], dirty: false, zoom: 1, fields: false, tab: "parts", adv: false,
  };
  const assetSrc = (id) => `${base}/designs/assets/${id}`;
  const root = h("div", { class: "cd", role: "dialog", "aria-label": "مصمم الشهادات" });
  const stage = h("div", { class: "cd-stage", tabindex: "0" });
  const pageHost = h("div", { class: "cd-pagehost" });
  stage.append(pageHost);
  const side = h("aside", { class: "cd-side" });
  const stageBar = h("div", { class: "cd-stagebar" });
  const saveBtn = btn("حفظ", () => save(), "cd-save");
  const nameIn = input({ value: S.name, maxLength: 80, class: "cd-name", "aria-label": "اسم التصميم" });
  const kindSel = select(Object.entries(KINDS), { value: S.kind, class: "cd-kind", "aria-label": "نوع الشهادة" });
  const zoomLbl = h("span", { class: "cd-zoom-l" });
  const status = h("small", { class: "cd-status" });
  nameIn.addEventListener("input", () => { S.name = nameIn.value; dirty(); });
  kindSel.addEventListener("change", () => { S.kind = kindSel.value; dirty(); drawSide(); });
  if (!canEdit) { nameIn.disabled = true; kindSel.disabled = true; }

  const els = () => S.layout.els;
  const selected = () => els().find((e) => e.id === S.sel) || null;
  const dims = () => PAGE[S.layout.page.orientation];
  function dirty() { S.dirty = true; status.textContent = "تعديلات غير محفوظة"; status.className = "cd-status warn"; saveBtn.classList.add("dirty"); }
  function snapshot() { S.past.push(JSON.stringify(S.layout)); if (S.past.length > 100) S.past.shift(); S.future = []; }
  function commit(fn) { if (!canEdit) return; snapshot(); fn(); dirty(); draw(); }
  function undo() { if (!S.past.length) return; S.future.push(JSON.stringify(S.layout)); S.layout = JSON.parse(S.past.pop()); dirty(); draw(); }
  function redo() { if (!S.future.length) return; S.past.push(JSON.stringify(S.layout)); S.layout = JSON.parse(S.future.pop()); dirty(); draw(); }

  // ----- Canvas -----
  let scale = 1, pageEl = null;
  // Fits the whole page in the visible area, then applies the user's zoom.
  function fitScale() {
    const { w, h: H } = dims();
    const aw = Math.max(240, stage.clientWidth - 32), ah = Math.max(240, stage.clientHeight - 32);
    return Math.min(3, Math.min(aw / (w * PX), ah / (H * PX)) * S.zoom);
  }
  function draw() {
    const values = S.fields ? null : valuesOf({ ...SAMPLE_CERT, kind: S.kind, data: { ...SAMPLE.data, layout: S.layout } });
    pageEl = renderPage(S.layout, { values, data: SAMPLE.data, editable: true, fieldNames: S.fields, assetSrc });
    scale = fitScale();
    const { w, h: H } = dims();
    pageEl.style.transform = `scale(${scale})`;
    pageEl.style.transformOrigin = "top left";
    pageHost.style.width = `${w * PX * scale}px`;
    pageHost.style.height = `${H * PX * scale}px`;
    mount(pageHost, pageEl);
    zoomLbl.textContent = `${Math.round(scale * 100)}%`;
    fitText(pageEl);
    drawSelection();
    drawSide();
  }
  function drawSelection() {
    pageEl.querySelector(".cd-selbox")?.remove();
    const e = selected();
    if (!e) return;
    const box = h("div", { class: `cd-selbox${e.locked ? " locked" : ""}`, style: `left:${e.x}mm;top:${e.y}mm;width:${e.w}mm;height:${e.h}mm;${e.rot ? `transform:rotate(${e.rot}deg)` : ""}` });
    if (!e.locked && canEdit) {
      for (const k of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) box.append(h("i", { class: `cd-h cd-h-${k}`, "data-h": k, style: `--s:${1 / scale}` }));
    }
    pageEl.append(box);
  }

  // Drag / resize with pointer events (mouse, pen, touch).
  let op = null;
  const guideX = h("div", { class: "cd-guide v" }), guideY = h("div", { class: "cd-guide h" });
  function hit(target) {
    const handle = target.closest?.(".cd-h");
    if (handle) return { handle: handle.dataset.h };
    const box = target.closest?.(".cp-el");
    return box ? { id: box.dataset.id } : null;
  }
  stage.addEventListener("pointerdown", (ev) => {
    if (!pageEl || ev.button > 0) return;
    const t = hit(ev.target);
    if (!t) { if (ev.target === stage || ev.target === pageHost || ev.target.classList?.contains("cp") || ev.target.closest?.(".cp-frame")) { S.sel = null; drawSelection(); drawSide(); } return; }
    if (t.id && t.id !== S.sel) { S.sel = t.id; drawSelection(); drawSide(); }
    const e = selected();
    if (!e || e.locked || !canEdit) return;
    ev.preventDefault();
    stage.setPointerCapture(ev.pointerId);
    op = { kind: t.handle ? "resize" : "move", handle: t.handle, sx: ev.clientX, sy: ev.clientY, start: { ...e }, moved: false, before: JSON.stringify(S.layout) };
  });
  stage.addEventListener("pointermove", (ev) => {
    if (!op) return;
    const e = selected();
    const dx = (ev.clientX - op.sx) / (PX * scale), dy = (ev.clientY - op.sy) / (PX * scale);
    if (!op.moved && Math.hypot(dx, dy) < 0.4) return;
    op.moved = true;
    const { w: W, h: H } = dims();
    const s0 = op.start;
    if (op.kind === "move") {
      let x = r1(s0.x + dx), y = r1(s0.y + dy);
      // Snap the element's centre to the page centre, and its edges to the page edges' margins.
      const cx = x + e.w / 2, cy = y + e.h / 2;
      guideX.remove(); guideY.remove();
      if (Math.abs(cx - W / 2) < 1.5) { x = r1(W / 2 - e.w / 2); pageEl.append(guideX); guideX.style.left = `${W / 2}mm`; }
      if (Math.abs(cy - H / 2) < 1.5) { y = r1(H / 2 - e.h / 2); pageEl.append(guideY); guideY.style.top = `${H / 2}mm`; }
      e.x = x; e.y = y;
    } else {
      const k = op.handle;
      let { x, y, w, h: hh } = s0;
      if (k.includes("e")) w = s0.w + dx;
      if (k.includes("s")) hh = s0.h + dy;
      if (k.includes("w")) { w = s0.w - dx; x = s0.x + dx; }
      if (k.includes("n")) { hh = s0.h - dy; y = s0.y + dy; }
      if ((ev.shiftKey || ["image", "logo", "qr"].includes(e.type)) && k.length === 2) { const ratio = s0.h / s0.w; hh = w * ratio; if (k.includes("n")) y = s0.y + s0.h - hh; }
      const min = e.type === "line" ? 0.2 : 3;
      e.w = r1(Math.max(min, w)); e.h = r1(Math.max(e.type === "line" ? 0.2 : 3, hh));
      e.x = r1(k.includes("w") ? Math.min(x, s0.x + s0.w - min) : x); e.y = r1(k.includes("n") ? Math.min(y, s0.y + s0.h - min) : y);
    }
    const box = pageEl.querySelector(`.cp-el[data-id="${e.id}"]`);
    if (box) Object.assign(box.style, { left: `${e.x}mm`, top: `${e.y}mm`, width: `${e.w}mm`, height: `${e.h}mm` });
    const sb = pageEl.querySelector(".cd-selbox");
    if (sb) Object.assign(sb.style, { left: `${e.x}mm`, top: `${e.y}mm`, width: `${e.w}mm`, height: `${e.h}mm` });
    updateGeometryInputs();
  });
  const endOp = () => {
    if (!op) return;
    guideX.remove(); guideY.remove();
    if (op.moved) { S.past.push(op.before); S.future = []; dirty(); draw(); }
    op = null;
  };
  stage.addEventListener("pointerup", endOp);
  stage.addEventListener("pointercancel", endOp);
  stage.addEventListener("dblclick", (ev) => { const t = hit(ev.target); if (t?.id && selected()?.type === "text") side.querySelector("textarea")?.focus(); });

  root.addEventListener("keydown", (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { ev.preventDefault(); redo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); save(); return; }
    if (typing) return;
    const e = selected();
    if (ev.key === "Escape") { S.sel = null; drawSelection(); drawSide(); return; }
    if (!e || e.locked || !canEdit) return;
    const step = ev.shiftKey ? 5 : 0.5;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (mv) { ev.preventDefault(); commit(() => { e.x = r1(e.x + mv[0]); e.y = r1(e.y + mv[1]); }); }
    if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); remove(e); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "d") { ev.preventDefault(); duplicate(e); }
  });

  // ----- Element operations -----
  function add(type, extra = {}) {
    const { w: W, h: H } = dims();
    const size = { text: [120, 12], image: [50, 40], logo: [30, 24], qr: [28, 28], table: [W - 40, 80], line: [80, 0.6], rect: [80, 40], signature: [50, 28] }[type];
    const e = { id: uid(), type, x: r1((W - size[0]) / 2), y: r1((H - size[1]) / 2), w: size[0], h: size[1], rot: 0, locked: false, hidden: false, style: {}, ...extra };
    e.x = r1((W - e.w) / 2);
    const free = freeY(e);
    if (free !== null) e.y = free;
    else toast("لا توجد مساحة فارغة كافية؛ وُضع في الوسط. اسحبه أو صغّر جزءًا آخر.");
    if (type === "text") { e.text = e.text || "نص جديد"; e.style = { font: "plex", size: 14, color: "#1A2233", align: "center", lh: 1.5, fit: true, ...(extra.style || {}) }; }
    if (type === "line") e.style = { color: "#16244A", dash: "solid" };
    if (type === "rect") e.style = { bg: "transparent", bc: "#16244A", bw: 0.6, br: 2 };
    if (type === "table") e.style = { size: 10, headBg: "#E8ECF4", headColor: "#16244A", line: "#C9D1DE", score: true, max: true, percent: true, grade: true, total: true };
    if (type === "signature") e.style = { font: "plex", size: 11, color: "#1A2233" };
    commit(() => { els().push(e); S.sel = e.id; });
  }
  // The empty band nearest the page centre where a new element fits without covering others.
  function freeY(e) {
    const { h: H } = dims();
    const taken = els().filter((x) => !x.hidden && x.type !== "rect" && x.x < e.x + e.w && x.x + x.w > e.x).map((x) => [x.y - 1, x.y + x.h + 1]);
    let best = null;
    for (let y = 12; y + e.h <= H - 12; y += 0.5) {
      if (taken.some(([a, b]) => y < b && y + e.h > a)) continue;
      if (best === null || Math.abs(y + e.h / 2 - H / 2) < Math.abs(best + e.h / 2 - H / 2)) best = y;
    }
    return best === null ? null : r1(best);
  }
  async function addImage() {
    const a = await pickAsset(base, { canEdit, title: "اختر صورة أو ارفع جديدة" });
    if (!a) return;
    const ratio = a.width && a.height ? a.height / a.width : 0.75;
    const w = Math.min(80, dims().w - 20);
    add("image", { asset: a.id, w, h: r1(w * ratio), style: { fitImg: "contain" } });
  }
  function remove(e) { commit(() => { S.layout.els = els().filter((x) => x.id !== e.id); S.sel = null; }); }
  function duplicate(e) { commit(() => { const c = { ...clone(e), id: uid(), x: r1(e.x + 4), y: r1(e.y + 4), locked: false }; els().splice(els().indexOf(e) + 1, 0, c); S.sel = c.id; }); }
  function order(e, dir) {
    commit(() => {
      const list = els(), i = list.indexOf(e);
      list.splice(i, 1);
      const to = dir === "top" ? list.length : dir === "bottom" ? 0 : Math.max(0, Math.min(list.length, i + (dir === "up" ? 1 : -1)));
      list.splice(to, 0, e);
    });
  }

  // ----- Side panel -----
  const num = (label, get, set, { min = -50, max = 420, step = 0.5, unit = "مم" } = {}) => {
    const el = input({ type: "number", value: get(), min, max, step, class: "ltr", inputMode: "decimal" });
    el.addEventListener("change", () => { const v = Number(el.value); if (Number.isFinite(v)) commit(() => set(Math.min(max, Math.max(min, v)))); });
    return h("label", { class: "cd-num" }, h("span", {}, label), el, unit ? h("i", {}, unit) : null);
  };
  const colorIn = (label, get, set, { allowNone = false } = {}) => {
    const v = get();
    const el = h("input", { type: "color", value: v && v !== "transparent" ? v : "#FFFFFF" });
    el.addEventListener("change", () => commit(() => set(el.value.toUpperCase())));
    return h("label", { class: "cd-color" }, h("span", {}, label), el,
      allowNone ? h("button", { type: "button", class: `cd-none${!v || v === "transparent" ? " on" : ""}`, onclick: () => commit(() => set("transparent")) }, "بلا") : null);
  };
  const check = (label, get, set) => {
    const el = h("input", { type: "checkbox", checked: Boolean(get()) });
    el.addEventListener("change", () => commit(() => set(el.checked)));
    return h("label", { class: "cd-check" }, el, label);
  };
  const seg = (options, get, set) => h("div", { class: "cd-seg" }, options.map(([v, l, t]) => h("button", { type: "button", class: get() === v ? "on" : "", title: t || l,
    onclick: () => commit(() => set(v)) }, l)));
  const sel = (label, options, get, set) => {
    const el = select(options, { value: get() });
    el.addEventListener("change", () => commit(() => set(el.value)));
    return h("label", { class: "cd-sel" }, h("span", {}, label), el);
  };
  const group = (title, ...kids) => h("div", { class: "cd-group" }, h("h4", {}, title), ...kids);
  let geo = null;
  function updateGeometryInputs() {
    const e = selected();
    if (!geo || !e) return;
    for (const k of ["x", "y", "w", "h"]) { const inp = geo.querySelector(`[data-k="${k}"] input`); if (inp && document.activeElement !== inp) inp.value = e[k]; }
  }

  // Precise settings, folded away under the simple controls.
  function advancedPanel(e) {
    const st = e.style || (e.style = {});
    const { w: W, h: H } = dims();
    geo = group("الموضع والحجم",
      h("div", { class: "cd-grid4" },
        h("div", { "data-k": "x" }, num("أفقي", () => e.x, (v) => { e.x = v; })), h("div", { "data-k": "y" }, num("رأسي", () => e.y, (v) => { e.y = v; })),
        h("div", { "data-k": "w" }, num("العرض", () => e.w, (v) => { e.w = Math.max(0.2, v); }, { min: 0.2 })), h("div", { "data-k": "h" }, num("الارتفاع", () => e.h, (v) => { e.h = Math.max(0.2, v); }, { min: 0.2 }))),
      h("div", { class: "cd-row" },
        num("الدوران", () => e.rot || 0, (v) => { e.rot = v; }, { min: -180, max: 180, step: 1, unit: "°" }),
        num("الشفافية", () => Math.round((st.op ?? 1) * 100), (v) => { st.op = v / 100; }, { min: 0, max: 100, step: 5, unit: "%" })),
      h("div", { class: "cd-tools" },
        btn("توسيط أفقي", () => commit(() => { e.x = r1((W - e.w) / 2); }), "ghost sm"),
        btn("توسيط رأسي", () => commit(() => { e.y = r1((H - e.h) / 2); }), "ghost sm"),
        btn("بعرض الصفحة", () => commit(() => { e.x = 15; e.w = W - 30; }), "ghost sm")));
    const kids = [sub("الأسهم في لوحة المفاتيح تحرّك الجزء نصف ملم، ومع Shift خمسة ملم.")];
    if (e.type === "text") {
      kids.push(group("الخط",
          h("div", { class: "cd-row" }, sel("نوع الخط", Object.entries(FONT_LABELS), () => st.font || "plex", (v) => { st.font = v; }),
            num("الحجم", () => st.size || 12, (v) => { st.size = v; }, { min: 4, max: 120, step: 1, unit: "pt" })),
          h("div", { class: "cd-row" }, seg([[true, "B", "عريض"]], () => Boolean(st.bold), () => { st.bold = !st.bold; }),
            seg([[true, "I", "مائل"]], () => Boolean(st.italic), () => { st.italic = !st.italic; }), colorIn("اللون", () => st.color, (v) => { st.color = v; })),
          seg([["right", "يمين"], ["center", "وسط"], ["left", "يسار"], ["justify", "ضبط"]], () => st.align || "center", (v) => { st.align = v; }),
          seg([["top", "أعلى"], ["middle", "منتصف"], ["bottom", "أسفل"]], () => st.valign || "middle", (v) => { st.valign = v; }),
          h("div", { class: "cd-row" }, num("تباعد الأسطر", () => st.lh || 1.5, (v) => { st.lh = v; }, { min: 0.8, max: 3, step: 0.1, unit: "" }),
            num("تباعد الحروف", () => st.ls || 0, (v) => { st.ls = v; }, { min: -2, max: 10, step: 0.5, unit: "pt" })),
          check("تصغير تلقائي إذا طال النص (للأسماء الطويلة)", () => st.fit, (v) => { st.fit = v; }),
          colorIn("خلفية الصندوق", () => st.bg, (v) => { st.bg = v; }, { allowNone: true })));
    }
    if (e.type === "image") {
      kids.push(group("الصورة", btn("تغيير الصورة", async () => { const a = await pickAsset(base, { canEdit }); if (a) commit(() => { e.asset = a.id; }); }, "ghost sm"),
        seg([["contain", "احتواء"], ["cover", "ملء وقص"], ["fill", "تمديد"]], () => st.fitImg || "contain", (v) => { st.fitImg = v; }),
        num("استدارة الحواف", () => st.br || 0, (v) => { st.br = v; }, { min: 0, max: 100 })));
    }
    if (e.type === "table") {
      kids.push(group("جدول الدرجات",
        check("الدرجة", () => st.score !== false, (v) => { st.score = v; }), check("الدرجة الكاملة", () => st.max !== false, (v) => { st.max = v; }),
        check("النسبة", () => st.percent !== false, (v) => { st.percent = v; }), check("التقدير", () => st.grade !== false, (v) => { st.grade = v; }),
        check("سطر المجموع", () => st.total !== false, (v) => { st.total = v; }), check("تظليل الأسطر بالتناوب", () => st.zebra, (v) => { st.zebra = v; }),
        h("div", { class: "cd-row" }, num("حجم الخط", () => st.size || 10, (v) => { st.size = v; }, { min: 6, max: 20, step: 0.5, unit: "pt" }),
          sel("الخط", Object.entries(FONT_LABELS), () => st.font || "plex", (v) => { st.font = v; })),
        h("div", { class: "cd-row" }, colorIn("رأس الجدول", () => st.headBg, (v) => { st.headBg = v; }), colorIn("نص الرأس", () => st.headColor, (v) => { st.headColor = v; })),
        h("div", { class: "cd-row" }, colorIn("الخطوط", () => st.line, (v) => { st.line = v; }), colorIn("النص", () => st.color, (v) => { st.color = v; }))));
    }
    if (e.type === "line") {
      kids.push(group("الخط", colorIn("اللون", () => st.color, (v) => { st.color = v; }),
        seg([["solid", "متصل"], ["dashed", "متقطع"], ["dotted", "منقط"], ["double", "مزدوج"]], () => st.dash || "solid", (v) => { st.dash = v; }),
        num("السماكة", () => e.h, (v) => { e.h = Math.max(0.2, v); }, { min: 0.2, max: 10, step: 0.1 })));
    }
    if (e.type === "rect") {
      kids.push(group("المستطيل", h("div", { class: "cd-row" }, colorIn("التعبئة", () => st.bg, (v) => { st.bg = v; }, { allowNone: true }), colorIn("الحد", () => st.bc, (v) => { st.bc = v; })),
        h("div", { class: "cd-row" }, num("سماكة الحد", () => st.bw ?? 0, (v) => { st.bw = v; }, { min: 0, max: 10, step: 0.1 }), num("استدارة", () => st.br || 0, (v) => { st.br = v; }, { min: 0, max: 100 })),
        seg([["solid", "متصل"], ["dashed", "متقطع"], ["dotted", "منقط"], ["double", "مزدوج"]], () => st.dash || "solid", (v) => { st.dash = v; })));
    }
    if (e.type === "signature") {
      kids.push(group("التوقيع", sub("يعرض صفة الموقّع واسمه من «إعدادات الشهادات». أضف صورة التوقيع أو الختم من «صورة» وضعها فوقه."),
        h("div", { class: "cd-row" }, sel("الخط", Object.entries(FONT_LABELS), () => st.font || "plex", (v) => { st.font = v; }),
          num("الحجم", () => st.size || 11, (v) => { st.size = v; }, { min: 6, max: 30, step: 0.5, unit: "pt" })),
        colorIn("اللون", () => st.color, (v) => { st.color = v; })));
    }
    if (["logo", "qr"].includes(e.type)) kids.push(sub(e.type === "logo" ? "يُستخدم شعار المؤسسة من «هوية المدرسة». لشعار آخر استخدم «صورة»." : "رمز التحقق الخاص بكل شهادة. يمسحه أي شخص ليتأكد من صحتها."));
    kids.push(geo, group("ترتيب وإجراءات",
      h("div", { class: "cd-tools" },
        btn("للأمام", () => order(e, "up"), "ghost sm"), btn("للخلف", () => order(e, "down"), "ghost sm"),
        btn("للأعلى", () => order(e, "top"), "ghost sm"), btn("للأسفل", () => order(e, "bottom"), "ghost sm")),
      h("div", { class: "cd-tools" },
        btn(e.locked ? "فك القفل" : "قفل", () => commit(() => { e.locked = !e.locked; }), "ghost sm"),
        btn(e.hidden ? "إظهار" : "إخفاء", () => commit(() => { e.hidden = !e.hidden; }), "ghost sm"),
        btn("نسخ", () => duplicate(e), "ghost sm"), btn("حذف", () => remove(e), "ghost sm danger"))));
    return h("div", {}, kids);
  }

  // ----- Friendly names and colours -----
  const FIELD_LABEL = Object.fromEntries(FIELDS);
  function labelOf(e) {
    if (e.type !== "text") return TYPE_LABEL[e.type];
    const t = String(e.text || "");
    const tokens = [...t.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    const plain = t.replace(/\{\{\w+\}\}/g, "").replace(/[\s:—–\-،.]+/g, " ").trim();
    if (tokens.length && plain.length <= 3) return FIELD_LABEL[tokens[0]] || "بيانات";
    const shown = t.replace(/\{\{(\w+)\}\}/g, (_, k) => `«${FIELD_LABEL[k] || k}»`).replace(/\s+/g, " ").trim();
    return shown.length > 36 ? `${shown.slice(0, 35)}…` : shown || "نص";
  }
  const HINT = { logo: "من هوية المدرسة", qr: "يمسحه أي شخص للتحقق", table: "درجات المواد", signature: "صفة الموقّع واسمه", image: "صورة أو ختم", line: "خط زخرفي", rect: "شكل أو شريط ملوّن" };
  const hintOf = (e) => (e.type === "text" ? (/\{\{\w+\}\}/.test(e.text || "") ? "يتعبأ تلقائيًا لكل طالب" : "نص ثابت") : HINT[e.type]);
  const COLOR_KEYS = ["color", "bg", "bc", "headBg", "headColor", "line"];
  function designColors() {
    const n = new Map();
    const count = (c) => { if (c && c !== "transparent") { const k = c.toUpperCase(); n.set(k, (n.get(k) || 0) + 1); } };
    const b = S.layout.page.border;
    if (b.style !== "none") { count(b.color); count(b.accent); }
    for (const e of els()) for (const k of COLOR_KEYS) count(e.style?.[k]);
    n.delete("#FFFFFF");
    return [...n.entries()].sort((a, b2) => b2[1] - a[1]).map(([c]) => c).slice(0, 10);
  }
  // Recolours every place a set of colours is used (elements and frame) in one pass.
  function recolor(map) {
    const swap = (c) => (c && map.has(c.toUpperCase()) ? map.get(c.toUpperCase()) : c);
    for (const e of els()) for (const k of COLOR_KEYS) if (e.style?.[k]) e.style[k] = swap(e.style[k]);
    const b = S.layout.page.border;
    b.color = swap(b.color); b.accent = swap(b.accent);
  }
  function applyPalette(main, accent) {
    const used = designColors();
    const strong = used.filter((c) => { const [s, l] = sl(c); return s >= 0.18 && l > 0.17 && l < 0.82; }).slice(0, 2).sort((a, b2) => sl(a)[1] - sl(b2)[1]);
    const map = new Map();
    if (strong[0]) map.set(strong[0], main);
    if (strong[1]) map.set(strong[1], accent);
    for (const c of used) { const [s, l] = sl(c); if (!map.has(c) && s >= 0.18 && l > 0.17 && l < 0.82) map.set(c, main); }
    for (const c of used) { const [s, l] = sl(c); if (s >= 0.08 && l >= 0.82 && !map.has(c)) map.set(c, mix(main, "#FFFFFF", 0.88)); }
    recolor(map);
    const b = S.layout.page.border;
    if (!strong.length) { b.color = main; b.accent = accent; }
  }
  function textSize(e, dir) {
    const st = e.style || (e.style = {});
    if (e.type === "text" || e.type === "signature") {
      const os = st.size || (e.type === "text" ? 12 : 11);
      const ns = Math.min(120, Math.max(4, os + dir * Math.max(1, Math.round(os * 0.08))));
      if (e.type === "text") { const nh = r1(Math.min(400, Math.max(3, e.h * ns / os))); e.y = r1(e.y - (nh - e.h) / 2); e.h = nh; }
      st.size = ns;
      return;
    }
    if (e.type === "table") { st.size = Math.min(20, Math.max(6, (st.size || 10) + dir * 0.5)); return; }
    const f = dir > 0 ? 1.1 : 1 / 1.1;
    const nw = r1(Math.min(400, Math.max(1, e.w * f))), nh = e.type === "line" ? e.h : r1(Math.min(400, Math.max(1, e.h * f)));
    e.x = r1(e.x - (nw - e.w) / 2); e.y = r1(e.y - (nh - e.h) / 2); e.w = nw; e.h = nh;
  }
  const centerX = (e) => { e.x = r1((dims().w - e.w) / 2); };
  function selectEl(id) { S.sel = id; drawSelection(); drawSide(); }

  // ----- Simple controls -----
  const toggle = (on, set, label) => {
    const i = h("input", { type: "checkbox", role: "switch", checked: on, "aria-label": label });
    i.addEventListener("change", () => set(i.checked));
    return h("label", { class: "cd-sw", title: on ? "ظاهر — اضغط للإخفاء" : "مخفي — اضغط للإظهار" }, i, h("span", {}));
  };
  const swatches = (label, get, set, { none = false } = {}) => {
    const cur = (get() || "").toUpperCase();
    const list = [...new Set([...designColors(), "#1A2233", "#5F6B7A", "#FFFFFF"])].slice(0, 9);
    const custom = h("input", { type: "color", value: cur && cur !== "TRANSPARENT" ? cur : "#16244A", title: "لون آخر" });
    custom.addEventListener("change", () => commit(() => set(custom.value.toUpperCase())));
    return h("div", { class: "cd-sws" }, h("span", {}, label),
      h("div", { class: "cd-sws-r" },
        none ? h("button", { type: "button", class: `cd-swc cd-swc-none${!cur || cur === "TRANSPARENT" ? " on" : ""}`, title: "بلا لون", onclick: () => commit(() => set("transparent")) }) : null,
        list.map((c) => h("button", { type: "button", class: `cd-swc${c === cur ? " on" : ""}`, style: `background:${c}`, title: c, onclick: () => commit(() => set(c)) })),
        h("label", { class: "cd-swc cd-swc-more", title: "لون آخر" }, custom)));
  };
  const sizeRow = (e, label = "الحجم") => h("div", { class: "cd-size" }, h("span", {}, label),
    h("button", { type: "button", class: "btn ghost sm", onclick: () => commit(() => textSize(e, -1)) }, "أصغر"),
    e.type === "text" || e.type === "signature" || e.type === "table" ? h("b", { class: "ltr" }, String(e.style?.size || (e.type === "table" ? 10 : e.type === "signature" ? 11 : 12))) : null,
    h("button", { type: "button", class: "btn ghost sm", onclick: () => commit(() => textSize(e, 1)) }, "أكبر"));

  function textEditor(e) {
    const ta = h("textarea", { rows: 3, value: e.text || "", class: "cd-text", dir: "rtl", "aria-label": "النص" });
    let timer;
    ta.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { snapshot(); e.text = ta.value.slice(0, 2000); dirty(); draw(); side.querySelector(".cd-text")?.focus(); }, 400); });
    const fieldSel = select([["", "+ أدرج بيانات الطالب أو الشهادة…"], ...FIELDS.map(([k, l]) => [k, l])], { "aria-label": "إدراج بيانات" });
    fieldSel.addEventListener("change", () => {
      if (!fieldSel.value) return;
      const at = ta.selectionStart ?? ta.value.length;
      const token = `{{${fieldSel.value}}}`;
      commit(() => { e.text = (ta.value.slice(0, at) + token + ta.value.slice(at)).slice(0, 2000); });
    });
    return group("النص", ta, fieldSel, sub("ما بين {{ }} يُستبدل تلقائيًا ببيانات كل طالب. اكتب أي عبارة كما تريد."));
  }

  function elementCard(e) {
    const st = e.style || (e.style = {});
    const kids = [
      h("button", { type: "button", class: "cd-back", onclick: () => selectEl(null) }, "→ كل الأجزاء"),
      h("div", { class: "cd-title" }, h("b", {}, labelOf(e)),
        h("span", { class: "cd-vis" }, h("small", {}, e.hidden ? "مخفي" : "ظاهر"), toggle(!e.hidden, (v) => commit(() => { e.hidden = !v; }), "إظهار في الشهادة"))),
    ];
    if (e.type === "text") {
      kids.push(textEditor(e), group("الشكل", sizeRow(e, "حجم الخط"),
        seg([["right", "يمين"], ["center", "وسط"], ["left", "يسار"]], () => st.align || "center", (v) => { st.align = v; }),
        h("div", { class: "cd-row" }, seg([[true, "عريض"]], () => Boolean(st.bold), () => { st.bold = !st.bold; }),
          sel("الخط", Object.entries(FONT_LABELS), () => st.font || "plex", (v) => { st.font = v; })),
        swatches("لون النص", () => st.color || "#1A2233", (v) => { st.color = v; })));
    }
    if (e.type === "image") {
      const op = h("input", { type: "range", min: 10, max: 100, step: 5, value: Math.round((st.op ?? 1) * 100), "aria-label": "الوضوح" });
      op.addEventListener("change", () => commit(() => { st.op = Number(op.value) / 100; }));
      kids.push(group("الصورة", btn("تغيير الصورة", async () => { const a = await pickAsset(base, { canEdit }); if (a) commit(() => { e.asset = a.id; }); }, "ghost sm"),
        sizeRow(e), h("label", { class: "cd-range" }, h("span", {}, "الوضوح (خفّفه للأختام والعلامات المائية)"), op)));
    }
    if (e.type === "table") {
      kids.push(group("أعمدة الجدول",
        check("الدرجة", () => st.score !== false, (v) => { st.score = v; }), check("الدرجة الكاملة", () => st.max !== false, (v) => { st.max = v; }),
        check("النسبة", () => st.percent !== false, (v) => { st.percent = v; }), check("التقدير", () => st.grade !== false, (v) => { st.grade = v; }),
        check("سطر المجموع", () => st.total !== false, (v) => { st.total = v; })),
      group("الشكل", sizeRow(e, "حجم الخط"), swatches("لون رأس الجدول", () => st.headBg || "#E8ECF4", (v) => { st.headBg = v; }),
        swatches("لون كتابة الرأس", () => st.headColor || "#16244A", (v) => { st.headColor = v; })));
    }
    if (e.type === "signature") kids.push(group("التوقيع", sub("يكتب صفة الموقّع واسمه كما في «إعدادات الشهادات». لإضافة صورة التوقيع أو الختم: «إضافة» ← «صورة أو ختم»."), sizeRow(e, "حجم الخط"),
      swatches("اللون", () => st.color || "#1A2233", (v) => { st.color = v; })));
    if (e.type === "logo") kids.push(group("الشعار", sub("يظهر شعار المؤسسة من «هوية المدرسة» تلقائيًا."), sizeRow(e)));
    if (e.type === "qr") kids.push(group("رمز التحقق", sub("خاص بكل شهادة. من يمسحه يرى أن الشهادة صحيحة وصادرة منكم."), sizeRow(e)));
    if (e.type === "line") kids.push(group("الخط", sizeRow(e, "الطول"), swatches("اللون", () => st.color || "#16244A", (v) => { st.color = v; })));
    if (e.type === "rect") kids.push(group("الشكل", sizeRow(e), swatches("التعبئة", () => st.bg, (v) => { st.bg = v; }, { none: true }),
      swatches("الحد", () => st.bc || "#16244A", (v) => { st.bc = v; })));
    kids.push(h("div", { class: "cd-tools cd-acts" },
      btn("توسيط في الصفحة", () => commit(() => centerX(e)), "ghost sm"),
      btn("نسخة منه", () => duplicate(e), "ghost sm"),
      btn("حذف", () => remove(e), "ghost sm danger")));
    const det = h("details", { class: "cd-adv", open: S.adv, ontoggle: () => { S.adv = det.open; } },
      h("summary", {}, "تحكم دقيق (الموضع بالملم، الدوران، الطبقات، القفل…)"), advancedPanel(e));
    kids.push(det);
    return h("div", {}, kids);
  }

  function partsPanel() {
    const list = [...els()].sort((a, b) => a.y - b.y || b.x - a.x);
    const shown = list.filter((e) => !e.hidden).length;
    const fieldsIn = h("input", { type: "checkbox", checked: S.fields });
    fieldsIn.addEventListener("change", () => { S.fields = fieldsIn.checked; draw(); });
    return h("div", {},
      h("p", { class: "cd-lead" }, "هذه كل أجزاء الشهادة من الأعلى للأسفل. ", h("b", {}, "أطفئ المفتاح"), " لإخفاء أي جزء، و", h("b", {}, "اضغط على الاسم"), " لتعديله. ويمكنك سحب أي جزء في الشهادة لتحريكه."),
      h("div", { class: "cd-parts" }, list.length ? list.map((e) => h("div", { class: `cd-part${e.hidden ? " off" : ""}` },
        h("button", { type: "button", class: "cd-part-n", onclick: () => selectEl(e.id) }, h("b", {}, labelOf(e)), h("small", {}, e.hidden ? "مخفي — لا يظهر في الشهادة" : hintOf(e))),
        toggle(!e.hidden, (v) => commit(() => { e.hidden = !v; }), `إظهار ${labelOf(e)}`))) : empty("الشهادة فارغة. أضف أجزاء من «إضافة».")),
      h("div", { class: "cd-tools cd-acts" }, h("small", { class: "cd-count" }, `يظهر ${shown} من ${list.length}`),
        canEdit && shown < list.length ? btn("إظهار الكل", () => commit(() => els().forEach((x) => { x.hidden = false; })), "ghost sm") : null,
        canEdit ? btn("+ إضافة جزء", () => { S.tab = "add"; drawSide(); }, "ghost sm") : null),
      h("label", { class: "cd-check cd-keep" }, fieldsIn, "اعرض أسماء البيانات بدل المثال"));
  }

  const PALETTES = [["كحلي وذهبي", "#16244A", "#B08D3C"], ["زمردي", "#0B7A75", "#16244A"], ["عنابي", "#7A1F2B", "#B08D3C"], ["أخضر", "#1F6B3A", "#B08D3C"],
    ["أزرق", "#1D4E89", "#4FA3D9"], ["رمادي فاخر", "#2E3440", "#8C7853"], ["بنفسجي", "#4B2C6F", "#C9A646"], ["بني وذهبي", "#5A3A22", "#C9A646"]];
  function lookPanel() {
    const p = S.layout.page;
    const { w: W, h: H } = dims();
    const texts = els().filter((e) => e.type === "text");
    const heads = texts.filter((e) => (e.style?.size || 12) >= 20);
    const body = els().filter((e) => (e.type === "text" && (e.style?.size || 12) < 20) || e.type === "table" || e.type === "signature");
    const common = (list) => { const n = {}; for (const e of list) { const f = e.style?.font || "plex"; n[f] = (n[f] || 0) + 1; } return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || "plex"; };
    const frameTile = ([k, l]) => {
      const pg = renderPage({ v: 1, page: { ...p, bgAsset: null, border: { ...p.border, style: k } }, els: [] }, {});
      pg.style.transform = `scale(${58 / (W * PX)})`;
      return h("button", { type: "button", class: `cd-frame${p.border.style === k ? " on" : ""}`, onclick: () => commit(() => { p.border.style = k; }) },
        h("div", { class: "cd-frame-v", style: `aspect-ratio:${W}/${H}` }, pg), h("small", {}, l));
    };
    const colors = designColors();
    const bgOp = h("input", { type: "range", min: 5, max: 100, step: 5, value: Math.round((p.bgOp ?? 1) * 100), "aria-label": "وضوح الخلفية" });
    bgOp.addEventListener("change", () => commit(() => { p.bgOp = Number(bgOp.value) / 100; }));
    return h("div", {},
      group("ألوان جاهزة", sub("اختر مجموعة ألوان فتتلوّن الشهادة كلها بها."),
        h("div", { class: "cd-pal" }, PALETTES.map(([name, a, b]) => h("button", { type: "button", class: "cd-pal-b", onclick: () => commit(() => applyPalette(a, b)) },
          h("span", {}, h("i", { style: `background:${a}` }), h("i", { style: `background:${b}` })), h("small", {}, name))))),
      colors.length ? group("ألوان هذا التصميم", sub("اضغط على أي لون وغيّره، فيتغيّر في كل مكان يظهر فيه."),
        h("div", { class: "cd-cols" }, colors.map((c) => {
          const inp = h("input", { type: "color", value: c, "aria-label": `تغيير اللون ${c}` });
          inp.addEventListener("change", () => commit(() => recolor(new Map([[c, inp.value.toUpperCase()]]))));
          return h("label", { class: "cd-col", style: `background:${c}`, title: c }, inp);
        }))) : null,
      group("الخطوط",
        heads.length ? sel("خط العناوين والاسم", Object.entries(FONT_LABELS), () => common(heads), (v) => { for (const e of heads) e.style.font = v; }) : null,
        sel("خط باقي النصوص", Object.entries(FONT_LABELS), () => common(body), (v) => { for (const e of body) e.style.font = v; })),
      group("الإطار", h("div", { class: "cd-frames" }, Object.entries(BORDERS).map(frameTile)),
        p.border.style !== "none" ? h("div", { class: "cd-row" }, colorIn("لون الإطار", () => p.border.color, (v) => { p.border.color = v; }), colorIn("اللون الثاني", () => p.border.accent, (v) => { p.border.accent = v; })) : null),
      group("الورقة",
        seg([["portrait", "طولية"], ["landscape", "عرضية"]], () => p.orientation, (v) => {
          if (v === p.orientation) return;
          const from = PAGE[p.orientation], to = PAGE[v];
          for (const e of els()) { e.x = r1(e.x * to.w / from.w); e.y = r1(e.y * to.h / from.h); e.w = r1(Math.min(e.w, to.w)); }
          p.orientation = v;
        }),
        colorIn("لون الورقة", () => p.bg, (v) => { p.bg = v; }),
        h("div", { class: "cd-tools" },
          btn(p.bgAsset ? "تغيير صورة الخلفية" : "+ صورة خلفية (ورق رسمي أو زخرفة)", async () => { const a = await pickAsset(base, { canEdit, title: "صورة الخلفية" }); if (a) commit(() => { p.bgAsset = a.id; }); }, "ghost sm"),
          p.bgAsset ? btn("إزالة الخلفية", () => commit(() => { p.bgAsset = null; }), "ghost sm") : null),
        p.bgAsset ? h("label", { class: "cd-range" }, h("span", {}, "وضوح الخلفية"), bgOp) : null),
      group("يُستخدم هذا التصميم لـ", kindSel),
      h("details", { class: "cd-adv", open: S.adv, ontoggle: (ev) => { S.adv = ev.target.open; } }, h("summary", {}, "تحكم دقيق في الإطار والخلفية"),
        p.border.style !== "none" ? h("div", { class: "cd-row" }, num("سماكة الإطار", () => p.border.width, (v) => { p.border.width = v; }, { min: 0.2, max: 6, step: 0.1 }),
          num("بعده عن الحافة", () => p.border.inset, (v) => { p.border.inset = v; }, { min: 0, max: 30, step: 0.5 })) : null,
        p.bgAsset ? seg([["cover", "ملء الصفحة"], ["contain", "احتواء"], ["fill", "تمديد"]], () => p.bgFit || "cover", (v) => { p.bgFit = v; }) : null));
  }

  const ALL = ["term", "year", "custom", "course", "attendance", "any"];
  const QUICK = [
    ["rank", "الترتيب على الصف", "الترتيب على الصف: {{rank}}", ["term", "year", "any"]],
    ["attendance", "نسبة الحضور والغياب", "نسبة الحضور {{attendance}} — أيام الغياب {{absent}}", ALL],
    ["grade", "التقدير العام", "التقدير العام: {{grade}}", ["term", "year", "any"]],
    ["total", "المجموع والنسبة", "المجموع {{total}} من {{max}} — النسبة {{percent}}", ["term", "year", "any"]],
    ["class_name", "الصف والشعبة", "{{class_name}}", ALL],
    ["hours", "عدد الساعات", "عدد الساعات التدريبية: {{hours}}", ["course", "attendance", "any"]],
    ["completed_on", "تاريخ الإكمال", "تاريخ الإكمال {{completed_on}}", ["course", "attendance", "any"]],
    ["body", "نص الشهادة المخصصة", "{{body}}", ["custom", "any"]],
    ["serial", "رقم الشهادة وتاريخها", "رقم الشهادة {{serial}}\nتاريخ الإصدار {{issued_at}}", ALL],
    ["approval_note", "عبارة الاعتماد الداخلي", "{{approval_note}}", ALL],
    ["footer_note", "ملاحظة أسفل الشهادة", "{{footer_note}}", ALL],
    ["verify_url", "رابط التحقق مكتوبًا", "للتحقق من الشهادة: {{verify_url}}", ALL],
  ];
  const OBJECTS = [["logo", "شعار المؤسسة", ALL], ["qr", "رمز التحقق QR", ALL], ["table", "جدول الدرجات", ["term", "year", "any"]], ["signature", "التوقيع", ALL]];
  function addPanel() {
    const findText = (k) => els().find((e) => e.type === "text" && String(e.text || "").includes(`{{${k}}}`));
    const ready = [];
    for (const [k, label, text, kinds] of QUICK) {
      if (!kinds.includes(S.kind)) continue;
      const e = findText(k);
      if (!e) ready.push(["+", label, () => add("text", { text, w: 150, h: text.includes("\n") ? 14 : 9, style: { size: 12, color: "#1A2233" } })]);
      else if (e.hidden) ready.push(["إظهار", label, () => commit(() => { e.hidden = false; S.sel = e.id; })]);
    }
    for (const [type, label, kinds] of OBJECTS) {
      if (!kinds.includes(S.kind)) continue;
      const e = els().find((x) => x.type === type);
      if (!e) ready.push(["+", label, () => add(type)]);
      else if (e.hidden) ready.push(["إظهار", label, () => commit(() => { e.hidden = false; S.sel = e.id; })]);
    }
    const tile = ([mark, label, fn]) => h("button", { type: "button", class: "cd-add-b", disabled: !canEdit, onclick: fn }, h("i", {}, mark), label);
    return h("div", {},
      group("أجزاء جاهزة لهذه الشهادة", ready.length ? h("div", { class: "cd-add" }, ready.map(tile)) : sub("كل الأجزاء الجاهزة موجودة في الشهادة.")),
      group("أضف بنفسك", h("div", { class: "cd-add" }, [
        ["+", "نص تكتبه", () => add("text")], ["+", "صورة أو ختم أو توقيع", () => addImage()], ["+", "بيانات أخرى", () => fieldDialog()],
        ["+", "خط فاصل", () => add("line")], ["+", "مستطيل أو شريط", () => add("rect")],
      ].map(tile))),
      sub("يظهر الجزء الجديد في وسط الشهادة ومحددًا؛ اسحبه إلى مكانه."));
  }

  function drawStageBar() {
    const e = selected();
    if (!e) {
      mount(stageBar, h("span", { class: "cd-tip" }, canEdit ? "اضغط على أي جزء في الشهادة لتعديله، واسحبه لتحريكه." : "عرض فقط — لا تملك صلاحية تعديل التصاميم."));
      return;
    }
    const b = (label, fn, cls = "") => h("button", { type: "button", class: `cd-sb ${cls}`, disabled: !canEdit || (e.locked && cls !== "keep"), onclick: fn }, label);
    mount(stageBar, h("b", { class: "cd-sb-n" }, labelOf(e)),
      b(e.hidden ? "إظهار" : "إخفاء", () => commit(() => { e.hidden = !e.hidden; }), "keep"),
      b("أصغر", () => commit(() => textSize(e, -1))), b("أكبر", () => commit(() => textSize(e, 1))),
      b("توسيط", () => commit(() => centerX(e))), b("نسخة", () => duplicate(e)), b("حذف", () => remove(e), "danger"),
      h("button", { type: "button", class: "cd-sb cd-sb-x", title: "إلغاء التحديد", onclick: () => selectEl(null) }, "تم"));
  }

  function fieldDialog() {
    const grid = h("div", { class: "cd-fields" }, FIELDS.map(([k, l]) => h("button", { type: "button", onclick: () => { d.close(); add("text", { text: `{{${k}}}`, w: 110, h: 11 }); } }, l, h("small", { dir: "ltr" }, `{{${k}}}`))));
    const d = dialog("إضافة حقل بيانات", h("div", {}, sub("يظهر الحقل في كل شهادة ببيانات صاحبها."), grid));
  }

  function drawSide() {
    const e = selected();
    // Keep the panel where the user was when the same panel is drawn again after a change.
    const view = e ? `el:${e.id}` : S.tab, oldPanel = side.querySelector(".cd-panel");
    const keep = oldPanel && side.dataset.view === view ? oldPanel.scrollTop : 0;
    side.dataset.view = view;
    const tabs = [["parts", "الأجزاء"], ["look", "الألوان والإطار"], ["add", "إضافة"]];
    mount(side,
      h("div", { class: "cd-tabs" }, tabs.map(([k, l]) => h("button", { type: "button", class: !e && S.tab === k ? "on" : "", onclick: () => { S.tab = k; selectEl(null); } }, l))),
      h("div", { class: "cd-panel" }, e ? elementCard(e) : S.tab === "look" ? lookPanel() : S.tab === "add" ? addPanel() : partsPanel()));
    side.querySelector(".cd-panel").scrollTop = keep;
    if (!canEdit) side.querySelectorAll("input,select,textarea,button.btn").forEach((x) => { if (!x.closest(".cd-tabs,.cd-keep,.cd-back")) x.disabled = true; });
    drawStageBar();
  }

  async function save() {
    if (!canEdit) return;
    try {
      const r = await api(`${base}/designs/${S.id}`, { name: S.name.trim() || "تصميم", kind: S.kind, layout: S.layout }, "PUT");
      S.dirty = false; status.textContent = `حُفظ — نسخة ${r.version}`; status.className = "cd-status ok"; saveBtn.classList.remove("dirty");
      toast("حُفظ التصميم"); onSaved?.();
    } catch (e) { toast(e.message, true); }
  }
  async function close() {
    if (S.dirty && canEdit && !confirmAction("لديك تعديلات غير محفوظة. الخروج بدون حفظ؟")) return;
    root.remove(); document.body.classList.remove("cd-open"); window.removeEventListener("resize", onResize); onSaved?.();
  }
  const onResize = () => draw();
  window.addEventListener("resize", onResize);

  const bar = h("header", { class: "cd-bar" },
    h("button", { type: "button", class: "btn ghost sm", onclick: close }, "رجوع"),
    nameIn,
    h("div", { class: "cd-bar-g" },
      h("button", { type: "button", class: "btn ghost sm", title: "تراجع (Ctrl+Z)", onclick: undo, disabled: !canEdit }, "تراجع"),
      h("button", { type: "button", class: "btn ghost sm", title: "إعادة (Ctrl+Y)", onclick: redo, disabled: !canEdit }, "إعادة"),
      h("button", { type: "button", class: "btn ghost sm cd-zoom", title: "تصغير العرض", onclick: () => { S.zoom = Math.max(0.4, S.zoom - 0.15); draw(); } }, "−"), zoomLbl,
      h("button", { type: "button", class: "btn ghost sm cd-zoom", title: "تكبير العرض", onclick: () => { S.zoom = Math.min(3, S.zoom + 0.15); draw(); } }, "+"),
    ),
    status, canEdit ? saveBtn : null);
  mount(root, bar, h("div", { class: "cd-body" }, h("div", { class: "cd-main" }, stageBar, stage), side));
  document.body.append(root);
  document.body.classList.add("cd-open");
  stage.focus();
  requestAnimationFrame(draw);
  return root;
}

// ---------- Designs list ----------
export async function designsView({ base, onChange } = {}) {
  const box = h("div", { class: "cd-list" });
  async function load() {
    const d = await api(`${base}/designs`);
    const preview = (layout) => {
      // A frame with the page's proportions; the page inside is scaled to its width whenever that changes,
      // so a thumbnail drawn before it is on screen never stretches the list.
      const { w, h: H } = PAGE[layout.page.orientation];
      const holder = h("div", { class: "cd-thumb", style: `aspect-ratio:${w}/${H}` });
      const page = renderPage(layout, { values: valuesOf({ ...SAMPLE_CERT, data: { ...SAMPLE.data } }), data: SAMPLE.data, assetSrc: (id) => `${base}/designs/assets/${id}` });
      holder.append(page);
      const fit = () => { if (holder.clientWidth && page.offsetWidth) page.style.transform = `scale(${holder.clientWidth / page.offsetWidth})`; };
      if ("ResizeObserver" in window) new ResizeObserver(fit).observe(holder); else requestAnimationFrame(fit);
      return holder;
    };
    const create = () => {
      const name = input({ value: "تصميم جديد", maxLength: 80 });
      const kind = select(Object.entries(KINDS).filter(([k]) => k !== "any"), { value: "term" });
      let preset = "classic";
      const cards = h("div", { class: "cd-presets" });
      const paint = () => mount(cards, d.presets.map((p) => h("button", { type: "button", class: `cd-preset${p.key === preset ? " on" : ""}`, onclick: () => { preset = p.key; paint(); } },
        preview(presetLayout(p.key)), h("b", {}, p.name))));
      paint();
      const dd = dialog("تصميم شهادة جديد", h("div", {}, h("div", { class: "row" }, field("اسم التصميم", name), field("نوع الشهادة", kind)),
        h("h4", { class: "ra-sub" }, "ابدأ من تصميم جاهز"), cards), [btn("إنشاء وفتح المصمم", async () => {
        try {
          const t = await api(`${base}/designs`, { name: name.value.trim() || "تصميم جديد", kind: kind.value, from: { preset } });
          dd.close(); openDesigner({ base, template: t, canEdit: true, onSaved: () => { load(); onChange?.(); } });
        } catch (e) { toast(e.message, true); }
      })]);
      dd.classList.add("dialog-lg");
    };
    mount(box,
      h("div", { class: "row", style: "justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap" },
        sub("صمّم شهاداتك بحرية: اسحب العناصر، وأضف صورك وأختامك وتوقيعاتك، واختر الخطوط والألوان. التصميم الافتراضي لكل نوع يُطبَّق على كل الشهادات التي تصدر بعده."),
        d.can_edit ? btn("+ تصميم جديد", create) : null),
      d.templates.length ? h("div", { class: "cd-cards" }, await Promise.all(d.templates.map(async (t) => {
        const full = await api(`${base}/designs/${t.id}`);
        return h("div", { class: "cd-card" }, preview(full.layout),
          h("div", { class: "cd-card-b" }, h("b", {}, t.name), h("small", {}, `${KINDS[t.kind]} · نسخة ${t.version}`), t.is_default ? badge(`مستخدم لكل ${KINDS[t.kind]}`, "green") : null),
          h("div", { class: "cd-card-a" },
            btn(d.can_edit ? "تعديل" : "عرض", () => openDesigner({ base, template: full, canEdit: d.can_edit, onSaved: () => { load(); onChange?.(); } }), "sm"),
            d.can_edit && !t.is_default ? btn("استخدمه لكل الشهادات", async () => { await api(`${base}/designs/${t.id}/default`, {}); toast(`صار هذا التصميم لكل ${KINDS[t.kind]} تصدر من الآن`); load(); }, "ghost sm") : null,
            d.can_edit ? btn("نسخة", async () => { await api(`${base}/designs`, { name: `${t.name} (نسخة)`.slice(0, 80), kind: t.kind, from: { template: t.id } }); load(); }, "ghost sm") : null,
            d.can_edit ? btn("حذف", async () => { if (!confirmAction(`حذف التصميم «${t.name}»؟ الشهادات الصادرة به لا تتأثر.`)) return; await api(`${base}/designs/${t.id}/archive`, {}); load(); }, "ghost sm danger") : null));
      }))) : notice("لا توجد تصاميم بعد. الشهادات تصدر بالتصميم الرسمي الجاهز لكل نوع حتى تنشئ تصميمك.", ""));
  }
  await load();
  return box;
}

// A picker for issuing: the default design of the kind, or a chosen one.
export async function designPicker(base, kind) {
  const d = await api(`${base}/designs`).catch(() => ({ templates: [] }));
  const own = d.templates.filter((t) => t.kind === kind || t.kind === "any");
  const def = own.find((t) => t.is_default);
  const el = select([["", def ? `الافتراضي: ${def.name}` : "التصميم الرسمي الجاهز"], ...own.filter((t) => !t.is_default).map((t) => [t.id, t.name])]);
  return { el, value: () => (el.value ? Number(el.value) : null) };
}
