// محرك الصفحات: يوزّع الكتل على صفحات بحجم الورق الحقيقي (مم)، فالمعاينة هي نفسها الطباعة.
//   * لا ينقسم السؤال بين صفحتين: إن لم يتسع ينتقل كاملًا للصفحة التالية.
//   * عنوان القسم لا يبقى وحيدًا أسفل الصفحة، والسؤال يبقى مع أول سطرين من مساحة إجابته.
//   * أسطر الإجابة الطويلة وحدها تكمل في الصفحة التالية.
//   * «صفحة كاملة» تملأ ما تبقى من الصفحة (أو صفحة جديدة إن كان المتبقي قليلًا).
import { h } from "../dom.js";
import { pageVars } from "./render.js";
import { FONTS, withLayoutDefaults } from "./engine.js";

// انتظار الخطوط والصور حتى تكون المقاسات صحيحة
export async function ready(root, layout) {
  const L = withLayoutDefaults(layout);
  const fams = new Set([FONTS[L.font]?.[0], L.heading_font !== "same" ? FONTS[L.heading_font]?.[0] : null].filter(Boolean));
  try {
    await Promise.all([...fams].flatMap((f) => [document.fonts.load(`400 12pt "${f}"`, "ابت"), document.fonts.load(`700 12pt "${f}"`, "ابت")]));
    await document.fonts.ready;
  } catch { /* الخط الاحتياطي */ }
  const imgs = [...root.querySelectorAll("img")].filter((i) => !i.complete);
  await Promise.all(imgs.map((i) => new Promise((r) => { i.onload = r; i.onerror = r; })));
}

function newPage(host, vars, { running, pageIndex, watermark }) {
  const body = h("div", { class: "xp-body" });
  const foot = h("div", { class: "xp-foot" }, h("span", { class: "xp-foot-text" }), h("span", { class: "xp-pno" }));
  const inner = h("div", { class: "xp-inner" }, pageIndex > 0 && running ? running.cloneNode(true) : null, body, foot);
  const page = h("div", { class: vars.cls, style: vars.style }, inner, watermark ? h("div", { class: "xp-watermark" }, watermark) : null);
  host.append(page);
  return { page, body };
}

const overflows = (body) => body.scrollHeight > body.clientHeight + 1;
const usedHeight = (body) => {
  const last = body.lastElementChild;
  return last ? last.offsetTop + last.offsetHeight - body.offsetTop : 0;
};

/**
 * يرسم الكتل في host كصفحات، ويعيد مصفوفة عناصر الصفحات.
 * blocks: [{ el, keep?, fillPage? }]
 */
export async function paginate(host, { blocks, running, layout, footerText = "", watermark = null }) {
  const vars = pageVars(layout);
  const L = vars.L;
  // قياس الصور والخطوط قبل التوزيع: نضع الكتل في صفحة قياس مؤقتة
  const probe = newPage(host, vars, { pageIndex: 0 });
  for (const b of blocks) probe.body.append(b.el);
  await ready(probe.page, L);
  probe.page.remove();
  for (const b of blocks) b.el.remove();

  const pages = [];
  let cur = newPage(host, vars, { running, pageIndex: 0, watermark });
  pages.push(cur);
  const next = () => { cur = newPage(host, vars, { running, pageIndex: pages.length, watermark }); pages.push(cur); return cur; };

  const placeOne = (b) => {
    if (b.fillPage) {
      let room = cur.body.clientHeight - usedHeight(cur.body) - 6;
      if (room < cur.body.clientHeight * 0.3) { next(); room = cur.body.clientHeight - 6; }
      b.el.style.height = `${Math.max(40, room)}px`;
      cur.body.append(b.el);
      return;
    }
    cur.body.append(b.el);
    if (overflows(cur.body) && cur.body.children.length > 1) {
      b.el.remove();
      next();
      cur.body.append(b.el);        // كتلة أطول من صفحة كاملة تبقى وحدها (نادر: صورة ضخمة)
    }
  };

  let i = 0;
  while (i < blocks.length) {
    const chain = [blocks[i]];
    while (chain[chain.length - 1].keep && i + chain.length < blocks.length && !blocks[i + chain.length].fillPage) chain.push(blocks[i + chain.length]);
    if (chain.length === 1 || chain[0].fillPage) { placeOne(chain[0]); i++; continue; }
    const hadContent = cur.body.children.length > 0;
    for (const b of chain) cur.body.append(b.el);
    if (overflows(cur.body)) {
      for (const b of chain) b.el.remove();
      if (hadContent) {
        next();
        for (const b of chain) cur.body.append(b.el);
        if (overflows(cur.body)) { for (const b of chain) b.el.remove(); chain.forEach(placeOne); }
      } else {
        chain.forEach(placeOne);   // السلسلة أطول من صفحة: توزَّع كتلة كتلة
      }
    }
    i += chain.length;
  }
  // إزالة صفحة أخيرة فارغة إن وُجدت
  if (!cur.body.children.length && pages.length > 1) { cur.page.remove(); pages.pop(); }

  const n = pages.length;
  pages.forEach((p, idx) => {
    p.page.querySelector(".xp-pno").textContent = L.page_numbers ? `صفحة ${idx + 1} من ${n}` : "";
    p.page.querySelector(".xp-foot-text").textContent = footerText || L.footer_text || "";
  });
  return pages.map((p) => p.page);
}

// نسخة الصفحات لطالب محدد: الاسم والصف والشعبة والرقم تُكتب في الحقول (التخطيط لا يتغير لأن الحقول بعرض ثابت)
export function personalize(pages, student) {
  const copy = pages.map((p) => p.cloneNode(true));
  const values = { name: student.name, grade: student.grade_name || "", section: student.class_name || "", number: String(student.number) };
  for (const el of copy[0].querySelectorAll("[data-field]")) {
    const v = values[el.dataset.field];
    if (v) { el.textContent = v; el.classList.add("filled"); }
  }
  for (const r of copy.slice(1)) {
    const run = r.querySelector(".xp-running");
    if (run && !run.querySelector(".xp-run-name")) run.append(h("span", { class: "xp-run-name" }, student.name));
  }
  return copy;
}

/* ---------- الطباعة ---------- */
// @page يُضبط عبر CSSOM (مسموح في سياسة الحماية، بخلاف عناصر style المضمنة)
function setPageRule(layout) {
  const { w, h: hh } = pageVars(layout);
  const sheet = [...document.styleSheets].find((s) => (s.href || "").endsWith("/shared/css/exam.css"));
  if (!sheet) return;
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) if (sheet.cssRules[i].type === CSSRule.PAGE_RULE) sheet.deleteRule(i);
  sheet.insertRule(`@page { size: ${w}mm ${hh}mm; margin: 0; }`, sheet.cssRules.length);
}

/**
 * يطبع الصفحات المعطاة وحدها: تُنقل مؤقتًا إلى جذر طباعة، وكل ما عداها مخفي.
 * يعيد وعدًا يتحقق بعد إغلاق نافذة الطباعة.
 */
export function printPages(pages, layout) {
  setPageRule(layout);
  const root = h("div", { class: "xp-print-root" }, pages.map((p) => p.cloneNode(true)));
  for (const wm of root.querySelectorAll(".xp-watermark")) wm.remove();
  document.body.append(root);
  document.body.classList.add("xp-printing");
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("afterprint", done);
      root.remove();
      document.body.classList.remove("xp-printing");
      resolve();
    };
    window.addEventListener("afterprint", done);
    // انتظار تحميل صور النسخة قبل فتح نافذة الطباعة
    const imgs = [...root.querySelectorAll("img")].filter((i) => !i.complete);
    Promise.all(imgs.map((i) => new Promise((r) => { i.onload = r; i.onerror = r; }))).then(() => setTimeout(() => window.print(), 50));
  });
}
