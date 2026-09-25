// محرك العرض: يحوّل الاختبار (نموذجًا واحدًا) إلى كتل جاهزة للتقسيم على الصفحات.
// كل كتلة { el, keep } حيث keep = «لا تفصلني عن الكتلة التالية» (عنوان القسم مع أول سؤال، والسؤال مع أول أسطر إجابته).
import { h } from "../dom.js";
import { rich } from "./math.js";
import {
  OPTION_LETTERS, QTYPES, FONTS, numbered, spaceLines, fmtNum, marksWord, sectionSummary, totals, withLayoutDefaults,
} from "./engine.js";

const FIELD_LABEL = { name: "اسم الطالب", grade: "الصف", section: "الشعبة", number: "رقم الطالب", date: "التاريخ", score: "الدرجة" };

// أنماط الورقة كمتغيرات CSS على الصفحة
export function pageVars(layoutIn) {
  const L = withLayoutDefaults(layoutIn);
  const sizes = { A4: [210, 297], A5: [148, 210], Letter: [216, 279] };
  let [w, hh] = sizes[L.paper] || sizes.A4;
  if (L.orientation === "landscape") [w, hh] = [hh, w];
  const font = FONTS[L.font]?.[0] || FONTS.plex[0];
  const head = L.heading_font === "same" ? font : FONTS[L.heading_font]?.[0] || font;
  const gap = { compact: 0.55, normal: 0.9, relaxed: 1.35 }[L.spacing] || 0.9;
  return {
    L, w, h: hh,
    style: `--pw:${w}mm;--ph:${hh}mm;--pm:${L.margins}mm;--pf:'${font}';--phf:'${head}';--pfs:${L.fontSize}pt;--pgap:${gap}em`,
    cls: `xp-page tpl-${L.template}${L.color ? "" : " xp-bw"} sp-${L.spacing}`,
  };
}

const marksTag = (L, m) => (L.show_marks ? h("span", { class: "xp-marks" }, `(${fmtNum(m)} ${marksWord(m)})`) : null);

function imageEl(q, imageUrl) {
  if (!q.image?.id) return null;
  return h("div", { class: `xp-img al-${q.image.align || "center"}` },
    h("img", { src: imageUrl(q.image.id), alt: "", style: `width:${q.image.width || 60}%`, loading: "eager", decoding: "sync" }));
}

export function tableEl(table, { editable = false } = {}) {
  if (!table?.rows?.length) return null;
  return h("table", { class: "xp-table" },
    table.rows.map((row, ri) => h("tr", {}, row.map((c) => (c.hide ? null
      : h(table.header && ri === 0 ? "th" : "td", { colSpan: c.cs || 1, rowSpan: c.rs || 1 }, editable ? null : rich(c.t)))))));
}

function linesEl(n, lined, cls = "") {
  return h("div", { class: `xp-lines ${lined === false ? "plain" : ""} ${cls}` }, Array.from({ length: n }, () => h("div", { class: "xp-line" })));
}

// عمود الخيارات: تلقائي حسب طول أطول خيار
function optionCols(q) {
  if (q.cols) return q.cols;
  const max = Math.max(0, ...(q.options || []).map((o) => String(o.text || "").length));
  const any = (q.options || []).some((o) => /\$/.test(o.text || ""));
  if (max <= 12 && !any && (q.options || []).length === 4) return 4;
  return max <= 30 ? 2 : 1;
}

/**
 * كتل سؤال واحد.
 * showAnswers: لمعاينة نموذج الإجابة داخل الورقة (المعلم فقط).
 */
export function questionBlocks(q, L, { imageUrl, showAnswers = false }) {
  const blocks = [];
  const def = QTYPES[q.type] || QTYPES.custom;
  const img = imageEl(q, imageUrl);
  const body = h("div", { class: `xp-q t-${q.type}`, "data-qid": q.id });
  const head = h("div", { class: "xp-qhead" },
    h("span", { class: "xp-no" }, `${q.no}`),
    h("div", { class: "xp-qtext" },
      q.type === "fill" ? rich(q.text, { blanks: true, answers: showAnswers ? q.answers : null }) : rich(q.text),
      q.type === "multi" ? h("span", { class: "xp-hint" }, " (اختر كل الإجابات الصحيحة)") : null,
      q.type === "truefalse" ? h("span", { class: `xp-tf${showAnswers && typeof q.correct === "boolean" ? " filled" : ""}` },
        showAnswers && typeof q.correct === "boolean" ? (q.correct ? "صح" : "خطأ") : "") : null),
    marksTag(L, q.marks));
  if (img && q.image.position === "before") body.append(img);
  body.append(head);
  if (img && q.image.position !== "before") body.append(img);
  if (q.table) body.append(tableEl(q.table));

  if (def.options) {
    const correct = new Set(q.correct || []);
    body.append(h("ol", { class: `xp-opts c${optionCols(q)}` }, (q.options || []).map((o, i) =>
      h("li", { class: showAnswers && correct.has(o.id) ? "ok" : "" },
        h("span", { class: "xp-letter" }, `${OPTION_LETTERS[i]})`), h("span", {}, rich(o.text))))));
  }
  if (q.type === "fill" && !/_{3,}/.test(q.text || "")) body.append(linesEl(1, true));

  if (q.type === "match") {
    const order = q.rightOrder || (q.pairs || []).map((p) => p.id);
    const right = order.map((id) => (q.pairs || []).find((p) => p.id === id)).filter(Boolean);
    body.append(h("table", { class: "xp-match" },
      h("tr", {}, h("th", {}, "العمود (أ)"), h("th", { class: "xp-slot-h" }, ""), h("th", {}, "العمود (ب)")),
      (q.pairs || []).map((p, i) => h("tr", {},
        h("td", {}, h("b", {}, `${i + 1}- `), rich(p.left)),
        h("td", { class: `xp-slot${showAnswers ? " filled" : ""}` }, showAnswers ? `${OPTION_LETTERS[order.indexOf(p.id)]}` : "(      )"),
        h("td", {}, right[i] ? [h("b", {}, `${OPTION_LETTERS[i]}) `), rich(right[i].right)] : "")))));
  }

  if (q.type === "order") {
    const shown = (q.displayOrder || (q.items || []).map((i) => i.id)).map((id) => (q.items || []).find((i) => i.id === id)).filter(Boolean);
    const rank = new Map((q.items || []).map((it, i) => [it.id, i + 1]));
    body.append(h("ol", { class: "xp-order" }, shown.map((it, i) => h("li", {},
      h("span", { class: `xp-slot${showAnswers ? " filled" : ""}` }, showAnswers ? `${rank.get(it.id)}` : "(    )"),
      h("span", { class: "xp-letter" }, `${OPTION_LETTERS[i]})`), rich(it.text)))));
  }

  if (showAnswers && def.space && q.answer) body.append(h("div", { class: "xp-model" }, h("b", {}, "الإجابة: "), rich(q.answer)));

  // مساحة الإجابة: أسطر مستقلة قابلة للانتقال للصفحة التالية، والسؤال يبقى مع أول سطرين
  if (def.space && !showAnswers) {
    if (q.space === "page") {
      blocks.push({ el: body, keep: true });
      blocks.push({ el: h("div", { class: `xp-fill ${q.lined === false ? "plain" : ""}` }), fillPage: true, lined: q.lined !== false });
      return blocks;
    }
    const n = spaceLines(q);
    if (n > 0) {
      const first = Math.min(2, n);
      body.append(linesEl(first, q.lined));
      blocks.push({ el: body, keep: n > first });
      for (let i = first; i < n; i++) blocks.push({ el: linesEl(1, q.lined, "xp-more"), keep: false, lineOf: q.id });
      return blocks;
    }
  }
  blocks.push({ el: body });
  return blocks;
}

/* ---------- الترويسة ---------- */
function infoLine(label, value) {
  return h("div", { class: "xp-info" }, h("span", { class: "xp-lbl" }, `${label}: `), h("span", { class: "xp-val" }, value ?? ""));
}

export function headerBlock(paper, L, { school, logoUrl, versionCode, total }) {
  const logo = L.show_logo && logoUrl ? h("img", { class: "xp-logo", src: logoUrl, alt: "" }) : null;
  const gradeText = [paper.grade_name, paper.class_name && paper.class_name !== paper.grade_name ? paper.class_name : null].filter(Boolean).join(" — ");
  const schoolSide = h("div", { class: "xp-h-school" },
    L.header_note ? L.header_note.split("\n").map((l) => h("div", { class: "xp-note" }, l)) : null,
    L.show_school && school ? h("div", { class: "xp-school" }, school) : null,
    L.show_teacher && paper.teacher_name ? infoLine("المعلم", paper.teacher_name) : null);
  const examSide = h("div", { class: "xp-h-exam" },
    infoLine("المادة", paper.subject_name),
    gradeText ? infoLine("الصف", gradeText) : null,
    L.show_date && paper.exam_date ? infoLine("التاريخ", paper.exam_date) : null,
    L.show_duration && paper.duration_min ? infoLine("الزمن", `${paper.duration_min} دقيقة`) : null,
    L.show_marks ? infoLine("الدرجة النهائية", fmtNum(paper.total_marks || total)) : null);
  const titleRow = h("div", { class: "xp-title-row" },
    h("div", { class: "xp-title" }, paper.title),
    h("div", { class: "xp-subtitle" }, paper.exam_type),
    L.show_version && versionCode ? h("div", { class: "xp-version" }, `نموذج ${versionCode}`) : null);
  return h("header", { class: "xp-header" },
    h("div", { class: "xp-h-grid" }, schoolSide, h("div", { class: "xp-h-logo" }, logo), examSide), titleRow);
}

export function studentBlock(L, { total, student }) {
  const fields = (L.student_fields || []).map((k) => [k, FIELD_LABEL[k]]).concat((L.extra_fields || []).map((l, i) => [`x${i}`, l]));
  if (!fields.length) return null;
  const val = (k) => (student ? { name: student.name, grade: student.grade_name, section: student.class_name, number: student.number }[k] : null);
  return h("div", { class: "xp-student" }, fields.map(([k, label]) =>
    h("div", { class: `xp-field f-${k}` }, h("span", { class: "xp-lbl" }, `${label}:`),
      k === "score"
        ? h("span", { class: "xp-score" }, h("span", { class: "xp-u short" }), ` / ${fmtNum(total)}`)
        : h("span", { class: "xp-u", "data-field": k }, val(k) ?? ""))));
}

function instructionsBlock(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  return h("div", { class: "xp-instructions" }, h("b", {}, "التعليمات:"),
    h("ul", {}, lines.map((l) => h("li", {}, rich(l.replace(/^[-•*]\s*/, ""))))));
}

function sectionHead(s, L) {
  const t = s.questions.reduce((a, q) => a + Number(q.marks || 0), 0);
  return h("div", { class: "xp-section" },
    h("div", { class: "xp-s-title" }, h("span", {}, s.title || ""), L.show_marks ? h("span", { class: "xp-s-marks" }, `${fmtNum(t)} ${marksWord(t)}`) : null),
    s.instructions ? h("div", { class: "xp-s-ins" }, rich(s.instructions)) : null);
}

/**
 * كل كتل ورقة الطالب لنموذج واحد.
 * يعيد { blocks, running } حيث running ترويسة مختصرة للصفحات التالية.
 */
export function paperBlocks({ paper, version, layout, school, logoUrl, imageUrl, showAnswers = false }) {
  const L = withLayoutDefaults(layout);
  const total = totals(paper.content).total;
  const blocks = [];
  blocks.push({ el: headerBlock(paper, L, { school, logoUrl, versionCode: paper.versions > 1 ? version.code : null, total }), keep: true });
  const st = studentBlock(L, { total: paper.total_marks || total, student: null });
  if (st) blocks.push({ el: st, keep: true, student: true });
  if (L.show_instructions) { const ins = instructionsBlock(paper.instructions); if (ins) blocks.push({ el: ins, keep: true }); }
  for (const s of numbered(version, L.numbering)) {
    if (!s.questions.length && !s.title) continue;
    if (s.title || s.instructions) blocks.push({ el: sectionHead(s, L), keep: true });
    for (const q of s.questions) blocks.push(...questionBlocks(q, L, { imageUrl, showAnswers }));
  }
  blocks.push({
    el: h("div", { class: "xp-end" }, h("div", { class: "xp-end-line" }, "انتهت الأسئلة"),
      L.show_signature ? h("div", { class: "xp-sign" }, h("span", {}, "توقيع المعلم: ", h("span", { class: "xp-u" })), h("span", {}, "توقيع المراجع: ", h("span", { class: "xp-u" }))) : null),
  });
  const running = h("div", { class: "xp-running" }, h("span", {}, paper.title), h("span", {}, paper.subject_name),
    L.show_version && paper.versions > 1 ? h("span", {}, `نموذج ${version.code}`) : null);
  return { blocks, running, L };
}

/* ---------- نموذج الإجابة: وثيقة منفصلة عن ورقة الطالب ---------- */
export function answerKeyBlocks({ paper, key, layout, school, logoUrl }) {
  const L = withLayoutDefaults(layout);
  const blocks = [];
  blocks.push({
    el: h("header", { class: "xp-header xp-key-head" },
      h("div", { class: "xp-h-grid" },
        h("div", { class: "xp-h-school" }, L.show_school && school ? h("div", { class: "xp-school" }, school) : null,
          paper.teacher_name ? infoLine("المعلم", paper.teacher_name) : null),
        h("div", { class: "xp-h-logo" }, L.show_logo && logoUrl ? h("img", { class: "xp-logo", src: logoUrl, alt: "" }) : null),
        h("div", { class: "xp-h-exam" }, infoLine("المادة", paper.subject_name), infoLine("الدرجة النهائية", fmtNum(paper.total_marks || paper.computed_marks)))),
      h("div", { class: "xp-title-row" }, h("div", { class: "xp-title" }, "نموذج الإجابة الرسمي"),
        h("div", { class: "xp-subtitle" }, paper.title), paper.versions > 1 ? h("div", { class: "xp-version" }, `نموذج ${key.code}`) : null),
      h("div", { class: "xp-confidential" }, "سري — للمعلم والمصحح فقط")),
    keep: true,
  });
  for (const s of key.sections) {
    if (s.title) blocks.push({ el: h("div", { class: "xp-section" }, h("div", { class: "xp-s-title" }, h("span", {}, s.title))), keep: true });
    blocks.push({ el: h("div", { class: "xp-key-row xp-key-th" }, h("span", {}, "رقم"), h("span", {}, "الإجابة الصحيحة"), h("span", {}, "الدرجة")), keep: true });
    for (const r of s.rows) {
      blocks.push({
        el: h("div", { class: "xp-key-row" },
          h("span", { class: "xp-no" }, r.no),
          h("div", {}, h("div", {}, rich(r.answer)),
            r.solution ? h("div", { class: "xp-model" }, h("b", {}, "الحل النموذجي: "), rich(r.solution)) : null,
            r.notes ? h("div", { class: "xp-key-notes" }, h("b", {}, "ملاحظات التصحيح: "), rich(r.notes)) : null),
          h("span", {}, fmtNum(r.marks))),
      });
    }
  }
  const running = h("div", { class: "xp-running" }, h("span", {}, "نموذج الإجابة"), h("span", {}, paper.title), paper.versions > 1 ? h("span", {}, `نموذج ${key.code}`) : null);
  return { blocks, running, L };
}

export { sectionSummary };
