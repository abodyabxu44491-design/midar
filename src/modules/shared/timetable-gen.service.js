// توليد جدول مبدئي: يوزّع حصص المواد على الأيام والحصص بلا تعارض،
// ويُعيد مسودة تحتاج موافقة المدير قبل الاعتماد. لا يكتب شيئًا قبل الموافقة.
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";

export const settingsSchema = z.object({
  days: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7),
  periods_per_day: z.coerce.number().int().min(1).max(10),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "الوقت بصيغة 07:30"),
  period_minutes: z.coerce.number().int().min(20).max(120),
  break_after: z.coerce.number().int().min(1).max(10).nullable().optional(),
  break_minutes: z.coerce.number().int().min(0).max(120).default(20),
});

export const generateSchema = z.object({
  class_ids: z.array(t.id).max(200).optional(),     // فارغ = كل الشعب
  replace: z.boolean().default(false),              // استبدال الجدول الحالي لهذه الشعب
});

export const applySchema = z.object({
  slots: z.array(z.object({
    class_id: t.id, day: z.coerce.number().int().min(0).max(6),
    period: z.coerce.number().int().min(1).max(10),
    subject_id: t.id, teacher_id: t.optId, room: t.optText(30),
  })).max(2000),
  replace: z.boolean().default(true),
});

const DEFAULTS = { days: [0, 1, 2, 3, 4], periods_per_day: 7, start_time: "07:30", period_minutes: 45, break_after: 3, break_minutes: 20 };

export async function getSettings(q) {
  const [row] = await q(
    `SELECT days, periods_per_day, to_char(start_time, 'HH24:MI') AS start_time, period_minutes, break_after, break_minutes
       FROM timetable_settings WHERE tenant_id = app_tenant()`);
  if (row) return { ...row, days: row.days.map(Number) };
  await q("INSERT INTO timetable_settings (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  return { ...DEFAULTS };
}

export async function saveSettings(q, b) {
  await q("INSERT INTO timetable_settings (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  await q(
    `UPDATE timetable_settings SET days = $1, periods_per_day = $2, start_time = $3, period_minutes = $4,
        break_after = $5, break_minutes = $6 WHERE tenant_id = app_tenant()`,
    [b.days, b.periods_per_day, b.start_time, b.period_minutes, b.break_after ?? null, b.break_minutes]);
  return getSettings(q);
}

/** أوقات الحصص المحسوبة من وقت البداية ومدة الحصة والفسحة */
export function periodTimes(settings) {
  const [hh, mm] = settings.start_time.split(":").map(Number);
  let minutes = hh * 60 + mm;
  const out = [];
  for (let p = 1; p <= settings.periods_per_day; p++) {
    const start = minutes;
    minutes += settings.period_minutes;
    out.push({
      period: p,
      from: fmt(start),
      to: fmt(minutes),
      break_after: settings.break_after === p ? settings.break_minutes : 0,
    });
    if (settings.break_after === p) minutes += settings.break_minutes;
  }
  return out;
}
const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * توليد مسودة جدول.
 * المدخلات من النظام نفسه: حصص كل مادة أسبوعيًا (من المواد)، وإسناد المعلمين (من الفصول والمواد).
 * القيود: لا معلم في فصلين بنفس الوقت، ولا شعبة بحصتين، والتوزيع على الأيام قدر الإمكان.
 */
export async function generate(q, b) {
  const settings = await getSettings(q);
  const classes = await q(
    `SELECT c.id, c.name, c.grade_id FROM classes c
      WHERE ($1::bigint[] IS NULL OR c.id = ANY($1)) ORDER BY c.sort_order, c.id`,
    [b.class_ids?.length ? b.class_ids : null]);
  if (!classes.length) throw badRequest("لا توجد شعب لتوليد جدولها");

  const subjects = await q(
    `SELECT s.id, s.name, s.weekly_periods,
            COALESCE(array_agg(sg.grade_id) FILTER (WHERE sg.grade_id IS NOT NULL), '{}') AS grade_ids
       FROM subjects s LEFT JOIN subject_grades sg ON sg.subject_id = s.id
      WHERE s.is_active GROUP BY s.id ORDER BY s.sort_order, s.id`);
  const assignments = await q("SELECT teacher_id, class_id, subject_id FROM teacher_assignments");

  const teacherOf = (classId, subjectId) => {
    const a = assignments.find((x) => Number(x.class_id) === Number(classId) && Number(x.subject_id) === Number(subjectId));
    return a ? Number(a.teacher_id) : null;
  };

  // الحصص المحجوزة حاليًا للشعب الأخرى (حتى لا تتعارض المسودة مع جدول قائم)
  const existing = b.replace
    ? await q("SELECT class_id, teacher_id, day, period FROM timetable_slots WHERE NOT (class_id = ANY($1::bigint[]))",
      [classes.map((c) => c.id)])
    : await q("SELECT class_id, teacher_id, day, period FROM timetable_slots");

  const busyTeacher = new Set(existing.filter((s) => s.teacher_id).map((s) => `${s.teacher_id}:${s.day}:${s.period}`));
  const busyClass = new Set(existing.map((s) => `${s.class_id}:${s.day}:${s.period}`));

  const slots = [];
  const warnings = [];
  const days = settings.days;
  const perDay = settings.periods_per_day;

  for (const cls of classes) {
    const mine = subjects.filter((s) => !s.grade_ids.length || s.grade_ids.map(Number).includes(Number(cls.grade_id)));
    if (!mine.length) { warnings.push(`لا توجد مواد مرتبطة بصف ${cls.name}`); continue; }

    // قائمة الحصص المطلوبة: مادة مكررة بعدد حصصها الأسبوعية
    const demand = [];
    for (const s of mine) demand.push(...Array(Math.max(1, s.weekly_periods || 1)).fill(s));
    const capacity = days.length * perDay;
    if (demand.length > capacity) {
      warnings.push(`${cls.name}: الحصص المطلوبة ${demand.length} أكبر من سعة الجدول ${capacity}. وُزّع الممكن فقط.`);
    }

    // توزيع: نمرّ على الأيام بالتناوب حتى لا تتكدس المادة في يوم واحد
    const perDayCount = new Map();      // يوم:مادة ← عدد
    let placed = 0;
    for (const subject of demand) {
      let done = false;
      for (let round = 0; round < 2 && !done; round++) {
        for (const day of days) {
          const used = perDayCount.get(`${day}:${subject.id}`) || 0;
          if (round === 0 && used >= 1) continue;        // جولة أولى: حصة واحدة لكل مادة في اليوم
          for (let period = 1; period <= perDay; period++) {
            if (busyClass.has(`${cls.id}:${day}:${period}`)) continue;
            const teacher = teacherOf(cls.id, subject.id);
            if (teacher && busyTeacher.has(`${teacher}:${day}:${period}`)) continue;
            slots.push({ class_id: cls.id, class_name: cls.name, day, period,
              subject_id: subject.id, subject: subject.name, teacher_id: teacher });
            busyClass.add(`${cls.id}:${day}:${period}`);
            if (teacher) busyTeacher.add(`${teacher}:${day}:${period}`);
            perDayCount.set(`${day}:${subject.id}`, used + 1);
            placed++;
            done = true;
            break;
          }
          if (done) break;
        }
      }
      if (!done) warnings.push(`${cls.name}: تعذّر وضع حصة لمادة ${subject.name} (لا يوجد وقت متاح للمعلم أو الشعبة)`);
    }

    const noTeacher = mine.filter((s) => !teacherOf(cls.id, s.id));
    if (noTeacher.length) warnings.push(`${cls.name}: بلا معلم مُسند في: ${noTeacher.map((s) => s.name).join("، ")}`);
    if (!placed) warnings.push(`${cls.name}: لم تُوضع أي حصة`);
  }

  return { settings, times: periodTimes(settings), slots, warnings, classes: classes.length };
}

/** اعتماد المسودة: يكتبها في الجدول الفعلي داخل معاملة واحدة */
export async function apply(q, b) {
  if (!b.slots.length) throw badRequest("لا توجد حصص للاعتماد");
  const classIds = [...new Set(b.slots.map((s) => Number(s.class_id)))];
  if (b.replace) await q("DELETE FROM timetable_slots WHERE class_id = ANY($1::bigint[])", [classIds]);

  let saved = 0;
  for (const s of b.slots) {
    const [cls] = await q("SELECT id FROM classes WHERE id = $1", [s.class_id]);
    if (!cls) throw notFound("شعبة غير موجودة");
    await q(
      `INSERT INTO timetable_slots (tenant_id, class_id, day, period, subject_id, teacher_id, room)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT (class_id, day, period)
       DO UPDATE SET subject_id = EXCLUDED.subject_id, teacher_id = EXCLUDED.teacher_id, room = EXCLUDED.room`,
      [s.class_id, s.day, s.period, s.subject_id, s.teacher_id ?? null, s.room ?? null]);
    saved++;
  }
  return { saved, classes: classIds.length };
}

/** فحص التعارضات في الجدول القائم (معلم، شعبة، قاعة) */
export async function conflicts(q) {
  const teacher = await q(
    `SELECT t.full_name AS teacher, s.day, s.period, array_agg(c.name) AS classes
       FROM timetable_slots s JOIN teachers t ON t.id = s.teacher_id JOIN classes c ON c.id = s.class_id
      GROUP BY t.full_name, s.day, s.period HAVING count(*) > 1`);
  const room = await q(
    `SELECT s.room, s.day, s.period, array_agg(c.name) AS classes
       FROM timetable_slots s JOIN classes c ON c.id = s.class_id
      WHERE s.room IS NOT NULL AND s.room <> ''
      GROUP BY s.room, s.day, s.period HAVING count(*) > 1`);
  return { teacher, room };
}
