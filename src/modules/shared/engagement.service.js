// التواصل التفاعلي: الاستبيانات (لأولياء الأمور أو المنسوبين) ومواعيد أولياء الأمور مع المعلمين والإدارة
import crypto from "node:crypto";
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict, forbidden } from "../../core/http/errors.js";
import { notify } from "./notify.service.js";
import { featureSettings } from "./feature-settings.service.js";

const localDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Aden" });

/* ===================== الاستبيانات ===================== */
const qid = () => `q_${crypto.randomBytes(5).toString("hex")}`;
export const QTYPES = { rating: "تقييم من 1 إلى 5", yesno: "نعم / لا", choice: "اختيار واحد", multi: "اختيار متعدد", text: "إجابة مكتوبة" };
const questionSchema = z.object({
  id: z.string().regex(/^q_[a-z0-9]{3,20}$/).optional(),
  type: z.enum(Object.keys(QTYPES)),
  text: z.string().trim().min(2, "اكتب نص السؤال").max(300),
  options: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  required: z.boolean().default(true),
});
export const surveySchema = z.object({
  title: t.shortText("عنوان الاستبيان", 150),
  description: t.optText(1000),
  audience: z.enum(["parents", "staff", "all"]),
  questions: z.array(questionSchema).min(1, "أضف سؤالًا واحدًا على الأقل").max(40),
  anonymous: z.boolean().default(true),
  closes_on: t.optDate,
  notify: z.boolean().default(true),
});

export async function createSurvey(q, b, actor) {
  const questions = b.questions.map((x) => {
    if ((x.type === "choice" || x.type === "multi") && (x.options || []).length < 2) throw badRequest(`السؤال «${x.text}» يحتاج خيارين على الأقل`);
    return { id: x.id || qid(), type: x.type, text: x.text, required: x.required, ...(x.type === "choice" || x.type === "multi" ? { options: x.options } : {}) };
  });
  const [row] = await q(`INSERT INTO surveys (tenant_id, title, description, audience, questions, anonymous, closes_on, created_by)
    VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`, [b.title, b.description ?? null, b.audience, JSON.stringify(questions), b.anonymous, b.closes_on ?? null, actor]);
  if (b.notify) {
    if (b.audience !== "staff") {
      const st = await q("SELECT id FROM students WHERE archived_at IS NULL");
      await notify(q, { event: "survey", students: st.map((s) => s.id), title: `استبيان: ${b.title}`, body: "رأيك يهمنا. أجب من ملف الطالب.", link: "surveys" });
    }
    if (b.audience !== "parents") {
      const us = await q("SELECT id FROM users WHERE is_active AND role = 'teacher'");
      await notify(q, { event: "survey", users: us.map((u) => u.id), title: `استبيان: ${b.title}`, body: "رأيك يهمنا. أجب من «الاستبيانات» في بوابتك." });
    }
  }
  return row;
}

const isOpen = (s) => s.status === "open" && (!s.closes_on || String(s.closes_on).slice(0, 10) >= localDay());
export const listSurveys = (q) => q(
  `SELECT s.id, s.title, s.description, s.audience, s.anonymous, s.status, s.closes_on::text, s.created_by, s.created_at,
          jsonb_array_length(s.questions) AS questions, (SELECT count(*) FROM survey_responses r WHERE r.survey_id = s.id)::int AS responses
     FROM surveys s ORDER BY s.id DESC LIMIT 200`);

export async function setSurveyStatus(q, id, status) {
  const r = await q("UPDATE surveys SET status = $2 WHERE id = $1 RETURNING id", [id, status]);
  if (!r.length) throw notFound("الاستبيان غير موجود");
}
export async function removeSurvey(q, id) {
  const r = await q("DELETE FROM surveys WHERE id = $1 RETURNING id", [id]);
  if (!r.length) throw notFound("الاستبيان غير موجود");
}

/** النتائج: لكل سؤال توزيع الإجابات، والمكتوبة كما هي (وأسماء المجيبين إن لم يكن مجهول الهوية) */
export async function results(q, id) {
  const [s] = await q("SELECT * FROM surveys WHERE id = $1", [id]);
  if (!s) throw notFound("الاستبيان غير موجود");
  const rows = await q(`SELECT r.answers, r.created_at, st.full_name AS student, u.full_name AS staff
    FROM survey_responses r LEFT JOIN students st ON st.id = r.student_id LEFT JOIN users u ON u.id = r.user_id WHERE r.survey_id = $1`, [id]);
  const out = s.questions.map((qq) => {
    const vals = rows.map((r) => ({ v: r.answers[qq.id], who: s.anonymous ? null : (r.student ? `ولي أمر ${r.student}` : r.staff) })).filter((x) => x.v !== undefined && x.v !== null && x.v !== "");
    const base = { id: qq.id, type: qq.type, text: qq.text, answered: vals.length };
    if (qq.type === "rating") {
      const nums = vals.map((x) => Number(x.v)).filter((n) => n >= 1 && n <= 5);
      return { ...base, average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null,
        counts: [1, 2, 3, 4, 5].map((n) => nums.filter((x) => x === n).length) };
    }
    if (qq.type === "yesno") return { ...base, counts: { yes: vals.filter((x) => x.v === true).length, no: vals.filter((x) => x.v === false).length } };
    if (qq.type === "choice" || qq.type === "multi") {
      const picks = vals.flatMap((x) => [].concat(x.v));
      return { ...base, options: qq.options.map((o, i) => ({ text: o, count: picks.filter((p) => p === i).length })) };
    }
    return { ...base, texts: vals.map((x) => ({ text: String(x.v), who: x.who })) };
  });
  return { survey: { id: s.id, title: s.title, description: s.description, audience: s.audience, anonymous: s.anonymous, status: s.status, closes_on: s.closes_on }, responses: rows.length, questions: out };
}

function cleanAnswers(survey, answers) {
  const out = {};
  for (const qq of survey.questions) {
    const v = answers?.[qq.id];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
    if (empty) { if (qq.required) throw badRequest(`أجب عن: ${qq.text}`); continue; }
    if (qq.type === "rating" && !(Number.isInteger(v) && v >= 1 && v <= 5)) throw badRequest("التقييم من 1 إلى 5");
    if (qq.type === "yesno" && typeof v !== "boolean") throw badRequest("إجابة غير صحيحة");
    if (qq.type === "choice" && !(Number.isInteger(v) && v >= 0 && v < qq.options.length)) throw badRequest("اختيار غير صحيح");
    if (qq.type === "multi" && !(Array.isArray(v) && v.every((x) => Number.isInteger(x) && x >= 0 && x < qq.options.length))) throw badRequest("اختيار غير صحيح");
    if (qq.type === "text" && (typeof v !== "string" || v.length > 2000)) throw badRequest("الإجابة طويلة جدًا");
    out[qq.id] = qq.type === "multi" ? [...new Set(v)] : qq.type === "text" ? v.trim() : v;
  }
  return out;
}

export const respondSchema = z.object({ answers: z.record(z.string(), z.any()) });
export async function respond(q, surveyId, who, answers) {
  const [s] = await q("SELECT * FROM surveys WHERE id = $1", [surveyId]);
  if (!s) throw notFound("الاستبيان غير موجود");
  const forParent = Boolean(who.student_id);
  if ((forParent && s.audience === "staff") || (!forParent && s.audience === "parents")) throw notFound("الاستبيان غير موجود");
  if (!isOpen(s)) throw badRequest("الاستبيان مغلق");
  const clean = cleanAnswers(s, answers);
  const r = await q(`INSERT INTO survey_responses (tenant_id, survey_id, student_id, user_id, answers) VALUES (app_tenant(), $1, $2, $3, $4)
    ON CONFLICT DO NOTHING RETURNING id`, [s.id, who.student_id ?? null, who.user_id ?? null, JSON.stringify(clean)]);
  if (!r.length) throw conflict("أجبت عن هذا الاستبيان من قبل. شكرًا لك.");
  return { ok: true };
}

/** الاستبيانات المتاحة لولي أمر طالب أو لمستخدم من المنسوبين */
export async function availableFor(q, who) {
  const aud = who.student_id ? ["parents", "all"] : ["staff", "all"];
  const rows = await q(`SELECT s.id, s.title, s.description, s.questions, s.anonymous, s.closes_on::text, s.status,
      EXISTS (SELECT 1 FROM survey_responses r WHERE r.survey_id = s.id AND (r.student_id = $2 OR r.user_id = $3)) AS answered
    FROM surveys s WHERE s.audience = ANY($1) AND s.status <> 'draft' AND s.created_at > now() - interval '180 days' ORDER BY s.id DESC LIMIT 20`,
  [aud, who.student_id ?? null, who.user_id ?? null]);
  return rows.map((s) => ({ ...s, open: isOpen(s) && !s.answered }));
}

/* ===================== مواعيد أولياء الأمور ===================== */
export const MODES = { in_person: "حضوري", phone: "اتصال هاتفي", video: "مكالمة مرئية" };
export const slotsSchema = z.object({
  day: t.date,
  from: z.string().regex(/^\d{2}:\d{2}$/, "الوقت بصيغة 09:00"),
  to: z.string().regex(/^\d{2}:\d{2}$/, "الوقت بصيغة 12:00"),
  minutes: z.coerce.number().int().min(5).max(180).optional(),
  mode: z.enum(Object.keys(MODES)).default("in_person"),
  location: t.optText(120), note: t.optText(300), class_id: t.optId,
  teacher_id: t.optId,    // للإدارة: مواعيد معلم محدد، وبدونه مواعيد الإدارة
  host_name: t.optText(80),
});
const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const toTime = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** إنشاء فترات متتالية بين وقتين */
export async function createSlots(q, b, { teacherId = null, hostName, actor }) {
  if (b.day < localDay()) throw badRequest("التاريخ مضى");
  const len = b.minutes || (await featureSettings(q, "meetings")).slot_minutes;
  const start = toMin(b.from), end = toMin(b.to);
  if (end - start < len) throw badRequest("الفترة أقصر من مدة الموعد");
  if ((end - start) / len > 60) throw badRequest("عدد المواعيد كبير جدًا، قسّمها");
  const clash = await q(`SELECT 1 FROM meeting_slots WHERE day = $1 AND teacher_id IS NOT DISTINCT FROM $2 AND start_time < $4::time AND start_time + (minutes || ' minutes')::interval > $3::time LIMIT 1`,
    [b.day, teacherId, b.from, b.to]);
  if (clash.length) throw conflict("لديك مواعيد في هذا الوقت");
  let n = 0;
  for (let m = start; m + len <= end; m += len) {
    await q(`INSERT INTO meeting_slots (tenant_id, teacher_id, host_name, day, start_time, minutes, mode, location, note, class_id, created_by)
      VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [teacherId, hostName, b.day, toTime(m), len, b.mode, b.location ?? null, b.note ?? null, b.class_id ?? null, actor]);
    n++;
  }
  return { created: n, minutes: len };
}

export const slotsList = (q, { teacherId = null, adminView = false } = {}) => q(
  `SELECT s.id, s.teacher_id, s.host_name, s.day::text, s.start_time::text, s.minutes, s.mode, s.location, s.class_id, c.name AS class_name,
          b.id AS booking_id, b.status AS booking_status, b.topic, st.full_name AS student, st.guardian_name, cs.name AS student_class
     FROM meeting_slots s LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN meeting_bookings b ON b.slot_id = s.id AND b.status <> 'cancelled'
     LEFT JOIN students st ON st.id = b.student_id LEFT JOIN classes cs ON cs.id = st.class_id
    WHERE s.day >= CURRENT_DATE - 7 AND ($1::bigint IS NULL OR s.teacher_id = $1) AND ($2 OR $1::bigint IS NOT NULL)
    ORDER BY s.day, s.start_time LIMIT 500`, [teacherId, adminView]);

export async function removeSlot(q, id, { teacherId = null } = {}) {
  const [s] = await q("SELECT s.id, s.teacher_id, b.student_id FROM meeting_slots s LEFT JOIN meeting_bookings b ON b.slot_id = s.id AND b.status = 'booked' WHERE s.id = $1", [id]);
  if (!s || (teacherId && Number(s.teacher_id) !== Number(teacherId))) throw notFound("الموعد غير موجود");
  if (s.student_id) throw conflict("الموعد محجوز. ألغِ الحجز أولًا (يصل إشعار لولي الأمر).");
  await q("DELETE FROM meeting_slots WHERE id = $1", [id]);
}

export async function setBookingStatus(q, bookingId, status, { teacherId = null } = {}) {
  const [b] = await q("SELECT b.id, b.student_id, s.teacher_id, s.host_name, s.day::text, s.start_time::text FROM meeting_bookings b JOIN meeting_slots s ON s.id = b.slot_id WHERE b.id = $1", [bookingId]);
  if (!b || (teacherId && Number(b.teacher_id) !== Number(teacherId))) throw notFound("الحجز غير موجود");
  await q("UPDATE meeting_bookings SET status = $2 WHERE id = $1", [bookingId, status]);
  if (status === "cancelled") {
    await notify(q, { event: "meeting", students: [b.student_id], title: "أُلغي موعدك", body: `مع ${b.host_name} يوم ${b.day} الساعة ${b.start_time.slice(0, 5)}` });
  }
}

/** المواعيد المتاحة لولي أمر طالب: الإدارة، ومعلمو شعبته */
export async function slotsForStudent(q, s) {
  return q(`SELECT ms.id, ms.host_name, ms.day::text, ms.start_time::text, ms.minutes, ms.mode, ms.location, ms.note,
      b.id AS booking_id, b.student_id = $1 AS mine, b.topic
    FROM meeting_slots ms LEFT JOIN meeting_bookings b ON b.slot_id = ms.id AND b.status = 'booked'
    WHERE ms.day >= $3 AND (ms.class_id IS NULL OR ms.class_id = $2)
      AND (ms.teacher_id IS NULL OR ms.teacher_id IN (SELECT teacher_id FROM teacher_assignments WHERE class_id = $2))
      AND (b.id IS NULL OR b.student_id = $1)
    ORDER BY ms.day, ms.start_time LIMIT 200`, [s.id, s.class_id, localDay()]);
}

export const bookSchema = z.object({ slot_id: t.id, topic: t.optText(300) });
export async function book(q, s, b) {
  const [slot] = await q(`SELECT ms.*, ms.day::text AS d FROM meeting_slots ms WHERE ms.id = $1 AND ms.day >= $2 AND (ms.class_id IS NULL OR ms.class_id = $3)
      AND (ms.teacher_id IS NULL OR ms.teacher_id IN (SELECT teacher_id FROM teacher_assignments WHERE class_id = $3)) FOR UPDATE`, [b.slot_id, localDay(), s.class_id]);
  if (!slot) throw notFound("الموعد غير متاح");
  const [same] = await q(`SELECT 1 FROM meeting_bookings x JOIN meeting_slots y ON y.id = x.slot_id
    WHERE x.student_id = $1 AND x.status = 'booked' AND y.day = $2 AND y.teacher_id IS NOT DISTINCT FROM $3`, [s.id, slot.d, slot.teacher_id]);
  if (same) throw conflict("لديك موعد مع نفس الجهة في هذا اليوم");
  try {
    await q("INSERT INTO meeting_bookings (tenant_id, slot_id, student_id, topic) VALUES (app_tenant(), $1, $2, $3)", [slot.id, s.id, b.topic ?? null]);
  } catch (e) { if (e.code === "23505") throw conflict("حُجز هذا الموعد للتو. اختر موعدًا آخر."); throw e; }
  // إشعار صاحب الموعد
  const users = slot.teacher_id ? await q("SELECT id FROM users WHERE teacher_id = $1", [slot.teacher_id]) : await q("SELECT id FROM users WHERE role = 'admin' AND is_active");
  await notify(q, { event: "meeting", users: users.map((u) => u.id), title: `حجز موعد: ولي أمر ${s.full_name}`,
    body: `${slot.d} الساعة ${String(slot.start_time).slice(0, 5)}${b.topic ? ` — ${b.topic}` : ""}` });
  return { ok: true };
}

export async function cancelByParent(q, s, slotId) {
  if (!(await featureSettings(q, "meetings")).allow_parent_cancel) throw forbidden("إلغاء الموعد من المدرسة فقط");
  const r = await q("UPDATE meeting_bookings SET status = 'cancelled' WHERE slot_id = $1 AND student_id = $2 AND status = 'booked' RETURNING id", [slotId, s.id]);
  if (!r.length) throw notFound("لا يوجد حجز لك في هذا الموعد");
}
