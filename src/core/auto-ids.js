/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Identifiers the platform fills in by itself when the administration leaves them empty: a readable username from the
// teacher's Arabic name (khaled.alhakimi), the next student number and the next employee number. All unique within
// the school (the queries run inside the school's own transaction).

// Common names with their usual English spelling; any other word is transliterated letter by letter.
const KNOWN = {
  محمد: "mohammed", أحمد: "ahmed", احمد: "ahmed", محمود: "mahmoud", علي: "ali", عمر: "omar", عثمان: "othman", خالد: "khaled",
  سعيد: "saeed", سعد: "saad", صالح: "saleh", ناصر: "nasser", فيصل: "faisal", فهد: "fahad", يوسف: "yousef", إبراهيم: "ibrahim",
  ابراهيم: "ibrahim", إسماعيل: "ismail", اسماعيل: "ismail", حسن: "hassan", حسين: "hussein", عبدالله: "abdullah", عبدالرحمن: "abdulrahman",
  عبدالعزيز: "abdulaziz", عبدالملك: "abdulmalik", عبدالكريم: "abdulkarim", عبدالقادر: "abdulqader", عبدالوهاب: "abdulwahab",
  عبدالجليل: "abduljalil", عبده: "abdo", ياسر: "yasser", ياسين: "yaseen", مصطفى: "mustafa", منصور: "mansour", سالم: "salem",
  سلطان: "sultan", سليمان: "sulaiman", طارق: "tariq", عادل: "adel", عمار: "ammar", أنس: "anas", انس: "anas", أسامة: "osama",
  اسامة: "osama", بسام: "bassam", جمال: "jamal", حمزة: "hamza", زكريا: "zakaria", شهاب: "shehab", صقر: "saqr", عبود: "abood",
  عوض: "awad", فؤاد: "fuad", ماجد: "majed", مازن: "mazen", مراد: "murad", نبيل: "nabil", هشام: "hisham", هيثم: "haitham",
  وليد: "waleed", ناجي: "naji", قاسم: "qasem", مهيب: "muheeb", منير: "munir", رشيد: "rashid", نايف: "naif", بندر: "bandar",
  فاطمة: "fatima", عائشة: "aisha", مريم: "maryam", خديجة: "khadija", زينب: "zainab", سارة: "sara", نورة: "noura", هند: "hind",
  أمل: "amal", امل: "amal", ريم: "reem", ليلى: "laila", منى: "mona", هدى: "huda", أسماء: "asma", اسماء: "asma", رحاب: "rehab",
};
const LETTERS = {
  ا: "a", أ: "a", إ: "e", آ: "a", ء: "", ؤ: "o", ئ: "e", ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh", د: "d", ذ: "th", ر: "r",
  ز: "z", س: "s", ش: "sh", ص: "s", ض: "d", ط: "t", ظ: "z", ع: "a", غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n", ه: "h",
  ة: "a", و: "o", ي: "i", ى: "a",
};
const TITLE = /^(أ\.|ا\.|د\.|م\.|أستاذ|استاذ|الأستاذ|الاستاذ|أستاذة|استاذة|المعلم|المعلمة|الشيخ|دكتور|د)\s*/;

function word(w) {
  const clean = w.replace(/[ً-ْـ]/g, "");  // harakat and tatweel
  if (KNOWN[clean]) return KNOWN[clean];
  if (/^[a-z0-9]+$/i.test(clean)) return clean.toLowerCase();
  let s = clean.startsWith("ال") && clean.length > 3 ? `al${[...clean.slice(2)].map((c) => LETTERS[c] ?? "").join("")}` : [...clean].map((c, i) =>
    (c === "ي" && i === 0 ? "y" : c === "و" && i === 0 ? "w" : LETTERS[c] ?? "")).join("");
  s = s.replace(/[^a-z]/g, "");
  return s;
}

// "أ. خالد ناجي الحكيمي" -> "khaled.alhakimi"; one-word names stay one word.
export function usernameFromName(name) {
  const words = String(name || "").trim().replace(TITLE, "").split(/\s+/).filter(Boolean);
  // "عبد الله" written in two words counts as one name.
  const joined = [];
  for (let i = 0; i < words.length; i++) {
    if ((words[i] === "عبد" || words[i] === "أبو" || words[i] === "ابو") && words[i + 1]) { joined.push(words[i] + words[i + 1]); i++; } else joined.push(words[i]);
  }
  const parts = [joined[0], joined.length > 1 ? joined.at(-1) : null].filter(Boolean).map(word).filter((x) => x.length >= 2);
  const base = parts.join(".").slice(0, 34).replace(/\.+$/, "");
  return base.length >= 3 ? base : "teacher";
}

// The base itself when free, otherwise base2, base3…
export async function uniqueUsername(q, base) {
  const rows = await q("SELECT username FROM users WHERE username = $1 OR username ~ ('^' || $2 || '[0-9]+$')",
    [base, base.replace(/[.]/g, "\\.")]);
  const taken = new Set(rows.map((r) => r.username));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

// Next student number: the academic year's start (e.g. 2026) and a four-digit sequence, continuing the highest
// number of that form already used in the school.
export async function nextStudentNo(q) {
  const [y] = await q(`SELECT COALESCE(
      (SELECT extract(year FROM start_date)::int FROM academic_years WHERE is_current ORDER BY start_date DESC LIMIT 1),
      extract(year FROM now())::int) AS y`).catch(() => [{ y: new Date().getFullYear() }]);
  const prefix = String(y.y);
  const [m] = await q(`SELECT max(substring(student_no FROM 5)::int) AS n FROM students WHERE student_no ~ ('^' || $1 || '[0-9]{4,6}$')`, [prefix]);
  return `${prefix}${String((m.n || 0) + 1).padStart(4, "0")}`;
}

// Next employee number: one more than the highest numeric employee number in the school (from 1001).
export async function nextEmployeeNo(q) {
  const [m] = await q(`SELECT max(employee_no::bigint) AS n FROM teachers WHERE employee_no ~ '^[0-9]{1,12}$'`);
  return String(Math.max(Number(m.n || 0) + 1, 1001));
}
