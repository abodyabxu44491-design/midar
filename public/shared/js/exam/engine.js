// محرك الاختبارات: منطق خالص بلا واجهة، يستخدمه الخادم والمتصفح معًا
// حتى يُحسب المجموع والنماذج ونموذج الإجابة بالطريقة نفسها في المكانين.
//
//   أنواع الأسئلة ← الأقسام ← محرك الدرجات ← النماذج المتعددة (ترتيب ثابت بالبذرة) ← نموذج الإجابة
//
// إضافة نوع سؤال جديد: أضفه في QTYPES هنا، وفي مخطط التحقق على الخادم، وفي محرر الأسئلة والعارض.

/* ---------- أنواع الأسئلة ---------- */
export const QTYPES = {
  mcq:       { label: "اختيار من متعدد", short: "اختيار", options: true, space: false },
  multi:     { label: "اختيار أكثر من إجابة", short: "متعدد", options: true, space: false },
  truefalse: { label: "صح أو خطأ", short: "صح/خطأ", options: false, space: false },
  fill:      { label: "أكمل الفراغ", short: "أكمل", options: false, space: false },
  short:     { label: "سؤال قصير", short: "قصير", options: false, space: true },
  essay:     { label: "سؤال مقالي", short: "مقالي", options: false, space: true },
  match:     { label: "توصيل", short: "توصيل", options: false, space: false },
  order:     { label: "ترتيب", short: "ترتيب", options: false, space: false },
  image:     { label: "سؤال بصورة", short: "صورة", options: false, space: true },
  table:     { label: "سؤال بجدول", short: "جدول", options: false, space: true },
  math:      { label: "سؤال رياضي", short: "رياضي", options: false, space: true },
  custom:    { label: "سؤال مخصص", short: "مخصص", options: false, space: true },
};
export const QTYPE_KEYS = Object.keys(QTYPES);

export const DIFFICULTY = { easy: "سهل", medium: "متوسط", hard: "صعب" };

// الأنواع الأساسية لكل مدرسة، ويضيف المعلم أنواعه من الإعدادات
export const DEFAULT_EXAM_TYPES = [
  "اختبار قصير", "اختبار أسبوعي", "اختبار شهري", "اختبار منتصف الفصل", "اختبار نهاية الفصل",
  "اختبار نهائي", "اختبار تجريبي", "واجب تقويمي", "تقييم قصير", "اختبار شفهي", "اختبار عملي", "اختبار مخصص",
];

export const STATUS = {
  draft: ["مسودة", "gray"], ready: ["جاهز", "amber"], approved: ["معتمد", ""],
  printed: ["تمت طباعته", "blue"], archived: ["مؤرشف", "gray"],
};

// مساحة الإجابة بعدد الأسطر (الصفحة الكاملة تُحسب عند التقسيم على الصفحات)
export const ANSWER_SPACE = {
  none: ["بدون مساحة", 0], small: ["صغيرة", 3], medium: ["متوسطة", 6], large: ["كبيرة", 11], page: ["صفحة كاملة", -1], auto: ["تلقائية", null],
};
export function spaceLines(q) {
  const key = q.space || "auto";
  if (key !== "auto") return ANSWER_SPACE[key]?.[1] ?? 0;
  // تلقائية: حسب الدرجة ونوع السؤال
  const base = q.type === "essay" ? 5 : q.type === "short" || q.type === "math" ? 2 : 3;
  return Math.min(14, base + Math.round(Number(q.marks || 1) * (q.type === "essay" ? 1 : 0.5)));
}

export const OPTION_LETTERS = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"];
export const VERSION_CODES = ["A", "B", "C", "D"];
export const ORDINALS = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر",
  "الحادي عشر", "الثاني عشر", "الثالث عشر", "الرابع عشر", "الخامس عشر"];

export const uid = (p = "q") => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;

/* ---------- إنشاء سؤال جديد بقيم افتراضية ---------- */
export function newQuestion(type = "mcq", marks = 1) {
  const q = { id: uid("q"), type, marks, text: "", difficulty: "medium" };
  switch (type) {
    case "mcq": case "multi":
      q.options = [0, 1, 2, 3].map(() => ({ id: uid("o"), text: "" }));
      q.correct = [];
      break;
    case "truefalse": q.correct = null; break;
    case "fill": q.answers = []; break;
    case "match":
      q.pairs = [0, 1, 2].map(() => ({ id: uid("p"), left: "", right: "" }));
      break;
    case "order":
      q.items = [0, 1, 2, 3].map(() => ({ id: uid("i"), text: "" }));
      break;
    case "table":
      q.table = newTable(3, 3);
      q.space = "small";
      break;
    case "essay": q.space = "medium"; q.lined = true; break;
    default: q.space = "auto"; q.lined = true;
  }
  return q;
}

export function newTable(rows = 3, cols = 3) {
  return { header: true, rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ t: "" }))) };
}

export const newSection = (title = "") => ({ id: uid("s"), title, instructions: "", questions: [] });

/* ---------- محرك الدرجات ---------- */
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

export function totals(content) {
  const sections = (content?.sections || []).map((s) => {
    const qs = s.questions || [];
    return { id: s.id, count: qs.length, total: round2(qs.reduce((a, q) => a + Number(q.marks || 0), 0)) };
  });
  const byType = {};
  const byDifficulty = {};
  for (const s of content?.sections || []) for (const q of s.questions || []) {
    byType[q.type] = (byType[q.type] || 0) + 1;
    byDifficulty[q.difficulty || "medium"] = (byDifficulty[q.difficulty || "medium"] || 0) + 1;
  }
  return {
    sections,
    count: sections.reduce((a, s) => a + s.count, 0),
    total: round2(sections.reduce((a, s) => a + s.total, 0)),
    byType, byDifficulty,
  };
}

// وصف القسم مثل: «10 أسئلة × 1 = 10 درجات» إذا كانت الدرجات متساوية
export function sectionSummary(section) {
  const qs = section.questions || [];
  if (!qs.length) return "بدون أسئلة";
  const total = round2(qs.reduce((a, q) => a + Number(q.marks || 0), 0));
  const same = qs.every((q) => Number(q.marks) === Number(qs[0].marks));
  return same && qs.length > 1
    ? `${qs.length} ${qs.length > 10 || qs.length < 3 ? "سؤال" : "أسئلة"} × ${fmtNum(qs[0].marks)} = ${fmtNum(total)} ${marksWord(total)}`
    : `${qs.length} ${qs.length > 10 || qs.length < 3 ? "سؤال" : "أسئلة"} — ${fmtNum(total)} ${marksWord(total)}`;
}
export const fmtNum = (n) => String(round2(n)).replace(/\.0+$/, "");
export const marksWord = (n) => (Number(n) === 1 ? "درجة" : Number(n) === 2 ? "درجتان" : Number(n) >= 3 && Number(n) <= 10 && Number.isInteger(Number(n)) ? "درجات" : "درجة");

// تنبيهات قبل الاعتماد: لا تمنع الحفظ، لكنها تظهر للمعلم وتمنع الاعتماد إن كانت حرجة
export function checkPaper(paper) {
  const t = totals(paper.content);
  const issues = [];
  if (!t.count) issues.push({ level: "error", text: "الاختبار بلا أسئلة" });
  if (paper.total_marks && Number(paper.total_marks) !== t.total) {
    issues.push({ level: "warn", text: `الدرجة النهائية المحددة (${fmtNum(paper.total_marks)}) لا تساوي مجموع درجات الأسئلة (${fmtNum(t.total)})` });
  }
  let n = 0;
  for (const s of paper.content?.sections || []) for (const q of s.questions || []) {
    n++;
    const where = `السؤال ${n}`;
    if (!String(q.text || "").trim() && !["match", "order"].includes(q.type) && !q.image) issues.push({ level: "error", text: `${where}: نص السؤال فارغ` });
    if (!(Number(q.marks) > 0)) issues.push({ level: "error", text: `${where}: الدرجة غير محددة` });
    if (q.type === "mcq" && (q.correct || []).length !== 1) issues.push({ level: "warn", text: `${where}: حدد الإجابة الصحيحة` });
    if (q.type === "multi" && !(q.correct || []).length) issues.push({ level: "warn", text: `${where}: حدد الإجابات الصحيحة` });
    if (QTYPES[q.type]?.options && (q.options || []).filter((o) => String(o.text).trim()).length < 2) issues.push({ level: "error", text: `${where}: يحتاج خيارين على الأقل` });
    if (q.type === "truefalse" && typeof q.correct !== "boolean") issues.push({ level: "warn", text: `${where}: حدد صح أو خطأ` });
    if (q.type === "match" && (q.pairs || []).filter((p) => p.left && p.right).length < 2) issues.push({ level: "error", text: `${where}: يحتاج زوجين على الأقل` });
    if (q.type === "order" && (q.items || []).filter((i) => i.text).length < 2) issues.push({ level: "error", text: `${where}: يحتاج عنصرين على الأقل` });
    if (q.type === "image" && !q.image) issues.push({ level: "error", text: `${where}: أضف الصورة` });
    if (q.type === "table" && !q.table) issues.push({ level: "error", text: `${where}: أضف الجدول` });
  }
  return { totals: t, issues, blocking: issues.some((i) => i.level === "error") };
}

/* ---------- النماذج المتعددة: عشوائية ثابتة بالبذرة ---------- */
// نفس البذرة = نفس الترتيب في كل مرة، فالنموذج B المطبوع اليوم هو نفسه غدًا
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// خلط يضمن أن الناتج يختلف عن الأصل إن أمكن (مهم للتوصيل والترتيب: لا يُطبع الحل جاهزًا)
function derange(arr, rand) {
  if (arr.length < 2) return arr.slice();
  for (let tries = 0; tries < 8; tries++) {
    const s = shuffled(arr, rand);
    if (s.some((x, i) => x !== arr[i])) return s;
  }
  return [...arr.slice(1), arr[0]];
}

/**
 * بناء نموذج من الاختبار.
 * النموذج A (index 0) يحافظ على ترتيب المعلم، والنماذج التالية تُخلط حسب الإعدادات.
 * الأعمدة في التوصيل والعناصر في الترتيب تُخلط دائمًا (حتى في A) لأن ترتيبها الأصلي هو الحل.
 */
export function buildVersion(paper, index = 0) {
  const seed = Number(paper.seed || 1);
  const shuffleQ = paper.shuffle_questions !== false && index > 0;
  const shuffleO = paper.shuffle_options !== false && index > 0;
  const rand = rng(seed * 31 + index * 7919 + 17);
  const sections = (paper.content?.sections || []).map((s) => {
    let qs = (s.questions || []).map((q) => {
      const c = { ...q };
      const qr = rng(hash(q.id) ^ (seed + index * 101));
      if (QTYPES[q.type]?.options && Array.isArray(q.options)) c.options = shuffleO ? shuffled(q.options, qr) : q.options.slice();
      if (q.type === "match" && Array.isArray(q.pairs)) c.rightOrder = derange(q.pairs.map((p) => p.id), qr);
      if (q.type === "order" && Array.isArray(q.items)) c.displayOrder = derange(q.items.map((i) => i.id), qr);
      return c;
    });
    if (shuffleQ) qs = shuffled(qs, rand);
    return { ...s, questions: qs };
  });
  return { code: VERSION_CODES[index] || "A", index, sections };
}

// ترقيم الأسئلة: متصل عبر الأقسام أو يبدأ من 1 في كل قسم
export function numbered(version, mode = "continuous") {
  let n = 0;
  return version.sections.map((s) => {
    if (mode === "per_section") n = 0;
    return { ...s, questions: s.questions.map((q) => ({ ...q, no: ++n })) };
  });
}

/* ---------- نموذج الإجابة ---------- */
export function answerOf(q) {
  const opts = q.options || [];
  const letterOf = (id) => OPTION_LETTERS[opts.findIndex((o) => o.id === id)] ?? "?";
  const textOf = (id) => opts.find((o) => o.id === id)?.text ?? "";
  switch (q.type) {
    case "mcq": case "multi": {
      const ids = (q.correct || []).filter((id) => opts.some((o) => o.id === id));
      ids.sort((a, b) => opts.findIndex((o) => o.id === a) - opts.findIndex((o) => o.id === b));
      return ids.length ? ids.map((id) => `(${letterOf(id)}) ${textOf(id)}`).join(" ، ") : "—";
    }
    case "truefalse": return q.correct === true ? "صح" : q.correct === false ? "خطأ" : "—";
    case "fill": return (q.answers || []).filter(Boolean).join(" ، ") || "—";
    case "match": {
      const order = q.rightOrder || (q.pairs || []).map((p) => p.id);
      return (q.pairs || []).map((p, i) => `${i + 1} ← ${OPTION_LETTERS[order.indexOf(p.id)] ?? "?"}`).join("   ");
    }
    case "order": {
      const shown = q.displayOrder || (q.items || []).map((i) => i.id);
      return (q.items || []).map((it) => OPTION_LETTERS[shown.indexOf(it.id)] ?? "?").join(" ← ");
    }
    default: return String(q.answer || "").trim() || "—";
  }
}

export function answerKey(paper, index = 0, numbering = "continuous") {
  const v = buildVersion(paper, index);
  return {
    code: v.code,
    sections: numbered(v, numbering).map((s) => ({
      title: s.title,
      rows: s.questions.map((q) => ({
        no: q.no, type: q.type, marks: q.marks, answer: answerOf(q),
        solution: String(q.solution || "").trim(), notes: String(q.notes || "").trim(),
      })),
    })),
  };
}

// إزالة كل ما يكشف الإجابة (لأي عرض لا يملك صلاحية نموذج الإجابة)
export function stripAnswers(content) {
  return {
    ...content,
    sections: (content?.sections || []).map((s) => ({
      ...s,
      questions: (s.questions || []).map(({ correct, answers, answer, solution, notes, ...q }) => q),
    })),
  };
}

/* ---------- تخطيط الورقة: القيم الافتراضية ---------- */
export const PAPER_TEMPLATES = {
  formal:   { label: "رسمي", note: "بسيط ومناسب للاختبارات الرسمية" },
  modern:   { label: "حديث", note: "تصميم عصري ومنظم" },
  simple:   { label: "بسيط", note: "أبيض وأسود للطباعة الاقتصادية" },
  academic: { label: "أكاديمي", note: "تنسيق رسمي بإطار مزدوج" },
  custom:   { label: "مخصص", note: "تعدّله كما تريد" },
};
export const PAPER_SIZES = { A4: [210, 297], A5: [148, 210], Letter: [216, 279] };
export const FONTS = {
  plex: ["IBM Plex Sans Arabic", "حديث (IBM Plex)"],
  naskh: ["Amiri", "نسخ تقليدي (أميري)"],
  kufi: ["Reem Kufi", "كوفي للعناوين"],
};
export const STUDENT_FIELDS = [
  ["name", "اسم الطالب"], ["grade", "الصف"], ["section", "الشعبة"], ["number", "رقم الطالب"], ["date", "التاريخ"], ["score", "الدرجة"],
];

export function defaultLayout() {
  return {
    template: "formal", paper: "A4", orientation: "portrait",
    margins: 14, font: "plex", fontSize: 13, spacing: "normal", heading_font: "same",
    color: true, show_logo: true, show_school: true, show_teacher: true, show_marks: true,
    show_version: true, page_numbers: true, show_duration: true, show_date: true,
    show_signature: true, show_instructions: true, numbering: "continuous",
    header_note: "", footer_text: "",
    student_fields: STUDENT_FIELDS.map(([key]) => key),
    extra_fields: [],
  };
}
export const withLayoutDefaults = (layout) => ({ ...defaultLayout(), ...(layout || {}) });
