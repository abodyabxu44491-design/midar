// النص الغني في الأسئلة: المعادلات بين علامتي $…$ (أو $$…$$ لسطر مستقل)، والفراغات ____، وفواصل الأسطر.
// محرك المعادلات (KaTeX) مستضاف داخل المنصة ويُحمّل فقط عند وجود معادلة.
// لا يُستخدم innerHTML: KaTeX يبني العناصر بنفسه، والنص العادي يُضاف كنص.
import { h } from "../dom.js";

let katex = null;
let loading = null;

export const hasMath = (text) => /\$[^$]+\$/.test(String(text || ""));

export function loadMath() {
  if (katex) return Promise.resolve(katex);
  if (!loading) {
    if (!document.querySelector('link[data-katex]')) {
      document.head.append(h("link", { rel: "stylesheet", href: new URL("../../vendor/katex/katex.min.css", import.meta.url).href, "data-katex": "1" }));
    }
    loading = import("../../vendor/katex/katex.mjs").then((m) => { katex = m.default || m; return katex; });
  }
  return loading;
}

// هل في الاختبار أي معادلة؟ (لتحميل المحرك قبل العرض)
export function paperNeedsMath(content) {
  for (const s of content?.sections || []) for (const q of s.questions || []) {
    const texts = [q.text, q.answer, q.solution, ...(q.options || []).map((o) => o.text), ...(q.pairs || []).flatMap((p) => [p.left, p.right]),
      ...(q.items || []).map((i) => i.text), ...(q.table?.rows || []).flat().map((c) => c.t)];
    if (texts.some(hasMath)) return true;
  }
  return false;
}

function mathEl(tex, display) {
  const el = h("span", { class: display ? "xp-math xp-math-block" : "xp-math", dir: "ltr" });
  if (!katex) { el.textContent = tex; return el; }
  try {
    katex.render(tex, el, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" });
  } catch {
    el.textContent = tex;
  }
  return el;
}

const BLANK = /_{3,}/g;

/**
 * يحوّل نص السؤال إلى عناصر.
 * blanks: تحويل «____» إلى سطر فراغ مناسب للكتابة، مع إجابته إن طُلب عرض الإجابات.
 */
export function rich(text, { blanks = false, answers = null } = {}) {
  const frag = document.createDocumentFragment();
  const src = String(text ?? "");
  let blankIndex = 0;
  const pushText = (s) => {
    const lines = s.split("\n");
    lines.forEach((line, i) => {
      if (i) frag.append(h("br"));
      if (!blanks) { if (line) frag.append(line); return; }
      let last = 0;
      for (const m of line.matchAll(BLANK)) {
        if (m.index > last) frag.append(line.slice(last, m.index));
        const ans = answers?.[blankIndex++];
        frag.append(h("span", { class: `xp-blank${ans ? " filled" : ""}`, style: `min-width:${Math.max(4, m[0].length * 0.9)}em` }, ans || ""));
        last = m.index + m[0].length;
      }
      if (last < line.length) frag.append(line.slice(last));
    });
  };
  // $$…$$ أولًا ثم $…$
  const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index > last) pushText(src.slice(last, m.index));
    frag.append(mathEl(m[1] ?? m[2], m[1] !== undefined));
    last = m.index + m[0].length;
  }
  if (last < src.length) pushText(src.slice(last));
  return frag;
}

export const countBlanks = (text) => (String(text || "").match(BLANK) || []).length;

// أزرار المعادلات: كل زر يُدرج قالب LaTeX داخل علامتي $ إن لم يكن المؤشر داخل معادلة
export const MATH_SNIPPETS = [
  ["كسر", "\\frac{a}{b}"], ["أس", "x^{2}"], ["جذر", "\\sqrt{x}"], ["جذر نوني", "\\sqrt[3]{x}"], ["دليل سفلي", "x_{1}"],
  ["×", "\\times"], ["÷", "\\div"], ["±", "\\pm"], ["≤", "\\le"], ["≥", "\\ge"], ["≠", "\\ne"], ["≈", "\\approx"],
  ["π", "\\pi"], ["∞", "\\infty"], ["زاوية", "\\angle ABC"], ["درجة", "30^{\\circ}"], ["مجموع", "\\sum_{i=1}^{n} i"],
  ["تكامل", "\\int_{a}^{b} f(x)\\,dx"], ["نهاية", "\\lim_{x \\to 0}"], ["سهم", "\\rightarrow"], ["مصفوفة", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}"],
];

export function insertMath(textarea, snippet) {
  const { selectionStart: a, selectionEnd: b, value } = textarea;
  const before = value.slice(0, a);
  const inside = (before.match(/\$/g) || []).length % 2 === 1;
  const piece = inside ? snippet : `$${snippet}$`;
  textarea.value = before + piece + value.slice(b);
  const pos = a + piece.length - (inside ? 0 : 1);
  textarea.focus();
  textarea.setSelectionRange(pos, pos);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
