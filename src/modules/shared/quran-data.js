/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The Quran's 114 surahs (name and number of ayat, 6236 in all) and where each of the 30 ajza starts.
// Every passage is kept as a range of ayat; its position in the whole Quran (1..6236) makes ranges easy to count and merge.
export const SURAHS = [
  ["الفاتحة", 7], ["البقرة", 286], ["آل عمران", 200], ["النساء", 176], ["المائدة", 120], ["الأنعام", 165], ["الأعراف", 206],
  ["الأنفال", 75], ["التوبة", 129], ["يونس", 109], ["هود", 123], ["يوسف", 111], ["الرعد", 43], ["إبراهيم", 52], ["الحجر", 99],
  ["النحل", 128], ["الإسراء", 111], ["الكهف", 110], ["مريم", 98], ["طه", 135], ["الأنبياء", 112], ["الحج", 78], ["المؤمنون", 118],
  ["النور", 64], ["الفرقان", 77], ["الشعراء", 227], ["النمل", 93], ["القصص", 88], ["العنكبوت", 69], ["الروم", 60], ["لقمان", 34],
  ["السجدة", 30], ["الأحزاب", 73], ["سبأ", 54], ["فاطر", 45], ["يس", 83], ["الصافات", 182], ["ص", 88], ["الزمر", 75], ["غافر", 85],
  ["فصلت", 54], ["الشورى", 53], ["الزخرف", 89], ["الدخان", 59], ["الجاثية", 37], ["الأحقاف", 35], ["محمد", 38], ["الفتح", 29],
  ["الحجرات", 18], ["ق", 45], ["الذاريات", 60], ["الطور", 49], ["النجم", 62], ["القمر", 55], ["الرحمن", 78], ["الواقعة", 96],
  ["الحديد", 29], ["المجادلة", 22], ["الحشر", 24], ["الممتحنة", 13], ["الصف", 14], ["الجمعة", 11], ["المنافقون", 11], ["التغابن", 18],
  ["الطلاق", 12], ["التحريم", 12], ["الملك", 30], ["القلم", 52], ["الحاقة", 52], ["المعارج", 44], ["نوح", 28], ["الجن", 28],
  ["المزمل", 20], ["المدثر", 56], ["القيامة", 40], ["الإنسان", 31], ["المرسلات", 50], ["النبأ", 40], ["النازعات", 46], ["عبس", 42],
  ["التكوير", 29], ["الانفطار", 19], ["المطففين", 36], ["الانشقاق", 25], ["البروج", 22], ["الطارق", 17], ["الأعلى", 19], ["الغاشية", 26],
  ["الفجر", 30], ["البلد", 20], ["الشمس", 15], ["الليل", 21], ["الضحى", 11], ["الشرح", 8], ["التين", 8], ["العلق", 19], ["القدر", 5],
  ["البينة", 8], ["الزلزلة", 8], ["العاديات", 11], ["القارعة", 11], ["التكاثر", 8], ["العصر", 3], ["الهمزة", 9], ["الفيل", 5],
  ["قريش", 4], ["الماعون", 7], ["الكوثر", 3], ["الكافرون", 6], ["النصر", 3], ["المسد", 5], ["الإخلاص", 4], ["الفلق", 5], ["الناس", 6],
];
// [surah, ayah] where each juz begins.
export const JUZ_STARTS = [
  [1, 1], [2, 142], [2, 253], [3, 93], [4, 24], [4, 148], [5, 82], [6, 111], [7, 88], [8, 41], [9, 93], [11, 6], [12, 53], [15, 1], [17, 1],
  [18, 75], [21, 1], [23, 1], [25, 21], [27, 56], [29, 46], [33, 31], [36, 28], [39, 32], [41, 47], [46, 1], [51, 31], [58, 1], [67, 1], [78, 1],
];

const OFFSET = [0];
for (const [, n] of SURAHS) OFFSET.push(OFFSET[OFFSET.length - 1] + n);
export const TOTAL_AYAT = OFFSET[114];

export const surahName = (s) => SURAHS[s - 1]?.[0] || "";
export const ayatIn = (s) => SURAHS[s - 1]?.[1] || 0;
export const validAyah = (s, a) => Number.isInteger(s) && s >= 1 && s <= 114 && Number.isInteger(a) && a >= 1 && a <= ayatIn(s);
// Position of an ayah in the whole Quran (1..6236), and back.
export const indexOf = (s, a) => OFFSET[s - 1] + a;
export function ayahAt(i) {
  let s = 1;
  while (s < 114 && OFFSET[s] < i) s++;
  return [s, i - OFFSET[s - 1]];
}
const JUZ_INDEX = JUZ_STARTS.map(([s, a]) => indexOf(s, a));
// The juz as a range of positions: [first, last].
export const juzRange = (j) => [JUZ_INDEX[j - 1], j < 30 ? JUZ_INDEX[j] - 1 : TOTAL_AYAT];
export const juzOf = (i) => { let j = 30; while (j > 1 && JUZ_INDEX[j - 1] > i) j--; return j; };

// Merges ranges [[a, b], ...] into sorted, non-overlapping ones.
export function merge(ranges) {
  const out = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
export const countOf = (merged) => merged.reduce((n, [a, b]) => n + b - a + 1, 0);
// How much of each juz the merged ranges cover (ayat), for the 30-juz progress grid.
export function juzCoverage(merged) {
  return Array.from({ length: 30 }, (_, k) => {
    const [ja, jb] = juzRange(k + 1);
    const done = merged.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, jb) - Math.max(a, ja) + 1), 0);
    return { juz: k + 1, done, total: jb - ja + 1, complete: done === jb - ja + 1 };
  });
}
// A readable passage: «البقرة 1–20» or «البقرة 280 – آل عمران 10».
export function passage(fs, fa, ts, ta) {
  if (!fs) return "";
  if (fs === ts) return fa === 1 && ta === ayatIn(fs) ? `سورة ${surahName(fs)} كاملة` : `${surahName(fs)} ${fa}–${ta}`;
  return `${surahName(fs)} ${fa} – ${surahName(ts)} ${ta}`;
}
