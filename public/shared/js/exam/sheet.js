// الكتابة على الورقة: صفحة الاختبار نفسها أمامك (الترويسة وخط الورقة وترقيمها)، وتكتب الأسئلة عليها مباشرة.
//   * «أضف سؤالًا» ← تختار النوع ← يظهر السؤال في مكانه في الورقة والمؤشر في نصه.
//     النوع يحدد القسم تلقائيًا: يُضاف لآخر قسم من نوعه، أو يُنشأ قسم جديد بعنوانه («السؤال الثاني: أكمل الفراغات»).
//   * كل شيء يُكتب في مكانه: نص السؤال، الخيارات، العمودان في التوصيل، العناصر في الترتيب، عنوان القسم.
//   * الإجابة الصحيحة بضغطة: الحرف في الاختيار، القوس في صح/خطأ (تظهر للمعلم فقط وليست في ورقة الطالب).
//   * شريط أدوات للسؤال المحدد: النوع، الصورة، مساحة الإجابة، تحريك، تكرار، إعدادات متقدمة، حذف.
//   * فواصل «بداية الصفحة 2…» تُحسب من محرك الطباعة نفسه، فترى أين تنتهي كل ورقة وأنت تكتب.
// البيانات نفسها التي يستخدمها محرر القائمة والمعاينة (paper.content)، والحفظ تلقائي.
import { h, mount } from "../dom.js";
import { btn, select, toast, confirmAction, dialog } from "../ui.js";
import { icons } from "../icons.js";
import {
  QTYPES, ORDINALS, OPTION_LETTERS, ANSWER_SPACE, SECTION_TITLES, newQuestion, newSection, newTable, uid, fmtNum, marksWord,
  spaceLines, withLayoutDefaults, buildVersion, totals,
} from "./engine.js";
import { countBlanks } from "./math.js";
import { pageVars, headerBlock, studentBlock, tableEl, optionCols, paperBlocks } from "./render.js";
import { paginate } from "./paginate.js";
import { questionEditor, uploadImage } from "./editor.js";
import { sectionTitleFor } from "./parse.js";

// الأنواع في شريط الإضافة بالترتيب الأكثر استخدامًا
const ADD_TYPES = ["mcq", "truefalse", "fill", "short", "essay", "match", "order", "multi", "math", "image", "table"];
const PH = {
  mcq: "اكتب السؤال هنا… (مثال: عاصمة المملكة العربية السعودية هي:)", multi: "اكتب السؤال… (اختر كل الإجابات الصحيحة)",
  truefalse: "اكتب العبارة هنا… (مثال: الشمس نجم)", fill: "اكتب الجملة، وضع ____ مكان الفراغ", short: "اكتب السؤال هنا…",
  essay: "اكتب السؤال المقالي هنا…", match: "صِل كل عنصر من العمود (أ) بما يناسبه من العمود (ب):", order: "رتّب ما يلي ترتيبًا صحيحًا:",
  math: "اكتب المسألة (المعادلات بين $ $)", image: "تأمل الشكل ثم أجب:", table: "أجب مستعينًا بالجدول:", custom: "اكتب السؤال هنا…",
};

// contenteditable نصي (بلا تنسيق)، مع احتياط للمتصفحات التي لا تدعم plaintext-only
const PLAIN = (() => { const d = document.createElement("div"); d.setAttribute("contenteditable", "plaintext-only"); return d.contentEditable === "plaintext-only"; })();
const textOf = (el) => el.innerText.replace(/ /g, " ").replace(/\n+$/, "");
function caretEnd(el) {
  el.focus({ preventScroll: true });
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
const atStart = (el) => { const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return false; const r = s.getRangeAt(0).cloneRange(); r.setStart(el, 0); return r.toString().length === 0; };

export function sheetEditor({ paper, base, ctx, ro = false, queue, onChange, school, logoUrl }) {
  const S = () => paper.content.sections;
  const root = h("div", { class: "xs" });
  const sheet = h("div");
  const breaksInfo = h("span", { class: "xs-pages" });
  let active = null;          // السؤال المحدد (يظهر شريط أدواته)
  let focusKey = null;        // الحقل الذي يعود له المؤشر بعد إعادة الرسم
  let lastSection = null;     // آخر قسم كُتب فيه (لإضافة الأسئلة بجانبه)

  const changed = () => { queue("content"); onChange?.(); scheduleBreaks(); };
  const touch = (s) => { lastSection = s; };

  /* ---------- حقل قابل للكتابة ---------- */
  function editable(value, onInput, { ph = "", cls = "", key, tag = "span", onEnter, onBackspaceEmpty, onBlur, multiline = false } = {}) {
    const el = h(tag, { class: `xs-ed ${cls}`, "data-ph": ph, "data-key": key, dir: "auto", spellcheck: "true" });
    el.textContent = value || "";
    if (!ro) el.setAttribute("contenteditable", PLAIN ? "plaintext-only" : "true");
    const paintEmpty = () => el.classList.toggle("is-empty", !textOf(el).trim());
    paintEmpty();
    el.addEventListener("input", () => { paintEmpty(); onInput(textOf(el)); });
    el.addEventListener("focus", () => { focusKey = key; });
    if (onBlur) el.addEventListener("blur", onBlur);
    if (!PLAIN) el.addEventListener("paste", (e) => {
      e.preventDefault();
      document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    });
    el.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return;       // للاختصار العام
      if (e.key === "Enter" && !(multiline && e.shiftKey)) {
        if (onEnter) { e.preventDefault(); onEnter(); } else if (!multiline) e.preventDefault();
      }
      if (e.key === "Backspace" && onBackspaceEmpty && !textOf(el) ) { e.preventDefault(); onBackspaceEmpty(); }
    });
    return el;
  }
  // نقل المؤشر فورًا (الرسم متزامن) حتى لا تذهب الحروف المكتوبة بسرعة للحقل السابق
  const focusField = (key) => {
    focusKey = key;
    const el = sheet.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el) { caretEnd(el); el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  };

  // عند مغادرة السؤال: حذف الخيارات والصفوف والعناصر الفارغة الزائدة (يبقى اثنان على الأقل)
  function prune(qid) {
    const q = S().flatMap((x) => x.questions).find((x) => x.id === qid);
    if (!q) return false;
    let n = 0;
    const trim = (arr, empty) => { while (arr && arr.length > 2 && empty(arr[arr.length - 1])) { arr.pop(); n++; } };
    trim(q.options, (o) => !String(o.text || "").trim());
    trim(q.pairs, (p) => !String(p.left || "").trim() && !String(p.right || "").trim());
    trim(q.items, (i) => !String(i.text || "").trim());
    if (q.options) q.correct = (q.correct || []).filter((id) => q.options.some((o) => o.id === id));
    if (n) changed();
    return n > 0;
  }

  /* ---------- الإضافة ---------- */
  // النوع يحدد المكان: القسم الحالي إن كان من النوع نفسه أو فارغًا، وإلا قسم جديد بعنوانه
  function placeFor(type) {
    const secs = S();
    const typeOf = (s) => s.questions[s.questions.length - 1]?.type;
    const pref = lastSection && secs.includes(lastSection) ? lastSection : secs[secs.length - 1];
    if (pref && (!pref.questions.length || typeOf(pref) === type)) return pref;
    const last = secs[secs.length - 1];
    if (last && (!last.questions.length || typeOf(last) === type)) return last;
    const s = newSection(sectionTitleFor(ORDINALS[secs.length] || secs.length + 1, type));
    secs.push(s);
    return s;
  }
  function addQuestion(type, section = null, after = null) {
    const s = section || placeFor(type);
    // قسم عنوانه عام («السؤال الأول») يأخذ عنوان نوع أول سؤال فيه
    if (!s.questions.length && /^السؤال \S+( \S+)?$/.test((s.title || "").trim()) && SECTION_TITLES[type]) s.title = `${s.title.trim()}: ${SECTION_TITLES[type]}`;
    const prev = after || s.questions[s.questions.length - 1];
    const q = newQuestion(type, prev?.type === type ? prev.marks : type === "essay" ? 3 : type === "match" || type === "order" ? 2 : 1);
    if (type === "table" && !q.table) q.table = newTable();
    if (type === "short" || type === "essay" || type === "math") q.space = type === "essay" ? "medium" : "small";
    const i = after ? s.questions.indexOf(after) + 1 : s.questions.length;
    s.questions.splice(i, 0, q);
    touch(s); active = q.id;
    changed(); draw();
    focusField(`${q.id}:text`);
    return q;
  }
  function addSection() {
    const s = newSection(`السؤال ${ORDINALS[S().length] || S().length + 1}`);
    S().push(s); touch(s); changed(); draw();
    focusField(`${s.id}:title`);
  }

  /* ---------- أدوات السؤال ---------- */
  const tool = (icon, label, fn, cls = "") => h("button", { type: "button", class: `xs-tool ${cls}`, title: label, "aria-label": label,
    onmousedown: (e) => e.preventDefault(), onclick: (e) => { e.stopPropagation(); fn(); } }, icon);
  function convert(q, type) {
    const keep = { text: q.text, marks: q.marks, difficulty: q.difficulty, image: q.image, solution: q.solution, notes: q.notes, unit: q.unit, lesson: q.lesson };
    const fresh = newQuestion(type, q.marks);
    for (const k of Object.keys(q)) if (k !== "id") delete q[k];
    Object.assign(q, fresh, keep, { id: q.id });
    if (type === "table" && !q.table) q.table = newTable();
  }
  function duplicate(q, s) {
    const c = structuredClone(q); c.id = uid("q"); c.bank_id = null;
    for (const k of ["options", "pairs", "items"]) if (c[k]) {
      const map = new Map();
      c[k] = c[k].map((o) => { const nid = uid(k[0]); map.set(o.id, nid); return { ...o, id: nid }; });
      if (k === "options" && Array.isArray(c.correct)) c.correct = c.correct.map((x) => map.get(x)).filter(Boolean);
    }
    s.questions.splice(s.questions.indexOf(q) + 1, 0, c);
    active = c.id; changed(); draw(); focusField(`${c.id}:text`);
  }
  function move(q, s, d) {
    const secs = S(); let i = s.questions.indexOf(q); const j = i + d;
    if (j >= 0 && j < s.questions.length) { [s.questions[i], s.questions[j]] = [s.questions[j], s.questions[i]]; }
    else {
      // من طرف القسم إلى القسم المجاور
      const si = secs.indexOf(s) + d; if (si < 0 || si >= secs.length) return;
      s.questions.splice(i, 1); i = d < 0 ? secs[si].questions.length : 0; secs[si].questions.splice(i, 0, q);
    }
    changed(); draw();
  }
  function advanced(q) {
    const d = dialog(`إعدادات السؤال — ${QTYPES[q.type].label}`, questionEditor(q, { base, onChange: () => changed(), onTypeChange: () => {} }), [btn("تم", () => d.close())]);
    d.classList.add("xb-wide");
    d.addEventListener("close", () => draw());
  }
  const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "hidden" });
  let imageFor = null;
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files[0]; const q = imageFor; fileIn.value = "";
    if (!f || !q) return;
    try {
      toast("جارٍ رفع الصورة…");
      const r = await uploadImage(base, f);
      // الافتراضي صغير وبجانب السؤال حتى لا يأخذ مساحة كبيرة
      q.image = { id: r.id, width: q.image?.width || 30, align: "center", position: q.image?.position || "side" };
      changed(); draw();
    } catch (e) { toast(e.message, true); }
  });

  function toolbar(q, s) {
    const def = QTYPES[q.type];
    const type = select(Object.entries(QTYPES).map(([k, v]) => [k, v.label]), { value: q.type, "aria-label": "نوع السؤال", class: "xs-type" });
    type.addEventListener("change", () => { convert(q, type.value); changed(); draw(); focusField(`${q.id}:text`); });
    const space = def.space ? select(Object.entries(ANSWER_SPACE).filter(([k]) => k !== "page").map(([k, [l]]) => [k, `مساحة: ${l}`]), { value: q.space || "auto", "aria-label": "مساحة الإجابة", class: "xs-type" }) : null;
    space?.addEventListener("change", () => { q.space = space.value; changed(); draw(); });
    const img = q.image;
    return h("div", { class: "xs-bar", onmousedown: (e) => { if (e.target.tagName !== "SELECT") e.preventDefault(); } },
      type,
      space,
      img ? [
        tool(icons.minus({ size: 16 }), "تصغير الصورة", () => { img.width = Math.max(10, (img.width || 30) - 5); changed(); draw(); }),
        tool(icons.plus({ size: 16 }), "تكبير الصورة", () => { img.width = Math.min(img.position === "side" ? 55 : 100, (img.width || 30) + 5); changed(); draw(); }),
        tool(h("span", { class: "small" }, img.position === "side" ? "تحت" : "بجانب"), "مكان الصورة", () => { img.position = img.position === "side" ? "after" : "side"; changed(); draw(); }),
        tool(icons.close({ size: 14 }), "إزالة الصورة", () => { q.image = null; changed(); draw(); }),
      ] : tool(icons.image({ size: 16 }), "إضافة صورة", () => { imageFor = q; fileIn.click(); }),
      h("span", { class: "xs-bar-sep" }),
      tool(icons.up({ size: 16 }), "لأعلى", () => move(q, s, -1)),
      tool(icons.down({ size: 16 }), "لأسفل", () => move(q, s, 1)),
      tool(icons.copy({ size: 16 }), "تكرار", () => duplicate(q, s)),
      tool(icons.settings({ size: 16 }), "إعدادات متقدمة (جدول، حل نموذجي، صعوبة…)", () => advanced(q)),
      tool(icons.trash({ size: 16 }), "حذف السؤال", () => {
        if ((q.text || "").trim() && !confirmAction("حذف السؤال؟")) return;
        s.questions.splice(s.questions.indexOf(q), 1); active = null; changed(); draw();
      }, "danger"));
  }

  /* ---------- رسم سؤال ---------- */
  function questionEl(q, s, no, L) {
    const def = QTYPES[q.type];
    const el = h("div", { class: `xs-q xp-q t-${q.type}${active === q.id ? " active" : ""}`, "data-qid": q.id,
      onfocusin: () => { if (active !== q.id) { const prev = active; active = q.id; if (prev && prune(prev)) { const k = focusKey; draw(); if (k) focusField(k); return; } touch(s); for (const x of sheet.querySelectorAll(".xs-q.active")) x.classList.remove("active"); el.classList.add("active"); mountBar(); } },
      onclick: (e) => { if (e.target === el || e.target.classList.contains("xs-q-main")) el.querySelector(".xs-ed")?.focus(); },
      onkeydown: (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addQuestion(q.type, s, q); } } });
    const barSlot = h("div", { class: "xs-bar-slot" });
    const mountBar = () => mount(barSlot, ro ? null : toolbar(q, s));
    if (active === q.id) mountBar();

    const next = (key) => () => focusField(key);
    const firstBody = q.type === "mcq" || q.type === "multi" ? `${q.id}:opt:0` : q.type === "match" ? `${q.id}:l:0` : q.type === "order" ? `${q.id}:i:0` : null;
    const blanks0 = countBlanks(q.text);
    const text = editable(q.text, (v) => { q.text = v; changed(); }, {
      ph: PH[q.type] || PH.custom, cls: "xs-qtext", key: `${q.id}:text`, multiline: true,
      onBlur: q.type === "fill" ? () => { if (countBlanks(q.text) !== blanks0) setTimeout(() => { const k = focusKey; draw(); if (k && k !== `${q.id}:text`) focusField(k); }, 0); } : null,
      onEnter: firstBody ? next(firstBody) : () => addQuestion(q.type, s, q),
    });
    // الدرجة: تضغط عليها وتكتب الرقم
    const marks = h("span", { class: "xp-marks xs-marks", title: "الدرجة — اضغط للتعديل" }, `(${fmtNum(q.marks)} ${marksWord(q.marks)})`);
    if (!ro) marks.addEventListener("click", () => {
      const inp = h("input", { type: "number", min: 0.25, step: 0.25, value: q.marks, class: "xs-marks-in", "aria-label": "الدرجة" });
      const done = () => { const v = Number(inp.value); if (v > 0) q.marks = v; changed(); draw(); };
      inp.addEventListener("blur", done);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
      marks.replaceWith(inp); inp.select();
    });
    // صح/خطأ: القوس نفسه يحدد الإجابة (✓ ثم ✗ ثم فارغ)
    const tf = q.type === "truefalse" ? h("button", { type: "button", class: `xp-tf xs-tf${typeof q.correct === "boolean" ? " filled" : ""}`, title: "الإجابة الصحيحة (للمعلم) — اضغط للتغيير", disabled: ro,
      onclick: () => { q.correct = q.correct === true ? false : q.correct === false ? null : true; changed(); draw(); } },
    h("span", {}, "("), h("span", { class: "xp-tf-in" }, q.correct === true ? "✓" : q.correct === false ? "✗" : ""), h("span", {}, ")")) : null;

    const head = h("div", { class: "xp-qhead" }, h("span", { class: "xp-no" }, `${no}`), h("div", { class: "xp-qtext" }, text,
      q.type === "fill" && !ro ? h("button", { type: "button", class: "xs-mini", onmousedown: (e) => e.preventDefault(), onclick: () => {
        const t = sheet.querySelector(`[data-key="${CSS.escape(`${q.id}:text`)}"]`);
        if (document.activeElement !== t) caretEnd(t);
        document.execCommand("insertText", false, " ______ ");
      } }, "+ فراغ") : null), tf, marks);

    const side = q.image?.id && q.image.position === "side";
    const main = h("div", { class: "xs-q-main" });
    const imgEl = q.image?.id ? h("div", { class: side ? "xp-img side" : `xp-img al-${q.image.align || "center"}`, style: side ? `width:${q.image.width || 30}%` : "" },
      h("img", { src: `${base}/images/${q.image.id}?size=thumb`, alt: "", style: side ? "" : `width:${q.image.width || 30}%` })) : null;
    if (imgEl && q.image.position === "before") el.append(imgEl);
    main.append(head);
    if (imgEl && !side && q.image.position !== "before") main.append(imgEl);
    if (q.table) main.append(h("div", { class: "xs-table", onclick: () => !ro && advanced(q), title: "اضغط لتعديل الجدول" }, tableEl(q.table)));
    main.append(...typeBody(q, s));
    if (def.space) main.append(answerSpace(q));
    el.append(barSlot);
    if (side) el.append(h("div", { class: "xs-side" }, main, imgEl)); else el.append(main);
    return el;
  }

  function typeBody(q, s) {
    const out = [];
    if (q.type === "mcq" || q.type === "multi") {
      const correct = new Set(q.correct || []);
      const opts = q.options || [];
      out.push(h("ol", { class: `xp-opts c${optionCols(q)}` }, opts.map((o, i) => h("li", { class: correct.has(o.id) ? "ok" : "" },
        h("button", { type: "button", class: "xp-letter xs-letter", title: "اجعلها الإجابة الصحيحة", disabled: ro, onmousedown: (e) => e.preventDefault(),
          onclick: () => {
            if (q.type === "multi") q.correct = correct.has(o.id) ? [...correct].filter((x) => x !== o.id) : [...correct, o.id];
            else q.correct = [o.id];
            changed(); draw();
          } }, `${OPTION_LETTERS[i]})`),
        editable(o.text, (v) => { o.text = v; changed(); }, {
          ph: `الخيار ${OPTION_LETTERS[i]}`, key: `${q.id}:opt:${i}`,
          onEnter: () => {
            if (i < opts.length - 1) return focusField(`${q.id}:opt:${i + 1}`);
            if (!o.text.trim() || opts.length >= 8) return addQuestion(q.type, s, q);
            opts.push({ id: uid("o"), text: "" }); changed(); draw(); focusField(`${q.id}:opt:${i + 1}`);
          },
          onBackspaceEmpty: () => {
            if (opts.length <= 2) return focusField(i ? `${q.id}:opt:${i - 1}` : `${q.id}:text`);
            opts.splice(i, 1); q.correct = (q.correct || []).filter((x) => x !== o.id); changed(); draw();
            focusField(i ? `${q.id}:opt:${i - 1}` : `${q.id}:text`);
          },
        })))));
      if (!ro) out.push(h("div", { class: "xs-hints" },
        opts.length < 8 ? h("button", { type: "button", class: "xs-mini", onclick: () => { opts.push({ id: uid("o"), text: "" }); changed(); draw(); focusField(`${q.id}:opt:${opts.length - 1}`); } }, "+ خيار") : null,
        !correct.size ? h("span", { class: "xs-warn" }, "اضغط حرف الإجابة الصحيحة") : null));
    }
    if (q.type === "fill") {
      const n = countBlanks(q.text);
      q.answers = (q.answers || []).slice(0, Math.max(n, 0));
      if (n) out.push(h("div", { class: "xs-key" }, h("b", {}, "الإجابة:"), Array.from({ length: n }, (_, i) =>
        editable(q.answers[i] || "", (v) => { q.answers[i] = v; changed(); }, { ph: `الفراغ ${i + 1}`, cls: "xs-key-f", key: `${q.id}:ans:${i}`,
          onEnter: () => (i < n - 1 ? focusField(`${q.id}:ans:${i + 1}`) : addQuestion(q.type, s, q)) }))));
      else if (!ro) out.push(h("div", { class: "xs-hints" }, h("span", { class: "xs-warn" }, "ضع ____ مكان الفراغ (أو اضغط «+ فراغ»)")));
    }
    if (q.type === "match") {
      const pairs = q.pairs || (q.pairs = []);
      const addRow = (i) => { pairs.splice(i, 0, { id: uid("p"), left: "", right: "" }); changed(); draw(); focusField(`${q.id}:l:${i}`); };
      out.push(h("div", { class: "xp-match xs-match" },
        h("div", { class: "xp-m-h" }, "العمود (أ)"), h("div", {}), h("div", { class: "xp-m-h" }, "العمود (ب) — الإجابة المقابلة"),
        pairs.map((p, i) => [
          h("div", { class: "xp-m-a" }, h("span", { class: "xp-m-slot" }), h("b", { class: "xp-m-no" }, `${i + 1}-`),
            editable(p.left, (v) => { p.left = v; changed(); }, { ph: "عنصر", cls: "xp-m-t", key: `${q.id}:l:${i}`, onEnter: () => focusField(`${q.id}:r:${i}`),
              onBackspaceEmpty: () => { if (!p.right && pairs.length > 2) { pairs.splice(i, 1); changed(); draw(); focusField(i ? `${q.id}:r:${i - 1}` : `${q.id}:text`); } } })),
          h("div", { class: "xp-m-dots" }, h("i"), h("i")),
          h("div", { class: "xp-m-b" }, h("b", { class: "xp-m-no" }, `${OPTION_LETTERS[i]})`),
            editable(p.right, (v) => { p.right = v; changed(); }, { ph: "ما يقابله", cls: "xp-m-t", key: `${q.id}:r:${i}`,
              onEnter: () => (i < pairs.length - 1 ? focusField(`${q.id}:l:${i + 1}`) : pairs.length < 12 && p.left.trim() ? addRow(i + 1) : addQuestion(q.type, s, q)) })),
        ])));
      if (!ro) out.push(h("div", { class: "xs-hints" },
        pairs.length < 12 ? h("button", { type: "button", class: "xs-mini", onclick: () => addRow(pairs.length) }, "+ صف") : null,
        h("span", {}, "اكتب كل عنصر مقابل إجابته الصحيحة؛ العمود (ب) يُخلط تلقائيًا في ورقة الطالب.")));
    }
    if (q.type === "order") {
      const items = q.items || (q.items = []);
      out.push(h("ol", { class: "xp-order xs-order" }, items.map((it, i) => h("li", {},
        h("span", { class: "xp-slot xs-rank", title: "الترتيب الصحيح" }, i + 1),
        editable(it.text, (v) => { it.text = v; changed(); }, { ph: `العنصر ${i + 1}`, key: `${q.id}:i:${i}`,
          onEnter: () => {
            if (i < items.length - 1) return focusField(`${q.id}:i:${i + 1}`);
            if (!it.text.trim() || items.length >= 12) return addQuestion(q.type, s, q);
            items.push({ id: uid("i"), text: "" }); changed(); draw(); focusField(`${q.id}:i:${i + 1}`);
          },
          onBackspaceEmpty: () => { if (items.length > 2) { items.splice(i, 1); changed(); draw(); focusField(i ? `${q.id}:i:${i - 1}` : `${q.id}:text`); } } })))));
      if (!ro) out.push(h("div", { class: "xs-hints" }, h("span", {}, "اكتب العناصر بترتيبها الصحيح؛ تُخلط تلقائيًا في ورقة الطالب.")));
    }
    return out;
  }

  // مساحة الإجابة: أسطر بعدد ما سيُطبع (حتى 6 تظهر هنا)، والإجابة النموذجية للمعلم تحتها
  function answerSpace(q) {
    const n = spaceLines(q);
    const shown = Math.min(n, 6);
    return h("div", { class: "xs-space" },
      n > 0 ? h("div", { class: `xp-lines ${q.lined === false ? "plain" : ""}` }, Array.from({ length: shown }, () => h("div", { class: "xp-line" }))) : null,
      n > shown ? h("small", { class: "xs-more" }, `+ ${n - shown} أسطر أخرى في الورقة`) : n < 0 ? h("small", { class: "xs-more" }, "صفحة كاملة للإجابة") : null,
      ro ? null : h("div", { class: "xs-key" }, h("b", {}, "الإجابة النموذجية (للمعلم):"),
        editable(q.answer || "", (v) => { q.answer = v; changed(); }, { ph: "اختياري — تظهر في نموذج الإجابة فقط", cls: "xs-key-f wide", key: `${q.id}:answer`, multiline: true })));
  }

  /* ---------- رسم الورقة ---------- */
  function sectionEl(s, si, nextNo, L) {
    const t = s.questions.reduce((a, q) => a + Number(q.marks || 0), 0);
    const lastType = s.questions[s.questions.length - 1]?.type;
    const title = editable(s.title, (v) => { s.title = v; queue("content"); }, { ph: "عنوان القسم (مثل: السؤال الأول: اختر الإجابة الصحيحة)", key: `${s.id}:title`,
      onEnter: () => (s.questions[0] ? focusField(`${s.questions[0].id}:text`) : null) });
    const ins = editable(s.instructions, (v) => { s.instructions = v; queue("content"); }, { ph: "+ تعليمات للقسم (اختياري)", cls: "xs-s-ins", key: `${s.id}:ins` });
    const mv = (d) => { const j = si + d; if (j < 0 || j >= S().length) return; [S()[si], S()[j]] = [S()[j], S()[si]]; changed(); draw(); };
    return h("section", { class: "xs-section", "data-sid": s.id, onfocusin: () => touch(s) },
      h("div", { class: "xp-section" },
        h("div", { class: "xp-s-title" }, title, L.show_marks ? h("span", { class: "xp-s-marks" }, `${fmtNum(t)} ${marksWord(t)}`) : null),
        h("div", { class: "xp-s-ins" }, ins),
        ro ? null : h("div", { class: "xs-s-tools" },
          tool(icons.up({ size: 14 }), "تحريك القسم لأعلى", () => mv(-1)),
          tool(icons.down({ size: 14 }), "تحريك القسم لأسفل", () => mv(1)),
          tool(icons.trash({ size: 14 }), "حذف القسم", () => {
            if (s.questions.length && !confirmAction(`حذف القسم وأسئلته (${s.questions.length})؟`)) return;
            S().splice(si, 1); changed(); draw();
          }, "danger"))),
      s.questions.map((q) => questionEl(q, s, nextNo(), L)),
      ro ? null : h("div", { class: "xs-sec-add" },
        lastType ? h("button", { type: "button", class: "btn soft sm", onclick: () => addQuestion(lastType, s) }, icons.plus({ size: 14 }), QTYPES[lastType].label) : null,
        typeMenu((type) => addQuestion(type, s), lastType ? "نوع آخر في هذا القسم" : "أضف سؤالًا لهذا القسم")));
  }

  function typeMenu(onPick, label) {
    const d = h("details", { class: "xs-menu" }, h("summary", {}, label),
      h("div", { class: "xs-menu-list" }, ADD_TYPES.map((k) => h("button", { type: "button", onclick: () => { d.open = false; onPick(k); } },
        QTYPES[k].label))));
    return d;
  }

  function draw() {
    const L = withLayoutDefaults(paper.layout);
    const vars = pageVars(L);
    const sectionsEnabled = ctx.settings?.sections_enabled !== false;
    let n = 0;
    const page = h("div", { class: `xs-page ${vars.cls.replace("xp-page", "")}`, style: vars.style },
      h("div", { class: "xs-head", title: "الترويسة من «معلومات الاختبار» و«تصميم الورقة»" },
        headerBlock(paper, L, { school, logoUrl, versionCode: null, total: totals(paper.content).total, sectionsEnabled }),
        studentBlock(L, { total: paper.total_marks || totals(paper.content).total, student: null, sectionsEnabled, hide: L.show_date && paper.exam_date ? ["date"] : [] })),
      S().map((s, si) => { if (L.numbering === "per_section") n = 0; return sectionEl(s, si, () => ++n, L); }),
      S().some((s) => s.questions.length) ? null : h("div", { class: "xs-empty" }, h("b", {}, "الورقة فارغة"), "اختر نوع السؤال من الأسفل ويظهر هنا في الورقة، واكتب عليه مباشرة."),
      h("div", { class: "xp-end" }, h("div", { class: "xp-end-line" }, "انتهت الأسئلة")));
    // على الجوال: زر واحد يفتح قائمة الأنواع (لا يغطي الورقة)، وعلى الشاشات الكبيرة الأنواع ظاهرة
    const addBar = ro ? null : h("div", { class: "xs-addbar" },
      h("div", { class: "xs-add-mobile" }, typeMenu((k) => addQuestion(k), "+ أضف سؤالًا")),
      h("b", { class: "xs-add-label" }, "أضف سؤالًا:"),
      h("div", { class: "xs-add-types" }, ADD_TYPES.slice(0, 7).map((k) => h("button", { type: "button", class: "btn ghost sm xs-add-t", onclick: () => addQuestion(k) }, icons.plus({ size: 14 }),
        QTYPES[k].label)),
      typeMenu((k) => addQuestion(k), "أنواع أخرى")),
      h("button", { type: "button", class: "btn soft sm", onclick: addSection }, icons.plus({ size: 14 }), "قسم جديد"));
    mount(sheet, page, addBar, fileIn);
    if (focusKey) {
      const el = sheet.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
      if (el && document.activeElement !== el) caretEnd(el);
    }
    scheduleBreaks();
  }

  /* ---------- حدود الصفحات من محرك الطباعة ---------- */
  let bt = null, bRun = 0;
  function scheduleBreaks() { clearTimeout(bt); bt = setTimeout(computeBreaks, 900); }
  async function computeBreaks() {
    const run = ++bRun;
    const host = h("div", { class: "xs-measure", "aria-hidden": "true" });
    document.body.append(host);
    try {
      const { blocks, running } = paperBlocks({ paper, version: buildVersion({ ...paper, versions: 1 }, 0), layout: paper.layout, school, logoUrl,
        imageUrl: (id) => `${base}/images/${id}`, sectionsEnabled: ctx.settings?.sections_enabled !== false });
      const pages = await paginate(host, { blocks, running, layout: paper.layout });
      if (run !== bRun) return;
      const firstOf = pages.slice(1).map((p) => p.querySelector("[data-qid]")?.dataset.qid).filter(Boolean);
      for (const m of sheet.querySelectorAll(".xs-break")) m.remove();
      firstOf.forEach((qid, i) => {
        const el = sheet.querySelector(`.xs-q[data-qid="${CSS.escape(qid)}"]`);
        el?.before(h("div", { class: "xs-break" }, h("span", {}, `نهاية الصفحة ${i + 1} — بداية الصفحة ${i + 2}`)));
      });
      breaksInfo.textContent = `الورقة الآن: ${pages.length} ${pages.length === 1 ? "صفحة" : pages.length === 2 ? "صفحتان" : pages.length <= 10 ? "صفحات" : "صفحة"}`;
    } catch { /* القياس اختياري */ } finally { host.remove(); }
  }

  // الضغط خارج الأسئلة يُخفي شريط الأدوات
  root.addEventListener("focusout", () => setTimeout(() => {
    if (!root.contains(document.activeElement) && !document.querySelector("dialog[open]")) {
      const prev = active; active = null;
      if (prev && prune(prev)) draw();
      else for (const x of sheet.querySelectorAll(".xs-q.active")) x.classList.remove("active");
    }
  }, 150));

  draw();
  mount(root, h("div", { class: "xs-top" }, breaksInfo, h("small", {}, "Enter للحقل التالي · Ctrl+Enter سؤال جديد من النوع نفسه · الإجابة الصحيحة بالضغط على الحرف أو القوس")), sheet);
  return { el: root, redraw: draw, addQuestion };
}
