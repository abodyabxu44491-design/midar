/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Certificate designs as data: an A4 page and freely placed elements, in millimetres from the page's
// top-left corner. Shared by the server (validation, defaults) and the browser (designer, print).
// No imports: the server reads this file too.

export const PAGE = { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } };
export const FONTS = { amiri: "Amiri, serif", plex: "'IBM Plex Sans Arabic', sans-serif", reem: "'Reem Kufi', sans-serif" };
export const FONT_LABELS = { amiri: "أميري (رسمي)", plex: "بلكس (واضح)", reem: "ريم كوفي (عناوين)" };
export const ELEMENT_TYPES = ["text", "image", "logo", "qr", "table", "line", "rect", "signature"];
export const BORDERS = { none: "بلا إطار", line: "خط واحد", double: "خط مزدوج", classic: "إطار رسمي", ornate: "إطار مزخرف", band: "شريط عريض" };
export const KINDS = { term: "شهادة نتيجة فصل", year: "شهادة إتمام عام", custom: "شهادة مخصصة / تقدير", course: "شهادة إتمام دورة", attendance: "إفادة حضور", any: "كل الأنواع" };

// Data fields a text may contain as {{key}}; filled from the certificate when it is printed.
export const FIELDS = [
  ["school", "اسم المؤسسة"], ["student", "اسم الطالب / المتدرب"], ["class_name", "الصف والشعبة"], ["title", "عنوان الشهادة"],
  ["scope", "الفصل / العام الدراسي"], ["result", "النتيجة"], ["percent", "النسبة"], ["grade", "التقدير العام"], ["total", "المجموع"],
  ["max", "الدرجة الكاملة"], ["rank", "الترتيب"], ["attendance", "نسبة الحضور"], ["absent", "أيام الغياب"], ["body", "نص الشهادة المخصصة"],
  ["course", "اسم الدورة"], ["program", "البرنامج"], ["hours", "عدد الساعات"], ["completed_on", "تاريخ الإكمال"], ["mode", "نظام التدريب"],
  ["serial", "رقم الشهادة"], ["code", "رمز التحقق"], ["issued_at", "تاريخ الإصدار"], ["signer_title", "صفة الموقّع"], ["signer_name", "اسم الموقّع"],
  ["approval_note", "عبارة الاعتماد الداخلي"], ["footer_note", "ملاحظة أسفل الشهادة"], ["verify_url", "رابط التحقق"],
];

const NAVY = "#16244A", TEAL = "#0B7A75", GOLD = "#B08D3C", MUTED = "#5F6B7A", INK = "#1A2233";
let n = 0;
const el = (type, x, y, w, h, extra = {}) => ({ id: `e${++n}`, type, x, y, w, h, rot: 0, locked: false, hidden: false, ...extra });
const txt = (x, y, w, h, text, style = {}) => el("text", x, y, w, h, { text, style: { font: "plex", size: 12, bold: false, color: INK, align: "center", lh: 1.5, fit: true, ...style } });

function classic() {
  n = 0;
  return {
    v: 1,
    page: { orientation: "portrait", bg: "#FFFFFF", bgAsset: null, border: { style: "classic", color: NAVY, accent: GOLD, width: 1.2, inset: 8 } },
    els: [
      el("logo", 90, 17, 30, 24),
      txt(20, 43, 170, 9, "{{school}}", { size: 16, bold: true, color: NAVY }),
      el("line", 80, 54, 50, 0.8, { style: { color: GOLD } }),
      txt(15, 58, 180, 16, "{{title}}", { font: "amiri", size: 30, bold: true, color: NAVY }),
      txt(20, 75, 170, 8, "{{scope}}", { size: 12, color: MUTED }),
      txt(20, 87, 170, 8, "تشهد إدارة {{school}} بأن الطالب", { font: "amiri", size: 15 }),
      txt(20, 96, 170, 14, "{{student}}", { font: "amiri", size: 26, bold: true, color: NAVY }),
      txt(20, 111, 170, 8, "من {{class_name}} قد حصل على النتيجة الموضحة أدناه.", { font: "amiri", size: 14 }),
      el("table", 22, 123, 166, 88, { style: { size: 10, headBg: "#E8ECF4", headColor: NAVY, line: "#C9D1DE", score: true, max: true, percent: true, grade: true, total: true } }),
      txt(20, 214, 170, 10, "النتيجة: {{result}} — النسبة {{percent}}", { size: 15, bold: true, color: TEAL }),
      txt(20, 225, 170, 6, "{{approval_note}}", { size: 9, color: MUTED }),
      el("qr", 22, 236, 30, 30),
      txt(14, 267, 46, 6, "{{code}}", { size: 8, color: MUTED }),
      txt(70, 245, 70, 16, "رقم الشهادة {{serial}}\nتاريخ الإصدار {{issued_at}}", { size: 10, color: MUTED }),
      el("signature", 140, 238, 50, 30, { style: { font: "plex", size: 11, color: INK } }),
    ],
  };
}

function modern() {
  n = 0;
  return {
    v: 1,
    page: { orientation: "portrait", bg: "#FFFFFF", bgAsset: null, border: { style: "none", color: TEAL, accent: TEAL, width: 1, inset: 8 } },
    els: [
      el("rect", 0, 0, 210, 46, { style: { bg: NAVY, bc: NAVY, bw: 0, br: 0 } }),
      el("logo", 167, 9, 28, 28),
      txt(15, 12, 145, 11, "{{school}}", { size: 18, bold: true, color: "#FFFFFF", align: "right" }),
      txt(15, 25, 145, 8, "{{scope}}", { size: 12, color: "#C9D6EE", align: "right" }),
      el("rect", 0, 46, 210, 2.5, { style: { bg: TEAL, bc: TEAL, bw: 0, br: 0 } }),
      txt(15, 60, 180, 16, "{{title}}", { font: "reem", size: 26, bold: true, color: TEAL }),
      txt(20, 82, 170, 8, "تشهد إدارة المدرسة بأن الطالب", { size: 13, color: MUTED }),
      txt(20, 91, 170, 14, "{{student}}", { size: 24, bold: true, color: NAVY }),
      txt(20, 106, 170, 8, "{{class_name}}", { size: 13, color: MUTED }),
      el("table", 18, 120, 174, 90, { style: { size: 10, headBg: TEAL, headColor: "#FFFFFF", line: "#D5DEE6", score: true, max: true, percent: true, grade: true, total: true } }),
      el("rect", 18, 214, 174, 14, { style: { bg: "#E3F1F0", bc: "#E3F1F0", bw: 0, br: 3 } }),
      txt(20, 216, 170, 10, "النتيجة: {{result}} — النسبة {{percent}} — التقدير {{grade}}", { size: 13, bold: true, color: TEAL }),
      txt(20, 231, 170, 6, "{{approval_note}}", { size: 9, color: MUTED }),
      el("qr", 18, 242, 28, 28),
      txt(12, 271, 40, 6, "{{code}}", { size: 8, color: MUTED }),
      txt(70, 250, 70, 14, "رقم الشهادة {{serial}}\nتاريخ الإصدار {{issued_at}}", { size: 10, color: MUTED }),
      el("signature", 142, 244, 50, 28, { style: { font: "plex", size: 11, color: INK } }),
    ],
  };
}

function goldCourse() {
  n = 0;
  return {
    v: 1,
    page: { orientation: "landscape", bg: "#FFFDF7", bgAsset: null, border: { style: "ornate", color: GOLD, accent: NAVY, width: 1.4, inset: 9 } },
    els: [
      el("logo", 133.5, 18, 30, 22),
      txt(40, 42, 217, 9, "{{school}}", { size: 15, bold: true, color: NAVY }),
      txt(30, 54, 237, 18, "{{title}}", { font: "amiri", size: 34, bold: true, color: GOLD }),
      txt(40, 77, 217, 9, "يشهد {{school}} بأن", { font: "amiri", size: 16 }),
      txt(40, 87, 217, 15, "{{student}}", { font: "amiri", size: 30, bold: true, color: NAVY }),
      el("line", 108.5, 103, 80, 0.6, { style: { color: GOLD } }),
      txt(35, 107, 227, 18, "قد أتم بنجاح {{course}}{{program}}\nبعدد {{hours}} ساعة تدريبية — {{result}}", { font: "amiri", size: 16, lh: 1.7 }),
      txt(40, 128, 217, 7, "تاريخ الإكمال {{completed_on}}", { size: 11, color: MUTED }),
      txt(40, 136, 217, 6, "{{approval_note}}", { size: 9, color: MUTED }),
      el("qr", 24, 152, 30, 30),
      txt(16, 183, 46, 6, "{{code}}", { size: 8, color: MUTED }),
      txt(108.5, 162, 80, 14, "رقم الشهادة {{serial}}\nتاريخ الإصدار {{issued_at}}", { size: 10, color: MUTED }),
      el("signature", 222, 154, 52, 30, { style: { font: "plex", size: 11, color: INK } }),
    ],
  };
}

function appreciation() {
  n = 0;
  return {
    v: 1,
    page: { orientation: "landscape", bg: "#FFFFFF", bgAsset: null, border: { style: "double", color: NAVY, accent: GOLD, width: 1.6, inset: 9 } },
    els: [
      el("logo", 133.5, 18, 30, 22),
      txt(40, 42, 217, 9, "{{school}}", { size: 15, bold: true, color: NAVY }),
      txt(30, 55, 237, 18, "{{title}}", { font: "reem", size: 32, bold: true, color: NAVY }),
      txt(40, 79, 217, 9, "تتقدم إدارة {{school}} بالشكر والتقدير إلى", { font: "amiri", size: 16 }),
      txt(40, 89, 217, 15, "{{student}}", { font: "amiri", size: 30, bold: true, color: GOLD }),
      txt(40, 105, 217, 8, "{{class_name}}", { size: 12, color: MUTED }),
      txt(35, 115, 227, 22, "{{body}}", { font: "amiri", size: 17, lh: 1.8 }),
      el("qr", 24, 152, 30, 30),
      txt(16, 183, 46, 6, "{{code}}", { size: 8, color: MUTED }),
      txt(108.5, 162, 80, 14, "رقم الشهادة {{serial}}\nتاريخ الإصدار {{issued_at}}", { size: 10, color: MUTED }),
      el("signature", 222, 154, 52, 30, { style: { font: "plex", size: 11, color: INK } }),
    ],
  };
}

function attendance() {
  const l = goldCourse();
  l.page.border = { style: "line", color: NAVY, accent: TEAL, width: 1, inset: 9 };
  l.els = l.els.map((e) => (e.type === "text" && e.text.startsWith("قد أتم")
    ? { ...e, text: "قد حضر {{course}}{{program}}\nبعدد {{hours}} ساعة — نسبة الحضور {{attendance}}" }
    : e.type === "text" && e.text.startsWith("{{title}}") ? { ...e, style: { ...e.style, color: NAVY } } : e));
  return l;
}

export const PRESETS = {
  classic: { name: "رسمي كلاسيكي", kinds: ["term", "year"], make: classic },
  modern: { name: "عصري بشريط علوي", kinds: ["term", "year"], make: modern },
  gold: { name: "ذهبي أنيق (دورات)", kinds: ["course"], make: goldCourse },
  appreciation: { name: "شكر وتقدير", kinds: ["custom"], make: appreciation },
  attendance: { name: "إفادة حضور", kinds: ["attendance"], make: attendance },
};
// The built-in design for a kind when the institution has not chosen one.
export const presetFor = (kind) => ({ term: "classic", year: "classic", custom: "appreciation", course: "gold", attendance: "attendance" }[kind] || "classic");
export const presetLayout = (key) => (PRESETS[key] || PRESETS.classic).make();
