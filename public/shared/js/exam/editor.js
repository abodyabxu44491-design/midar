// محرر السؤال: نموذج لكل نوع، شريط المعادلات مع معاينة فورية، الصور، الجداول مع دمج الخلايا،
// والإجابة الصحيحة والحل النموذجي وملاحظات التصحيح (للمعلم فقط، لا تظهر في ورقة الطالب).
// المحرر يعدّل كائن السؤال مباشرة ثم يستدعي onChange (الحفظ التلقائي عند المصمم).
import { h, mount } from "../dom.js";
import { api } from "../api.js";
import { field, input, textarea, select, btn, toast } from "../ui.js";
import { icons } from "../icons.js";
import { rich, loadMath, hasMath, MATH_SNIPPETS, insertMath, countBlanks } from "./math.js";
import { QTYPES, DIFFICULTY, ANSWER_SPACE, OPTION_LETTERS, newQuestion, newTable, uid } from "./engine.js";

/* ---------- حقل نص مع شريط المعادلات ومعاينة ---------- */
export function richInput(value, onInput, { rows = 2, placeholder = "", math = true } = {}) {
  const ta = textarea({ rows, placeholder, value: value || "", dir: "auto" });
  const prev = h("div", { class: "xb-rich-prev hidden" });
  const refresh = async () => {
    const v = ta.value;
    if (hasMath(v)) { await loadMath(); mount(prev, rich(v, { blanks: true })); prev.classList.remove("hidden"); }
    else prev.classList.add("hidden");
  };
  ta.addEventListener("input", () => { onInput(ta.value); refresh(); });
  refresh();
  const bar = math ? h("div", { class: "xb-mathbar hidden" },
    MATH_SNIPPETS.map(([label, tex]) => h("button", { type: "button", title: tex, onclick: () => insertMath(ta, tex) }, label))) : null;
  const toggle = math ? h("button", { type: "button", class: "gate-link small", onclick: () => bar.classList.toggle("hidden") }, "معادلة رياضية") : null;
  return h("div", {}, ta, math ? h("div", { class: "row", style: "justify-content:space-between;align-items:center" },
    h("small", { class: "sub" }, "المعادلات بين علامتي $ … $"), toggle) : null, bar, prev);
}

/* ---------- الصور ---------- */
// تصغير الصور الكبيرة قبل الرفع (جودة كافية للطباعة، وحجم أقل من 2 ميجابايت)
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const max = 2000;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.8 * 1024 * 1024 && ["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return { mime: file.type, data: await toBase64(file) };
  }
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * scale); c.height = Math.round(bitmap.height * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.9);
  return { mime: "image/jpeg", data: url.split(",")[1] };
}
const toBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = rej;
  r.readAsDataURL(file);
});

// صورة مصغرة (حتى 480 بكسل) للمعاينات: WebP إن دعمه المتصفح وإلا JPEG
async function makeThumb(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bitmap.width * scale)); c.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    let url = c.toDataURL("image/webp", 0.82);
    let mime = "image/webp";
    if (!url.startsWith("data:image/webp")) { url = c.toDataURL("image/jpeg", 0.82); mime = "image/jpeg"; }
    return { mime, data: url.split(",")[1] };
  } catch { return undefined; }
}

export async function uploadImage(base, file) {
  const [img, thumb] = await Promise.all([prepareImage(file), makeThumb(file)]);
  return api(`${base}/images`, { ...img, thumb });
}

function imageControls(q, base, changed) {
  const box = h("div");
  const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "hidden" });
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files[0];
    if (!f) return;
    try {
      toast("جارٍ رفع الصورة…");
      const r = await uploadImage(base, f);
      q.image = { id: r.id, width: q.image?.width || 60, align: q.image?.align || "center", position: q.image?.position || "after" };
      changed(); draw();
    } catch (e) { toast(e.message, true); }
    fileIn.value = "";
  });
  const draw = () => {
    if (!q.image) {
      mount(box, btn("إضافة صورة", () => fileIn.click(), "ghost sm"), fileIn);
      return;
    }
    const width = input({ type: "range", min: 10, max: 100, step: 5, value: q.image.width });
    const preview = h("img", { src: `${base}/images/${q.image.id}?size=thumb`, alt: "", loading: "lazy", decoding: "async", style: `width:${q.image.width}%;max-height:220px;object-fit:contain;display:block;margin:6px auto;border:1px solid var(--line);border-radius:6px` });
    // المعاينة بالمصغرة، والأصلية تُفتح فقط عند الضغط عليها
    const previewLink = h("a", { href: `${base}/images/${q.image.id}`, target: "_blank", rel: "noopener", title: "فتح الصورة الأصلية" }, preview);
    width.addEventListener("input", () => { q.image.width = Number(width.value); preview.style.width = `${width.value}%`; changed(); });
    const align = select([["start", "يمين"], ["center", "وسط"], ["end", "يسار"]], { value: q.image.align });
    align.addEventListener("change", () => { q.image.align = align.value; changed(); });
    const pos = select([["before", "قبل نص السؤال"], ["after", "بعد نص السؤال"]], { value: q.image.position });
    pos.addEventListener("change", () => { q.image.position = pos.value; changed(); });
    mount(box, previewLink,
      h("div", { class: "row" }, field(`الحجم (${q.image.width}%)`, width), field("المحاذاة", align), field("المكان", pos)),
      h("div", { class: "row", style: "justify-content:flex-start" },
        btn("تغيير الصورة", () => fileIn.click(), "ghost sm"),
        btn("إزالة الصورة", () => { q.image = null; changed(); draw(); }, "danger sm")), fileIn);
  };
  draw();
  return box;
}

/* ---------- محرر الجدول ---------- */
export function tableEditor(table, changed) {
  const box = h("div");
  let sel = null;   // [صف، عمود]
  const draw = () => {
    const rows = table.rows;
    const grid = h("table", {}, rows.map((row, ri) => h("tr", {}, row.map((c, ci) => {
      if (c.hide) return null;
      const inp = input({ value: c.t, "aria-label": `خلية ${ri + 1}-${ci + 1}`, style: ri === 0 && table.header ? "font-weight:700" : "" });
      inp.addEventListener("input", () => { c.t = inp.value; changed(); });
      inp.addEventListener("focus", () => { sel = [ri, ci]; grid.querySelectorAll("td").forEach((td) => td.classList.remove("sel")); inp.parentElement.classList.add("sel"); });
      return h("td", { colSpan: c.cs || 1, rowSpan: c.rs || 1 }, inp);
    }))));
    const cols = rows[0].length;
    const addRow = () => { rows.push(Array.from({ length: cols }, () => ({ t: "" }))); changed(); draw(); };
    const addCol = () => { rows.forEach((r) => r.push({ t: "" })); changed(); draw(); };
    const delRow = () => { if (rows.length > 1) { unmergeAll(); rows.pop(); changed(); draw(); } };
    const delCol = () => { if (cols > 1) { unmergeAll(); rows.forEach((r) => r.pop()); changed(); draw(); } };
    const unmergeAll = () => rows.forEach((r) => r.forEach((c) => { delete c.cs; delete c.rs; delete c.hide; }));
    // الدمج: الخلية المحددة مع التي بجانبها (يسار في العربية) أو تحتها
    const mergeRight = () => {
      if (!sel) return toast("اختر خلية أولًا", true);
      const [r, c] = sel; const cell = rows[r][c]; const span = cell.cs || 1;
      const next = rows[r][c + span];
      if (!next || next.hide || (next.rs || 1) !== (cell.rs || 1)) return toast("لا توجد خلية مناسبة للدمج بجانبها", true);
      cell.cs = span + (next.cs || 1); next.hide = true; next.t = "";
      changed(); draw();
    };
    const mergeDown = () => {
      if (!sel) return toast("اختر خلية أولًا", true);
      const [r, c] = sel; const cell = rows[r][c]; const span = cell.rs || 1;
      const next = rows[r + span]?.[c];
      if (!next || next.hide || (next.cs || 1) !== (cell.cs || 1)) return toast("لا توجد خلية مناسبة للدمج تحتها", true);
      cell.rs = span + (next.rs || 1); next.hide = true; next.t = "";
      changed(); draw();
    };
    const split = () => {
      if (!sel) return toast("اختر خلية أولًا", true);
      const [r, c] = sel; const cell = rows[r][c];
      for (let i = r; i < r + (cell.rs || 1); i++) for (let j = c; j < c + (cell.cs || 1); j++) if (i !== r || j !== c) delete rows[i][j].hide;
      delete cell.cs; delete cell.rs; changed(); draw();
    };
    const header = h("label", { class: "row", style: "align-items:center;gap:6px;flex:none" },
      h("input", { type: "checkbox", checked: table.header, onchange: (e) => { table.header = e.target.checked; changed(); draw(); } }), "الصف الأول عناوين");
    mount(box, h("div", { class: "xb-tbl" }, grid),
      h("div", { class: "xb-add" },
        btn("+ صف", addRow, "ghost sm"), btn("+ عمود", addCol, "ghost sm"), btn("- صف", delRow, "ghost sm"), btn("- عمود", delCol, "ghost sm"),
        btn("دمج مع المجاورة", mergeRight, "ghost sm"), btn("دمج مع التي تحتها", mergeDown, "ghost sm"), btn("فك الدمج", split, "ghost sm"), header));
  };
  draw();
  return box;
}

/* ---------- المحرر ---------- */
export function questionEditor(q, { base, onChange, onTypeChange, bankFields = null }) {
  const root = h("div");
  const changed = () => onChange?.(q);

  const draw = () => {
    const def = QTYPES[q.type];
    const type = select(Object.entries(QTYPES).map(([k, v]) => [k, v.label]), { value: q.type });
    type.addEventListener("change", () => {
      const keep = { text: q.text, marks: q.marks, difficulty: q.difficulty, image: q.image, solution: q.solution, notes: q.notes, unit: q.unit, lesson: q.lesson, bank_id: null };
      const fresh = newQuestion(type.value, q.marks);
      for (const k of Object.keys(q)) if (k !== "id") delete q[k];
      Object.assign(q, fresh, keep, { id: q.id || fresh.id });
      if (type.value === "table" && !q.table) q.table = newTable();
      changed(); onTypeChange?.(); draw();
    });
    const marks = input({ type: "number", min: 0.25, step: 0.25, value: q.marks, style: "max-width:110px" });
    marks.addEventListener("input", () => { q.marks = Number(marks.value) || 0; changed(); });
    const diff = select(Object.entries(DIFFICULTY), { value: q.difficulty || "medium" });
    diff.addEventListener("change", () => { q.difficulty = diff.value; changed(); });

    const parts = [
      h("div", { class: "row" }, field("نوع السؤال", type), field("الدرجة", marks), field("الصعوبة", diff)),
      bankFields,
      field(q.type === "fill" ? "نص السؤال (اكتب ____ مكان كل فراغ)" : q.type === "truefalse" ? "العبارة" : "نص السؤال",
        richInput(q.text, (v) => { q.text = v; changed(); }, { rows: q.type === "essay" ? 3 : 2 })),
    ];
    if (q.type === "fill") parts.push(btn("إدراج فراغ", () => {
      const ta = root.querySelector("textarea");
      insertPlain(ta, " ________ ");
    }, "ghost sm"));

    parts.push(typeBody(q, changed, draw));
    parts.push(h("details", { open: !!(q.image || q.table) || q.type === "image" || q.type === "table" },
      h("summary", { class: "small", style: "cursor:pointer;margin:8px 0" }, "صورة أو جدول داخل السؤال"),
      imageControls(q, base, changed),
      q.table ? h("div", { class: "spaced" }, tableEditor(q.table, changed),
        q.type !== "table" ? btn("إزالة الجدول", () => { q.table = null; changed(); draw(); }, "danger sm") : null)
        : btn("إضافة جدول", () => { q.table = newTable(); changed(); draw(); }, "ghost sm")));

    if (def.space) {
      const space = select(Object.entries(ANSWER_SPACE).map(([k, [l]]) => [k, l]), { value: q.space || "auto" });
      space.addEventListener("change", () => { q.space = space.value; changed(); });
      const lined = h("input", { type: "checkbox", checked: q.lined !== false, onchange: (e) => { q.lined = e.target.checked; changed(); } });
      parts.push(h("div", { class: "row" }, field("مساحة الإجابة في الورقة", space),
        h("label", { class: "row", style: "align-items:center;gap:6px;flex:none;margin-bottom:12px" }, lined, "خطوط للكتابة")));
    }

    parts.push(h("div", { class: "xb-teacher-only" }, h("b", {}, "للمعلم فقط — لا تظهر في ورقة الطالب"),
      def.space ? field(q.type === "essay" ? "عناصر الإجابة المتوقعة" : "الإجابة الصحيحة",
        richInput(q.answer, (v) => { q.answer = v; changed(); }, { rows: 2 })) : null,
      field("الحل النموذجي", richInput(q.solution, (v) => { q.solution = v; changed(); }, { rows: 2 })),
      field("ملاحظات التصحيح", richInput(q.notes, (v) => { q.notes = v; changed(); }, { rows: 1, math: false }))));
    mount(root, parts);
  };
  draw();
  return root;
}

function insertPlain(ta, text) {
  const { selectionStart: a, selectionEnd: b, value } = ta;
  ta.value = value.slice(0, a) + text + value.slice(b);
  ta.focus(); ta.setSelectionRange(a + text.length, a + text.length);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

// الأجزاء الخاصة بكل نوع
function typeBody(q, changed, redraw) {
  switch (q.type) {
    case "mcq": case "multi": return optionsEditor(q, changed, redraw);
    case "truefalse": {
      const mk = (val, label) => h("label", { class: "row", style: "align-items:center;gap:6px;flex:none" },
        h("input", { type: "radio", name: `tf-${q.id}`, checked: q.correct === val, onchange: () => { q.correct = val; changed(); } }), label);
      return field("الإجابة الصحيحة", h("div", { class: "row", style: "gap:18px" }, mk(true, "صح"), mk(false, "خطأ")));
    }
    case "fill": {
      const n = Math.max(1, countBlanks(q.text));
      q.answers = (q.answers || []).slice(0, Math.max(n, 1));
      return h("div", { class: "xb-teacher-only" }, h("b", {}, `إجابات الفراغات (${n})`),
        Array.from({ length: n }, (_, i) => {
          const el = input({ value: q.answers[i] || "", placeholder: `الفراغ ${i + 1}` });
          el.addEventListener("input", () => { q.answers[i] = el.value; changed(); });
          return h("div", { style: "margin-bottom:6px" }, el);
        }),
        btn("تحديث عدد الفراغات", redraw, "ghost sm"));
    }
    case "match": {
      const list = h("div");
      const draw = () => mount(list,
        h("div", { class: "xb-spec", style: "grid-template-columns:1fr 1fr 36px" }, h("b", { class: "small" }, "العمود (أ)"), h("b", { class: "small" }, "ما يقابله (ب)"), h("span")),
        (q.pairs || []).map((p, i) => {
          const l = input({ value: p.left, placeholder: `${i + 1}`, dir: "auto" });
          const r = input({ value: p.right, placeholder: "الإجابة المقابلة", dir: "auto" });
          l.addEventListener("input", () => { p.left = l.value; changed(); });
          r.addEventListener("input", () => { p.right = r.value; changed(); });
          return h("div", { class: "xb-spec", style: "grid-template-columns:1fr 1fr 36px" }, l, r,
            h("button", { type: "button", class: "xb-icon danger", "aria-label": "حذف", onclick: () => { q.pairs.splice(i, 1); changed(); draw(); } }, icons.trash({ size: 16 })));
        }),
        (q.pairs || []).length < 12 ? btn("+ زوج", () => { q.pairs.push({ id: uid("p"), left: "", right: "" }); changed(); draw(); }, "ghost sm") : null,
        h("small", { class: "sub" }, "اكتب كل عنصر مقابل إجابته الصحيحة. العمود (ب) يُخلط تلقائيًا في الورقة."));
      draw();
      return list;
    }
    case "order": {
      const list = h("div");
      const draw = () => mount(list, h("small", { class: "sub" }, "اكتب العناصر بالترتيب الصحيح. تُخلط تلقائيًا في الورقة."),
        (q.items || []).map((it, i) => {
          const el = input({ value: it.text, placeholder: `العنصر ${i + 1}`, dir: "auto" });
          el.addEventListener("input", () => { it.text = el.value; changed(); });
          const mv = (d) => { const j = i + d; if (j < 0 || j >= q.items.length) return; [q.items[i], q.items[j]] = [q.items[j], q.items[i]]; changed(); draw(); };
          return h("div", { class: "xb-opt" }, h("span", { class: "letter" }, i + 1), el,
            h("button", { type: "button", class: "xb-icon", "aria-label": "أعلى", onclick: () => mv(-1) }, icons.up({ size: 16 })),
            h("button", { type: "button", class: "xb-icon", "aria-label": "أسفل", onclick: () => mv(1) }, icons.down({ size: 16 })),
            h("button", { type: "button", class: "xb-icon danger", "aria-label": "حذف", onclick: () => { q.items.splice(i, 1); changed(); draw(); } }, icons.trash({ size: 16 })));
        }),
        (q.items || []).length < 12 ? btn("+ عنصر", () => { q.items.push({ id: uid("i"), text: "" }); changed(); draw(); }, "ghost sm") : null);
      draw();
      return list;
    }
    default: return null;
  }
}

function optionsEditor(q, changed) {
  const box = h("div");
  const multi = q.type === "multi";
  const draw = () => {
    const correct = new Set(q.correct || []);
    const cols = select([["", "ترتيب تلقائي"], ["1", "عمود واحد"], ["2", "عمودان"], ["4", "أربعة أعمدة"]], { value: q.cols || "" });
    cols.addEventListener("change", () => { if (cols.value) q.cols = Number(cols.value); else delete q.cols; changed(); });
    mount(box,
      h("small", { class: "sub" }, multi ? "حدد كل الإجابات الصحيحة" : "حدد الإجابة الصحيحة"),
      (q.options || []).map((o, i) => {
        const mark = h("input", { type: multi ? "checkbox" : "radio", name: `opt-${q.id}`, checked: correct.has(o.id), "aria-label": "إجابة صحيحة" });
        mark.addEventListener("change", () => {
          if (multi) q.correct = mark.checked ? [...new Set([...(q.correct || []), o.id])] : (q.correct || []).filter((x) => x !== o.id);
          else q.correct = [o.id];
          changed();
        });
        const text = input({ type: "text", value: o.text, placeholder: `الخيار ${OPTION_LETTERS[i]}`, dir: "auto" });
        const shown = h("span", { class: "xb-opt-math" });
        const paint = async () => { if (hasMath(o.text)) { await loadMath(); mount(shown, rich(o.text)); } else shown.replaceChildren(); };
        text.addEventListener("input", () => { o.text = text.value; changed(); paint(); });
        paint();
        return h("div", { class: "xb-opt" }, mark, h("span", { class: "letter" }, OPTION_LETTERS[i]), text, shown,
          h("button", { type: "button", class: "xb-icon danger", "aria-label": "حذف الخيار", onclick: () => {
            q.options.splice(i, 1); q.correct = (q.correct || []).filter((x) => x !== o.id); changed(); draw();
          } }, icons.trash({ size: 16 })));
      }),
      h("div", { class: "row", style: "align-items:center" },
        (q.options || []).length < 8 ? btn("+ خيار", () => { q.options.push({ id: uid("o"), text: "" }); changed(); draw(); }, "ghost sm") : null,
        field("عرض الخيارات", cols)));
  };
  draw();
  return box;
}
