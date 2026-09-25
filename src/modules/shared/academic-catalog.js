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

/** الكتالوج كاملًا للواجهة */
export const catalog = () => ({
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
