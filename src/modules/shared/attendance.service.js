// منطق الحضور (مشترك بين الإدارة والمعلم)
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";
import { notify, getQuiet } from "./notify.service.js";
import { featureSettings } from "./feature-settings.service.js";

export const STATUSES = ["present", "absent", "late", "excused"];
const LABEL = { present: "حاضر", absent: "غائب", late: "متأخر", excused: "غياب بعذر" };

export const listQuery = z.object({ class_id: t.id, date: t.date });
export const dayQuery = z.object({ date: t.date });
export const markSchema = z.object({
  date: t.date,
  reason: t.optText(300),
  // يمكن تسجيل طالب واحد أو فصل كامل دفعة واحدة
  // excuse: سبب الغياب أو التأخر، يظهر لولي الأمر (يُمسح تلقائيًا إن صار الطالب حاضرًا)
  entries: z.array(z.object({ student_id: t.id, status: z.enum(STATUSES), excuse: t.optText(200) })).min(1).max(500),
});

/**
 * حالة يوم من ناحية الدراسة: هل هو إجازة تؤثر على الحضور (من جدول الإجازات)،
 * وهل هو من أيام الدراسة الأسبوعية المضبوطة. مصدر واحد يقرأه الحضور والواجهات.
 */
export async function dayStatus(q, date) {
  const [holiday] = await q(
    `SELECT name, kind FROM holidays WHERE affects_attendance AND $1::date BETWEEN start_date AND end_date
      ORDER BY start_date LIMIT 1`, [date]);
  const [cfg] = await q("SELECT days FROM timetable_settings WHERE tenant_id = app_tenant()");
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();        // 0 = الأحد
  const studyDay = cfg ? cfg.days.map(Number).includes(dow) : dow <= 4;
  return { date, holiday: holiday || null, study_day: studyDay };
}

// withContact: جوال ولي الأمر لأزرار التنبيه (للإدارة فقط، لا يُرسل لبوابة المعلم)
export async function listForClass(q, classId, day, { withContact = false } = {}) {
  return q(
    `SELECT s.id, s.full_name AS name, a.status, a.excuse, a.parent_excuse, a.parent_excuse_state${withContact ? ", s.guardian_phone, s.guardian_name, s.access_key" : ""}
       FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.day = $2
      WHERE s.class_id = $1 AND s.archived_at IS NULL
      ORDER BY s.full_name`,
    [classId, day],
  );
}

/**
 * يسجل الحضور داخل معاملة واحدة. تعديل حالة مسجلة سابقًا يتطلب سببًا.
 * @param allowedClass دالة تتحقق أن الفصل مسموح للمستخدم
 */
export async function mark(q, { date, reason, entries }, { actor, allowedClass }) {
  if (date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw badRequest("لا يمكن تسجيل حضور لتاريخ مستقبلي");
  const day = await dayStatus(q, date);
  if (day.holiday) throw badRequest(`هذا اليوم إجازة (${day.holiday.name}) ولا يُسجَّل فيه حضور`);
  const ids = entries.map((e) => e.student_id);
  const students = await q("SELECT id, class_id, full_name FROM students WHERE id = ANY($1::bigint[]) AND archived_at IS NULL", [ids]);
  if (students.length !== new Set(ids).size) throw notFound("أحد الطلاب غير موجود");
  for (const s of students) if (!(await allowedClass(s.class_id))) throw badRequest(`الطالب ${s.full_name} ليس ضمن فصولك`);

  const existing = new Map((await q("SELECT student_id, status FROM attendance WHERE day = $1 AND student_id = ANY($2::bigint[])", [date, ids]))
    .map((r) => [Number(r.student_id), r.status]));
  const changes = entries.filter((e) => existing.has(e.student_id) && existing.get(e.student_id) !== e.status);
  if (changes.length && !reason) throw badRequest("اكتب سبب تعديل الحضور المسجل سابقًا");

  for (const e of entries) {
    const excuse = e.status === "present" ? null : (e.excuse ?? null);
    await q(
      `INSERT INTO attendance (tenant_id, student_id, day, status, note, recorded_by, excuse)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT (student_id, day) DO UPDATE
         SET status = EXCLUDED.status, note = COALESCE(EXCLUDED.note, attendance.note), recorded_by = EXCLUDED.recorded_by,
             excuse = CASE WHEN EXCLUDED.status = 'present' THEN NULL ELSE COALESCE(EXCLUDED.excuse, attendance.excuse) END
         WHERE attendance.status IS DISTINCT FROM EXCLUDED.status
            OR (EXCLUDED.excuse IS NOT NULL AND attendance.excuse IS DISTINCT FROM EXCLUDED.excuse)`,
      [e.student_id, date, e.status, existing.has(e.student_id) && changes.includes(e) ? `تعديل من ${LABEL[existing.get(e.student_id)]}: ${reason}` : null, actor, excuse],
    );
  }
  // إشعار ولي الأمر بالغياب أو التأخر الجديد (والحضور إن فعّلته المدرسة) — لأيام قريبة فقط، لا عند إدخال سجلات قديمة.
  // مفتاح لكل طالب ويوم وحالة: تبديل الحالة ذهابًا وإيابًا لا يكرر التنبيه
  const fresh = entries.filter((e) => ["absent", "late", "present"].includes(e.status) && existing.get(e.student_id) !== e.status);
  if (fresh.length && date >= new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)) {
    const names = new Map(students.map((s) => [Number(s.id), s.full_name]));
    const TEXT = { absent: ["غياب", "سُجّل غياب"], late: ["تأخر", "سُجّل تأخر"], present: ["حضور", "سُجّل حضور"] };
    for (const e of fresh) {
      const name = names.get(Number(e.student_id));
      const [label, verb] = TEXT[e.status];
      await notify(q, { event: e.status === "absent" ? "absence" : e.status, students: [e.student_id], urgent: e.status === "absent",
        title: `${label}: ${name}`, dedupKey: `${e.student_id}:${date}:${e.status}`, dedupMinutes: 24 * 60,
        body: `${verb} ${name} يوم ${date}${e.excuse ? ` — ${e.excuse}` : ""}.`,
        link: "attendance" });
    }
  }
  return { saved: entries.length, changed: changes.length };
}

/* ---------- متابعة الإدارة ---------- */

// نسبة الحضور: الغياب بعذر لا يُحسب على الطالب (يُستثنى من المقام)
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** متابعة يوم: لكل فصل هل سُجّل حضوره، وأعداد الحالات، ومن سجّله؛ مع قائمة الغائبين والمتأخرين */
export async function overview(q, date) {
  const day = await dayStatus(q, date);
  const classes = await q(
    `SELECT c.id, c.name, count(s.id)::int AS students,
            count(a.id)::int AS recorded,
            count(a.id) FILTER (WHERE a.status = 'present')::int AS present,
            count(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
            count(a.id) FILTER (WHERE a.status = 'late')::int AS late,
            count(a.id) FILTER (WHERE a.status = 'excused')::int AS excused,
            max(a.updated_at) AS last_at,
            (SELECT string_agg(DISTINCT a2.recorded_by, '، ') FROM attendance a2 JOIN students s2 ON s2.id = a2.student_id
              WHERE s2.class_id = c.id AND a2.day = $1) AS recorded_by
       FROM classes c
       LEFT JOIN students s ON s.class_id = c.id AND s.archived_at IS NULL
       LEFT JOIN attendance a ON a.student_id = s.id AND a.day = $1
      GROUP BY c.id ORDER BY c.id`, [date]);
  const people = await q(
    `SELECT s.id, s.full_name AS name, s.guardian_phone, s.guardian_name, s.access_key, c.id AS class_id, c.name AS class_name,
            a.status, a.excuse, a.parent_excuse, a.parent_excuse_state, a.recorded_by
       FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE a.day = $1 AND a.status IN ('absent', 'late', 'excused') AND s.archived_at IS NULL
      ORDER BY a.status, c.id, s.full_name`, [date]);
  const withStudents = classes.filter((c) => c.students);
  const sum = (k) => withStudents.reduce((n, c) => n + c[k], 0);
  const totals = { classes: withStudents.length, done: withStudents.filter((c) => c.recorded >= c.students).length,
    partial: withStudents.filter((c) => c.recorded && c.recorded < c.students).length,
    students: sum("students"), recorded: sum("recorded"), present: sum("present"), absent: sum("absent"), late: sum("late"), excused: sum("excused") };
  totals.rate = pct(totals.present + totals.late, totals.recorded - totals.excused);
  return { day, totals, classes, people };
}

export const reportQuery = z.object({ from: t.date, to: t.date, class_id: t.id.optional() });

/** تقرير فترة: لكل طالب أعداد الحالات ونسبة الحضور، ولكل فصل نسبته، ومنحنى الأيام */
export async function report(q, { from, to, class_id }) {
  if (to < from) throw badRequest("نهاية الفترة قبل بدايتها");
  const cls = class_id ? "AND s.class_id = $3" : "";
  const args = class_id ? [from, to, class_id] : [from, to];
  const students = await q(
    `SELECT s.id, s.full_name AS name, c.name AS class_name, s.guardian_phone, s.guardian_name, s.access_key,
            count(a.id)::int AS days,
            count(a.id) FILTER (WHERE a.status = 'present')::int AS present,
            count(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
            count(a.id) FILTER (WHERE a.status = 'late')::int AS late,
            count(a.id) FILTER (WHERE a.status = 'excused')::int AS excused,
            max(a.day) FILTER (WHERE a.status = 'absent') AS last_absent
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN attendance a ON a.student_id = s.id AND a.day BETWEEN $1 AND $2
      WHERE s.archived_at IS NULL ${cls}
      GROUP BY s.id, c.id ORDER BY absent DESC, late DESC, s.full_name`, args);
  for (const s of students) s.rate = pct(s.present + s.late, s.days - s.excused);
  const classes = await q(
    `SELECT c.id, c.name, count(a.id)::int AS records,
            count(a.id) FILTER (WHERE a.status IN ('present', 'late'))::int AS attended,
            count(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
            count(a.id) FILTER (WHERE a.status = 'late')::int AS late,
            count(a.id) FILTER (WHERE a.status = 'excused')::int AS excused
       FROM classes c JOIN students s ON s.class_id = c.id AND s.archived_at IS NULL
       JOIN attendance a ON a.student_id = s.id AND a.day BETWEEN $1 AND $2
      WHERE TRUE ${cls} GROUP BY c.id ORDER BY c.id`, args);
  for (const c of classes) c.rate = pct(c.attended, c.records - c.excused);
  const days = await q(
    `SELECT a.day::text AS day, count(*)::int AS records,
            count(*) FILTER (WHERE a.status IN ('present', 'late'))::int AS attended,
            count(*) FILTER (WHERE a.status = 'absent')::int AS absent,
            count(*) FILTER (WHERE a.status = 'excused')::int AS excused
       FROM attendance a JOIN students s ON s.id = a.student_id
      WHERE a.day BETWEEN $1 AND $2 AND s.archived_at IS NULL ${cls}
      GROUP BY a.day ORDER BY a.day`, args);
  for (const d of days) d.rate = pct(d.attended, d.records - d.excused);
  return { from, to, students, classes, days };
}

/** الطلاب الذين بلغ غيابهم (بلا عذر) الحد خلال آخر 30 يومًا */
export async function atRisk(q, threshold) {
  if (!threshold) return [];
  return q(
    `SELECT s.id, s.full_name AS name, c.name AS class_name, s.guardian_phone, s.guardian_name, s.access_key,
            count(*)::int AS absent, max(a.day)::text AS last_absent
       FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE a.status = 'absent' AND a.day >= CURRENT_DATE - 30 AND s.archived_at IS NULL
      GROUP BY s.id, c.id HAVING count(*) >= $1 ORDER BY absent DESC, s.full_name`, [threshold]);
}

/* ---------- الأعذار ---------- */

export const excuseSchema = z.object({ student_id: t.id, date: t.date, excuse: t.optText(200), status: z.enum(["absent", "late", "excused"]).optional() });

/** الإدارة تكتب سبب الغياب (أو تعدّله) لسجل موجود، وقد تحوّله إلى «بعذر» */
export async function setExcuse(q, { student_id, date, excuse, status }) {
  const [row] = await q(
    `UPDATE attendance SET excuse = $3, status = COALESCE($4, status)
      WHERE student_id = $1 AND day = $2 AND status <> 'present' RETURNING status, excuse`, [student_id, date, excuse ?? null, status ?? null]);
  if (!row) throw notFound("لا يوجد غياب أو تأخر مسجل لهذا الطالب في هذا اليوم");
  return row;
}

export async function pendingExcuses(q) {
  return q(
    `SELECT a.student_id, a.day::text AS day, a.status, a.parent_excuse, a.parent_excuse_at, a.excuse,
            s.full_name AS name, c.name AS class_name, s.guardian_name, s.guardian_phone
       FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE a.parent_excuse_state = 'pending' ORDER BY a.parent_excuse_at`);
}

export const decideSchema = z.object({ student_id: t.id, date: t.date, accept: z.boolean() });

/** قبول عذر ولي الأمر: الغياب يصبح «بعذر» والعذر يصبح سبب الغياب الظاهر. الرفض يبقي الحالة */
export async function decideExcuse(q, { student_id, date, accept }) {
  const [row] = await q(
    `UPDATE attendance SET parent_excuse_state = $3,
            status = CASE WHEN $3 = 'accepted' AND status = 'absent' THEN 'excused' ELSE status END,
            excuse = CASE WHEN $3 = 'accepted' THEN left(parent_excuse, 200) ELSE excuse END
      WHERE student_id = $1 AND day = $2 AND parent_excuse_state = 'pending' RETURNING status`,
    [student_id, date, accept ? "accepted" : "rejected"]);
  if (!row) throw notFound("العذر غير موجود أو سبق البت فيه");
  return row;
}

export const parentExcuseSchema = z.object({ date: t.date, text: z.string().trim().min(3, "اكتب العذر").max(300) });

/** ولي الأمر يرسل عذرًا عن يوم غياب أو تأخر (آخر 30 يومًا، ما لم يُقبل عذر سابق) */
export async function submitParentExcuse(q, studentId, { date, text }) {
  const [row] = await q(
    `UPDATE attendance SET parent_excuse = $3, parent_excuse_at = now(), parent_excuse_state = 'pending'
      WHERE student_id = $1 AND day = $2 AND status IN ('absent', 'late') AND day >= CURRENT_DATE - 30
        AND parent_excuse_state IS DISTINCT FROM 'accepted'
      RETURNING day`, [studentId, date, text]);
  if (!row) throw badRequest("لا يمكن إرسال عذر لهذا اليوم (غير مسجل غياب، أو مضى عليه أكثر من 30 يومًا، أو قُبل عذره)");
  return { ok: true };
}

/* ---------- بوابة الحضور: مسح بطاقة الطالب ---------- */
export const gateSchema = z.object({ code: z.string().trim().min(4).max(400) });

// رمز البطاقة رابط ملف الطالب (…/<المدرسة>?k=المعرّف) أو المعرّف نفسه مكتوبًا
export function keyFromCode(code, schoolId) {
  let key = code;
  if (/^https?:\/\//i.test(code)) {
    let u;
    try { u = new URL(code); } catch { throw badRequest("رمز غير مقروء"); }
    const school = decodeURIComponent(u.pathname.split("/")[1] || "").toLowerCase();
    if (school && school !== String(schoolId).toLowerCase()) throw badRequest("هذه البطاقة لمدرسة أخرى");
    key = u.searchParams.get("k") || "";
  }
  key = key.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{8}$/.test(key)) throw badRequest("الرمز ليس بطاقة طالب");
  return `${key.slice(0, 4)}-${key.slice(4)}`;
}

/**
 * تسجيل وصول طالب من البوابة: حاضر قبل وقت التأخر، ومتأخر بعده، وإبلاغ ولي الأمر فورًا.
 * المسح مرة ثانية في نفس اليوم لا يكرر شيئًا. ومن سُجّل غائبًا ثم وصل يتحول إلى متأخر.
 */
export async function gateCheckIn(q, code, { actor, schoolId }) {
  const key = keyFromCode(code, schoolId);
  const [s] = await q(`SELECT s.id, s.full_name, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id
    WHERE s.access_key = $1 AND s.status = 'active' AND s.archived_at IS NULL`, [key]);
  if (!s) throw notFound("لم يُعثر على طالب بهذه البطاقة");
  const { timezone } = await getQuiet(q);
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: timezone });
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const day = await dayStatus(q, date);
  if (day.holiday) throw badRequest(`اليوم إجازة (${day.holiday.name})`);
  if (!day.study_day) throw badRequest("اليوم ليس من أيام الدراسة");
  const { late_after } = await featureSettings(q, "gate");
  const status = hm > late_after ? "late" : "present";
  const time12 = new Intl.DateTimeFormat("ar", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  const student = { id: s.id, name: s.full_name, class_name: s.class_name };
  const [prev] = await q("SELECT status, created_at FROM attendance WHERE student_id = $1 AND day = $2", [s.id, date]);
  if (prev && (prev.status === "present" || prev.status === "late")) {
    return { student, status: prev.status, already: true, date, time: time12 };
  }
  await q(
    `INSERT INTO attendance (tenant_id, student_id, day, status, note, recorded_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5)
     ON CONFLICT (student_id, day) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by, excuse = NULL`,
    [s.id, date, status, prev ? `وصل عند البوابة بعد تسجيله ${LABEL[prev.status]}` : "بوابة الحضور", actor]);
  if (status === "present") {
    await notify(q, { event: "arrival", students: [s.id], title: `وصل ${s.full_name} المدرسة`,
      body: `سُجّل حضوره عند البوابة الساعة ${time12}.`, link: "attendance", dedupKey: `${s.id}:${date}:arrival`, dedupMinutes: 24 * 60 });
  } else {
    await notify(q, { event: "late", students: [s.id], title: `تأخر: ${s.full_name}`,
      body: `وصل المدرسة متأخرًا الساعة ${time12}.`, link: "attendance", dedupKey: `${s.id}:${date}:late`, dedupMinutes: 24 * 60 });
  }
  return { student, status, already: false, date, time: time12 };
}

/** آخر من سُجّلوا عبر البوابة اليوم */
export async function gateToday(q) {
  const { timezone } = await getQuiet(q);
  const date = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const rows = await q(`SELECT s.full_name AS name, c.name AS class_name, a.status, a.created_at FROM attendance a
    JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
    WHERE a.day = $1 AND a.note LIKE '%بوابة%' ORDER BY a.created_at DESC LIMIT 30`, [date]);
  const [{ n }] = await q("SELECT count(*)::int AS n FROM attendance WHERE day = $1 AND note LIKE '%بوابة%'", [date]);
  return { date, count: n, recent: rows };
}
