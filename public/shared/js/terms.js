/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The institution's words (from its type and its own settings, sent with /me). Screens call T("students") instead of
// writing the word; until set, or for a word the institution did not change, the platform's own word is used.
const TERMS = {
  student: "طالب", students: "الطلاب", teacher: "معلم", teachers: "المعلمون", class: "شعبة", classes: "الشعب",
  grade: "صف", grades: "الصفوف", subject: "مادة", subjects: "المواد", guardian: "ولي الأمر", guardians: "أولياء الأمور",
};
export function setTerms(terms) {
  for (const [k, v] of Object.entries(terms || {})) if (k in TERMS && typeof v === "string" && v.trim()) TERMS[k] = v.trim();
}
export const T = (key) => TERMS[key] ?? key;
