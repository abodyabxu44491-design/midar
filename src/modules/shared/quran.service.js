/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { badRequest, forbidden, notFound, conflict } from "../../core/http/errors.js";
import { t, z } from "../../core/http/validate.js";
import * as Q from "./quran-data.js";
import { issueCustom } from "./certificates.service.js";

// Quran circles: levels the institution defines, circles with a teacher, one active circle per student, and a daily log of
// new memorisation, review, recitation tests and absences. Progress is the union of the passages memorised (graded not «repeat»).

export const KINDS = { new: "حفظ جديد", review: "مراجعة", test: "تسميع", absent: "غائب", excused: "غائب بعذر" };
export const GRADES = { excellent: "ممتاز", very_good: "جيد جدًا", good: "جيد", acceptable: "مقبول", weak: "ضعيف", repeat: "يُعاد" };
const GRADE_SCORE = { excellent: 5, very_good: 4, good: 3, acceptable: 2, weak: 1, repeat: 0 };

export const meta = () => ({
  surahs: Q.SURAHS.map(([name, ayat], i) => ({ n: i + 1, name, ayat })),
  juz: Q.JUZ_STARTS.map(([s, a], i) => ({ juz: i + 1, surah: s, ayah: a, range: Q.juzRange(i + 1) })),
  kinds: KINDS, grades: GRADES, total: Q.TOTAL_AYAT,
});

/* ---------- levels and circles (administration) ---------- */
export const levelSchema = z.object({ name: t.shortText("اسم المستوى", 80), description: t.optText(300), sort: z.coerce.number().int().min(0).max(10000).prefault(100) });
export const halaqaSchema = z.object({
  name: t.shortText("اسم الحلقة", 80), teacher_id: t.optId, level_id: t.optId, schedule: t.optText(120),
  capacity: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(500)]).optional().transform((v) => (v === "" ? null : v)),
  notes: t.optText(500),
});

export const halaqaPatch = z.object({
  name: t.shortText("اسم الحلقة", 80).optional(), teacher_id: t.optId, level_id: t.optId, schedule: t.optText(120),
  capacity: halaqaSchema.shape.capacity, notes: t.optText(500), status: z.enum(["active", "archived"]).optional(),
});

export const levels = (q) => q(`SELECT l.*, (SELECT count(*)::int FROM halaqa_members m WHERE m.level_id = l.id AND m.ended_on IS NULL) AS students
                                   FROM quran_levels l ORDER BY l.sort, l.id`);
export async function addLevel(q, b) {
  const [dup] = await q("SELECT 1 FROM quran_levels WHERE name = $1", [b.name]);
  if (dup) throw conflict("يوجد مستوى بهذا الاسم");
  return (await q("INSERT INTO quran_levels (tenant_id, name, description, sort) VALUES (app_tenant(), $1, $2, $3) RETURNING *", [b.name, b.description ?? null, b.sort]))[0];
}
export async function updateLevel(q, id, b) {
  const [row] = await q(`UPDATE quran_levels SET name = COALESCE($2, name), description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                           sort = COALESCE($5, sort) WHERE id = $1 RETURNING *`, [id, b.name ?? null, b.description !== undefined, b.description ?? null, b.sort ?? null]);
  if (!row) throw notFound("المستوى غير موجود");
  return row;
}
export async function removeLevel(q, id) {
  const rows = await q("DELETE FROM quran_levels WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("المستوى غير موجود");
}

export const halaqat = (q, { teacherId = null, all = false } = {}) => q(
  `SELECT h.*, tc.full_name AS teacher, l.name AS level,
          (SELECT count(*)::int FROM halaqa_members m WHERE m.halaqa_id = h.id AND m.ended_on IS NULL) AS students
     FROM halaqat h LEFT JOIN teachers tc ON tc.id = h.teacher_id LEFT JOIN quran_levels l ON l.id = h.level_id
    WHERE ($1::bigint IS NULL OR h.teacher_id = $1) AND ($2 OR h.status = 'active')
    ORDER BY h.status, h.name`, [teacherId, all]);

export async function addHalaqa(q, b) {
  const [dup] = await q("SELECT 1 FROM halaqat WHERE name = $1 AND status = 'active'", [b.name]);
  if (dup) throw conflict("توجد حلقة بهذا الاسم");
  return (await q(`INSERT INTO halaqat (tenant_id, name, teacher_id, level_id, schedule, capacity, notes)
                   VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING *`,
    [b.name, b.teacher_id ?? null, b.level_id ?? null, b.schedule ?? null, b.capacity ?? null, b.notes ?? null]))[0];
}
export async function updateHalaqa(q, id, b) {
  const [cur] = await q("SELECT * FROM halaqat WHERE id = $1 FOR UPDATE", [id]);
  if (!cur) throw notFound("الحلقة غير موجودة");
  const v = (k) => (b[k] !== undefined ? b[k] : cur[k]);
  const [row] = await q(`UPDATE halaqat SET name = $2, teacher_id = $3, level_id = $4, schedule = $5, capacity = $6, notes = $7, status = $8
                          WHERE id = $1 RETURNING *`,
    [id, v("name"), v("teacher_id"), v("level_id"), v("schedule"), v("capacity"), v("notes"), v("status")]);
  // Archiving a circle ends its memberships (the students' records stay).
  if (b.status === "archived" && cur.status !== "archived") await q("UPDATE halaqa_members SET ended_on = CURRENT_DATE WHERE halaqa_id = $1 AND ended_on IS NULL", [id]);
  return row;
}

/* ---------- members ---------- */
export const membersSchema = z.object({
  student_ids: z.array(t.id).min(1, "اختر طالبًا واحدًا على الأقل").max(500),
  level_id: t.optId,
  daily_target: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(1000)]).optional().transform((v) => (v === "" ? null : v)),
});
export const memberPatch = z.object({ level_id: t.optId, daily_target: membersSchema.shape.daily_target, note: t.optText(300) });

// Adds students to a circle; a student already in another circle moves (the old membership ends today).
export async function addMembers(q, halaqaId, b) {
  const [h] = await q("SELECT * FROM halaqat WHERE id = $1 AND status = 'active'", [halaqaId]);
  if (!h) throw notFound("الحلقة غير موجودة");
  const found = await q("SELECT id FROM students WHERE id = ANY($1) AND archived_at IS NULL", [b.student_ids]);
  if (found.length !== new Set(b.student_ids).size) throw badRequest("بعض الطلاب غير موجودين");
  if (h.capacity) {
    const [{ n }] = await q("SELECT count(*)::int AS n FROM halaqa_members WHERE halaqa_id = $1 AND ended_on IS NULL AND NOT (student_id = ANY($2))", [halaqaId, b.student_ids]);
    if (n + found.length > h.capacity) throw badRequest(`سعة الحلقة ${h.capacity}، وفيها ${n} الآن`);
  }
  let moved = 0, added = 0;
  for (const { id } of found) {
    const [cur] = await q("SELECT id, halaqa_id FROM halaqa_members WHERE student_id = $1 AND ended_on IS NULL", [id]);
    if (cur?.halaqa_id === halaqaId) continue;
    if (cur) { await q("UPDATE halaqa_members SET ended_on = CURRENT_DATE WHERE id = $1", [cur.id]); moved++; }
    await q(`INSERT INTO halaqa_members (tenant_id, halaqa_id, student_id, level_id, daily_target) VALUES (app_tenant(), $1, $2, $3, $4)`,
      [halaqaId, id, b.level_id ?? h.level_id ?? null, b.daily_target ?? null]);
    added++;
  }
  return { added, moved };
}
export async function updateMember(q, id, b) {
  const [row] = await q(`UPDATE halaqa_members SET level_id = CASE WHEN $2 THEN $3 ELSE level_id END, daily_target = CASE WHEN $4 THEN $5 ELSE daily_target END,
                           note = CASE WHEN $6 THEN $7 ELSE note END WHERE id = $1 AND ended_on IS NULL RETURNING *`,
    [id, b.level_id !== undefined, b.level_id ?? null, b.daily_target !== undefined, b.daily_target ?? null, b.note !== undefined, b.note ?? null]);
  if (!row) throw notFound("العضوية غير موجودة");
  return row;
}
export async function endMember(q, id) {
  const rows = await q("UPDATE halaqa_members SET ended_on = CURRENT_DATE WHERE id = $1 AND ended_on IS NULL RETURNING id", [id]);
  if (!rows.length) throw notFound("العضوية غير موجودة");
}

/* ---------- progress ---------- */
const sqlRecords = `SELECT r.*, tc.full_name AS teacher FROM quran_records r LEFT JOIN teachers tc ON tc.id = r.teacher_id`;
const shape = (r) => ({
  id: r.id, on_date: r.on_date, kind: r.kind, kind_name: KINDS[r.kind], passage: Q.passage(r.from_surah, r.from_ayah, r.to_surah, r.to_ayah),
  from_surah: r.from_surah, from_ayah: r.from_ayah, to_surah: r.to_surah, to_ayah: r.to_ayah, ayat: r.ayat,
  grade: r.grade, grade_name: GRADES[r.grade] || null, mistakes: r.mistakes, notes: r.notes, teacher: r.teacher || null,
  halaqa_id: r.halaqa_id, created_by: r.created_by, created_at: r.created_at, teacher_id: r.teacher_id,
});
const memorised = (rows) => Q.merge(rows.filter((r) => r.kind === "new" && r.grade !== "repeat" && r.from_index).map((r) => [r.from_index, r.to_index]));
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// Where the next new passage starts. Many circles memorise from the end of the Quran backwards (An-Nas, Al-Falaq...):
// when what is memorised reaches the end but not the beginning, the next passage is the nearest gap before that last
// block; otherwise it is the first ayah not yet memorised after the latest passage.
function nextStart(rows) {
  const news = rows.filter((r) => r.kind === "new" && r.from_index && r.grade !== "repeat");
  if (!news.length) return null;
  const merged = memorised(rows);
  const covered = (i) => merged.some(([a, b]) => i >= a && i <= b);
  const firstGap = (from, to) => { for (let i = from; i <= to; i++) if (!covered(i)) return i; return null; };
  const at = (i) => { const [surah, ayah] = Q.ayahAt(i); return { surah, ayah }; };
  if (covered(Q.TOTAL_AYAT) && !covered(1)) {
    const start = merged[merged.length - 1][0];
    const [s0, a0] = Q.ayahAt(start);
    for (let s = a0 > 1 ? s0 : s0 - 1; s >= 1; s--) {
      const i = firstGap(Q.indexOf(s, 1), Math.min(Q.indexOf(s, Q.ayatIn(s)), start - 1));
      if (i) return at(i);
    }
    return null;
  }
  const i = firstGap(news[0].to_index + 1, Q.TOTAL_AYAT) || firstGap(1, Q.TOTAL_AYAT);
  return i ? at(i) : null;
}

function summarise(rows, member) {
  const merged = memorised(rows);
  const done = Q.countOf(merged);
  const coverage = Q.juzCoverage(merged);
  const since = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const week = rows.filter((r) => iso(r.on_date) >= since);
  const weekNew = week.filter((r) => r.kind === "new" && r.grade !== "repeat").reduce((n, r) => n + r.ayat, 0);
  const graded = rows.filter((r) => r.grade).slice(0, 20);
  const lastNew = rows.find((r) => r.kind === "new");
  const target = member?.daily_target ? member.daily_target * new Set(week.filter((r) => !["absent", "excused"].includes(r.kind)).map((r) => iso(r.on_date))).size : null;
  return {
    memorised: done, percent: Math.round((done / Q.TOTAL_AYAT) * 1000) / 10, juz_complete: coverage.filter((c) => c.complete).map((c) => c.juz),
    coverage, next: nextStart(rows), last_record: rows[0] ? iso(rows[0].on_date) : null, last_new: lastNew ? iso(lastNew.on_date) : null,
    week: { new_ayat: weekNew, review_ayat: week.filter((r) => r.kind === "review").reduce((n, r) => n + r.ayat, 0),
      absences: week.filter((r) => r.kind === "absent").length, target },
    average: graded.length ? Math.round((graded.reduce((n, r) => n + GRADE_SCORE[r.grade], 0) / graded.length) * 10) / 10 : null,
    behind: target !== null ? weekNew < target : Boolean(rows.length && (!lastNew || iso(lastNew.on_date) < since)),
  };
}

export async function halaqaDetail(q, id, { teacherId = null } = {}) {
  const [h] = (await halaqat(q, { all: true })).filter((x) => x.id === id);
  if (!h) throw notFound("الحلقة غير موجودة");
  if (teacherId && h.teacher_id !== teacherId) throw forbidden("هذه الحلقة ليست من حلقاتك");
  const members = await q(`SELECT m.*, s.full_name AS name, s.student_no, c.name AS class_name, l.name AS level
                             FROM halaqa_members m JOIN students s ON s.id = m.student_id LEFT JOIN classes c ON c.id = s.class_id
                             LEFT JOIN quran_levels l ON l.id = m.level_id
                            WHERE m.halaqa_id = $1 AND m.ended_on IS NULL ORDER BY s.full_name`, [id]);
  const records = members.length ? await q(`${sqlRecords} WHERE r.student_id = ANY($1) ORDER BY r.on_date DESC, r.id DESC`, [members.map((m) => m.student_id)]) : [];
  const today = new Date().toISOString().slice(0, 10);
  return {
    halaqa: h,
    members: members.map((m) => {
      const mine = records.filter((r) => r.student_id === m.student_id);
      return { ...m, progress: summarise(mine, m), today: mine.filter((r) => iso(r.on_date) === today).map(shape) };
    }),
  };
}

export async function studentProgress(q, studentId, { teacherId = null, limit = 60 } = {}) {
  const [s] = await q(`SELECT s.id, s.full_name AS name, s.student_no, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [studentId]);
  if (!s) throw notFound("الطالب غير موجود");
  const [member] = await q(`SELECT m.*, h.name AS halaqa, h.teacher_id, l.name AS level FROM halaqa_members m JOIN halaqat h ON h.id = m.halaqa_id
                              LEFT JOIN quran_levels l ON l.id = m.level_id WHERE m.student_id = $1 AND m.ended_on IS NULL`, [studentId]);
  if (teacherId && member?.teacher_id !== teacherId) throw forbidden("الطالب ليس في حلقاتك");
  const rows = await q(`${sqlRecords} WHERE r.student_id = $1 ORDER BY r.on_date DESC, r.id DESC`, [studentId]);
  const achievements = await q(`SELECT a.*, x.code, x.serial FROM quran_achievements a LEFT JOIN certificates x ON x.id = a.certificate_id
                                 WHERE a.student_id = $1 ORDER BY a.achieved_on DESC, a.id DESC`, [studentId]);
  const progress = summarise(rows, member);
  const has = new Set(achievements.filter((a) => a.kind === "juz").map((a) => a.juz));
  return {
    student: s, membership: member || null, progress, records: rows.slice(0, limit).map(shape),
    achievements: achievements.map((a) => ({ ...a, title: a.kind === "khatm" ? "ختم القرآن الكريم" : `إتمام الجزء ${a.juz}` })),
    eligible: {
      juz: progress.juz_complete.filter((j) => !has.has(j)),
      khatm: progress.memorised === Q.TOTAL_AYAT && !achievements.some((a) => a.kind === "khatm"),
    },
  };
}

/* ---------- the daily log ---------- */
const ayahRef = z.coerce.number().int();
export const recordSchema = z.object({
  student_id: t.id,
  on_date: t.date.optional(),
  kind: z.enum(Object.keys(KINDS)),
  from_surah: ayahRef.optional(), from_ayah: ayahRef.optional(), to_surah: ayahRef.optional(), to_ayah: ayahRef.optional(),
  juz: z.coerce.number().int().min(1).max(30).optional(),
  grade: z.enum(Object.keys(GRADES)).optional().nullable(),
  mistakes: z.union([z.literal(""), z.null(), z.coerce.number().int().min(0).max(500)]).optional().transform((v) => (v === "" ? null : v)),
  notes: t.optText(500),
});

// The passage as positions in the Quran. A whole juz may be given instead of surah and ayah.
function rangeOf(b) {
  if (b.juz) {
    const [a, z2] = Q.juzRange(b.juz);
    const [fs, fa] = Q.ayahAt(a), [ts, ta] = Q.ayahAt(z2);
    return { from_surah: fs, from_ayah: fa, to_surah: ts, to_ayah: ta, from_index: a, to_index: z2 };
  }
  const fs = b.from_surah, fa = b.from_ayah ?? 1, ts = b.to_surah ?? b.from_surah, ta = b.to_ayah ?? Q.ayatIn(b.to_surah ?? b.from_surah);
  if (!Q.validAyah(fs, fa)) throw badRequest(`بداية المقطع غير صحيحة${fs >= 1 && fs <= 114 ? `: سورة ${Q.surahName(fs)} ${Q.ayatIn(fs)} آية` : ""}`);
  if (!Q.validAyah(ts, ta)) throw badRequest(`نهاية المقطع غير صحيحة${ts >= 1 && ts <= 114 ? `: سورة ${Q.surahName(ts)} ${Q.ayatIn(ts)} آية` : ""}`);
  const from = Q.indexOf(fs, fa), to = Q.indexOf(ts, ta);
  if (from > to) throw badRequest("نهاية المقطع قبل بدايته");
  return { from_surah: fs, from_ayah: fa, to_surah: ts, to_ayah: ta, from_index: from, to_index: to };
}

async function memberOf(q, studentId) {
  const [m] = await q(`SELECT m.halaqa_id, h.teacher_id FROM halaqa_members m JOIN halaqat h ON h.id = m.halaqa_id
                        WHERE m.student_id = $1 AND m.ended_on IS NULL`, [studentId]);
  return m || null;
}

export async function addRecord(q, b, { teacherId = null, actor }) {
  const [s] = await q("SELECT id FROM students WHERE id = $1 AND archived_at IS NULL", [b.student_id]);
  if (!s) throw notFound("الطالب غير موجود");
  const m = await memberOf(q, b.student_id);
  if (teacherId && m?.teacher_id !== teacherId) throw forbidden("الطالب ليس في حلقاتك");
  const today = new Date().toISOString().slice(0, 10);
  const onDate = b.on_date || today;
  if (onDate > today) throw badRequest("لا يُسجَّل يوم لم يأتِ بعد");
  const absence = ["absent", "excused"].includes(b.kind);
  const range = absence ? null : rangeOf(b);
  if (!absence && b.from_surah === undefined && !b.juz) throw badRequest("حدد المقطع: السورة والآيات أو الجزء");
  if (absence) {
    const [dup] = await q("SELECT 1 FROM quran_records WHERE student_id = $1 AND on_date = $2 AND kind IN ('absent', 'excused')", [b.student_id, onDate]);
    if (dup) throw conflict("سُجّل غياب هذا الطالب في هذا اليوم");
  }
  const [row] = await q(
    `INSERT INTO quran_records (tenant_id, student_id, halaqa_id, teacher_id, on_date, kind, from_surah, from_ayah, to_surah, to_ayah,
                                from_index, to_index, ayat, grade, mistakes, notes, created_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
    [b.student_id, m?.halaqa_id ?? null, teacherId ?? m?.teacher_id ?? null, onDate, b.kind,
     range?.from_surah ?? null, range?.from_ayah ?? null, range?.to_surah ?? null, range?.to_ayah ?? null,
     range?.from_index ?? null, range?.to_index ?? null, range ? range.to_index - range.from_index + 1 : 0,
     absence ? null : b.grade ?? null, absence ? null : b.mistakes ?? null, b.notes ?? null, actor]);
  return shape(row);
}

// A teacher removes only their own entries, and only on the day they were made; the administration removes any.
export async function removeRecord(q, id, { teacherId = null } = {}) {
  const [r] = await q("SELECT * FROM quran_records WHERE id = $1", [id]);
  if (!r) throw notFound("السجل غير موجود");
  if (teacherId && (r.teacher_id !== teacherId || iso(r.created_at) !== new Date().toISOString().slice(0, 10))) {
    throw forbidden("يحذف المعلم ما سجله اليوم فقط. للتصحيح بعد ذلك تواصل مع الإدارة.");
  }
  await q("DELETE FROM quran_records WHERE id = $1", [id]);
}

/* ---------- reports ---------- */
export const rangeQuery = z.object({ from: t.date.optional(), to: t.date.optional() });
const period = (f) => {
  const to = f.to || new Date().toISOString().slice(0, 10);
  const from = f.from || new Date(Date.parse(to) - 29 * 864e5).toISOString().slice(0, 10);
  if (from > to) throw badRequest("بداية الفترة بعد نهايتها");
  return { from, to };
};

export async function halaqaReport(q, id, f, { teacherId = null } = {}) {
  const d = await halaqaDetail(q, id, { teacherId });
  const { from, to } = period(f);
  const rows = d.members.length ? await q(`SELECT * FROM quran_records WHERE student_id = ANY($1) AND on_date BETWEEN $2 AND $3`,
    [d.members.map((m) => m.student_id), from, to]) : [];
  const students = d.members.map((m) => {
    const mine = rows.filter((r) => r.student_id === m.student_id);
    const graded = mine.filter((r) => r.grade);
    return {
      student_id: m.student_id, name: m.name, level: m.level, memorised_total: m.progress.memorised, percent: m.progress.percent,
      new_ayat: mine.filter((r) => r.kind === "new" && r.grade !== "repeat").reduce((n, r) => n + r.ayat, 0),
      review_ayat: mine.filter((r) => r.kind === "review").reduce((n, r) => n + r.ayat, 0),
      tests: mine.filter((r) => r.kind === "test").length,
      days: new Set(mine.filter((r) => !["absent", "excused"].includes(r.kind)).map((r) => iso(r.on_date))).size,
      absences: mine.filter((r) => r.kind === "absent").length, excused: mine.filter((r) => r.kind === "excused").length,
      average: graded.length ? Math.round((graded.reduce((n, r) => n + GRADE_SCORE[r.grade], 0) / graded.length) * 10) / 10 : null,
      behind: m.progress.behind,
    };
  });
  const sum = (k) => students.reduce((n, s) => n + s[k], 0);
  return { halaqa: d.halaqa, from, to, students, totals: { students: students.length, new_ayat: sum("new_ayat"), review_ayat: sum("review_ayat"),
    absences: sum("absences"), behind: students.filter((s) => s.behind).length } };
}

export async function teachersReport(q, f) {
  const { from, to } = period(f);
  const rows = await q(
    `SELECT tc.id, tc.full_name AS teacher,
            (SELECT count(*)::int FROM halaqat h WHERE h.teacher_id = tc.id AND h.status = 'active') AS halaqat,
            (SELECT count(*)::int FROM halaqa_members m JOIN halaqat h ON h.id = m.halaqa_id WHERE h.teacher_id = tc.id AND m.ended_on IS NULL) AS students,
            count(r.id) FILTER (WHERE r.kind NOT IN ('absent', 'excused'))::int AS entries,
            COALESCE(sum(r.ayat) FILTER (WHERE r.kind = 'new' AND r.grade IS DISTINCT FROM 'repeat'), 0)::int AS new_ayat,
            COALESCE(sum(r.ayat) FILTER (WHERE r.kind = 'review'), 0)::int AS review_ayat,
            count(DISTINCT r.on_date)::int AS days
       FROM teachers tc LEFT JOIN quran_records r ON r.teacher_id = tc.id AND r.on_date BETWEEN $1 AND $2
      WHERE EXISTS (SELECT 1 FROM halaqat h WHERE h.teacher_id = tc.id) OR r.id IS NOT NULL
      GROUP BY tc.id ORDER BY tc.full_name`, [from, to]);
  return { from, to, teachers: rows };
}

/* ---------- achievements ---------- */
export const achievementSchema = z.object({ student_id: t.id, kind: z.enum(["juz", "khatm"]), juz: z.coerce.number().int().min(1).max(30).optional(),
  note: t.optText(300), certificate: z.boolean().prefault(true) });

// Recorded only when the log shows it: every ayah of the juz (or of the Quran) memorised.
export async function addAchievement(q, b, { actor, school }) {
  if (b.kind === "juz" && !b.juz) throw badRequest("حدد الجزء");
  const p = await studentProgress(q, b.student_id);
  if (b.kind === "juz" && !p.progress.juz_complete.includes(b.juz)) throw badRequest(`لم يكتمل حفظ الجزء ${b.juz} في السجل بعد`);
  if (b.kind === "khatm" && p.progress.memorised !== Q.TOTAL_AYAT) throw badRequest("لم يكتمل حفظ القرآن كاملًا في السجل بعد");
  const [dup] = await q("SELECT 1 FROM quran_achievements WHERE student_id = $1 AND kind = $2 AND COALESCE(juz, 0) = $3", [b.student_id, b.kind, b.juz ?? 0]);
  if (dup) throw conflict("سُجّل هذا الإنجاز مسبقًا");
  const title = b.kind === "khatm" ? "شهادة ختم القرآن الكريم" : `شهادة إتمام حفظ الجزء ${b.juz}`;
  const where = p.membership ? ` في ${p.membership.halaqa}` : "";
  const body = b.kind === "khatm"
    ? `أتم ${p.student.name} حفظ القرآن الكريم كاملًا${where}، بحسب سجل الحفظ في ${school}. نسأل الله أن يجعله حجة له.`
    : `أتم ${p.student.name} حفظ الجزء ${b.juz} من القرآن الكريم${where}، بحسب سجل الحفظ في ${school}.`;
  const cert = b.certificate ? await issueCustom(q, { student_id: b.student_id, title, body }, actor) : null;
  const [row] = await q(`INSERT INTO quran_achievements (tenant_id, student_id, kind, juz, certificate_id, note, created_by)
                         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING *`,
    [b.student_id, b.kind, b.kind === "juz" ? b.juz : null, cert?.id ?? null, b.note ?? null, actor]);
  return { ...row, certificate: cert ? { id: cert.id, code: cert.code, serial: cert.serial } : null };
}

// What a parent sees: the same progress, the latest entries and the achievements, without staff-only fields.
export async function forParent(q, studentId) {
  const p = await studentProgress(q, studentId, { limit: 30 });
  return {
    membership: p.membership ? { halaqa: p.membership.halaqa, level: p.membership.level, daily_target: p.membership.daily_target } : null,
    progress: { memorised: p.progress.memorised, percent: p.progress.percent, juz_complete: p.progress.juz_complete, coverage: p.progress.coverage,
      week: p.progress.week, last_record: p.progress.last_record },
    records: p.records.map(({ created_by, teacher_id, halaqa_id, ...r }) => r),
    achievements: p.achievements.map((a) => ({ title: a.title, achieved_on: a.achieved_on, code: a.code || null })),
    total: Q.TOTAL_AYAT,
  };
}
