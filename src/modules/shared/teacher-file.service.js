// ملف المعلم: مصدر واحد للبيانات المجمّعة (إسناد، جدول، اختبارات، واجبات، حساب، سجل نشاط).
// المعلم كيان مركزي: كل الربط بـ teacher_id، والأسماء تُقرأ من جداولها المركزية عند كل عرض.
import { notFound, badRequest, conflict } from "../../core/http/errors.js";
import { openCredential, credentialsEnabled } from "../../core/auth/secret-box.js";

/* ---------- حالة حساب الدخول ---------- */
export const ACCOUNT_STATES = {
  inactive: "الحساب غير فعال",
  locked: "الحساب مقفل مؤقتًا",
  not_activated: "حساب لم يتم تفعيله",
  initial: "بيانات الدخول الأولية ما زالت مستخدمة",
  password_changed: "تم تغيير كلمة المرور",
  username_changed: "تم تغيير اسم المستخدم",
  credentials_changed: "تم تغيير بيانات الدخول",
};

/**
 * تُحسب الحالة من أعمدة الحساب فقط، ولا حاجة لمعرفة كلمة المرور نفسها (مخزّنة مُجزّأة).
 * @param {{is_active:boolean, locked:boolean, must_change_password:boolean, last_login_at:any,
 *          password_changed_at:any, created_at:any, username_changed_at:any}} u
 */
export function accountStatus(u) {
  if (!u.is_active) return "inactive";
  if (u.locked) return "locked";
  const pwChanged = !u.must_change_password && u.password_changed_at && u.created_at
    && new Date(u.password_changed_at) - new Date(u.created_at) > 5000;
  const nameChanged = Boolean(u.username_changed_at);
  if (pwChanged && nameChanged) return "credentials_changed";
  if (nameChanged) return "username_changed";
  if (pwChanged) return "password_changed";
  // ما زالت كلمة المرور المؤقتة (الأولية أو من إعادة التعيين) هي المستخدمة
  const neverUsed = !u.last_login_at || (u.password_changed_at && new Date(u.last_login_at) < new Date(u.password_changed_at));
  return neverUsed ? "not_activated" : "initial";
}

/* ---------- سجل النشاط من audit_log ---------- */
const FIELD_LABEL = {
  full_name: "الاسم", phone: "الجوال", employee_no: "الرقم الوظيفي", national_id: "رقم الهوية", email: "البريد",
  specialty: "التخصص", department: "القسم", short_name: "الاسم المختصر", gender: "الجنس", birth_date: "تاريخ الميلاد",
  job_title: "المسمى الوظيفي", qualification: "المؤهل", hire_date: "تاريخ التعيين", employment_type: "نوع التوظيف",
  address: "العنوان", emergency_name: "اسم جهة الطوارئ", emergency_phone: "جوال الطوارئ",
};
const SENSITIVE = new Set(["national_id"]);   // يُذكر أنه تغيّر دون عرض القيم

/** يحوّل صف audit_log إلى سطر مقروء (أو null إن لم يكن تغييرًا ذا معنى) */
export function describeAudit(a, names = { class: () => "", subject: () => "" }) {
  const o = a.old_data || {}, n = a.new_data || {};
  const T = a.table_name;
  if (T === "teacher_assignments") {
    const d = a.action === "delete" ? o : n;
    const what = `${names.subject(d.subject_id) || "مادة"} — ${names.class(d.class_id) || "فصل"}`;
    return { kind: "assignment", text: `${a.action === "delete" ? "إزالة إسناد" : "إسناد مادة"}: ${what}` };
  }
  if (T === "users") {
    if (a.action === "insert") return { kind: "account", text: `إنشاء حساب الدخول (${n.username})` };
    if (o.username !== n.username) return { kind: "account", text: `تغيير اسم المستخدم من ${o.username} إلى ${n.username}` };
    if (o.is_active !== n.is_active) return { kind: "account", text: n.is_active ? "تفعيل الحساب" : "إيقاف الحساب" };
    if (o.must_change_password === false && n.must_change_password === true) return { kind: "account", text: "إعادة تعيين كلمة المرور (كلمة مؤقتة جديدة)" };
    if (o.must_change_password === true && n.must_change_password === false) return { kind: "account", text: "غيّر المعلم كلمة المرور" };
    if (o.password_changed_at !== n.password_changed_at) return { kind: "account", text: "تغيير كلمة المرور" };
    if ((o.locked_until || null) !== (n.locked_until || null) && n.locked_until) return { kind: "account", text: "قفل الحساب مؤقتًا بعد محاولات فاشلة" };
    return null;
  }
  if (T === "teachers") {
    if (a.action === "insert") return { kind: "profile", text: "إنشاء ملف المعلم" };
    if (a.action === "delete") return { kind: "profile", text: "حذف ملف المعلم" };
    const changed = Object.keys(FIELD_LABEL).filter((k) => (o[k] ?? null) !== (n[k] ?? null));
    if (!changed.length) return null;
    return { kind: "profile", text: `تعديل: ${changed.map((k) => FIELD_LABEL[k]).join("، ")}`,
      changes: changed.filter((k) => !SENSITIVE.has(k)).map((k) => ({ field: FIELD_LABEL[k], from: o[k] ?? null, to: n[k] ?? null })) };
  }
  return null;
}

/* ---------- الملف الكامل ---------- */
export async function get(q, id) {
  const [t] = await q(
    `SELECT t.id, t.full_name AS name, t.short_name, t.phone, t.employee_no, t.national_id, t.email, t.specialty, t.department,
            t.gender, t.birth_date, t.job_title, t.qualification, t.hire_date, t.employment_type, t.address,
            t.emergency_name, t.emergency_phone, (t.photo IS NOT NULL) AS has_photo, t.created_at, t.updated_at,
            (SELECT s.base_salary + s.allowance FROM staff s WHERE s.teacher_id = t.id AND s.is_active) AS monthly_salary
       FROM teachers t WHERE t.id = $1`, [id]);
  if (!t) throw notFound("المعلم غير موجود");
  return t;
}

export async function account(q, teacherId) {
  const [u] = await q(
    `SELECT id, username, is_active, must_change_password, last_login_at, password_changed_at, created_at, username_changed_at,
            (locked_until IS NOT NULL AND locked_until > now()) AS locked, locked_until, failed_logins,
            (initial_password_enc IS NOT NULL) AS has_initial
       FROM users WHERE teacher_id = $1`, [teacherId]);
  if (!u) return null;
  const state = accountStatus(u);
  // لا يُعاد أي سر: لا كلمة مرور ولا hash ولا معرّف جلسة
  return { user_id: u.id, username: u.username, is_active: u.is_active, last_login_at: u.last_login_at, created_at: u.created_at,
    password_changed_at: u.password_changed_at, username_changed_at: u.username_changed_at, locked_until: u.locked ? u.locked_until : null,
    failed_logins: u.failed_logins, state, state_label: ACCOUNT_STATES[state],
    initial_password_active: state === "not_activated" || state === "initial",
    // متاحة للعرض فقط ما دامت النسخة المشفّرة موجودة (تُمسح من القاعدة فور تغيير كلمة المرور)، ولا تُرسل هنا أبدًا
    initial_password_available: Boolean(u.has_initial) && (state === "not_activated" || state === "initial"),
    initial_password_supported: credentialsEnabled() };
}

export async function load(q, teacherId) {
  return q(
    `SELECT a.class_id, a.subject_id, c.name AS class_name, s.name AS subject_name
       FROM teacher_assignments a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id
      WHERE a.teacher_id = $1 ORDER BY c.sort_order, c.id, s.name`, [teacherId]);
}

export async function timetable(q, teacherId) {
  return q(
    `SELECT ts.day, ts.period, ts.room, ts.class_id, c.name AS class_name, ts.subject_id, s.name AS subject_name
       FROM timetable_slots ts JOIN classes c ON c.id = ts.class_id JOIN subjects s ON s.id = ts.subject_id
      WHERE ts.teacher_id = $1 ORDER BY ts.day, ts.period`, [teacherId]);
}

// اختبارات فصوله ومواده المسندة (الاختبار مرتبط بالصف والمادة لا بالمعلم مباشرة)
export async function exams(q, teacherId) {
  return q(
    `SELECT e.id, e.title, e.exam_date, e.max_score, e.status, c.name AS class_name, s.name AS subject_name,
            (SELECT count(*)::int FROM scores sc WHERE sc.exam_id = e.id AND sc.score IS NOT NULL) AS scored,
            (SELECT round(avg(sc.score / e.max_score * 100), 1) FROM scores sc WHERE sc.exam_id = e.id AND sc.score IS NOT NULL) AS avg_percent
       FROM exams e JOIN classes c ON c.id = e.class_id JOIN subjects s ON s.id = e.subject_id
      WHERE EXISTS (SELECT 1 FROM teacher_assignments a WHERE a.teacher_id = $1 AND a.class_id = e.class_id AND a.subject_id = e.subject_id)
      ORDER BY e.exam_date DESC NULLS LAST, e.id DESC LIMIT 100`, [teacherId]);
}

export async function homework(q, teacherId) {
  return q(
    `SELECT w.id, w.title, w.due_date, w.created_at, c.name AS class_name, s.name AS subject_name
       FROM assignments w JOIN classes c ON c.id = w.class_id JOIN subjects s ON s.id = w.subject_id
      WHERE w.teacher_id = $1 ORDER BY w.created_at DESC LIMIT 100`, [teacherId]);
}

export async function activity(q, teacherId, userId, limit = 100) {
  const [classes, subjects] = await Promise.all([q("SELECT id, name FROM classes"), q("SELECT id, name FROM subjects")]);
  const cMap = new Map(classes.map((c) => [Number(c.id), c.name])), sMap = new Map(subjects.map((s) => [Number(s.id), s.name]));
  const names = { class: (i) => cMap.get(Number(i)), subject: (i) => sMap.get(Number(i)) };
  const rows = await q(
    `SELECT id, actor, action, table_name, old_data, new_data, created_at FROM audit_log
      WHERE (table_name = 'teachers' AND record_id = $1::text)
         OR (table_name = 'users' AND record_id = $2::text)
         OR (table_name = 'teacher_assignments' AND COALESCE(new_data ->> 'teacher_id', old_data ->> 'teacher_id') = $1::text)
      ORDER BY id DESC LIMIT $3`, [String(teacherId), String(userId ?? 0), limit * 2]);
  return rows.map((a) => ({ id: a.id, actor: a.actor, at: a.created_at, ...describeAudit(a, names) })).filter((x) => x.text).slice(0, limit);
}

export async function fullProfile(q, id) {
  const t = await get(q, id);
  const acc = await account(q, id);
  const [assignments, slots, examList, hw, log] = await Promise.all([
    load(q, id), timetable(q, id), exams(q, id), homework(q, id), activity(q, id, acc?.user_id)]);
  const classes = new Set(assignments.map((a) => Number(a.class_id))), subjects = new Set(assignments.map((a) => Number(a.subject_id)));
  return { teacher: t, account: acc, load: assignments, timetable: slots, exams: examList, homework: hw, activity: log,
    summary: { subjects: subjects.size, classes: classes.size, periods_per_week: slots.length, exams: examList.length, homework: hw.length } };
}

/* ---------- الصورة ---------- */
const MAGIC = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];
export async function setPhoto(q, id, dataUrl) {
  await get(q, id);
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (buf.length > 150_000) throw badRequest("الصورة كبيرة (الحد 150 كيلوبايت بعد التصغير)");
  const type = MAGIC.find(([, ok]) => buf.length > 12 && ok(buf))?.[0];
  if (!type) throw badRequest("الملف ليس صورة صالحة");
  await q("UPDATE teachers SET photo = $2, photo_type = $3 WHERE id = $1", [id, buf, type]);
}
export async function removePhoto(q, id) {
  await get(q, id);
  await q("UPDATE teachers SET photo = NULL, photo_type = NULL WHERE id = $1", [id]);
}
export async function getPhoto(q, id) {
  const [r] = await q("SELECT photo, photo_type FROM teachers WHERE id = $1", [id]);
  if (!r?.photo) throw notFound("لا توجد صورة");
  return r;
}

/* ---------- قواعد التكرار ---------- */
export async function ensureUniqueEmployeeNo(q, employeeNo, exceptId = null) {
  if (!employeeNo) return;
  const [d] = await q("SELECT full_name FROM teachers WHERE employee_no = $1 AND ($2::bigint IS NULL OR id <> $2) LIMIT 1", [employeeNo, exceptId]);
  if (d) throw conflict(`الرقم الوظيفي «${employeeNo}» مستخدم للمعلم ${d.full_name}`);
}

/** تغيير اسم المستخدم من الإدارة: يمنع التكرار داخل المدرسة، ويسجل وقت التغيير، ويُنهي جلسات المعلم */
export async function changeUsername(q, teacherId, username) {
  const [u] = await q("SELECT id, username FROM users WHERE teacher_id = $1", [teacherId]);
  if (!u) throw notFound("المعلم غير موجود");
  if (u.username === username) return { changed: false };
  const [taken] = await q("SELECT 1 FROM users WHERE username = $1 AND id <> $2", [username, u.id]);
  if (taken) throw conflict("اسم المستخدم مستخدم داخل المدرسة");
  await q("UPDATE users SET username = $2, username_changed_at = now() WHERE id = $1", [u.id, username]);
  await q("DELETE FROM sessions WHERE user_id = $1", [u.id]);
  return { changed: true, from: u.username };
}

/**
 * بيانات الدخول الأولية للمعلم (للإدارة، بطلب صريح ويُسجَّل في سجل النشاط).
 * تعمل فقط ما دامت كلمة المرور لم تتغير: تغييرها يمسح النسخة المشفّرة تلقائيًا في القاعدة (trigger).
 */
export async function revealInitialCredentials(q, teacherId, tenantId) {
  const [u] = await q("SELECT id, username, initial_password_enc, must_change_password FROM users WHERE teacher_id = $1", [teacherId]);
  if (!u) throw notFound("المعلم غير موجود");
  if (!u.initial_password_enc || !u.must_change_password) throw notFound("غيّر المعلم بيانات الدخول، أو لا توجد بيانات أولية محفوظة. أنشئ كلمة مؤقتة جديدة عند الحاجة.");
  const password = openCredential(u.initial_password_enc, tenantId);
  if (!password) throw badRequest("تعذر فك تشفير بيانات الدخول الأولية (مفتاح التشفير تغيّر؟). أنشئ كلمة مؤقتة جديدة.");
  return { username: u.username, password, school: tenantId };
}
