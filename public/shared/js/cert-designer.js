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
    sel: null, past: [], future: [], dirty: false, zoom: 1, fields: false, tab: "props",
  };
  const assetSrc = (id) => `${base}/designs/assets/${id}`;
  const root = h("div", { class: "cd", role: "dialog", "aria-label": "مصمم الشهادات" });
  const stage = h("div", { class: "cd-stage", tabindex: "0" });
  const pageHost = h("div", { class: "cd-pagehost" });
  stage.append(pageHost);
  const side = h("aside", { class: "cd-side" });
  const saveBtn = btn("حفظ", () => save(), "cd-save");
  const nameIn = input({ value: S.name, maxLength: 80, class: "cd-name", "aria-label": "اسم التصميم" });
  const kindSel = select(Object.entries(KINDS), { value: S.kind, class: "cd-kind", "aria-label": "نوع الشهادة" });
  const zoomLbl = h("span", { class: "cd-zoom-l" });
  const status = h("small", { class: "cd-status" });
  nameIn.addEventListener("input", () => { S.name = nameIn.value; dirty(); });
  kindSel.addEventListener("change", () => { S.kind = kindSel.value; dirty(); });
  if (!canEdit) { nameIn.disabled = true; kindSel.disabled = true; }

  const els = () => S.layout.els;
  const selected = () => els().find((e) => e.id === S.sel) || null;
  const dims = () => PAGE[S.layout.page.orientation];
  function dirty() { S.dirty = true; status.textContent = "تعديلات غير محفوظة"; status.className = "cd-status warn"; }
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
    if (t.id && t.id !== S.sel) { S.sel = t.id; S.tab = "props"; drawSelection(); drawSide(); }
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
    if (type === "text") { e.text = e.text || "نص جديد"; e.style = { font: "plex", size: 14, color: "#1A2233", align: "center", lh: 1.5, fit: true, ...(extra.style || {}) }; }
    if (type === "line") e.style = { color: "#16244A", dash: "solid" };
    if (type === "rect") e.style = { bg: "transparent", bc: "#16244A", bw: 0.6, br: 2 };
    if (type === "table") e.style = { size: 10, headBg: "#E8ECF4", headColor: "#16244A", line: "#C9D1DE", score: true, max: true, percent: true, grade: true, total: true };
    if (type === "signature") e.style = { font: "plex", size: 11, color: "#1A2233" };
    commit(() => { els().push(e); S.sel = e.id; S.tab = "props"; });
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

  function propsPanel() {
    const e = selected();
    if (!e) return h("div", { class: "cd-hint" }, h("b", {}, "اختر عنصرًا من الشهادة لتعديله"), sub("اسحب العناصر بالفأرة أو بإصبعك، وغيّر حجمها من المقابض. الأسهم تحرّك العنصر نصف ملم (ومع Shift خمسة ملم)."));
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
    const kids = [h("div", { class: "cd-title" }, h("b", {}, TYPE_LABEL[e.type]), e.locked ? badge("مقفل", "gray") : null)];
    if (e.type === "text") {
      const ta = h("textarea", { rows: 4, value: e.text || "", class: "cd-text", dir: "rtl" });
      let timer;
      ta.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { snapshot(); e.text = ta.value.slice(0, 2000); dirty(); draw(); ta.focus(); }, 350); });
      const fieldSel = select([["", "+ إدراج حقل بيانات…"], ...FIELDS.map(([k, l]) => [k, l])]);
      fieldSel.addEventListener("change", () => {
        if (!fieldSel.value) return;
        const at = ta.selectionStart ?? ta.value.length;
        const token = `{{${fieldSel.value}}}`;
        commit(() => { e.text = (ta.value.slice(0, at) + token + ta.value.slice(at)).slice(0, 2000); });
        fieldSel.value = "";
      });
      kids.push(group("النص", ta, fieldSel, sub("الحقول بين {{ }} تُملأ تلقائيًا من بيانات كل طالب عند الإصدار.")),
        group("الخط",
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

  function pagePanel() {
    const p = S.layout.page, b = p.border;
    return h("div", {},
      group("الورقة", seg([["portrait", "طولي A4"], ["landscape", "عرضي A4"]], () => p.orientation, (v) => {
        if (v === p.orientation) return;
        const from = PAGE[p.orientation], to = PAGE[v];
        for (const e of els()) { e.x = r1(e.x * to.w / from.w); e.y = r1(e.y * to.h / from.h); e.w = r1(Math.min(e.w, to.w)); }
        p.orientation = v;
      }), colorIn("لون الورقة", () => p.bg, (v) => { p.bg = v; })),
      group("صورة خلفية (ورق رسمي أو زخرفة)",
        h("div", { class: "cd-tools" },
          btn(p.bgAsset ? "تغيير الخلفية" : "اختيار خلفية", async () => { const a = await pickAsset(base, { canEdit, title: "صورة الخلفية" }); if (a) commit(() => { p.bgAsset = a.id; }); }, "ghost sm"),
          p.bgAsset ? btn("إزالة الخلفية", () => commit(() => { p.bgAsset = null; }), "ghost sm") : null),
        p.bgAsset ? seg([["cover", "ملء الصفحة"], ["contain", "احتواء"], ["fill", "تمديد"]], () => p.bgFit || "cover", (v) => { p.bgFit = v; }) : null,
        p.bgAsset ? num("شفافية الخلفية", () => Math.round((p.bgOp ?? 1) * 100), (v) => { p.bgOp = v / 100; }, { min: 5, max: 100, step: 5, unit: "%" }) : null),
      group("الإطار", sel("شكل الإطار", Object.entries(BORDERS), () => b.style, (v) => { b.style = v; }),
        h("div", { class: "cd-row" }, colorIn("اللون الأساسي", () => b.color, (v) => { b.color = v; }), colorIn("اللون الثانوي", () => b.accent, (v) => { b.accent = v; })),
        h("div", { class: "cd-row" }, num("السماكة", () => b.width, (v) => { b.width = v; }, { min: 0.2, max: 6, step: 0.1 }),
          num("البعد عن الحافة", () => b.inset, (v) => { b.inset = v; }, { min: 0, max: 30, step: 0.5 }))));
  }

  function layersPanel() {
    const list = [...els()].reverse();
    return h("div", { class: "cd-layers" }, list.length ? list.map((e) => h("div", { class: `cd-layer${e.id === S.sel ? " on" : ""}`, onclick: () => { S.sel = e.id; S.tab = "props"; drawSelection(); drawSide(); } },
      h("b", {}, TYPE_LABEL[e.type]), h("small", {}, e.type === "text" ? String(e.text || "").slice(0, 32) : ""),
      h("span", { class: "cd-layer-acts" }, e.hidden ? badge("مخفي", "gray") : null, e.locked ? badge("مقفل", "gray") : null))) : empty("لا توجد عناصر."));
  }

  const addMenu = () => h("div", { class: "cd-add" },
    [["text", "نص"], ["field", "حقل بيانات"], ["image", "صورة"], ["logo", "الشعار"], ["qr", "رمز QR"], ["table", "جدول الدرجات"], ["signature", "توقيع"], ["line", "خط"], ["rect", "مستطيل"]]
      .map(([k, l]) => h("button", { type: "button", class: "cd-add-b", disabled: !canEdit, onclick: () => {
        if (k === "image") return addImage();
        if (k === "field") return fieldDialog();
        add(k);
      } }, l)));
  function fieldDialog() {
    const grid = h("div", { class: "cd-fields" }, FIELDS.map(([k, l]) => h("button", { type: "button", onclick: () => { d.close(); add("text", { text: `{{${k}}}`, w: 110, h: 11 }); } }, l, h("small", { dir: "ltr" }, `{{${k}}}`))));
    const d = dialog("إضافة حقل بيانات", h("div", {}, sub("يظهر الحقل في كل شهادة ببيانات صاحبها."), grid));
  }

  function drawSide() {
    const tabs = [["props", "الخصائص"], ["add", "إضافة"], ["page", "الصفحة والإطار"], ["layers", "الطبقات"]];
    mount(side,
      h("div", { class: "cd-tabs" }, tabs.map(([k, l]) => h("button", { type: "button", class: S.tab === k ? "on" : "", onclick: () => { S.tab = k; drawSide(); } }, l))),
      h("div", { class: "cd-panel" },
        S.tab === "props" ? propsPanel() : S.tab === "add" ? h("div", {}, addMenu(), sub("بعد الإضافة اسحب العنصر إلى مكانه وغيّر حجمه من المقابض.")) : S.tab === "page" ? pagePanel() : layersPanel()));
    if (!canEdit) side.querySelectorAll("input,select,textarea,button.btn:not(.cd-keep)").forEach((x) => { if (!x.closest(".cd-tabs")) x.disabled = true; });
  }

  async function save() {
    if (!canEdit) return;
    try {
      const r = await api(`${base}/designs/${S.id}`, { name: S.name.trim() || "تصميم", kind: S.kind, layout: S.layout }, "PUT");
      S.dirty = false; status.textContent = `حُفظ — نسخة ${r.version}`; status.className = "cd-status ok";
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
    nameIn, kindSel,
    h("div", { class: "cd-bar-g" },
      h("button", { type: "button", class: "btn ghost sm", title: "تراجع (Ctrl+Z)", onclick: undo, disabled: !canEdit }, "↶"),
      h("button", { type: "button", class: "btn ghost sm", title: "إعادة (Ctrl+Y)", onclick: redo, disabled: !canEdit }, "↷"),
      h("button", { type: "button", class: "btn ghost sm", onclick: () => { S.zoom = Math.max(0.4, S.zoom - 0.15); draw(); } }, "−"), zoomLbl,
      h("button", { type: "button", class: "btn ghost sm", onclick: () => { S.zoom = Math.min(3, S.zoom + 0.15); draw(); } }, "+"),
      h("button", { type: "button", class: "btn ghost sm cd-keep", onclick: () => { S.fields = !S.fields; draw(); } }, "الحقول / المعاينة")),
    status, canEdit ? saveBtn : null);
  mount(root, bar, h("div", { class: "cd-body" }, stage, side));
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
          h("div", { class: "cd-card-b" }, h("b", {}, t.name), h("small", {}, `${KINDS[t.kind]} · نسخة ${t.version}`), t.is_default ? badge("الافتراضي", "green") : null),
          h("div", { class: "cd-card-a" },
            btn(d.can_edit ? "تعديل" : "عرض", () => openDesigner({ base, template: full, canEdit: d.can_edit, onSaved: () => { load(); onChange?.(); } }), "sm"),
            d.can_edit && !t.is_default ? btn("اجعله الافتراضي", async () => { await api(`${base}/designs/${t.id}/default`, {}); toast("أصبح التصميم الافتراضي لهذا النوع"); load(); }, "ghost sm") : null,
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
