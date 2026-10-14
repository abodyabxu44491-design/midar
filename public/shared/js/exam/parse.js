/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
//
import { newQuestion, uid, SECTION_TITLES } from "./engine.js";

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toLatin = (s) => String(s).replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d));

const LETTERS = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"];
const LATIN_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const letterIndex = (l) => {
  const x = l.replace(/^ه$/, "هـ").replace(/^ا$/, "أ");
  const i = LETTERS.indexOf(x);
  return i >= 0 ? i : LATIN_LETTERS.indexOf(x.toLowerCase());
};

const NUMBER = /^\s*(?:س\s*|سؤال\s*)?[(\[]?\s*[0-9٠-٩]{1,3}\s*[)\].\-ـ:/]\s*/;
const OPTION = /^\s*[(\[]?\s*(هـ|[أابجدهوزح]|[a-hA-H])\s*[)\]\-.:/]\s*/;
const BULLET = /^\s*[•●▪◦]\s*/;
const INLINE_OPTION = /(?:^|\s)[(\[]?(هـ|[أابجدهوزح]|[a-hA-H])\s*[)\]]\s*/g;
const CORRECT_MARK = /\s*(?:\*|✓|✔|☑|\(\s*صح(?:يح)?\s*\))\s*$/;
const CORRECT_MARK_START = /^\s*(?:\*|✓|✔|☑)\s*/;
const ANSWER_LINE = /^\s*(?:الإجابة|الاجابة|الجواب|الحل|الإجابة الصحيحة|الاجابة الصحيحة|answer)\s*[:：\-]\s*(.*)$/i;
const HEADING = /^\s*(?:السؤال|القسم|الجزء|المجموعة)\s+(?:ال\S+|[0-9٠-٩]+)(?:\s+\S+)?\s*(?:[:：\-ـ]|$)/;
const TF_TRUE = /^(?:صح|صحيح|صحيحة|√|✓|✔|true|t)$/i;
const TF_FALSE = /^(?:خطأ|خطا|خاطئ|خاطئة|×|✗|✘|x|false|f)$/i;
const TF_TAIL = /\s*[(\[]\s*(صح|صحيح|صحيحة|خطأ|خطا|خاطئ|خاطئة|√|✓|✔|×|✗|✘)\s*[)\]]\s*$/;
const MARKS_TAIL = /\s*[(\[]\s*([0-9٠-٩]+(?:[.,][0-9٠-٩]+)?)\s*(?:درجة|درجات|درجتان|درجتين|د)\s*[)\]]\s*$/;
const MARKS_TWO = /\s*[(\[]\s*(?:درجتان|درجتين)\s*[)\]]\s*$/;
const BLANK = /_{3,}|…{2,}|\.{4,}/g;
const HAS_BLANK = /_{3,}|…{2,}|\.{4,}/;
const TF_EMPTY = /\s*[(\[]\s*[)\]]\s*$/;
const PAIR = /^(.+?)\s*(?:=|←|→|⟵|⟶|\t|\s-{2,}\s|\s—\s)\s*(.+)$/;

const clean = (s) => String(s || "").replace(/‏|‎| /g, " ").replace(/[ \t]+$/g, "").replace(/^\s+/, "");

function typeFromHeading(title) {
  const t = String(title || "");
  if (/(^|[\s(«"])(صح|خطأ|خطا|صواب)($|[\s)»"])/.test(t)) return "truefalse";
  if (/أكمل|اكمل|املأ/.test(t)) return "fill";
  if (/صل|وصّل|وصل|توصيل|العمود/.test(t)) return "match";
  if (/رتب|رتّب|ترتيب/.test(t)) return "order";
  if (/اختر|اختيار|ضع دائرة/.test(t)) return "mcq";
  if (/مقال|اشرح|ناقش|اكتب موضوع/.test(t)) return "essay";
  return null;
}

export function parseQuestions(text, { marks = 1 } = {}) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map(clean);
  const sections = [];
  const warnings = [];
  let section = null;
  let block = null;

  const ensureSection = () => { if (!section) { section = { title: "", kind: null, questions: [] }; sections.push(section); } return section; };
  const flush = () => {
    if (!block) return;
    const q = buildQuestion(block, ensureSection().kind, marks, warnings);
    if (q) section.questions.push(q);
    block = null;
  };
  const start = (first) => { flush(); block = { head: [first], options: [], pairs: [], answer: null, numbered: true }; };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (block && !block.numbered) flush();
      continue;
    }
    if (HEADING.test(line) && !NUMBER.test(line)) {
      flush();
      section = { title: line.replace(/\s*[:：\-ـ]\s*$/, ""), kind: typeFromHeading(line), questions: [] };
      sections.push(section);
      continue;
    }
    const ans = line.match(ANSWER_LINE);
    if (ans && block) { block.answer = ans[1].trim(); continue; }
    if (NUMBER.test(line)) { start(line.replace(NUMBER, "")); continue; }
    if (!block && section?.kind === "match" && PAIR.test(line)) {
      block = { head: [], options: [], pairs: [], answer: null, numbered: true };
    }
    if (!block) { block = { head: [line], options: [], pairs: [], answer: null, numbered: false }; continue; }

    const opt = line.match(OPTION);
    const optionLike = opt && letterIndex(opt[1]) >= 0 && (block.options.length > 0 || letterIndex(opt[1]) === 0) && line.length > opt[0].length;
    if (optionLike || BULLET.test(line)) {
      block.options.push(line.replace(optionLike ? OPTION : BULLET, ""));
      continue;
    }
    const pair = !block.options.length && line.match(PAIR);
    if (pair) { block.pairs.push([pair[1].trim(), pair[2].trim()]); continue; }
    if (block.options.length) block.options[block.options.length - 1] += ` ${line}`;
    else if (!block.numbered && !/[:：،,]$/.test(block.head[block.head.length - 1] || "")) {
      flush(); block = { head: [line], options: [], pairs: [], answer: null, numbered: false };
    } else block.head.push(line);
  }
  flush();

  const out = sections.filter((s) => s.questions.length || s.title).map((s) => ({ title: s.title, questions: s.questions }));
  return { sections: out, count: out.reduce((a, s) => a + s.questions.length, 0), warnings };
}

function splitInlineOptions(text) {
  const marks = [...text.matchAll(INLINE_OPTION)];
  const firstIdx = marks.findIndex((m) => letterIndex(m[1]) === 0);
  if (firstIdx < 0 || marks.length - firstIdx < 2 || letterIndex(marks[firstIdx + 1][1]) !== 1) return null;
  const seq = [marks[firstIdx]];
  for (let i = firstIdx + 1; i < marks.length; i++) if (letterIndex(marks[i][1]) === seq.length) seq.push(marks[i]);
  const stem = text.slice(0, seq[0].index).trim();
  const options = seq.map((m, i) => text.slice(m.index + m[0].length, seq[i + 1] ? seq[i + 1].index : undefined).trim());
  return { stem, options };
}

function takeMarks(text, fallback) {
  if (MARKS_TWO.test(text)) return { text: text.replace(MARKS_TWO, ""), marks: 2 };
  const m = text.match(MARKS_TAIL);
  if (!m) return { text, marks: fallback };
  return { text: text.replace(MARKS_TAIL, ""), marks: Number(toLatin(m[1]).replace(",", ".")) || fallback };
}

function buildQuestion(b, kind, defMarks, warnings) {
  let text = b.head.join("\n").trim();
  let options = b.options.slice();
  if (!options.length) {
    const inline = splitInlineOptions(text);
    if (inline) { text = inline.stem; options = inline.options; }
  }
  let marks;
  ({ text, marks } = takeMarks(text, defMarks));
  if (!text && !options.length && !b.pairs.length) return null;

  if (options.length >= 2) {
    const correct = [];
    const opts = options.slice(0, 8).map((o, i) => {
      let t = o;
      if (CORRECT_MARK.test(t) || CORRECT_MARK_START.test(t)) { correct.push(i); t = t.replace(CORRECT_MARK, "").replace(CORRECT_MARK_START, ""); }
      return { id: uid("o"), text: t.trim() };
    });
    if (options.length > 8) warnings.push(`«${short(text)}»: أُخذت أول 8 خيارات فقط`);
    if (b.answer && !correct.length) {
      const a = b.answer.replace(/[()[\]\s.]/g, "");
      for (const part of a.split(/[،,و]+/).filter(Boolean)) {
        const i = letterIndex(part);
        if (i >= 0 && i < opts.length) correct.push(i);
        else { const j = opts.findIndex((o) => o.text === b.answer.trim()); if (j >= 0) correct.push(j); }
      }
    }
    const q = newQuestion(correct.length > 1 ? "multi" : "mcq", marks);
    q.text = text; q.options = opts; q.correct = [...new Set(correct)].map((i) => opts[i].id);
    return q;
  }

  if (b.pairs.length >= 2 || (kind === "match" && b.pairs.length)) {
    const q = newQuestion("match", marks);
    q.text = text;
    q.pairs = b.pairs.slice(0, 12).map(([left, right]) => ({ id: uid("p"), left, right }));
    return q;
  }
  if (b.pairs.length === 1) text = `${text}\n${b.pairs[0].join(" = ")}`.trim();

  const tf = text.match(TF_TAIL);
  const tfAnswer = !b.answer ? undefined : TF_TRUE.test(b.answer.trim()) ? true : TF_FALSE.test(b.answer.trim()) ? false : undefined;
  if (tf || (kind === "truefalse" && !HAS_BLANK.test(text)) || tfAnswer !== undefined || (TF_EMPTY.test(text) && kind !== "fill")) {
    const q = newQuestion("truefalse", marks);
    q.text = text.replace(TF_TAIL, "").replace(TF_EMPTY, "").trim();
    const v = tf ? tf[1] : b.answer?.trim();
    q.correct = v && TF_TRUE.test(v) ? true : v && TF_FALSE.test(v) ? false : null;
    return q;
  }

  if (HAS_BLANK.test(text) || kind === "fill") {
    const q = newQuestion("fill", marks);
    let body = text.replace(BLANK, "________");
    let answers = [];
    const tail = body.match(/\s*[(\[]([^()[\]]+)[)\]]\s*$/);
    if (tail && /_{3,}/.test(body.slice(0, tail.index))) { answers = tail[1].split(/[،,؛;]/).map((x) => x.trim()).filter(Boolean); body = body.slice(0, tail.index); }
    if (!answers.length && b.answer) answers = b.answer.split(/[،,؛;]/).map((x) => x.trim()).filter(Boolean);
    if (!/_{3,}/.test(body)) body = `${body} ________`;
    q.text = body.trim(); q.answers = answers;
    return q;
  }

  const type = kind === "essay" || text.length > 220 ? "essay" : "short";
  const q = newQuestion(type, marks);
  q.text = text;
  if (b.answer) q.answer = b.answer;
  return q;
}

const short = (s) => (String(s).length > 40 ? `${String(s).slice(0, 40)}…` : String(s));

export const sectionTitleFor = (ordinal, type) => `السؤال ${ordinal}: ${SECTION_TITLES[type] || ""}`.replace(/:\s*$/, "");
