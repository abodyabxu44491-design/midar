// استيراد المعلمين (Excel/CSV): مطابقة أعمدة ← تحليل بلا كتابة ← تأكيد ← نتيجة.
// القواعد:
//   • التعرّف على المعلم الموجود بالرقم الوظيفي (أو اسم المستخدم) فقط، ولا يُعتمد على الاسم وحده.
//   • الصف والمادة والشعبة تُقرأ من الهيكل الأكاديمي المركزي بمعرّفاتها، بلا أسماء ثابتة.
//   • الإسناد عند التحديث يُضاف على الموجود (لا يحذف إسنادًا قائمًا).
//   • كلمات المرور المؤقتة تُعاد مرة واحدة فقط في نتيجة التنفيذ، ولا تُخزَّن إلا مُجزّأة.
import { badRequest } from "../../core/http/errors.js";
import { hashPassword } from "../../core/auth/password.js";
import { newTempPassword } from "../../core/auth/codes.js";
import { sealCredential } from "../../core/auth/secret-box.js";
import { cleanName, normalizePhone } from "./students.service.js";
import { structure } from "./structure.service.js";
import { buildXlsx } from "../../core/xlsx.js";
import { norm, buildIndex, matchGrade, pickSection } from "./grade-match.js";

export const MAX_ROWS = 200;   // تجزئة كلمة المرور بطيئة عمدًا، فنحدّ الدفعة

export const FIELDS = [
  { key: "employee_no", label: "الرقم الوظيفي", aliases: ["الرقم الوظيفي", "رقم الموظف", "الرقم", "employee no", "employee number", "employee id", "id"] },
  { key: "name", label: "اسم المعلم", required: true, aliases: ["اسم المعلم", "الاسم", "الاسم الكامل", "name", "full name", "teacher name", "full_name"] },
  { key: "username", label: "اسم المستخدم", aliases: ["اسم المستخدم", "المستخدم", "username", "user name", "login"] },
  { key: "national_id", label: "رقم الهوية", aliases: ["رقم الهوية", "الهوية", "national id", "id number"] },
  { key: "phone", label: "الجوال", aliases: ["الجوال", "رقم الجوال", "الهاتف", "phone", "mobile"] },
  { key: "email", label: "البريد الإلكتروني", aliases: ["البريد", "البريد الالكتروني", "email", "e-mail"] },
  { key: "gender", label: "الجنس", aliases: ["الجنس", "النوع", "gender", "sex"] },
  { key: "birth_date", label: "تاريخ الميلاد", aliases: ["تاريخ الميلاد", "الميلاد", "birth date", "dob"] },
  { key: "specialty", label: "التخصص", aliases: ["التخصص", "specialty", "specialization"] },
  { key: "qualification", label: "المؤهل", aliases: ["المؤهل", "المؤهل العلمي", "qualification", "degree"] },
  { key: "job_title", label: "المسمى الوظيفي", aliases: ["المسمى الوظيفي", "المسمى", "job title", "title"] },
  { key: "department", label: "القسم", aliases: ["القسم", "department"] },
  { key: "hire_date", label: "تاريخ التعيين", aliases: ["تاريخ التعيين", "تاريخ المباشره", "hire date", "start date"] },
  { key: "employment_type", label: "نوع التوظيف", aliases: ["نوع التوظيف", "التوظيف", "employment type"] },
  { key: "subject", label: "المادة", aliases: ["المادة", "المواد", "subject", "subjects"] },
  { key: "stage", label: "المرحلة", aliases: ["المرحله", "stage"] },
  { key: "grade", label: "الصف", aliases: ["الصف", "grade", "level"] },
  { key: "section", label: "الشعبة", aliases: ["الشعبه", "section"] },
];
const ALIAS = new Map();
for (const f of FIELDS) { ALIAS.set(norm(f.label), f.key); for (const a of f.aliases) ALIAS.set(norm(a), f.key); }
const clean = (h) => norm(String(h ?? "").replace(/[*：:]/g, " "));

/** اقتراح مطابقة الأعمدة: { "عنوان العمود في الملف": مفتاح الحقل | "" } — يُعدَّل يدويًا في الواجهة */
export function suggestMapping(headers) {
  const used = new Set(), out = {};
  for (const h of headers) {
    const key = ALIAS.get(clean(h));
    out[h] = key && !used.has(key) ? key : "";
    if (out[h]) used.add(key);
  }
  return out;
}

/* ---------- القيم ---------- */
const AR = "٠١٢٣٤٥٦٧٨٩";
const latin = (v) => String(v ?? "").replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).trim();
const GENDER = new Map([["ذكر", "male"], ["male", "male"], ["m", "male"], ["معلم", "male"], ["انثى", "female"], ["أنثى", "female"], ["female", "female"], ["f", "female"], ["معلمة", "female"]]);
const EMPLOYMENT = new Map([["دوام كامل", "full_time"], ["كامل", "full_time"], ["full time", "full_time"], ["full_time", "full_time"],
  ["دوام جزئي", "part_time"], ["جزئي", "part_time"], ["part time", "part_time"], ["part_time", "part_time"],
  ["عقد", "contract"], ["متعاقد", "contract"], ["contract", "contract"], ["تطوع", "volunteer"], ["متطوع", "volunteer"], ["volunteer", "volunteer"]]);

function parseDate(v, min = 1940) {
  const s = latin(v); if (!s) return { value: undefined };
  let y, m, d, x;
  if ((x = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) [y, m, d] = [x[1], x[2], x[3]];
  else if ((x = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) [d, m, y] = [x[1], x[2], x[3]];
  else if (/^\d{4,6}(\.\d+)?$/.test(s) && Number(s) > 10000 && Number(s) < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else return { error: `التاريخ «${s}» غير مفهوم (استخدم 2015-03-28)` };
  y = Number(y); m = Number(m); d = Number(d);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { error: `التاريخ «${s}» غير موجود في التقويم` };
  if (y < min || y > 2100) return { error: `التاريخ «${s}» خارج المدى المعقول` };
  return { value: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}
const USERNAME = /^[a-z0-9._-]{3,40}$/;
const splitList = (v) => String(v ?? "").split(/[,،;؛|\n]+/).map((x) => x.trim()).filter(Boolean);
export const gradeKey = (grade, stage) => `${norm(grade)}|${norm(stage)}`;

/**
 * تحليل بلا أي كتابة. rows: صفوف بمفاتيح الحقول (بعد مطابقة الأعمدة في الواجهة).
 * @param {{gradeMap?:Record<string,number>, maxTeachers?:number|null}} opts
 */
export async function analyze(q, rawRows, { gradeMap = {}, maxTeachers = null } = {}) {
  const struct = await structure(q);
  const index = buildIndex(struct);
  const gradeById = new Map(index.map((g) => [g.grade_id, g]));
  const subjects = await q("SELECT id, name FROM subjects");
  const subjectByName = new Map(subjects.map((s) => [norm(s.name), s]));
  const sectionsEnabled = struct.sections_enabled;

  const rows = rawRows.map((r) => Object.fromEntries(FIELDS.map((f) => [f.key, r[f.key] === null || r[f.key] === undefined ? "" : String(r[f.key]).trim()])));
  const nos = [...new Set(rows.map((r) => latin(r.employee_no)).filter(Boolean))];
  const names = [...new Set(rows.map((r) => String(r.username || "").toLowerCase()).filter(Boolean))];
  const cols = `t.id, t.full_name, t.employee_no, t.phone, t.email, t.national_id, t.specialty, t.department, t.job_title, t.qualification, t.gender,
                t.birth_date::text AS birth_date, t.hire_date::text AS hire_date, t.employment_type, u.username`;
  const existing = nos.length || names.length
    ? await q(`SELECT ${cols} FROM teachers t JOIN users u ON u.teacher_id = t.id WHERE t.employee_no = ANY($1::text[]) OR u.username = ANY($2::text[])`, [nos, names]) : [];
  const byNo = new Map(existing.filter((t) => t.employee_no).map((t) => [t.employee_no, t]));
  const byUser = new Map(existing.map((t) => [t.username, t]));
  const takenUsers = names.length ? new Set((await q("SELECT username FROM users WHERE username = ANY($1::text[])", [names])).map((x) => x.username)) : new Set();
  const [{ n: teacherCount }] = await q("SELECT count(*)::int AS n FROM teachers");

  const seenNo = new Map(), seenUser = new Map(), ambiguities = new Map(), out = [];

  rows.forEach((r, i) => {
    const res = { row: i + 2, status: "ok", action: "create", errors: [], notes: [], name: cleanName(r.name), employee_no: latin(r.employee_no) || null, load: [] };
    const data = {}, fail = (m) => res.errors.push(m);

    if (!res.name) fail("اسم المعلم مطلوب");
    else if (res.name.length < 2 || res.name.length > 120) fail("اسم المعلم يجب أن يكون بين 2 و120 حرفًا");
    else data.name = res.name;

    if (res.employee_no) {
      if (res.employee_no.length > 30) fail("الرقم الوظيفي أطول من 30 خانة");
      else if (seenNo.has(res.employee_no)) fail(`الرقم الوظيفي «${res.employee_no}» مكرر في السطر ${seenNo.get(res.employee_no)}`);
      else seenNo.set(res.employee_no, res.row);
    }

    let username = String(r.username || "").trim().toLowerCase();
    if (username && !USERNAME.test(username)) { fail(`اسم المستخدم «${r.username}» غير صالح (حروف إنجليزية وأرقام، 3 أحرف على الأقل)`); username = ""; }
    if (username) {
      if (seenUser.has(username)) fail(`اسم المستخدم «${username}» مكرر في السطر ${seenUser.get(username)}`);
      else seenUser.set(username, res.row);
    }

    const bd = parseDate(r.birth_date, 1940); if (bd.error) fail(`تاريخ الميلاد: ${bd.error}`); else if (bd.value) data.birth_date = bd.value;
    const hd = parseDate(r.hire_date, 1960); if (hd.error) fail(`تاريخ التعيين: ${hd.error}`); else if (hd.value) data.hire_date = hd.value;
    if (r.gender) { const g = GENDER.get(r.gender.toLowerCase()) || GENDER.get(r.gender); if (!g) fail(`الجنس «${r.gender}» غير مفهوم (ذكر/أنثى)`); else data.gender = g; }
    if (r.employment_type) { const e = EMPLOYMENT.get(norm(r.employment_type)) || EMPLOYMENT.get(r.employment_type.toLowerCase()); if (!e) fail(`نوع التوظيف «${r.employment_type}» غير مفهوم (دوام كامل/دوام جزئي/عقد/تطوع)`); else data.employment_type = e; }
    if (r.phone) { const p = normalizePhone(r.phone); if (!p || p.replace(/\D/g, "").length < 7) fail(`الجوال «${r.phone}» غير صالح`); else data.phone = p; }
    if (r.email) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) || r.email.length > 120) fail(`البريد «${r.email}» غير صالح`); else data.email = r.email; }
    if (r.national_id) { const n = latin(r.national_id); if (!/^[0-9]{5,20}$/.test(n)) fail("رقم الهوية أرقام فقط (5 إلى 20)"); else data.national_id = n; }
    for (const k of ["specialty", "department", "job_title", "qualification"]) if (r[k]) data[k] = r[k].slice(0, k === "qualification" ? 120 : k === "job_title" ? 80 : 60);

    // الإسناد: مادة/مواد + صف (+ مرحلة وشعبة). بلا شعبة = كل شعب ذلك الصف.
    const subjectTexts = splitList(r.subject);
    const wantsLoad = subjectTexts.length || r.grade || r.section;
    if (wantsLoad) {
      const subs = [];
      for (const st of subjectTexts) { const s = subjectByName.get(norm(st)); if (s) subs.push(s); else fail(`المادة «${st}» غير موجودة في المدرسة`); }
      if (!subjectTexts.length) fail("حدّد المادة مع الصف");
      let grade = null;
      if (!r.grade) { if (subjectTexts.length) fail("حدّد الصف مع المادة"); }
      else {
        const m = matchGrade(index, { grade: r.grade, stage: r.stage || "", section: r.section || "" });
        if (m.status === "exact") grade = m.grade;
        else if (m.status === "ambiguous") {
          const key = gradeKey(r.grade, r.stage || "");
          const chosen = gradeMap[key] ? gradeById.get(Number(gradeMap[key])) : null;
          if (chosen && m.candidates.some((c) => c.grade_id === chosen.grade_id)) grade = chosen;
          else {
            res.status = "review"; res.review = "grade"; res.notes.push(`الصف «${r.grade}» يحتمل أكثر من صف`);
            const a = ambiguities.get(key) || { key, value: r.grade, stage: r.stage || "", candidates: m.candidates, count: 0 };
            a.count++; ambiguities.set(key, a);
          }
        } else fail(`الصف «${r.grade}» غير موجود في هيكل المدرسة`);
        if (grade && subs.length) {
          let classes = [];
          const direct = m.class_id ? [m.class_id] : null;
          if (direct) classes = direct;
          else if (r.section || m.section_text) {
            const sec = pickSection(grade, r.section || m.section_text, sectionsEnabled);
            if (sec.status === "ok") classes = [sec.class_id]; else fail(`الشعبة «${r.section || m.section_text}» غير موجودة في الصف «${grade.grade_name}»`);
          } else {
            classes = grade.sections.map((s) => s.id);
            if (!classes.length) fail(`الصف «${grade.grade_name}» بلا شعب`);
            else if (classes.length > 1) res.notes.push(`بلا شعبة محددة: سيُسند لكل شعب «${grade.grade_name}» (${classes.length})`);
          }
          const nameOf = new Map(grade.sections.map((s) => [s.id, s.name]));
          for (const s of subs) for (const c of classes) res.load.push({ class_id: c, subject_id: Number(s.id), label: `${s.name} — ${nameOf.get(c) || grade.grade_name}` });
        }
      }
    }

    // التعرّف على المعلم: الرقم الوظيفي ثم اسم المستخدم. الاسم وحده لا يكفي أبدًا.
    const ex = (res.employee_no && byNo.get(res.employee_no)) || (username && byUser.get(username)) || null;
    if (ex) {
      res.action = "update"; res.existing_id = Number(ex.id);
      if (username && byUser.get(username) && byUser.get(username).id !== ex.id) fail(`اسم المستخدم «${username}» يخص معلمًا آخر`);
      if (res.employee_no && !byNo.get(res.employee_no) && ex.employee_no && ex.employee_no !== res.employee_no) res.notes.push(`الرقم الوظيفي يتغير من «${ex.employee_no}»`);
      if (data.name && norm(data.name) !== norm(ex.full_name)) res.notes.push(`الاسم يتغير من «${ex.full_name}»`);
      const cmp = { name: ex.full_name, phone: ex.phone, email: ex.email, national_id: ex.national_id, specialty: ex.specialty, department: ex.department,
        job_title: ex.job_title, qualification: ex.qualification, gender: ex.gender, birth_date: ex.birth_date, hire_date: ex.hire_date, employment_type: ex.employment_type };
      const changes = {};
      for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== cmp[k]) changes[k] = v;
      if (res.employee_no && !ex.employee_no) changes.employee_no = res.employee_no;
      res.changes = changes;
      if (!Object.keys(changes).length && !res.load.length && !res.errors.length) res.action = "unchanged";
    } else if (!res.errors.length) {
      // معلم جديد: يحتاج اسم مستخدم (من الملف أو من الرقم الوظيفي)
      if (!username && res.employee_no) { const gen = `t${res.employee_no}`.toLowerCase().replace(/[^a-z0-9._-]/g, ""); if (USERNAME.test(gen)) { username = gen; res.notes.push(`اسم المستخدم المُنشأ: ${gen}`); } }
      if (!username) fail("اسم المستخدم مطلوب لمعلم جديد (أو رقم وظيفي ليُنشأ منه)");
      else if (takenUsers.has(username) || (byUser.get(username))) fail(`اسم المستخدم «${username}» مستخدم مسبقًا`);
    }
    if (!ex && username) res.username = username;

    if (res.errors.length) { res.status = "error"; res.action = "skip"; }
    else if (res.status === "review") res.action = "skip";
    res.data = data;
    res.preview = { employee_no: res.employee_no || "", name: res.name, username: res.username || "", specialty: data.specialty || "",
      load: res.load.map((l) => l.label).slice(0, 4).join("، ") + (res.load.length > 4 ? ` +${res.load.length - 4}` : "") };
    out.push(res);
  });

  const count = (f) => out.filter(f).length;
  const willCreate = count((r) => r.status === "ok" && r.action === "create");
  return {
    summary: { total: out.length, valid: count((r) => r.status === "ok"), review: count((r) => r.status === "review"), errors: count((r) => r.status === "error"),
      create: willCreate, update: count((r) => r.status === "ok" && r.action === "update"), unchanged: count((r) => r.status === "ok" && r.action === "unchanged") },
    capacity: { max: maxTeachers, current: teacherCount, after: teacherCount + willCreate, exceeded: Boolean(maxTeachers) && teacherCount + willCreate > maxTeachers },
    ambiguities: [...ambiguities.values()],
    rows: out.map(({ data, changes, ...r }) => r),
    _internal: out,
  };
}

/** التنفيذ: يعيد التحليل في الخادم، ثم يكتب الصحيح. كلمات المرور المؤقتة تُعاد هنا مرة واحدة فقط. */
export async function commit(q, tenantId, rawRows, opts = {}) {
  if (rawRows.length > MAX_ROWS) throw badRequest(`الحد ${MAX_ROWS} معلم في المرة`);
  const a = await analyze(q, rawRows, opts);
  if (a.capacity.exceeded) throw badRequest(`الاستيراد سيتجاوز حد المعلمين في باقتك (${a.capacity.max}). الحاليون ${a.capacity.current} والجدد ${a.summary.create}.`);
  const rows = a._internal, credentials = [];
  const COL = { name: "full_name", phone: "phone", email: "email", national_id: "national_id", specialty: "specialty", department: "department",
    job_title: "job_title", qualification: "qualification", gender: "gender", birth_date: "birth_date", hire_date: "hire_date", employment_type: "employment_type", employee_no: "employee_no" };
  const addLoad = async (teacherId, load) => {
    for (const l of load) await q(`INSERT INTO teacher_assignments (tenant_id, teacher_id, class_id, subject_id) VALUES (app_tenant(), $1, $2, $3) ON CONFLICT DO NOTHING`, [teacherId, l.class_id, l.subject_id]);
  };

  const creates = rows.filter((x) => x.status === "ok" && x.action === "create");
  const updates = rows.filter((x) => x.status === "ok" && x.action === "update");
  let n = 0;
  const report = () => opts.onProgress?.(++n, creates.length + updates.length);
  for (const r of creates) {
    const d = r.data;
    const [t] = await q(
      `INSERT INTO teachers (tenant_id, full_name, phone, employee_no, national_id, email, specialty, department, gender, birth_date, job_title, qualification, hire_date, employment_type)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [d.name, d.phone ?? null, r.employee_no, d.national_id ?? null, d.email ?? null, d.specialty ?? null, d.department ?? null, d.gender ?? null,
       d.birth_date ?? null, d.job_title ?? null, d.qualification ?? null, d.hire_date ?? null, d.employment_type ?? null]);
    const password = newTempPassword();
    await q(`INSERT INTO users (tenant_id, role, full_name, username, password_hash, teacher_id, must_change_password, initial_password_enc)
             VALUES (app_tenant(), 'teacher', $1, $2, $3, $4, true, $5)`, [d.name, r.username, await hashPassword(password), t.id, sealCredential(password, tenantId)]);
    await addLoad(t.id, r.load);
    credentials.push({ name: d.name, username: r.username, password, school: tenantId });
    report();
  }
  for (const r of updates) {
    const sets = [], vals = [r.existing_id];
    for (const [k, v] of Object.entries(r.changes)) { vals.push(v); sets.push(`${COL[k]} = $${vals.length}`); }
    if (sets.length) await q(`UPDATE teachers SET ${sets.join(", ")} WHERE id = $1`, vals);
    if (r.changes.name) await q("UPDATE users SET full_name = $2 WHERE teacher_id = $1", [r.existing_id, r.changes.name]);
    await addLoad(r.existing_id, r.load);
    report();
  }
  const failed = rows.filter((r) => r.status !== "ok");
  return {
    created: credentials.length, updated: rows.filter((r) => r.status === "ok" && r.action === "update").length,
    unchanged: rows.filter((r) => r.status === "ok" && r.action === "unchanged").length, skipped: failed.length,
    review: rows.filter((r) => r.status === "review").length,
    problems: failed.map((r) => ({ row: r.row, name: r.name, employee_no: r.employee_no, status: r.status, message: [...r.errors, ...r.notes].join(" — ") })),
    credentials,
  };
}

/* ---------- القالب والتصدير ---------- */
const HEADERS = FIELDS.map((f) => f.label + (f.required ? " *" : ""));
const IDX = Object.fromEntries(FIELDS.map((f, i) => [f.key, i]));
const G_LABEL = { male: "ذكر", female: "أنثى" };
const E_LABEL = { full_time: "دوام كامل", part_time: "دوام جزئي", contract: "عقد", volunteer: "تطوع" };
const TEXT_COLS = ["employee_no", "username", "national_id", "phone", "birth_date", "hire_date", "grade", "section"].map((k) => IDX[k]);

/**
 * قالب Excel. stage_id/subject_id اختياريان: يعبّئان عمودي المرحلة والمادة مسبقًا. existing=1 يضيف المعلمين الحاليين لتحديثهم.
 * لا أسماء صفوف ثابتة: القوائم من الهيكل الأكاديمي الحالي للمدرسة.
 */
export async function buildTemplate(q, { stage_id, subject_id, existing = false } = {}) {
  const struct = await structure(q);
  const subjects = await q("SELECT id, name FROM subjects ORDER BY name");
  const stage = stage_id ? struct.stages.find((s) => Number(s.id) === Number(stage_id)) : null;
  const subject = subject_id ? subjects.find((s) => Number(s.id) === Number(subject_id)) : null;
  if (stage_id && !stage) throw badRequest("المرحلة غير موجودة");
  if (subject_id && !subject) throw badRequest("المادة غير موجودة");
  const blank = () => FIELDS.map(() => "");
  let rows = [];
  if (existing) {
    const list = await q(
      `SELECT t.employee_no, t.full_name, u.username, t.national_id, t.phone, t.email, t.gender, t.birth_date::text AS birth_date, t.specialty, t.qualification,
              t.job_title, t.department, t.hire_date::text AS hire_date, t.employment_type FROM teachers t JOIN users u ON u.teacher_id = t.id ORDER BY t.id`);
    rows = list.map((t) => { const r = blank();
      Object.assign(r, { [IDX.employee_no]: t.employee_no || "", [IDX.name]: t.full_name, [IDX.username]: t.username, [IDX.national_id]: t.national_id || "",
        [IDX.phone]: t.phone || "", [IDX.email]: t.email || "", [IDX.gender]: G_LABEL[t.gender] || "", [IDX.birth_date]: t.birth_date || "",
        [IDX.specialty]: t.specialty || "", [IDX.qualification]: t.qualification || "", [IDX.job_title]: t.job_title || "", [IDX.department]: t.department || "",
        [IDX.hire_date]: t.hire_date || "", [IDX.employment_type]: E_LABEL[t.employment_type] || "" });
      return r; });
  }
  for (let i = 0; i < 30; i++) { const r = blank(); if (stage) r[IDX.stage] = stage.name; if (subject) r[IDX.subject] = subject.name; rows.push(r); }
  const gradeLines = struct.stages.flatMap((s) => s.grades.map((g) => [`${s.name} — ${g.name}${struct.sections_enabled ? ` — ${g.sections.map((c) => c.name.replace(g.name, "").replace(/^[\s\-–—]+/, "").trim() || c.name).join("، ")}` : ""}`]));
  const sheet = { name: "المعلمون", headers: HEADERS, rows, textColumns: TEXT_COLS,
    widths: [14, 26, 16, 16, 16, 24, 10, 14, 18, 18, 20, 16, 14, 16, 18, 18, 16, 12],
    lists: { [IDX.gender]: ["ذكر", "أنثى"], [IDX.employment_type]: Object.values(E_LABEL), [IDX.stage]: struct.stages.map((s) => s.name), [IDX.subject]: subjects.map((s) => s.name) } };
  const help = { name: "تعليمات", headers: ["ملاحظة"], widths: [100], rows: [
    ["الإلزامي: اسم المعلم. الرقم الوظيفي هو مفتاح التحديث: إن وُجد معلم بنفس الرقم (أو اسم المستخدم) تُحدَّث بياناته بدل إضافته."],
    ["لمعلم جديد: اكتب اسم المستخدم، أو اكتب الرقم الوظيفي فيُنشأ منه (t + الرقم). تُنشأ كلمة مرور مؤقتة لكل معلم جديد وتظهر لك مرة واحدة بعد الاستيراد."],
    ["الإسناد: المادة + الصف (والمرحلة والشعبة عند الحاجة). يمكن كتابة عدة مواد في الخلية مفصولة بفاصلة. بلا شعبة = كل شعب الصف."],
    ["عند التحديث يُضاف الإسناد الجديد على الموجود ولا يحذف شيئًا. الخلايا الفارغة لا تمسح البيانات الموجودة."],
    ["الصف يُكتب بأي صيغة معقولة (الأول، 1، Grade 1) وإن احتمل أكثر من صف سنسألك عند الفحص. التواريخ بصيغة 2015-03-28."],
    [""], ["المواد الحالية: " + (subjects.map((s) => s.name).join("، ") || "—")], ["الهيكل الحالي (المرحلة — الصف — الشعب):"], ...gradeLines,
  ] };
  return { buffer: buildXlsx([sheet, help]), filename: stage || subject ? `قالب-معلمين${stage ? `-${stage.name}` : ""}${subject ? `-${subject.name}` : ""}.xlsx` : "قالب-المعلمين.xlsx" };
}

/** تصدير Excel للمعلمين: لا كلمات مرور ولا hash ولا أي سر */
export async function exportXlsx(q) {
  const list = await q(
    `SELECT t.employee_no, t.full_name, u.username, t.national_id, t.phone, t.email, t.gender, t.birth_date::text AS birth_date, t.specialty, t.qualification,
            t.job_title, t.department, t.hire_date::text AS hire_date, t.employment_type, u.is_active, t.id FROM teachers t JOIN users u ON u.teacher_id = t.id ORDER BY t.id`);
  const load = await q(`SELECT a.teacher_id, s.name AS subject, c.name AS class FROM teacher_assignments a JOIN subjects s ON s.id = a.subject_id JOIN classes c ON c.id = a.class_id`);
  const rows = list.map((t) => [t.employee_no || "", t.full_name, t.username, t.national_id || "", t.phone || "", t.email || "", G_LABEL[t.gender] || "", t.birth_date || "",
    t.specialty || "", t.qualification || "", t.job_title || "", t.department || "", t.hire_date || "", E_LABEL[t.employment_type] || "", t.is_active ? "نشط" : "موقوف",
    load.filter((l) => Number(l.teacher_id) === Number(t.id)).map((l) => `${l.subject} (${l.class})`).join(" | ")]);
  const headers = [...FIELDS.slice(0, 14).map((f) => f.label), "الحالة", "الإسناد"];
  return buildXlsx([{ name: "المعلمون", headers, rows, textColumns: [0, 2, 3, 4, 7, 12], widths: [14, 26, 16, 16, 16, 24, 10, 14, 18, 18, 20, 16, 14, 16, 10, 50] }]);
}
