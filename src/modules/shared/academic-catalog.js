// كتالوج جاهز: المراحل وصفوفها، والمواد المقترحة لكل مرحلة، وقوالب المدارس.
// كل ما يُولَّد منه قابل للتعديل والحذف والإضافة لاحقًا من لوحة الإدارة.

export const STAGES = {
  primary: {
    name: "المرحلة الابتدائية",
    grades: ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"],
    subjects: [
      { name: "القرآن الكريم", code: "QUR", weekly: 4 },
      { name: "التربية الإسلامية", code: "ISL", weekly: 4 },
      { name: "اللغة العربية", code: "ARB", weekly: 8 },
      { name: "الرياضيات", code: "MTH", weekly: 5 },
      { name: "العلوم", code: "SCI", weekly: 3 },
      { name: "الدراسات الاجتماعية", code: "SOC", weekly: 2 },
      { name: "اللغة الإنجليزية", code: "ENG", weekly: 3 },
      { name: "المهارات الرقمية", code: "ICT", weekly: 1 },
      { name: "التربية الفنية", code: "ART", weekly: 1 },
      { name: "التربية البدنية", code: "PED", weekly: 2 },
    ],
  },
  middle: {
    name: "المرحلة المتوسطة",
    grades: ["الأول المتوسط", "الثاني المتوسط", "الثالث المتوسط"],
    subjects: [
      { name: "القرآن الكريم", code: "QUR", weekly: 2 },
      { name: "التربية الإسلامية", code: "ISL", weekly: 4 },
      { name: "اللغة العربية", code: "ARB", weekly: 6 },
      { name: "الرياضيات", code: "MTH", weekly: 5 },
      { name: "العلوم", code: "SCI", weekly: 4 },
      { name: "الدراسات الاجتماعية", code: "SOC", weekly: 2 },
      { name: "اللغة الإنجليزية", code: "ENG", weekly: 4 },
      { name: "المهارات الرقمية", code: "ICT", weekly: 2 },
      { name: "التربية الفنية", code: "ART", weekly: 1 },
      { name: "التربية البدنية", code: "PED", weekly: 2 },
    ],
  },
  secondary: {
    name: "المرحلة الثانوية",
    grades: ["الأول الثانوي", "الثاني الثانوي", "الثالث الثانوي"],
    subjects: [
      { name: "التربية الإسلامية", code: "ISL", weekly: 3 },
      { name: "اللغة العربية", code: "ARB", weekly: 5 },
      { name: "الرياضيات", code: "MTH", weekly: 5 },
      { name: "الفيزياء", code: "PHY", weekly: 3 },
      { name: "الكيمياء", code: "CHE", weekly: 3 },
      { name: "الأحياء", code: "BIO", weekly: 3 },
      { name: "اللغة الإنجليزية", code: "ENG", weekly: 5 },
      { name: "الحاسب وعلومه", code: "ICT", weekly: 2 },
      { name: "التاريخ والجغرافيا", code: "SOC", weekly: 2 },
      { name: "التربية البدنية", code: "PED", weekly: 1 },
    ],
  },
  kindergarten: {
    name: "رياض الأطفال",
    grades: ["التمهيدي", "الروضة", "البستان"],
    subjects: [
      { name: "القرآن الكريم", code: "QUR", weekly: 3 },
      { name: "اللغة العربية", code: "ARB", weekly: 5 },
      { name: "الرياضيات", code: "MTH", weekly: 3 },
      { name: "اللغة الإنجليزية", code: "ENG", weekly: 2 },
      { name: "الأنشطة والفنون", code: "ART", weekly: 4 },
    ],
  },
};

// قوالب المدارس: أي قالب مجموعة مراحل
export const TEMPLATES = {
  primary: { name: "مدرسة ابتدائية", stages: ["primary"] },
  middle: { name: "مدرسة متوسطة", stages: ["middle"] },
  secondary: { name: "مدرسة ثانوية", stages: ["secondary"] },
  primary_middle: { name: "ابتدائي ومتوسط", stages: ["primary", "middle"] },
  middle_secondary: { name: "متوسط وثانوي", stages: ["middle", "secondary"] },
  full: { name: "مدرسة شاملة", stages: ["primary", "middle", "secondary"] },
  kg_primary: { name: "روضة وابتدائي", stages: ["kindergarten", "primary"] },
  empty: { name: "بدون قالب (أبني الهيكل بنفسي)", stages: [] },
};

// أنماط تسمية الشعب
export const SECTION_NAMING = {
  arabic: { name: "أ ب ج", labels: ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح", "ط", "ي"] },
  english: { name: "A B C", labels: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] },
  numeric: { name: "1 2 3", labels: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] },
};

export const SCHOOL_TYPES = { private: "أهلية", public: "حكومية", international: "عالمية", quran: "تحفيظ قرآن", other: "أخرى" };
export const GENDERS = { boys: "بنين", girls: "بنات", mixed: "مختلطة" };

/** اسم الشعبة: «الأول - أ» أو «Grade 1 - A» حسب النمط المختار */
export const sectionName = (gradeName, index, naming = "arabic") => {
  const labels = (SECTION_NAMING[naming] || SECTION_NAMING.arabic).labels;
  return `${gradeName} - ${labels[index] ?? index + 1}`;
};



/* =====================================================================
 * مكتبة المواد الكاملة: كل ما يُدرَّس في المدارس العربية (اليمن، السعودية،
 * الخليج، مصر، الأردن…) وما يُستخدم عالميًا في المدارس الدولية.
 * المدرسة تفعّل ما تحتاجه فقط، وتضيف أي مادة أخرى يدويًا.
 * ===================================================================== */
export const SUBJECT_LIBRARY = [
  { group: "العلوم الشرعية", items: [
    { name: "القرآن الكريم", code: "QUR", weekly: 4 },
    { name: "التجويد", code: "TJW", weekly: 1 },
    { name: "التربية الإسلامية", code: "ISL", weekly: 4 },
    { name: "التوحيد", code: "TWH", weekly: 1 },
    { name: "الفقه", code: "FQH", weekly: 2 },
    { name: "الحديث", code: "HDT", weekly: 1 },
    { name: "التفسير", code: "TFS", weekly: 1 },
    { name: "السيرة النبوية", code: "SRA", weekly: 1 },
  ]},
  { group: "اللغات", items: [
    { name: "اللغة العربية", code: "ARB", weekly: 6 },
    { name: "النحو والصرف", code: "NHW", weekly: 2 },
    { name: "الأدب والنصوص", code: "ADB", weekly: 2 },
    { name: "الإملاء والخط", code: "IML", weekly: 1 },
    { name: "القراءة", code: "QRA", weekly: 2 },
    { name: "اللغة الإنجليزية", code: "ENG", weekly: 4 },
    { name: "اللغة الفرنسية", code: "FRA", weekly: 2 },
    { name: "اللغة التركية", code: "TUR", weekly: 2 },
    { name: "اللغة الألمانية", code: "GER", weekly: 2 },
  ]},
  { group: "الرياضيات والعلوم", items: [
    { name: "الرياضيات", code: "MTH", weekly: 5 },
    { name: "الإحصاء", code: "STA", weekly: 1 },
    { name: "العلوم", code: "SCI", weekly: 4 },
    { name: "الفيزياء", code: "PHY", weekly: 3 },
    { name: "الكيمياء", code: "CHE", weekly: 3 },
    { name: "الأحياء", code: "BIO", weekly: 3 },
    { name: "علوم الأرض", code: "GEO", weekly: 1 },
    { name: "علم النفس", code: "PSY", weekly: 1 },
  ]},
  { group: "الاجتماعيات", items: [
    { name: "الدراسات الاجتماعية", code: "SOC", weekly: 2 },
    { name: "التاريخ", code: "HIS", weekly: 2 },
    { name: "الجغرافيا", code: "GGR", weekly: 2 },
    { name: "التربية الوطنية", code: "NAT", weekly: 1 },
    { name: "التربية الأسرية", code: "FAM", weekly: 1 },
    { name: "الفلسفة والمنطق", code: "PHI", weekly: 1 },
    { name: "علم الاجتماع", code: "SOY", weekly: 1 },
  ]},
  { group: "التقنية والمهارات", items: [
    { name: "المهارات الرقمية", code: "ICT", weekly: 2 },
    { name: "الحاسب وعلومه", code: "CSC", weekly: 2 },
    { name: "البرمجة", code: "PRG", weekly: 2 },
    { name: "الروبوت والذكاء الاصطناعي", code: "ROB", weekly: 1 },
    { name: "المهارات الحياتية", code: "LIF", weekly: 1 },
    { name: "التفكير الناقد", code: "CRT", weekly: 1 },
    { name: "المهنية والتقنية", code: "VOC", weekly: 2 },
  ]},
  { group: "الفنون والرياضة", items: [
    { name: "التربية الفنية", code: "ART", weekly: 1 },
    { name: "التربية البدنية", code: "PED", weekly: 2 },
    { name: "التربية الموسيقية", code: "MUS", weekly: 1 },
    { name: "المسرح والأنشطة", code: "ACT", weekly: 1 },
  ]},
  { group: "مواد إضافية", items: [
    { name: "النشاط الطلابي", code: "STU", weekly: 1 },
    { name: "الإرشاد الطلابي", code: "GID", weekly: 1 },
    { name: "الاقتصاد وإدارة الأعمال", code: "BUS", weekly: 2 },
    { name: "المحاسبة", code: "ACC", weekly: 2 },
    { name: "القانون", code: "LAW", weekly: 1 },
  ]},
];

/**
 * إعدادات الدولة: تُقترح تلقائيًا عند اختيار دولة المدرسة (وكلها قابلة للتغيير بعد ذلك).
 * dial: رمز الدولة لروابط واتساب، grade_set: تسمية الصفوف، days: أيام الدوام (0 = الأحد)،
 * holidays: إجازات رسمية ثابتة بالتاريخ الميلادي تُقترح في المعالج (الأعياد الهجرية تتغير كل سنة فتُضاف يدويًا).
 */
export const COUNTRIES = {
  YE: {
    name: "اليمن", currency: "YER", dial: "967", grade_set: "yemen", days: [0, 1, 2, 3, 4],
    phone_hint: "77xxxxxxx",
    // لا مناسبات ثابتة مقترحة: الأعياد الهجرية تتغير كل سنة وتضيفها المدرسة بتواريخها
    holidays: [],
  },
  SA: {
    name: "السعودية", currency: "SAR", dial: "966", grade_set: "arabic_full", days: [0, 1, 2, 3, 4],
    phone_hint: "05xxxxxxxx",
    holidays: [{ name: "اليوم الوطني", month: 9, day: 23 }, { name: "يوم التأسيس", month: 2, day: 22 }],
  },
  // دولة أخرى: لا تُغيَّر العملة ولا رمز الاتصال تلقائيًا (تُضبط يدويًا من الإعدادات)
  OTHER: { name: "دولة أخرى", currency: null, dial: "", grade_set: "arabic_basic", days: [0, 1, 2, 3, 4], phone_hint: "", holidays: [] },
};
export const DEFAULT_COUNTRY = "YE";
/** مفتاح الدولة من الاسم المحفوظ في ملف المدرسة (نص حر في المدارس القديمة) */
export const countryKey = (name) => {
  const v = String(name || "").trim();
  if (!v) return null;
  const hit = Object.entries(COUNTRIES).find(([k, c]) => c.name === v || k === v.toUpperCase());
  if (hit) return hit[0];
  if (/يمن|yemen/i.test(v)) return "YE";
  if (/سعود|saudi|المملكة/i.test(v)) return "SA";
  return "OTHER";
};

/* أنماط تسمية الصفوف: عربية كاملة، عربية مختصرة، ودولية */
export const GRADE_SETS = {
  arabic_full: {
    name: "السعودية والخليج (أول ابتدائي…)",
    primary: ["أول ابتدائي", "ثاني ابتدائي", "ثالث ابتدائي", "رابع ابتدائي", "خامس ابتدائي", "سادس ابتدائي"],
    middle: ["أول متوسط", "ثاني متوسط", "ثالث متوسط"],
    secondary: ["أول ثانوي", "ثاني ثانوي", "ثالث ثانوي"],
    kindergarten: ["البستان", "الروضة", "التمهيدي"],
  },
  arabic_short: {
    name: "رقمي (الأول، الثاني…)",
    primary: ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"],
    middle: ["السابع", "الثامن", "التاسع"],
    secondary: ["الأول ثانوي", "الثاني ثانوي", "الثالث ثانوي"],
    kindergarten: ["البستان", "الروضة", "التمهيدي"],
  },
  arabic_basic: {
    name: "الصف الأول … الصف التاسع، ثم أول ثانوي",
    primary: ["الصف الأول", "الصف الثاني", "الصف الثالث", "الصف الرابع", "الصف الخامس", "الصف السادس"],
    middle: ["الصف السابع", "الصف الثامن", "الصف التاسع"],
    secondary: ["أول ثانوي", "ثاني ثانوي", "ثالث ثانوي"],
    kindergarten: ["البستان", "الروضة", "التمهيدي"],
  },
  international: {
    name: "دولي (الصف 1…)",
    primary: ["الصف 1", "الصف 2", "الصف 3", "الصف 4", "الصف 5", "الصف 6"],
    middle: ["الصف 7", "الصف 8", "الصف 9"],
    secondary: ["الصف 10", "الصف 11", "الصف 12"],
    kindergarten: ["KG1", "KG2", "KG3"],
  },
  international_en: {
    name: "دولي بالإنجليزية (Grade 1…)",
    primary: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"],
    middle: ["Grade 7", "Grade 8", "Grade 9"],
    secondary: ["Grade 10", "Grade 11", "Grade 12"],
    kindergarten: ["KG1", "KG2", "KG3"],
  },
  // اليمن: الصفوف تُسمّى الأول والثاني… كما يقولها الناس، بلا كلمة «الأساسي»؛ والمرحلة وحدها تبيّن أنه أساسي
  yemen: {
    name: "اليمن (الأول… التاسع، ثم أول ثانوي)",
    primary: ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"],
    middle: ["السابع", "الثامن", "التاسع"],
    secondary: ["أول ثانوي", "ثاني ثانوي", "ثالث ثانوي"],
    kindergarten: ["البستان", "الروضة", "التمهيدي"],
    stage_names: { primary: "الأساسي (1–6)", middle: "الأساسي (7–9)", secondary: "الثانوي", kindergarten: "رياض الأطفال" },
  },
};

/** اسم المرحلة حسب نمط التسمية (اليمن: الأساسي والثانوي بدل الابتدائي والمتوسط) */
export const stageName = (stageKey, set) => GRADE_SETS[set]?.stage_names?.[stageKey] || STAGES[stageKey].name;

/** أسماء صفوف مرحلة حسب نمط التسمية المختار */
export const gradeNames = (stageKey, set = "arabic_full") =>
  (GRADE_SETS[set] || GRADE_SETS.arabic_full)[stageKey] || STAGES[stageKey].grades;


/** الكتالوج كاملًا للواجهة */
export const catalog = () => ({
  subject_library: SUBJECT_LIBRARY,
  grade_sets: Object.entries(GRADE_SETS).map(([key, g]) => ({
    key, name: g.name, sample: [g.primary[0], g.middle[0], g.secondary[0]].filter(Boolean).join(" / "),
    names: { primary: g.primary, middle: g.middle, secondary: g.secondary, kindergarten: g.kindergarten },
    stage_names: g.stage_names || null,
  })),
  countries: Object.entries(COUNTRIES).map(([key, c]) => ({ key, ...c })),
  stages: Object.entries(STAGES).map(([key, s]) => ({
    key, name: s.name, grades: s.grades,
    subjects: s.subjects.map((x) => ({ ...x })),
  })),
  templates: Object.entries(TEMPLATES).map(([key, t]) => ({
    key, name: t.name,
    stages: t.stages.map((k) => STAGES[k].name),
    grades: t.stages.reduce((n, k) => n + STAGES[k].grades.length, 0),
  })),
  naming: Object.entries(SECTION_NAMING).map(([key, n]) => ({ key, name: n.name, sample: n.labels.slice(0, 3).join(" ") })),
  school_types: Object.entries(SCHOOL_TYPES).map(([key, name]) => ({ key, name })),
  genders: Object.entries(GENDERS).map(([key, name]) => ({ key, name })),
});
