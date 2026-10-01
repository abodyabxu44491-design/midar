// شؤون الموظفين: حضور يومي، وتسجيل المعلم حضوره بنفسه، وطلبات الإجازة، وخصم الغياب من الراتب، وحصص الانتظار
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, forbidden, conflict } from "../../core/http/errors.js";
import { featureSettings } from "./feature-settings.service.js";
import { notify } from "./notify.service.js";

export const STATUSES = { present: "حاضر", late: "متأخر", absent: "غائب", leave: "إجازة", excused: "بعذر" };
export const LEAVE_KINDS = { sick: "مرضية", annual: "سنوية", emergency: "اضطرارية", unpaid: "بدون راتب", official: "مهمة رسمية", other: "أخرى" };

// الوقت المحلي للمدرسة (اليمن والسعودية +3)
const ZONE = "Asia/Aden";
export const localDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: ZONE });
const localTime = (d = new Date()) => d.toLocaleTimeString("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
const minutes = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** أيام الدراسة بين تاريخين (بلا عطل الأسبوع ولا الإجازات الرسمية) */
export async function schoolDays(q, from, to) {
  const [cfg] = await q("SELECT days FROM timetable_settings WHERE tenant_id = app_tenant()");
  const week = cfg ? cfg.days.map(Number) : [0, 1, 2, 3, 4];
  const hol = await q("SELECT start_date::text AS a, end_date::text AS b FROM holidays WHERE affects_attendance AND end_date >= $1 AND start_date <= $2", [from, to]);
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (week.includes(dow) && !hol.some((h) => d >= h.a && d <= h.b)) out.push(d);
  }
  return out;
}

/* ---------- الحضور ---------- */
export const markSchema = z.object({
  day: t.date,
  entries: z.array(z.object({
    staff_id: t.id, status: z.enum(Object.keys(STATUSES)),
    check_in: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(), note: t.optText(300),
  })).min(1).max(500),
});

export async function board(q, day) {
  return q(
    `SELECT s.id AS staff_id, s.full_name, s.category, s.job_title, s.teacher_id,
            a.status, a.check_in::text, a.check_out::text, a.late_min, a.note, a.source,
            (SELECT l.kind FROM leave_requests l WHERE l.staff_id = s.id AND l.status = 'approved' AND $1::date BETWEEN l.from_day AND l.to_day LIMIT 1) AS leave_kind
       FROM staff s LEFT JOIN staff_attendance a ON a.staff_id = s.id AND a.day = $1
      WHERE s.is_active ORDER BY s.category, s.full_name`, [day]);
}

export async function mark(q, b, actor) {
  if (b.day > localDay()) throw badRequest("لا يمكن تسجيل حضور لتاريخ مستقبلي");
  const ids = b.entries.map((e) => e.staff_id);
  const found = await q("SELECT id FROM staff WHERE id = ANY($1)", [ids]);
  if (found.length !== new Set(ids).size) throw notFound("أحد الموظفين غير موجود");
  const s = await featureSettings(q, "staff");
  for (const e of b.entries) {
    const late = e.status === "late" && e.check_in ? Math.max(0, minutes(e.check_in) - minutes(s.work_start)) : null;
    await q(
      `INSERT INTO staff_attendance (tenant_id, staff_id, day, status, check_in, late_min, note, source, recorded_by)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, 'admin', $7)
       ON CONFLICT (staff_id, day) DO UPDATE SET status = EXCLUDED.status, check_in = COALESCE(EXCLUDED.check_in, staff_attendance.check_in),
         late_min = EXCLUDED.late_min, note = EXCLUDED.note, source = 'admin', recorded_by = EXCLUDED.recorded_by`,
      [e.staff_id, b.day, e.status, e.check_in || null, late, e.note ?? null, actor]);
  }
  return { saved: b.entries.length };
}

async function staffOfTeacher(q, teacherId) {
  const [s] = await q("SELECT id, full_name FROM staff WHERE teacher_id = $1", [teacherId]);
  if (!s) throw notFound("لا يوجد سجل وظيفي لهذا الحساب. تواصل مع الإدارة.");
  return s;
}

/** المعلم يسجل حضوره وانصرافه من بوابته (إن سمحت المدرسة) */
export async function selfCheck(q, teacherId, kind, actor) {
  const s = await featureSettings(q, "staff");
  if (!s.self_checkin) throw forbidden("تسجيل الحضور الذاتي غير مفعّل في المدرسة");
  const me = await staffOfTeacher(q, teacherId);
  const day = localDay(), now = localTime();
  const [cur] = await q("SELECT status, check_in::text, check_out::text FROM staff_attendance WHERE staff_id = $1 AND day = $2", [me.id, day]);
  if (kind === "in") {
    if (cur?.check_in) throw conflict(`سجّلت حضورك اليوم الساعة ${cur.check_in.slice(0, 5)}`);
    if (cur?.status === "leave") throw conflict("لديك إجازة معتمدة اليوم");
    const lateMin = Math.max(0, minutes(now) - minutes(s.work_start));
    const status = lateMin > s.late_after_min ? "late" : "present";
    await q(`INSERT INTO staff_attendance (tenant_id, staff_id, day, status, check_in, late_min, source, recorded_by)
             VALUES (app_tenant(), $1, $2, $3, $4, $5, 'self', $6)
             ON CONFLICT (staff_id, day) DO UPDATE SET status = EXCLUDED.status, check_in = EXCLUDED.check_in, late_min = EXCLUDED.late_min, source = 'self'`,
      [me.id, day, status, now, status === "late" ? lateMin : null, actor]);
    return { day, check_in: now, status, late_min: status === "late" ? lateMin : 0 };
  }
  if (!cur?.check_in) throw badRequest("سجّل حضورك أولًا");
  if (cur.check_out) throw conflict(`سجّلت انصرافك الساعة ${cur.check_out.slice(0, 5)}`);
  await q("UPDATE staff_attendance SET check_out = $3 WHERE staff_id = $1 AND day = $2", [me.id, day, now]);
  return { day, check_out: now };
}

export async function myStatus(q, teacherId) {
  const me = await staffOfTeacher(q, teacherId);
  const day = localDay();
  const [today] = await q("SELECT status, check_in::text, check_out::text, late_min FROM staff_attendance WHERE staff_id = $1 AND day = $2", [me.id, day]);
  const month = day.slice(0, 7) + "-01";
  const [sum] = await q(
    `SELECT count(*) FILTER (WHERE status IN ('present', 'late'))::int AS present, count(*) FILTER (WHERE status = 'late')::int AS late,
            count(*) FILTER (WHERE status = 'absent')::int AS absent, count(*) FILTER (WHERE status = 'leave')::int AS leave,
            COALESCE(sum(late_min), 0)::int AS late_minutes
       FROM staff_attendance WHERE staff_id = $1 AND day >= $2`, [me.id, month]);
  const leaves = await q(`SELECT id, kind, from_day::text, to_day::text, reason, status, decision_note, created_at FROM leave_requests
    WHERE staff_id = $1 ORDER BY from_day DESC LIMIT 30`, [me.id]);
  const s = await featureSettings(q, "staff");
  return { day, today: today || null, month: sum, leaves, self_checkin: s.self_checkin, work_start: s.work_start, work_end: s.work_end };
}

/** تقرير فترة لكل موظف */
export async function report(q, from, to) {
  return q(
    `SELECT s.id AS staff_id, s.full_name, s.category,
            count(a.*) FILTER (WHERE a.status IN ('present', 'late'))::int AS present,
            count(a.*) FILTER (WHERE a.status = 'late')::int AS late,
            COALESCE(sum(a.late_min), 0)::int AS late_minutes,
            count(a.*) FILTER (WHERE a.status = 'absent')::int AS absent,
            count(a.*) FILTER (WHERE a.status = 'leave')::int AS leave,
            count(a.*) FILTER (WHERE a.status = 'excused')::int AS excused
       FROM staff s LEFT JOIN staff_attendance a ON a.staff_id = s.id AND a.day BETWEEN $1 AND $2
      WHERE s.is_active GROUP BY s.id ORDER BY s.category, s.full_name`, [from, to]);
}

/* ---------- الإجازات ---------- */
export const leaveSchema = z.object({
  staff_id: t.optId,
  kind: z.enum(Object.keys(LEAVE_KINDS)),
  from_day: t.date, to_day: t.date,
  reason: t.optText(500),
});

export async function requestLeave(q, b, { staffId, actor, approveNow = false }) {
  if (b.to_day < b.from_day) throw badRequest("تاريخ النهاية قبل البداية");
  const [dup] = await q(`SELECT 1 FROM leave_requests WHERE staff_id = $1 AND status IN ('pending', 'approved')
    AND from_day <= $3 AND to_day >= $2`, [staffId, b.from_day, b.to_day]);
  if (dup) throw conflict("يوجد طلب إجازة متداخل مع هذه الأيام");
  const [row] = await q(
    `INSERT INTO leave_requests (tenant_id, staff_id, kind, from_day, to_day, reason, requested_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING id`, [staffId, b.kind, b.from_day, b.to_day, b.reason ?? null, actor]);
  if (approveNow) await decideLeave(q, row.id, { approve: true, note: null }, actor);
  return row;
}

export async function decideLeave(q, id, { approve, note }, actor) {
  const [l] = await q("SELECT l.*, s.teacher_id, s.full_name FROM leave_requests l JOIN staff s ON s.id = l.staff_id WHERE l.id = $1 FOR UPDATE OF l", [id]);
  if (!l) throw notFound("الطلب غير موجود");
  if (l.status !== "pending") throw conflict("تم البت في هذا الطلب");
  await q("UPDATE leave_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1",
    [id, approve ? "approved" : "rejected", actor, note ?? null]);
  if (approve) {
    for (const day of await schoolDays(q, l.from_day, l.to_day)) {
      await q(`INSERT INTO staff_attendance (tenant_id, staff_id, day, status, note, source, recorded_by)
               VALUES (app_tenant(), $1, $2, 'leave', $3, 'leave', $4)
               ON CONFLICT (staff_id, day) DO UPDATE SET status = 'leave', note = EXCLUDED.note, source = 'leave'`,
        [l.staff_id, day, `إجازة ${LEAVE_KINDS[l.kind]}`, actor]);
    }
  }
  if (l.teacher_id) {
    const users = await q("SELECT id FROM users WHERE teacher_id = $1", [l.teacher_id]);
    await notify(q, { event: "leave", users: users.map((u) => u.id), title: approve ? "اعتُمدت إجازتك" : "لم تُعتمد إجازتك",
      body: `${LEAVE_KINDS[l.kind]} من ${l.from_day} إلى ${l.to_day}${note ? ` — ${note}` : ""}` });
  }
}

export async function cancelLeave(q, id, staffId) {
  const rows = await q("UPDATE leave_requests SET status = 'cancelled' WHERE id = $1 AND staff_id = $2 AND status = 'pending' RETURNING id", [id, staffId]);
  if (!rows.length) throw notFound("لا يوجد طلب معلّق بهذا الرقم");
}

export const leaves = (q, { status = null } = {}) => q(
  `SELECT l.id, l.staff_id, s.full_name, s.category, l.kind, l.from_day::text, l.to_day::text, l.reason, l.status,
          l.requested_by, l.decided_by, l.decided_at, l.decision_note, l.created_at
     FROM leave_requests l JOIN staff s ON s.id = l.staff_id
    WHERE ($1::text IS NULL OR l.status = $1) ORDER BY (l.status = 'pending') DESC, l.from_day DESC LIMIT 300`, [status]);

/** خصم الغياب للمسير: أيام الغياب بلا إجازة + أيام الإجازة بدون راتب، بسعر اليوم = (الأساسي + البدل) ÷ أيام العمل */
export async function absenceDeductions(q, period) {
  const s = await featureSettings(q, "staff");
  if (!s.deduct_absence) return { map: new Map(), working_days: s.working_days };
  const from = period, to = addDays(addDays(period, 32).slice(0, 8) + "01", -1);
  const absent = await q(`SELECT staff_id, count(*)::int AS n FROM staff_attendance WHERE status = 'absent' AND day BETWEEN $1 AND $2 GROUP BY staff_id`, [from, to]);
  const unpaid = await q(`SELECT staff_id, from_day::text AS a, to_day::text AS b FROM leave_requests WHERE status = 'approved' AND kind = 'unpaid' AND to_day >= $1 AND from_day <= $2`, [from, to]);
  const out = new Map();
  for (const r of absent) out.set(Number(r.staff_id), { absent: r.n, unpaid: 0 });
  for (const l of unpaid) {
    const days = (await schoolDays(q, l.a < from ? from : l.a, l.b > to ? to : l.b)).length;
    const cur = out.get(Number(l.staff_id)) || { absent: 0, unpaid: 0 };
    cur.unpaid += days; out.set(Number(l.staff_id), cur);
  }
  for (const v of out.values()) v.days = v.absent + v.unpaid;
  return { map: out, working_days: s.working_days };
}

/* ---------- حصص الانتظار ---------- */
export async function absentTeachers(q, day) {
  return q(
    `SELECT DISTINCT t.id AS teacher_id, t.full_name, COALESCE(a.status, 'leave') AS status
       FROM teachers t JOIN staff s ON s.teacher_id = t.id
       LEFT JOIN staff_attendance a ON a.staff_id = s.id AND a.day = $1
      WHERE a.status IN ('absent', 'leave') OR EXISTS (SELECT 1 FROM leave_requests l WHERE l.staff_id = s.id AND l.status = 'approved' AND $1::date BETWEEN l.from_day AND l.to_day)
      ORDER BY t.full_name`, [day]);
}

/** حصص المعلمين الغائبين في اليوم، مع البديل المختار والمقترحين (الفارغون في الحصة نفسها، الأقل انتظارًا هذا الأسبوع أولًا) */
export async function substitutionNeeds(q, day) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  const absent = await absentTeachers(q, day);
  if (!absent.length) return { day, absent: [], slots: [] };
  const ids = absent.map((a) => a.teacher_id);
  const slots = await q(
    `SELECT ts.id AS slot_id, ts.period, ts.class_id, c.name AS class_name, sub.name AS subject, ts.teacher_id, t.full_name AS teacher,
            x.substitute_teacher_id, st.full_name AS substitute
       FROM timetable_slots ts JOIN classes c ON c.id = ts.class_id LEFT JOIN subjects sub ON sub.id = ts.subject_id
       JOIN teachers t ON t.id = ts.teacher_id
       LEFT JOIN substitutions x ON x.slot_id = ts.id AND x.day = $2 LEFT JOIN teachers st ON st.id = x.substitute_teacher_id
      WHERE ts.day = $1 AND ts.teacher_id = ANY($3) ORDER BY ts.period, c.name`, [dow, day, ids]);
  const weekStart = addDays(day, -dow);
  const free = await q(
    `SELECT t.id, t.full_name, p.period,
            (SELECT count(*) FROM substitutions x WHERE x.substitute_teacher_id = t.id AND x.day BETWEEN $3 AND $3::date + 6)::int AS load
       FROM teachers t CROSS JOIN (SELECT DISTINCT period FROM timetable_slots WHERE day = $1) p
      WHERE NOT (t.id = ANY($2))
        AND NOT EXISTS (SELECT 1 FROM timetable_slots s WHERE s.teacher_id = t.id AND s.day = $1 AND s.period = p.period)
        AND NOT EXISTS (SELECT 1 FROM substitutions x JOIN timetable_slots s ON s.id = x.slot_id WHERE x.substitute_teacher_id = t.id AND x.day = $4 AND s.period = p.period)
      ORDER BY load, t.full_name`, [dow, ids, weekStart, day]);
  return { day, absent, slots: slots.map((s) => ({ ...s,
    candidates: free.filter((f) => f.period === s.period || Number(f.id) === Number(s.substitute_teacher_id)).map((f) => ({ id: f.id, name: f.full_name, load: f.load })) })) };
}

export const assignSchema = z.object({ day: t.date, slot_id: t.id, substitute_teacher_id: t.id, note: t.optText(200) });
export async function assign(q, b, actor) {
  const dow = new Date(`${b.day}T00:00:00Z`).getUTCDay();
  const [slot] = await q("SELECT ts.id, ts.period, ts.day, ts.teacher_id, c.name AS class_name, sub.name AS subject FROM timetable_slots ts JOIN classes c ON c.id = ts.class_id LEFT JOIN subjects sub ON sub.id = ts.subject_id WHERE ts.id = $1", [b.slot_id]);
  if (!slot) throw notFound("الحصة غير موجودة");
  if (Number(slot.day) !== dow) throw badRequest("الحصة ليست في هذا اليوم");
  if (Number(slot.teacher_id) === Number(b.substitute_teacher_id)) throw badRequest("اختر معلمًا غير معلم الحصة");
  const [busy] = await q(`SELECT 1 FROM timetable_slots WHERE teacher_id = $1 AND day = $2 AND period = $3
    UNION ALL SELECT 1 FROM substitutions x JOIN timetable_slots s ON s.id = x.slot_id WHERE x.substitute_teacher_id = $1 AND x.day = $4 AND s.period = $3 AND x.slot_id <> $5 LIMIT 1`,
    [b.substitute_teacher_id, dow, slot.period, b.day, b.slot_id]);
  if (busy) throw conflict("المعلم المختار لديه حصة في هذا الوقت");
  await q(`INSERT INTO substitutions (tenant_id, day, slot_id, absent_teacher_id, substitute_teacher_id, note, created_by)
           VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
           ON CONFLICT (slot_id, day) DO UPDATE SET substitute_teacher_id = EXCLUDED.substitute_teacher_id, note = EXCLUDED.note`,
    [b.day, b.slot_id, slot.teacher_id, b.substitute_teacher_id, b.note ?? null, actor]);
  const users = await q("SELECT id FROM users WHERE teacher_id = $1", [b.substitute_teacher_id]);
  await notify(q, { event: "substitute", users: users.map((u) => u.id), title: `حصة انتظار: ${slot.class_name}`,
    body: `${b.day} — الحصة ${slot.period}${slot.subject ? ` (${slot.subject})` : ""}` });
}

export const unassign = (q, slotId, day) => q("DELETE FROM substitutions WHERE slot_id = $1 AND day = $2", [slotId, day]);

export const mySubstitutions = (q, teacherId) => q(
  `SELECT x.day::text, s.period, c.name AS class_name, sub.name AS subject, t.full_name AS absent_teacher, x.note
     FROM substitutions x JOIN timetable_slots s ON s.id = x.slot_id JOIN classes c ON c.id = s.class_id
     LEFT JOIN subjects sub ON sub.id = s.subject_id LEFT JOIN teachers t ON t.id = x.absent_teacher_id
    WHERE x.substitute_teacher_id = $1 AND x.day >= CURRENT_DATE - 1 ORDER BY x.day, s.period LIMIT 50`, [teacherId]);
