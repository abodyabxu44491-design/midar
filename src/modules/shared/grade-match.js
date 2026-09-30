// التعرف على الصف والشعبة من نص حر (بدون تخمين خطير):
//   «الأول» / «الصف الأول» / «1» / «Grade 1» / «أول ابتدائي» / «الأول - أ»
// النتيجة دائمًا: مطابقة واحدة مؤكدة، أو عدة احتمالات تُعرض للمستخدم ليختار، أو لا شيء.

const DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** توحيد الحروف: ألف/همزات، ياء/ألف مقصورة، تاء مربوطة، الأرقام الهندية، المسافات */
export function norm(v) {
  return String(v ?? "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .toLowerCase().replace(/[_\-–—/\\.,،:()]+/g, " ").replace(/\s+/g, " ").trim();
}

const ORDINALS = new Map([
  [1, ["اول", "الاول", "اولى", "الاولى", "واحد", "الواحد", "first", "1st", "one"]],
  [2, ["ثاني", "الثاني", "ثانيه", "الثانيه", "اثنين", "two", "second", "2nd"]],
  [3, ["ثالث", "الثالث", "ثالثه", "الثالثه", "ثلاثه", "three", "third", "3rd"]],
  [4, ["رابع", "الرابع", "رابعه", "الرابعه", "اربعه", "four", "fourth", "4th"]],
  [5, ["خامس", "الخامس", "خامسه", "الخامسه", "خمسه", "five", "fifth", "5th"]],
  [6, ["سادس", "السادس", "سادسه", "السادسه", "سته", "six", "sixth", "6th"]],
  [7, ["سابع", "السابع", "سبعه", "seven", "seventh", "7th"]],
  [8, ["ثامن", "الثامن", "ثمانيه", "eight", "eighth", "8th"]],
  [9, ["تاسع", "التاسع", "تسعه", "nine", "ninth", "9th"]],
  [10, ["عاشر", "العاشر", "عشره", "ten", "tenth", "10th"]],
  [11, ["حادي عشر", "الحادي عشر", "eleven", "11th"]],
  [12, ["ثاني عشر", "الثاني عشر", "twelve", "12th"]],
]);
const WORD_TO_NUM = new Map();
for (const [n, words] of ORDINALS) for (const w of words) WORD_TO_NUM.set(w, n);

// كلمات المراحل: كل مجموعة تشير لمرحلة واحدة
const STAGE_WORDS = [
  ["primary", ["ابتدائي", "ابتدائيه", "الابتدائي", "الابتدائيه", "primary", "elementary"]],
  ["middle", ["متوسط", "المتوسط", "المتوسطه", "اعدادي", "الاعدادي", "الاعداديه", "middle", "intermediate"]],
  ["secondary", ["ثانوي", "الثانوي", "الثانويه", "secondary", "high"]],
  ["kindergarten", ["روضه", "الروضه", "تمهيدي", "التمهيدي", "بستان", "kg", "kindergarten"]],
];
const STAGE_OF_WORD = new Map();
for (const [key, words] of STAGE_WORDS) for (const w of words) STAGE_OF_WORD.set(w, key);
const NOISE = new Set(["الصف", "صف", "grade", "class", "year", "المرحله", "مرحله", "stage", "ال", "شعبه", "الشعبه", "فصل", "الفصل"]);

/** تحليل نص حر إلى { number, stage, tail } — tail الجزء المتبقي (غالبًا الشعبة) */
export function parseGradeText(text) {
  let tokens = norm(text).split(" ").filter(Boolean);
  // «الحادي عشر» / «ثاني عشر» كلمة واحدة
  const joined = [];
  for (let i = 0; i < tokens.length; i++) {
    const two = `${tokens[i]} ${tokens[i + 1] || ""}`.trim();
    if (WORD_TO_NUM.has(two)) { joined.push(two); i++; } else joined.push(tokens[i]);
  }
  tokens = joined;
  let number = null, stage = null;
  const rest = [];
  for (const tk of tokens) {
    const digit = /^(\d{1,2})(st|nd|rd|th)?$/.exec(tk);
    if (number === null && digit) number = Number(digit[1]);
    else if (number === null && WORD_TO_NUM.has(tk)) number = WORD_TO_NUM.get(tk);
    else if (STAGE_OF_WORD.has(tk)) stage = stage || STAGE_OF_WORD.get(tk);
    else if (!NOISE.has(tk)) rest.push(tk);
  }
  return { number, stage, tail: rest.join(" ") };
}

/** المرحلة التي ينتمي لها اسم مرحلة/صف في النظام (من كلماته) */
function stageKeyOf(text) {
  for (const tk of norm(text).split(" ")) if (STAGE_OF_WORD.has(tk)) return STAGE_OF_WORD.get(tk);
  return null;
}

/**
 * يبني فهرسًا من هيكل المدرسة: كل صف برقمه ومرحلته وشعبه.
 * structure = ما يعيده structure() : stages[].grades[].sections[]
 */
export function buildIndex(structure) {
  const grades = [];
  for (const st of structure.stages) {
    const stageKey = stageKeyOf(st.name) || stageKeyOf(st.code || "");
    for (const g of st.grades) {
      const p = parseGradeText(g.name);
      grades.push({
        grade_id: Number(g.id), grade_name: g.name, stage_id: Number(st.id), stage_name: st.name,
        stage_key: stageKey || p.stage, number: p.number, key: norm(g.name), stage_norm: norm(st.name),
        sections: (g.sections || []).map((c) => ({ id: Number(c.id), name: c.name, key: norm(c.name), short: sectionShort(c.name, g.name) })),
      });
    }
  }
  return grades;
}

// «الأول - أ» ← «ا» (الجزء الذي يميّز الشعبة عن اسم الصف)
function sectionShort(className, gradeName) {
  const c = norm(className), g = norm(gradeName);
  return c.startsWith(g) ? c.slice(g.length).trim() : c;
}

/**
 * مطابقة نص الصف (وقد يأتي معه مرحلة وشعبة في أعمدة مستقلة).
 * @returns {{ status:'exact'|'ambiguous'|'none', candidates:Array<{grade_id,label}>, grade?:object, section_text:string }}
 */
export function matchGrade(index, { grade, stage = "", section = "" }) {
  const raw = String(grade ?? "").trim();
  if (!raw) return { status: "none", candidates: [], section_text: norm(section) };
  const n = norm(raw);
  const label = (g) => `${g.grade_name} — ${g.stage_name}`;

  // 1) تطابق حرفي مع اسم صف أو «مرحلة + صف» أو اسم شعبة كاملة (مثل «الأول - أ»)
  const stageHint = stage ? (stageKeyOf(stage) || norm(stage)) : null;
  const byStage = (g) => !stageHint || g.stage_key === stageHint || g.stage_norm === norm(stage) || g.stage_norm.includes(norm(stage));
  const classHit = index.filter((g) => byStage(g) && g.sections.some((s) => s.key === n));
  if (classHit.length === 1) {
    const g = classHit[0];
    return { status: "exact", grade: g, candidates: [{ grade_id: g.grade_id, label: label(g) }], section_text: g.sections.find((s) => s.key === n).short, class_id: g.sections.find((s) => s.key === n).id };
  }
  const literal = index.filter((g) => byStage(g) && (g.key === n || norm(`${g.grade_name} ${g.stage_name}`) === n));
  // اسم صف بلا كلمة مرحلة («الأول») قد يوجد مثله في مراحل أخرى: لا نعتبره مؤكدًا إلا إذا كان رقمه فريدًا في المدرسة
  const literalSafe = literal.length === 1 && (
    stageKeyOf(literal[0].grade_name) !== null || stageHint !== null
    || index.filter((g) => g.number !== null && g.number === literal[0].number).length <= 1);
  if (literalSafe) {
    return { status: "exact", grade: literal[0], candidates: [{ grade_id: literal[0].grade_id, label: label(literal[0]) }], section_text: norm(section) };
  }

  // 2) تحليل ذكي: رقم + مرحلة (من النص أو من عمود المرحلة) + شعبة ملحقة
  const p = parseGradeText(raw);
  const sectionText = norm(section) || p.tail;
  if (p.number === null) return { status: "none", candidates: [], section_text: sectionText };
  const wantedStage = stageHint || p.stage;
  let pool = index.filter((g) => g.number === p.number);
  if (wantedStage) {
    const narrowed = pool.filter((g) => g.stage_key === wantedStage || g.stage_norm === wantedStage);
    if (narrowed.length) pool = narrowed;
    else if (stage) pool = [];   // ذكر المستخدم مرحلة صراحة ولا صف بهذا الرقم فيها: لا نقفز لمرحلة أخرى
  }
  if (pool.length === 1) return { status: "exact", grade: pool[0], candidates: [{ grade_id: pool[0].grade_id, label: label(pool[0]) }], section_text: sectionText };
  if (pool.length > 1) return { status: "ambiguous", candidates: pool.map((g) => ({ grade_id: g.grade_id, label: label(g) })), section_text: sectionText };
  return { status: "none", candidates: [], section_text: sectionText };
}

/** يحدد class_id من الصف المطابق والشعبة المكتوبة. مدرسة بلا شعب: الشعبة الوحيدة للصف. */
export function pickSection(grade, sectionText, sectionsEnabled) {
  if (!grade) return { status: "none" };
  const secs = grade.sections;
  if (!secs.length) return { status: "no_sections" };
  if (!sectionsEnabled || secs.length === 1 && !sectionText) return { status: "ok", class_id: secs[0].id };
  if (!sectionText) return { status: secs.length === 1 ? "ok" : "need_section", class_id: secs.length === 1 ? secs[0].id : null, options: secs };
  const t = norm(sectionText);
  const hit = secs.filter((s) => s.short === t || s.key === t || s.key === norm(`${grade.grade_name} ${t}`) || s.short.endsWith(` ${t}`) || s.short === t.replace(/^ال/, ""));
  if (hit.length === 1) return { status: "ok", class_id: hit[0].id };
  return { status: "bad_section", options: secs };
}
