// مدرسة عرض كاملة: مدارس بنين أهلية في عدن (الأساسي والثانوي) أنهت عامًا دراسيًا كاملًا بفصليه.
// كل أقسام المنصة فيها بيانات حقيقية الشكل: الهيكل والجدول، الحضور لكل يوم دراسي مع الأعذار، اختبارات الفصلين ونتائج السنة،
// الواجبات، الرسوم والسداد بتواريخها وإشعارات التحويل، المالية (مصروفات شهرية وإيداعات وتبرعات)، الموظفون ورواتب عشرة أشهر،
// التعاميم والتنبيهات، طلبات التسجيل للعام الجديد، وبنك أسئلة وورقة اختبار، والسلوك ودوام الموظفين والتقويم وخطط الدروس
// والنقل والمكتبة والمخزون والعيادة والاستبيانات ومواعيد أولياء الأمور. السنة منتهية فيقدر المدير يجرب «بدء سنة جديدة» والترفيع.
// يُبنى بخدمات المنصة نفسها حتى تطابق المدرسة ما ينتج عن الاستخدام الفعلي، مع إدخال مجمّع للبيانات الكثيرة.
// البيانات ثابتة بالبذرة: نفس المدخلات تعطي نفس المدرسة. بلا مناسبات سياسية (الأعياد الدينية فقط).
import { transaction } from "../../core/db/pool.js";
import { hashPassword } from "../../core/auth/password.js";
import { newTempPassword, newStudentKey } from "../../core/auth/codes.js";
import { sealCredential } from "../../core/auth/secret-box.js";
import { logEvent } from "../../core/audit.js";
import * as S from "./structure.service.js";
import * as academic from "./academic.service.js";
import * as gen from "./timetable-gen.service.js";
import * as finance from "./finance.service.js";
import * as ledger from "./ledger.service.js";
import * as payroll from "./payroll.service.js";
import * as donations from "./donations.service.js";
import * as payments from "./payments.service.js";
import * as bank from "./question-bank.service.js";
import * as papers from "./exam-papers.service.js";
import * as behavior from "./behavior.service.js";

/* ---------- أسماء واقعية (بنين) ---------- */
const FIRST = ["محمد", "أحمد", "علي", "عبدالله", "عبدالرحمن", "صالح", "حسين", "ياسر", "أيمن", "وضاح", "أكرم", "هيثم", "عمار", "نبيل",
  "فؤاد", "جمال", "مراد", "شهاب", "بسام", "رشاد", "عادل", "سامي", "ماجد", "مجاهد", "زكريا", "إبراهيم", "يوسف", "خالد", "أسامة", "عمرو",
  "طارق", "عصام", "أنور", "معاذ", "براء", "أنس", "ريان", "عبدالملك", "عبدالسلام", "عبدالكريم", "صقر", "منير", "نشوان", "أوس",
  "حمزة", "عبدالرحيم", "مصطفى", "يحيى", "فارس", "بلال", "عبدالعزيز", "محمود", "سليم", "قيس", "مهيب", "وسيم", "رامي", "ضياء", "هاشم", "أمجد"];
const FATHER = ["محمد", "أحمد", "علي", "عبدالله", "صالح", "حسن", "حسين", "عبده", "قاسم", "ناجي", "سعيد", "عبدالرحمن", "يحيى", "عبدالوهاب",
  "فضل", "ناصر", "مقبل", "سيف", "عبدالكريم", "عبدالجليل", "منصور", "عبدالقادر", "إسماعيل", "عبدالرزاق", "فيصل", "أمين", "شرف", "هادي", "عوض", "سالم"];
// عائلات منتشرة في عدن والجنوب وتعز
const FAMILY = ["باوزير", "العمودي", "بن بريك", "باعباد", "الحضرمي", "اليافعي", "العولقي", "الكثيري", "باشراحيل", "بافضل", "بامطرف",
  "الشعيبي", "الردفاني", "الضالعي", "الحالمي", "الصبيحي", "العدني", "الجعدي", "السقاف", "العطاس", "باسليم", "الحداد", "العريقي",
  "المخلافي", "الشرجبي", "الأغبري", "الحكيمي", "القدسي", "الصبري", "العبسي", "الذبحاني", "المقطري", "الشميري", "البيحاني", "الهاشمي",
  "بازرعة", "باحميش", "لقمان", "الجفري", "النقيب"];
// جوال يمني: 9 أرقام تبدأ بـ 77 أو 73 أو 71 أو 70 أو 78. بعض أولياء الأمور مغتربون في السعودية (05…)
const PREFIX = ["77", "77", "73", "71", "70", "78"];
// الأعياد (تقريبية بالتقويم الميلادي) للسنة الدراسية حسب سنة نهايتها
const EIDS = { 2026: { fitr: "2026-03-20", adha: "2026-05-27" }, 2027: { fitr: "2027-03-10", adha: "2027-05-16" }, 2028: { fitr: "2028-02-27", adha: "2028-05-05" } };

// مولّد أرقام ثابت بالبذرة (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const iso = (d) => d.toISOString().slice(0, 10);
const D = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const monthEnd = (y, m) => iso(new Date(Date.UTC(y, m + 1, 0)));   // m: 0..11

/**
 * يبني المدرسة كاملة داخل مدرسة موجودة فارغة (أنشأها createTenant للتو).
 * @returns ملخص الأرقام وحسابات عيّنة للدخول
 */
export async function buildShowcase(tid, { actor = "إعداد مدرسة العرض", ip = null, perSection = 24, seed = 2026, progress = () => {} } = {}) {
  const R = rng(seed);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const chance = (p) => R() < p;
  const between = (a, b) => a + Math.floor(R() * (b - a + 1));
  const phone = () => `${pick(PREFIX)}${String(Math.floor(R() * 1e7)).padStart(7, "0")}`;
  const saudiPhone = () => `05${String(Math.floor(R() * 1e8)).padStart(8, "0")}`;
  const today = new Date(`${iso(new Date())}T00:00:00Z`);
  // آخر سنة دراسية مكتملة: تبدأ في سبتمبر وتنتهي في يونيو
  const y0 = today.getUTCMonth() >= 6 ? today.getUTCFullYear() - 1 : today.getUTCFullYear() - 2;
  const yearStart = `${y0}-09-06`, yearEnd = `${y0 + 1}-06-11`;
  const T1 = { start: `${y0}-09-06`, end: `${y0 + 1}-01-15` }, T2 = { start: `${y0 + 1}-02-01`, end: `${y0 + 1}-06-11` };
  const eid = EIDS[y0 + 1];

  return transaction({ tenantId: tid, actor, ip }, async (q) => {
    await q("SET LOCAL statement_timeout = '300s'");
    const out = {};

    progress(3, 100, "الهيكل والسنة الدراسية");
    /* 1) ملف المدرسة والهيكل (اليمن: الأول… التاسع ثم أول ثانوي، شعبتان لكل صف) */
    await q(`INSERT INTO school_profile (tenant_id, school_type, gender, country, city, address, email, phone, template)
             VALUES (app_tenant(), 'private', 'boys', 'اليمن', 'عدن', 'خور مكسر، شارع الجامعة', 'info@alrowad-aden.edu.ye', '02234567', 'full')
             ON CONFLICT (tenant_id) DO UPDATE SET school_type = 'private', gender = 'boys', country = EXCLUDED.country, city = EXCLUDED.city,
               address = EXCLUDED.address, email = EXCLUDED.email, phone = EXCLUDED.phone, template = 'full'`);
    await S.applyCountry(q, "YE");   // رمز واتساب 967 والريال اليمني
    await S.setSectionsMode(q, true);
    out.structure = await S.applyTemplate(q, { template: "full", sections_per_grade: 2, naming: "arabic", grade_set: "yemen" });
    // كل الأقسام مفعّلة للعرض (التبرعات موقوفة افتراضيًا في المدارس الجديدة)
    await q("INSERT INTO school_modules (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
    await q("UPDATE school_modules SET donations = true, payroll = true, finance = true, transfers = true WHERE tenant_id = app_tenant()");

    // السنة: فصلان بينهما إجازة منتصف العام، والسنة منتهية (يجرّب المدير «بدء سنة جديدة» والترفيع)
    await academic.configureYear(q, { name: `${y0}/${y0 + 1}`, start_date: yearStart, end_date: yearEnd, terms: 2 });
    const [year] = await q("SELECT id FROM academic_years WHERE is_current");
    const terms = await q("SELECT id, ordinal FROM terms WHERE year_id = $1 ORDER BY ordinal", [year.id]);
    await academic.updateTerm(q, terms[0].id, { name: "الفصل الأول", start_date: T1.start, end_date: T1.end });
    await academic.updateTerm(q, terms[1].id, { name: "الفصل الثاني", start_date: T2.start, end_date: T2.end });
    const term1 = { id: terms[0].id, ...T1 }, term2 = { id: terms[1].id, ...T2 };
    await academic.setCurrentTerm(q, term2.id);
    await academic.setPassMark(q, year.id, 50);
    await gen.saveSettings(q, { days: [0, 1, 2, 3, 4], periods_per_day: 7, start_time: "07:30", period_minutes: 45, break_after: 3, break_minutes: 25 });
    const holidays = [
      { name: "إجازة منتصف العام", kind: "term_end", start_date: iso(addDays(D(T1.end), 1)), end_date: iso(addDays(D(T2.start), -1)) },
      ...(eid ? [
        { name: "إجازة عيد الفطر المبارك", kind: "eid", start_date: iso(addDays(D(eid.fitr), -2)), end_date: iso(addDays(D(eid.fitr), 5)) },
        { name: "إجازة عيد الأضحى المبارك", kind: "eid", start_date: iso(addDays(D(eid.adha), -2)), end_date: iso(addDays(D(eid.adha), 5)) },
      ] : []),
    ];
    for (const hd of holidays) await academic.addHoliday(q, { ...hd, notes: null, affects_attendance: true, show_in_calendar: true });
    await S.completeSetup(q);

    const classes = await q(`SELECT c.id, c.name, c.grade_id, g.name AS grade_name, g.sort_order AS g_order, st.code AS stage
                               FROM classes c JOIN grades g ON g.id = c.grade_id JOIN stages st ON st.id = g.stage_id
                              ORDER BY st.sort_order, g.sort_order, c.sort_order, c.id`);
    const subjects = await q(`SELECT s.id, s.name, s.weekly_periods, array_agg(sg.grade_id) AS grades
                                FROM subjects s JOIN subject_grades sg ON sg.subject_id = s.id WHERE s.is_active GROUP BY s.id ORDER BY s.sort_order, s.id`);

    progress(8, 100, "المعلمون والموظفون");
    /* 2) المعلمون: لكل مادة ومرحلة معلمون متخصصون بنصاب لا يتجاوز 20 حصة أسبوعيًا */
    const pairs = [];
    for (const c of classes) for (const s of subjects) if (s.grades.map(Number).includes(Number(c.grade_id))) pairs.push({ c, s });
    const usedNames = new Set();
    const personName = () => {
      for (;;) { const n = `${pick(FIRST)} ${pick(FATHER)} ${pick(FAMILY)}`; if (!usedNames.has(n)) { usedNames.add(n); return n; } }
    };
    const teachers = [];
    const groups = new Map();
    for (const p of pairs) {
      const k = `${p.s.id}:${p.c.stage}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    const assignments = [];
    let seq = 1001;
    for (const list of groups.values()) {
      let cur = null, load = 0;
      for (const p of list) {
        const w = Math.max(1, p.s.weekly_periods || 2);
        if (!cur || load + w > 20) {
          cur = { name: `أ. ${personName()}`, subject: p.s.name, stage: p.c.stage, username: `t${seq}`, employee_no: `EMP-${seq}` };
          seq++; load = 0;
          teachers.push(cur);
        }
        load += w;
        assignments.push({ t: cur, class_id: p.c.id, subject_id: p.s.id });
      }
    }
    const STAGE_AR = { primary: "الأساسي (1–6)", middle: "الأساسي (7–9)", secondary: "الثانوي" };
    const QUAL = ["بكالوريوس", "بكالوريوس تربية", "ماجستير", "بكالوريوس مع دبلوم تربوي", "دبلوم معلمين"];
    const creds = [];
    for (const t of teachers) {
      const [row] = await q(
        `INSERT INTO teachers (tenant_id, full_name, phone, employee_no, email, specialty, department, job_title, qualification, hire_date, employment_type, gender)
         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, 'معلم', $7, $8, $9, 'male') RETURNING id`,
        [t.name, phone(), t.employee_no, `${t.username}@alrowad-aden.edu.ye`, t.subject, STAGE_AR[t.stage] || null, pick(QUAL),
         iso(addDays(D(yearStart), -Math.floor(365 * (1 + R() * 12)))), chance(0.85) ? "full_time" : "part_time"]);
      t.id = row.id;
      t.password = newTempPassword();
      await q(`INSERT INTO users (tenant_id, role, full_name, username, password_hash, teacher_id, must_change_password, initial_password_enc)
               VALUES (app_tenant(), 'teacher', $1, $2, $3, $4, true, $5)`,
        [t.name, t.username, await hashPassword(t.password), t.id, sealCredential(t.password, tid)]);
      if (creds.length < 3) creds.push({ name: t.name, subject: t.subject, username: t.username, password: t.password });
    }
    await q(`INSERT INTO teacher_assignments (tenant_id, teacher_id, class_id, subject_id)
             SELECT app_tenant(), * FROM unnest($1::bigint[], $2::bigint[], $3::bigint[])`,
      [assignments.map((a) => a.t.id), assignments.map((a) => a.class_id), assignments.map((a) => a.subject_id)]);
    out.teachers = teachers.length;

    // المعلمون صاروا موظفين تلقائيًا (مشغّل القاعدة): رواتبهم حسب المرحلة والخبرة، والدوام الجزئي أقل
    const tsal = teachers.map((t) => ({ id: t.id, base: (t.stage === "secondary" ? 190000 : t.stage === "middle" ? 175000 : 160000) + between(0, 6) * 5000 }));
    await q(`UPDATE staff s SET base_salary = x.b * CASE WHEN t.employment_type = 'part_time' THEN 0.6 ELSE 1 END, allowance = 20000,
               pay_method = 'transfer', account_number = lpad((3000000000 + s.id * 7919)::text, 10, '0')
               FROM unnest($1::bigint[], $2::numeric[]) AS x(tid, b) JOIN teachers t ON t.id = x.tid WHERE s.teacher_id = x.tid`,
      [tsal.map((x) => x.id), tsal.map((x) => x.base)]);
    // بقية الموظفين بأنواعهم
    const STAFF = [
      ["admin", "وكيل المدرسة", 260000, 40000], ["admin", "سكرتير المدرسة", 140000, 15000], ["admin", "أمين المكتبة", 120000, 10000],
      ["accountant", "المحاسب", 200000, 20000], ["supervisor", "المشرف الاجتماعي", 150000, 15000], ["supervisor", "مشرف الأنشطة", 140000, 15000],
      ["guard", "حارس البوابة الرئيسية", 90000, 10000], ["guard", "حارس ليلي", 90000, 10000],
      ["driver", "سائق الباص 1", 110000, 20000], ["driver", "سائق الباص 2", 110000, 20000], ["driver", "سائق الباص 3", 110000, 20000],
      ["cleaner", "عامل نظافة", 80000, 5000], ["cleaner", "عامل نظافة", 80000, 5000], ["cleaner", "عامل نظافة", 80000, 5000],
      ["worker", "عامل صيانة", 100000, 10000],
    ];
    for (const [category, title, base, allowance] of STAFF) {
      await q(`INSERT INTO staff (tenant_id, full_name, job_title, category, phone, base_salary, allowance, pay_method, hire_date)
               VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8)`,
        [personName(), title, category, phone(), base, allowance, ["guard", "cleaner", "worker"].includes(category) ? "cash" : "transfer",
         iso(addDays(D(yearStart), -Math.floor(365 * (1 + R() * 8))))]);
    }
    out.staff = teachers.length + STAFF.length;

    // حساب المحاسب (بوابة المحاسب) بصلاحيات كاملة
    const accPassword = newTempPassword();
    await q(`INSERT INTO users (tenant_id, role, full_name, username, password_hash, must_change_password, initial_password_enc,
               can_approve_finance, can_manage_payroll, can_manage_accounts)
             VALUES (app_tenant(), 'accountant', 'المحاسب', 'accountant', $1, true, $2, true, true, true)`,
      [await hashPassword(accPassword), sealCredential(accPassword, tid)]);

    progress(12, 100, "الجدول الدراسي");
    /* 3) الجدول الدراسي: مولّد المنصة نفسه، ثم إكمال ما عجز عنه، ثم حفظ مجمّع */
    const draft = await gen.generate(q, { replace: true });
    fillGaps(draft.slots, pairs, assignments, draft.settings);
    const rooms = new Map(classes.map((c, i) => [Number(c.id), `قاعة ${101 + i}`]));
    await q(`INSERT INTO timetable_slots (tenant_id, class_id, day, period, subject_id, teacher_id, room)
             SELECT app_tenant(), * FROM unnest($1::bigint[], $2::int[], $3::int[], $4::bigint[], $5::bigint[], $6::text[])`,
      [draft.slots.map((s) => s.class_id), draft.slots.map((s) => s.day), draft.slots.map((s) => s.period),
       draft.slots.map((s) => s.subject_id), draft.slots.map((s) => s.teacher_id), draft.slots.map((s) => rooms.get(Number(s.class_id)))]);
    out.periods = draft.slots.length;

    progress(15, 100, "الطلاب وأولياء الأمور");
    /* 4) الطلاب: أعمار مناسبة، إخوة بجوال ولي أمر واحد، وبعض أولياء الأمور مغتربون بجوال سعودي */
    const students = [];
    const keys = new Set();
    let no = 1;
    const families = [];
    for (const c of classes) {
      const stageBase = { primary: 6, middle: 12, secondary: 15 }[c.stage] ?? 6;
      const age = stageBase + (Number(c.g_order) - 1);
      const size = perSection - 2 + Math.floor(R() * 5);
      for (let i = 0; i < size; i++) {
        let fam = families.length && chance(0.3) ? pick(families) : null;
        if (!fam || fam.kids >= 3) {
          fam = { father: pick(FATHER), grand: pick(FATHER), family: pick(FAMILY), phone: chance(0.12) ? saudiPhone() : phone(), kids: 0 };
          families.push(fam);
        }
        let first;
        do { first = pick(FIRST); } while (first === fam.father);
        fam.kids++;
        let key; do { key = newStudentKey(); } while (keys.has(key)); keys.add(key);
        const born = addDays(new Date(Date.UTC(y0 - age, 0, 1)), Math.floor(R() * 365));
        students.push({ class_id: c.id, stage: c.stage, name: `${first} ${fam.father} ${fam.grand} ${fam.family}`,
          guardian: `${fam.father} ${fam.grand} ${fam.family}`, phone: fam.phone, key, no: `${y0}${String(no++).padStart(4, "0")}`,
          birth: iso(born), ability: 0.45 + R() * 0.53, absentProne: chance(0.08) });
      }
    }
    const ids = await q(`INSERT INTO students (tenant_id, class_id, full_name, guardian_name, guardian_phone, access_key, fees_enabled, student_no, birth_date, gender, created_at)
                          SELECT app_tenant(), c, n, g, p, k, true, sn, b::date, 'male', $8::date + time '08:00'
                            FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS x(c, n, g, p, k, sn, b)
                          RETURNING id`,
      [students.map((s) => s.class_id), students.map((s) => s.name), students.map((s) => s.guardian), students.map((s) => s.phone),
       students.map((s) => s.key), students.map((s) => s.no), students.map((s) => s.birth), iso(addDays(D(yearStart), -20))]);
    students.forEach((s, i) => { s.id = ids[i].id; });
    out.students = students.length;
    const byClass = new Map();
    for (const s of students) { if (!byClass.has(Number(s.class_id))) byClass.set(Number(s.class_id), []); byClass.get(Number(s.class_id)).push(s); }

    /* 5) الحضور لكل يوم دراسي في الفصلين (بلا الإجازات)، مع أسباب الغياب وأعذار أولياء الأمور */
    const REASONS = ["مراجعة طبية", "ظرف عائلي", "مرض", "سفر مع الأسرة", "موعد في المستشفى"];
    const PARENT = ["كان مريضًا ومعه تقرير طبي", "سافرنا لظرف عائلي طارئ", "موعد عند الطبيب", "حمّى منذ الأمس"];
    const off = new Set();
    for (const hd of holidays) for (let d = D(hd.start_date); iso(d) <= hd.end_date; d = addDays(d, 1)) off.add(iso(d));
    const studyDays = [];
    for (const t of [term1, term2]) for (let d = D(t.start); iso(d) <= t.end; d = addDays(d, 1)) if (d.getUTCDay() <= 4 && !off.has(iso(d))) studyDays.push(iso(d));
    const teacherOfClass = new Map(assignments.map((a) => [Number(a.class_id), a.t.name]));
    let attRows = 0;
    for (const [di, day] of studyDays.entries()) {
      const rows = { id: [], st: [], ex: [], by: [], pe: [], ps: [] };
      const lateInYear = di > studyDays.length - 8;   // آخر أيام السنة: أعذار ما زالت بانتظار المراجعة
      for (const s of students) {
        const r = R();
        const pa = s.absentProne ? 0.13 : 0.03;
        let st = r < pa ? "absent" : r < pa + 0.025 ? "late" : "present";
        let ex = st === "late" && chance(0.4) ? "زحام مروري" : st === "absent" && chance(0.3) ? pick(REASONS) : null;
        let pe = null, ps = null;
        if (st === "absent" && chance(0.25)) {
          pe = pick(PARENT);
          if (lateInYear) ps = "pending"; else { ps = "accepted"; st = "excused"; ex = pe; }
        }
        rows.id.push(s.id); rows.st.push(st); rows.ex.push(ex); rows.by.push(teacherOfClass.get(Number(s.class_id)) || "الإدارة");
        rows.pe.push(pe); rows.ps.push(ps);
      }
      await q(`INSERT INTO attendance (tenant_id, student_id, day, status, excuse, recorded_by, parent_excuse, parent_excuse_state, parent_excuse_at, created_at)
               SELECT app_tenant(), sid, $1::date, st, ex, rb, pe, ps, CASE WHEN pe IS NULL THEN NULL ELSE $1::date + time '19:00' END, $1::date + time '07:45'
                 FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS x(sid, st, ex, rb, pe, ps)`,
        [day, rows.id, rows.st, rows.ex, rows.by, rows.pe, rows.ps]);
      attRows += rows.id.length;
      if (di % 10 === 0) progress(18 + (22 * di) / studyDays.length, 100, "الحضور اليومي");
    }
    out.school_days = studyDays.length; out.attendance = attRows;

    progress(40, 100, "الاختبارات والدرجات");
    /* 6) الاختبارات: شهريان ونهائي لكل مادة في كل شعبة وفي كل فصل (20 + 20 + 60 = 100)، منشورة بدرجاتها */
    const PLAN = [
      [term1, "اختبار الشهر الأول", 20, `${y0}-10-20`], [term1, "اختبار الشهر الثاني", 20, `${y0}-11-24`], [term1, "الاختبار النهائي — الفصل الأول", 60, `${y0 + 1}-01-08`],
      [term2, "اختبار الشهر الأول", 20, `${y0 + 1}-03-02`], [term2, "اختبار الشهر الثاني", 20, `${y0 + 1}-04-20`], [term2, "الاختبار النهائي — الفصل الثاني", 60, `${y0 + 1}-06-02`],
    ];
    let exams = 0, scoreRows = 0;
    for (const [pi, [term, title, max, date]] of PLAN.entries()) {
      const made = await q(`INSERT INTO exams (tenant_id, class_id, subject_id, title, exam_date, max_score, status, created_by, term_id)
                            SELECT app_tenant(), c, s, $3, $4::date, $5, 'draft', n, $6 FROM unnest($1::bigint[], $2::bigint[], $7::text[]) AS x(c, s, n)
                            RETURNING id, class_id, subject_id`,
        [assignments.map((a) => a.class_id), assignments.map((a) => a.subject_id), title, date, max, term.id, assignments.map((a) => a.t.name)]);
      const sc = { e: [], s: [], v: [], by: [] };
      const tName = new Map(assignments.map((a) => [`${a.class_id}:${a.subject_id}`, a.t.name]));
      for (const e of made) {
        for (const k of byClass.get(Number(e.class_id)) || []) {
          // الفصل الثاني أفضل قليلًا لمعظم الطلاب (تحسّن عبر السنة)
          const lvl = Math.min(0.99, k.ability + (term === term2 ? 0.03 : 0) + (R() - 0.5) * 0.22);
          sc.e.push(e.id); sc.s.push(k.id); sc.v.push(Math.max(0, Math.min(max, Math.round(lvl * max * 2) / 2)));
          sc.by.push(tName.get(`${e.class_id}:${e.subject_id}`) || "المعلم");
        }
      }
      await q(`INSERT INTO scores (tenant_id, exam_id, student_id, score, updated_by)
               SELECT app_tenant(), e, s, v, b FROM unnest($1::bigint[], $2::bigint[], $3::numeric[], $4::text[]) AS x(e, s, v, b)`, [sc.e, sc.s, sc.v, sc.by]);
      const examIds = made.map((e) => e.id);
      await q("UPDATE exams SET status = 'published' WHERE id = ANY($1::bigint[])", [examIds]);
      await q("UPDATE exams SET published_at = exam_date + interval '3 days' + time '13:00' WHERE id = ANY($1::bigint[])", [examIds]);
      exams += made.length; scoreRows += sc.e.length;
      progress(40 + (15 * (pi + 1)) / PLAN.length, 100);
    }
    out.exams = exams; out.scores = scoreRows;

    progress(56, 100, "الواجبات");
    /* 7) الواجبات: 4 في كل فصل لمادتين في كل شعبة، مع التسليم */
    let hw = 0;
    const HW = ["حل تمارين الدرس", "مراجعة الوحدة", "بحث قصير", "ورقة عمل", "تلخيص الدرس", "حل أسئلة الكتاب", "مشروع صغير"];
    for (const c of classes) {
      const mine = assignments.filter((a) => Number(a.class_id) === Number(c.id)).slice(0, 2);
      const kids = byClass.get(Number(c.id)) || [];
      for (const a of mine) for (const term of [term1, term2]) for (let k = 0; k < 4; k++) {
        const span = (D(term.end) - D(term.start)) / 86400000;
        const due = addDays(D(term.start), Math.floor(((k + 0.7) * span) / 4.5));
        const [w] = await q(`INSERT INTO assignments (tenant_id, class_id, subject_id, teacher_id, title, details, due_date, created_by, term_id, created_at)
                             VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $6::date - interval '4 days') RETURNING id`,
          [a.class_id, a.subject_id, a.t.id, pick(HW), "تُسلَّم في الحصة القادمة.", iso(due), a.t.name, term.id]);
        await q(`INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, submitted, marked_by)
                 SELECT app_tenant(), $1, sid, sub, $2 FROM unnest($3::bigint[], $4::bool[]) AS x(sid, sub)`,
          [w.id, a.t.name, kids.map((x) => x.id), kids.map((x) => R() < x.ability + 0.12)]);
        hw++;
      }
    }
    out.homework = hw;

    progress(60, 100, "الرسوم والسداد");
    /* 8) الرسوم: فاتورة لكل فصل دراسي، وسداد بتاريخه (نقدًا أو تحويلًا أو محفظة)، وبقايا غير مسددة في الفصل الثاني */
    await ledger.ensureDefaults(q);
    await q("UPDATE finance_accounts SET name = 'الصندوق النقدي', low_balance = 500000 WHERE kind = 'cash'");
    await q("UPDATE finance_accounts SET name = 'بنك الكريمي — حساب المدرسة' WHERE kind = 'bank'");
    const [wallet] = await q("INSERT INTO finance_accounts (tenant_id, name, kind) VALUES (app_tenant(), 'محفظة جوالي', 'online') RETURNING id");
    await q("UPDATE finance_method_accounts SET account_id = $1 WHERE method = 'online'", [wallet.id]);
    const [bankAcc] = await q("SELECT id FROM finance_accounts WHERE kind = 'bank' LIMIT 1");
    const [cashAcc] = await q("SELECT id FROM finance_accounts WHERE kind = 'cash' LIMIT 1");
    await q(`INSERT INTO payment_accounts (tenant_id, bank_name, account_holder, account_number) VALUES
               (app_tenant(), 'بنك الكريمي', 'مدارس الرواد الأهلية — عدن', '3012045871'),
               (app_tenant(), 'محفظة جوالي', 'مدارس الرواد الأهلية — عدن', '777000123')`);
    await q(`INSERT INTO school_public_settings (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING`);
    const FEES = { primary: 180000, middle: 210000, secondary: 250000 };
    const invoiceFor = async (term, title, due) => q(
      `INSERT INTO invoices (tenant_id, student_id, title, amount, due_date, created_by, term_id, created_at)
       SELECT app_tenant(), sid, $3, amt, $4::date, 'المحاسب', $5, $6::date + time '09:00' FROM unnest($1::bigint[], $2::numeric[]) AS x(sid, amt)
       RETURNING id, student_id, amount`,
      [students.map((s) => s.id), students.map((s) => FEES[s.stage] ?? 200000), title, due, term.id, term.start]);
    const inv1 = await invoiceFor(term1, "رسوم الفصل الأول", `${y0}-10-15`);
    const inv2 = await invoiceFor(term2, "رسوم الفصل الثاني", `${y0 + 1}-02-28`);
    const payDay = (term, late) => iso(addDays(D(term.start), between(late ? 30 : 0, late ? 110 : 45)));
    const method = () => { const r = R(); return r < 0.55 ? "cash" : r < 0.9 ? "transfer" : "online"; };
    let paid = 0, partial = 0, unpaid2 = [];
    for (const [ti, list] of [inv1, inv2].entries()) {
      const term = ti ? term2 : term1;
      for (const [i, inv] of list.entries()) {
        const r = R();
        const full = ti ? r < 0.8 : r < 0.93, half = ti ? r < 0.92 : r < 0.98;
        const key = `showcase-${tid}-${ti}-${i}`;
        if (full) {
          paid++;
          if (chance(0.3)) {   // على دفعتين
            await finance.recordPayment(q, { invoiceId: inv.id, amount: Math.round(inv.amount / 2), method: method(), note: "الدفعة الأولى", idempotencyKey: `${key}-a`, actor: "المحاسب", paidOn: payDay(term, false) });
            await finance.recordPayment(q, { invoiceId: inv.id, amount: inv.amount - Math.round(inv.amount / 2), method: method(), note: "الدفعة الثانية", idempotencyKey: `${key}-b`, actor: "المحاسب", paidOn: payDay(term, true) });
          } else {
            await finance.recordPayment(q, { invoiceId: inv.id, amount: inv.amount, method: method(), note: null, idempotencyKey: `${key}-a`, actor: "المحاسب", paidOn: payDay(term, false) });
          }
        } else if (half) {
          partial++;
          await finance.recordPayment(q, { invoiceId: inv.id, amount: Math.round(inv.amount / 2000) * 1000, method: method(), note: "الدفعة الأولى", idempotencyKey: `${key}-a`, actor: "المحاسب", paidOn: payDay(term, false) });
          if (ti) unpaid2.push(inv);
        } else if (ti) unpaid2.push(inv);
      }
      progress(60 + 10 * (ti + 1), 100);
    }
    out.invoices = inv1.length + inv2.length; out.paid = paid; out.partial = partial;

    // إشعارات تحويل من أولياء الأمور: 4 بانتظار مراجعة المحاسب، وواحد مرفوض
    const byId = new Map(students.map((s) => [Number(s.id), s]));
    const [payAcc] = await q("SELECT id FROM payment_accounts ORDER BY id LIMIT 1");
    let claims = 0;
    for (const [i, inv] of unpaid2.slice(0, 5).entries()) {
      const st = byId.get(Number(inv.student_id));
      const [{ paid: already }] = await q("SELECT invoice_net_paid($1) AS paid", [inv.id]);
      const c = await payments.createClaim(q, { id: st.id }, {
        invoice_id: inv.id, account_id: payAcc.id, amount: Math.min(Number(inv.amount) - Number(already), 90000),
        transfer_date: `${y0 + 1}-06-${String(3 + i).padStart(2, "0")}`, sender_name: st.guardian, bank_reference: `KR${between(100000, 999999)}`,
        idempotency_key: `showcase-claim-${tid}-${i}`,
      });
      if (i === 4) await payments.reviewClaim(q, c.id, { decision: "reject", note: "لم يصل المبلغ إلى حساب المدرسة، راجع البنك" }, "المحاسب");
      claims++;
    }
    out.claims = claims;

    progress(72, 100, "المالية والمصروفات");
    /* 9) المالية: مصروفات تشغيل شهرية، وإيداع النقد في البنك، وتبرعات، وسحبات بانتظار الاعتماد */
    const months = [];
    for (let m = 8; m <= 17; m++) months.push({ y: y0 + Math.floor(m / 12), m: m % 12 });   // سبتمبر ← يونيو
    const EXP = [
      ["rent", "إيجار مبنى المدرسة", 1800000, "transfer", "مالك المبنى"],
      ["utilities", "فاتورة الكهرباء والمياه", 700000, "cash", "مؤسسة الكهرباء"],
      ["utilities", "ديزل المولد الكهربائي", 450000, "cash", "محطة الوقود"],
      ["internet", "الإنترنت والاتصالات", 120000, "transfer", "يمن نت"],
      ["transport_expense", "وقود الباصات", 850000, "cash", "محطة الوقود"],
      ["services", "مواد النظافة", 180000, "cash", "مؤسسة التوريدات"],
    ];
    let expenses = 0;
    for (const { y, m } of months) {
      for (const [code, reason, amount, how, who] of EXP) {
        await ledger.addSystemEntry(q, { direction: "expense", amount: Math.round((amount * (0.9 + R() * 0.2)) / 1000) * 1000, method: how,
          occurredOn: `${y}-${String(m + 1).padStart(2, "0")}-${String(between(3, 25)).padStart(2, "0")}`, reason, beneficiary: who,
          categoryCode: code, sourceType: "expense", actor: "المحاسب" });
        expenses++;
      }
      if ([8, 1].includes(m)) {   // بداية كل فصل: قرطاسية وكتب
        await ledger.addSystemEntry(q, { direction: "expense", amount: 2600000, method: "cash", occurredOn: `${y}-${String(m + 1).padStart(2, "0")}-02`,
          reason: "قرطاسية ومستلزمات بداية الفصل", beneficiary: "مكتبة عدن", categoryCode: "supplies", sourceType: "expense", actor: "المحاسب" });
        expenses++;
      }
      if (chance(0.5)) {
        await ledger.addSystemEntry(q, { direction: "expense", amount: between(2, 9) * 50000, method: "cash", occurredOn: `${y}-${String(m + 1).padStart(2, "0")}-${String(between(5, 26)).padStart(2, "0")}`,
          reason: pick(["صيانة المكيفات", "صيانة دورات المياه", "إصلاح نوافذ الفصول", "صيانة الباص"]), beneficiary: "ورشة الصيانة", categoryCode: "maintenance", sourceType: "expense", actor: "المحاسب" });
        expenses++;
      }
      // إيداع النقد الزائد في البنك نهاية كل شهر، ويبقى في الصندوق احتياطي لمصروفات الأشهر القادمة
      // الرصيد حتى نهاية الشهر (الدفعات مسجلة بتواريخها لكل السنة، فالرصيد الكلي لا يصلح هنا)
      const [{ b }] = await q(
        `SELECT a.opening_balance + COALESCE(SUM(CASE WHEN e.direction = 'income' THEN e.amount ELSE -e.amount END), 0) AS b
           FROM finance_accounts a LEFT JOIN finance_entries e ON e.account_id = a.id AND e.status = 'approved' AND e.occurred_on <= $2
          WHERE a.id = $1 GROUP BY a.id`, [cashAcc.id, monthEnd(y, m)]);
      const dep = Math.floor(Math.max(0, Number(b) - 9000000) / 100000) * 100000;
      if (dep > 0) await ledger.transfer(q, { from_account_id: cashAcc.id, to_account_id: bankAcc.id, amount: dep, occurred_on: monthEnd(y, m),
        reason: "إيداع النقد في البنك", reference: `DEP-${y}${String(m + 1).padStart(2, "0")}` }, "المحاسب");
    }
    await ledger.addSystemEntry(q, { direction: "expense", amount: 950000, method: "cash", occurredOn: `${y0 + 1}-04-15`, reason: "الرحلة المدرسية والحفل الختامي",
      beneficiary: "لجنة الأنشطة", categoryCode: "activities_expense", sourceType: "expense", actor: "المحاسب" });
    // مصروفان بانتظار اعتماد المدير (مثال على دورة الاعتماد)
    const cats = Object.fromEntries((await q("SELECT code, id FROM finance_categories WHERE code IS NOT NULL")).map((c) => [c.code, c.id]));
    for (const [reason, amount] of [["شراء جهاز عرض للمختبر", 420000], ["سلفة لشراء أدوات رياضية", 160000]]) {
      await ledger.addEntry(q, { direction: "expense", amount, account_id: cashAcc.id, category_id: cats.other_expense, occurred_on: `${y0 + 1}-06-09`,
        reason, beneficiary: "مشتريات المدرسة", method: "cash", reference: null, attachment: null, note: null }, { actor: "المحاسب", sourceType: "withdrawal", status: "pending" });
    }
    const DON = [["مجلس الآباء", 1500000, "دعم تجهيز معمل الحاسوب"], ["رجل أعمال من أولياء الأمور", 2000000, "كفالة رسوم الطلاب الأيتام"],
      [null, 500000, "دعم الأنشطة"], ["جمعية خيرية محلية", 1200000, "كسوة الطلاب المحتاجين"], ["أحد خريجي المدرسة", 300000, "جوائز المتفوقين"]];
    for (const [i, [who, amount, purpose]] of DON.entries()) {
      await donations.add(q, { donor_name: who, anonymous: !who, phone: null, amount, purpose, method: i % 2 ? "cash" : "transfer",
        reference: null, received_on: iso(addDays(D(yearStart), 30 + i * 50)), note: null }, "المحاسب");
    }
    out.expenses = expenses; out.donations = DON.length;

    progress(80, 100, "رواتب عشرة أشهر");
    /* 10) الرواتب: مسير لكل شهر من سبتمبر إلى يونيو، معتمد ومصروف نهاية الشهر */
    for (const [i, { y, m }] of months.entries()) {
      const run = await payroll.createRun(q, { period: `${y}-${String(m + 1).padStart(2, "0")}-01` }, "المحاسب");
      if (i % 3 === 1) {   // مكافآت وخصومات في بعض الأشهر
        const items = await payroll.runItems(q, run.id);
        for (const it of items.filter(() => chance(0.08))) {
          await payroll.updateItem(q, run.id, it.id, { allowances: Number(it.allowances), bonus: chance(0.6) ? 20000 : 0, deductions: chance(0.4) ? 10000 : 0, advances: 0, note: null });
        }
      }
      await payroll.approveRun(q, run.id, "مدير المدرسة");
      await payroll.payRun(q, run.id, { method: "transfer", paid_on: monthEnd(y, m) }, "المحاسب");
      progress(80 + (10 * (i + 1)) / months.length, 100);
    }
    out.payroll_months = months.length;

    progress(91, 100, "التعاميم والتنبيهات والتسجيل");
    /* 11) التعاميم والتنبيهات */
    const ANN = [
      [`${y0}-09-04`, "بداية العام الدراسي", "نرحب بأبنائنا الطلاب في العام الدراسي الجديد، ونتمنى لهم عامًا حافلًا بالتميز."],
      [`${y0}-09-20`, "الزي المدرسي", "نذكّر بالالتزام بالزي المدرسي الرسمي والحضور قبل الساعة 7:30 صباحًا."],
      [`${y0}-10-12`, "اختبارات الشهر الأول", "تبدأ اختبارات الشهر الأول يوم الأحد القادم وفق الجدول المعلن في ملف الطالب."],
      [`${y0}-11-05`, "اجتماع أولياء الأمور", "يُعقد اجتماع أولياء الأمور يوم الخميس القادم الساعة الرابعة عصرًا في قاعة المدرسة."],
      [`${y0}-12-28`, "الاختبارات النهائية للفصل الأول", "تبدأ الاختبارات النهائية للفصل الأول يوم 4 يناير. نتمنى التوفيق لأبنائنا."],
      [`${y0 + 1}-01-14`, "إجازة منتصف العام", "تبدأ إجازة منتصف العام بعد انتهاء الاختبارات، ويستأنف الدوام في الفصل الثاني مطلع فبراير."],
      [`${y0 + 1}-02-01`, "بداية الفصل الثاني", "أهلًا بأبنائنا في الفصل الدراسي الثاني. النتائج متاحة في ملف كل طالب."],
      ...(eid ? [[iso(addDays(D(eid.fitr), -5)), "إجازة عيد الفطر", "كل عام وأنتم بخير. تبدأ إجازة عيد الفطر المبارك ويستأنف الدوام بعدها مباشرة."]] : []),
      [`${y0 + 1}-04-10`, "الرحلة المدرسية", "تنظم المدرسة رحلة ترفيهية لطلاب الصفوف العليا إلى ساحل أبين. التسجيل لدى المشرف."],
      [`${y0 + 1}-05-25`, "الاختبارات النهائية", "تبدأ الاختبارات النهائية للفصل الثاني يوم 1 يونيو، والجدول في ملف الطالب."],
      [`${y0 + 1}-06-12`, "نهاية العام الدراسي", "انتهى العام الدراسي. النتائج النهائية متاحة في ملف كل طالب، والتسجيل للعام القادم مفتوح."],
    ];
    for (const [d, t, b] of ANN) await q("INSERT INTO announcements (tenant_id, title, body, created_by, created_at) VALUES (app_tenant(), $1, $2, 'الإدارة', $3::date + time '10:00')", [t, b, d]);
    const top = [...students].sort((a, b) => b.ability - a.ability).slice(0, 20);
    for (const [i, s] of top.entries()) await q(`INSERT INTO student_alerts (tenant_id, student_id, kind, level, title, body, for_parent, created_by, created_at, acknowledged_at)
      VALUES (app_tenant(), $1, 'praise', 'positive', 'تميز دراسي', 'من أوائل الصف في الاختبارات النهائية، نفخر به.', true, 'الإدارة', $2::date, CASE WHEN $3 THEN $2::date + 1 ELSE NULL END)`,
      [s.id, `${y0 + 1}-06-${i % 2 ? "08" : "10"}`, i % 3 !== 0]);
    const risky = students.filter((s) => s.absentProne).slice(0, 12);
    for (const [i, s] of risky.entries()) await q(`INSERT INTO student_alerts (tenant_id, student_id, kind, level, title, body, for_parent, created_by, created_at, acknowledged_at)
      VALUES (app_tenant(), $1, 'attendance', 'warning', 'تكرار الغياب', 'نأمل متابعة انتظام الطالب في الحضور والتواصل مع المشرف الاجتماعي.', true, 'المشرف الاجتماعي', $2::date, CASE WHEN $3 THEN $2::date + 2 ELSE NULL END)`,
      [s.id, iso(addDays(D(T2.start), 20 + i * 5)), i % 2 === 0]);

    // طلبات التسجيل للعام القادم (من صفحة المدرسة)
    const ADM = [["الأول", 6], ["الأول", 6], ["الأول", 6], ["الرابع", 9], ["السابع", 12], ["أول ثانوي", 15], ["الأول", 6], ["الخامس", 10]];
    for (const [i, [grade, age]] of ADM.entries()) {
      const fam = `${pick(FATHER)} ${pick(FATHER)} ${pick(FAMILY)}`;
      await q(`INSERT INTO admissions (tenant_id, student_name, grade_wanted, birth_date, guardian_name, guardian_phone, note, status, created_at)
               VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8::date + time '11:00')`,
        [`${pick(FIRST)} ${fam}`, grade, iso(addDays(new Date(Date.UTC(y0 + 1 - age, 0, 1)), between(0, 300))), fam, chance(0.2) ? saudiPhone() : phone(),
         i === 3 ? "منتقل من مدرسة حكومية" : null, i < 5 ? "new" : "contacted", `${y0 + 1}-06-${String(12 + i).padStart(2, "0")}`]);
    }

    // الطلاب المنتقلون خلال السنة (تبقى سجلاتهم)
    for (const s of students.filter(() => chance(0.01)).slice(0, 5)) {
      await q("UPDATE students SET status = 'transferred', status_note = 'انتقل مع أسرته إلى مدينة أخرى' WHERE id = $1", [s.id]);
    }

    /* 12) بنك الأسئلة وورقة اختبار (رياضيات السابع) */
    const math = subjects.find((x) => x.name === "الرياضيات");
    const seventh = classes.find((c) => c.grade_name === "السابع");
    const mathT = math && seventh && assignments.find((a) => Number(a.class_id) === Number(seventh.id) && Number(a.subject_id) === Number(math.id))?.t;
    if (mathT) {
      const opts = (a) => a.map((text, i) => ({ id: `o_m${i}${between(100, 999)}`, text }));
      const Q = [
        { type: "mcq", marks: 2, text: "ناتج 3/4 + 1/8 يساوي:", options: opts(["7/8", "4/12", "1", "5/8"]), correctIdx: 0 },
        { type: "mcq", marks: 2, text: "العدد الأولي من الأعداد التالية هو:", options: opts(["21", "27", "29", "33"]), correctIdx: 2 },
        { type: "truefalse", marks: 1, text: "مجموع زوايا المثلث 180 درجة.", correct: true },
        { type: "truefalse", marks: 1, text: "العدد صفر عدد موجب.", correct: false },
        { type: "fill", marks: 2, text: "مساحة المستطيل = الطول × ........", answers: ["العرض"] },
        { type: "fill", marks: 2, text: "إذا كان 2س = 14 فإن س = ........", answers: ["7"] },
        { type: "essay", marks: 5, text: "اشترى أحمد 3 أقلام بسعر 450 ريالًا للقلم و4 دفاتر بسعر 700 ريال للدفتر. كم دفع إجمالًا؟ وضّح خطوات الحل." },
        { type: "mcq", marks: 2, text: "محيط مربع طول ضلعه 6 سم هو:", options: opts(["12 سم", "24 سم", "36 سم", "18 سم"]), correctIdx: 1 },
      ].map(({ correctIdx, ...x }) => (correctIdx === undefined ? x : { ...x, correct: [x.options[correctIdx].id] }));
      const parsed = bank.bankBulkSchema.parse({ subject_id: math.id, grade_id: seventh.grade_id, unit: "الوحدة الأولى", lesson: "مراجعة", is_shared: true, questions: Q });
      await bank.createMany(q, mathT.id, parsed);
      const qs = Q.slice(0, 6).map((x, i) => ({ ...x, id: `q_p${i}${between(100, 999)}` }));
      const body = papers.createSchema.parse({
        title: "اختبار الشهر الأول — رياضيات", subject_id: math.id, class_id: seventh.id, term_id: term1.id, exam_type: "اختبار شهري",
        exam_date: `${y0}-10-20`, duration_min: 45, total_marks: 20,
        content: { sections: [
          { id: "s_mcq1", title: "السؤال الأول: اختر الإجابة الصحيحة", instructions: "", questions: qs.filter((x) => x.type === "mcq") },
          { id: "s_tf01", title: "السؤال الثاني: ضع علامة صح أو خطأ", instructions: "", questions: qs.filter((x) => x.type === "truefalse") },
          { id: "s_fil1", title: "السؤال الثالث: أكمل الفراغ", instructions: "", questions: qs.filter((x) => x.type === "fill") },
        ] },
      });
      await papers.create(q, { role: "teacher", teacherId: mathT.id }, body, mathT.name);
    }

    progress(94, 100, "الميزات: السلوك والخدمات والاستبيانات");
    /* 14) الميزات الإضافية: السلوك، الموظفون والإجازات، التقويم، خطط الدروس، النقل، المكتبة، المخزون، العيادة، الاستبيانات، المواعيد */
    const staffRows = await q("SELECT id, full_name, category FROM staff ORDER BY id");
    const sample = (arr, n) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
    const term2Days = studyDays.filter((d) => d >= T2.start);

    // السلوك: تصنيفات المنصة الافتراضية ثم سجلات على مدى الفصل الثاني (المتميزون أكثر نقاطًا إيجابية)
    const bcats = await behavior.categories(q);
    const pos = bcats.filter((c) => c.kind === "positive"), neg = bcats.filter((c) => c.kind === "negative");
    const tOf = new Map(assignments.map((a) => [Number(a.class_id), a.t]));
    const bh = { st: [], cat: [], kind: [], pts: [], title: [], day: [], tch: [], by: [] };
    for (const st of students) {
      const n = between(0, 3) + (st.ability > 0.85 ? 2 : 0);
      for (let i = 0; i < n; i++) {
        const good = st.absentProne ? chance(0.35) : chance(0.8);
        const c = good ? pick(pos) : pick(neg);
        if (!c) continue;
        const t = tOf.get(Number(st.class_id));
        bh.st.push(st.id); bh.cat.push(c.id); bh.kind.push(c.kind); bh.pts.push(c.kind === "positive" ? c.points : -c.points);
        bh.title.push(c.name); bh.day.push(pick(term2Days)); bh.tch.push(t?.id || null); bh.by.push(t?.name || "الإدارة");
      }
    }
    await q(`INSERT INTO behavior_records (tenant_id, student_id, category_id, kind, points, title, day, term_id, teacher_id, recorded_by)
             SELECT app_tenant(), s, c, k, p, t, d::date, $9, tc, b
               FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::int[], $5::text[], $6::text[], $7::bigint[], $8::text[]) AS x(s, c, k, p, t, d, tc, b)`,
      [bh.st, bh.cat, bh.kind, bh.pts, bh.title, bh.day, bh.tch, bh.by, term2.id]);
    out.behavior_records = bh.st.length;

    // دوام الموظفين في آخر شهر من السنة + طلبات إجازة (معتمدة ومرفوضة)
    const lastMonth = studyDays.filter((d) => d >= `${y0 + 1}-05-01`);
    const sa = { st: [], day: [], status: [], late: [], cin: [] };
    for (const m of staffRows) for (const d of lastMonth) {
      const r = R();
      const status = r < 0.02 ? "absent" : r < 0.07 ? "late" : "present";
      const late = status === "late" ? between(5, 40) : null;
      sa.st.push(m.id); sa.day.push(d); sa.status.push(status); sa.late.push(late);
      sa.cin.push(status === "absent" ? null : `07:${String(status === "late" ? 15 + Math.min(late, 44) : between(0, 14)).padStart(2, "0")}`);
    }
    await q(`INSERT INTO staff_attendance (tenant_id, staff_id, day, status, late_min, check_in, check_out, recorded_by)
             SELECT app_tenant(), s, d::date, st, l, ci::time, CASE WHEN st = 'absent' THEN NULL ELSE time '13:30' END, 'الإدارة'
               FROM unnest($1::bigint[], $2::text[], $3::text[], $4::int[], $5::text[]) AS x(s, d, st, l, ci)`,
      [sa.st, sa.day, sa.status, sa.late, sa.cin]);
    const LEAVES = [["sick", "التهاب حاد في الحلق مع تقرير طبي", "approved"], ["emergency", "ظرف عائلي طارئ", "approved"],
      ["annual", "زيارة الأهل في تعز", "rejected"], ["official", "دورة تدريبية في مكتب التربية", "approved"]];
    for (const [i, [kind, reason, status]] of LEAVES.entries()) {
      const m = staffRows[(i * 7 + 3) % staffRows.length];
      const from = term2Days[20 + i * 15];
      await q(`INSERT INTO leave_requests (tenant_id, staff_id, kind, from_day, to_day, reason, status, requested_by, decided_by, decided_at, decision_note, created_at)
               VALUES (app_tenant(), $1, $2, $3::date, $3::date + $4::int, $5, $6, $7, 'مدير المدرسة', $3::date - 1, $8, $3::date - 3)`,
        [m.id, kind, from, i % 2, reason, status, m.full_name, status === "rejected" ? "فترة اختبارات، يمكن تأجيلها للإجازة" : null]);
    }

    // التقويم المدرسي
    const EV = [[`${y0}-10-15`, `${y0}-10-15`, "يوم المعلم", "activity", "all", "تكريم المعلمين في الطابور الصباحي"],
      [`${y0}-11-06`, `${y0}-11-06`, "اجتماع أولياء الأمور", "meeting", "parents", "قاعة المدرسة الساعة 4 عصرًا"],
      [`${y0}-12-10`, `${y0}-12-11`, "المعرض العلمي", "activity", "all", "مشاريع طلاب المرحلة الثانوية"],
      [`${y0 + 1}-01-04`, `${y0 + 1}-01-14`, "الاختبارات النهائية للفصل الأول", "exam", "all", null],
      [`${y0 + 1}-03-02`, `${y0 + 1}-03-02`, "اجتماع المعلمين الدوري", "meeting", "staff", "مراجعة الخطط الفصلية"],
      [`${y0 + 1}-04-10`, `${y0 + 1}-04-10`, "رحلة ساحل أبين", "trip", "all", "للصفوف العليا"],
      [`${y0 + 1}-05-20`, `${y0 + 1}-05-20`, "آخر موعد لسداد رسوم الفصل الثاني", "deadline", "parents", null],
      [`${y0 + 1}-06-01`, `${y0 + 1}-06-11`, "الاختبارات النهائية للفصل الثاني", "exam", "all", null]];
    for (const [a, b, title, kind, aud, desc] of EV) {
      await q(`INSERT INTO calendar_events (tenant_id, title, kind, starts_on, ends_on, audience, description, created_by) VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, 'الإدارة')`,
        [title, kind, a, b, aud, desc]);
    }

    // خطط الدروس: أسبوعان لعدد من المعلمين (معتمدة ومقدمة)
    for (const [i, a] of sample(assignments, 12).entries()) {
      const wk = iso(addDays(D(T2.start), 7 * (i % 4)));
      await q(`INSERT INTO lesson_plans (tenant_id, teacher_id, class_id, subject_id, week_start, topic, objectives, activities, assessment, homework, status, reviewed_by, reviewed_at)
               VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10 = 'approved' THEN 'مدير المدرسة' END, CASE WHEN $10 = 'approved' THEN $4::date END)`,
        [a.t.id, a.class_id, a.subject_id, wk, "الوحدة الثالثة — الدرس الأول", "أن يتعرف الطالب على المفاهيم الأساسية للوحدة ويطبقها في أمثلة",
         "عصف ذهني، عمل في مجموعات، حل تمارين الكتاب", "أسئلة شفهية وورقة عمل قصيرة", "تمارين صفحة 54", i % 3 ? "approved" : "submitted"]);
    }

    // النقل: ثلاث حافلات بسائقيها وركابها
    const drivers = staffRows.filter((m) => m.category === "driver");
    const ROUTES = [["خط المنصورة", "المنصورة — الشيخ عثمان — خور مكسر", ["جولة كالتكس", "سوق المنصورة", "الشيخ عثمان"]],
      ["خط كريتر", "كريتر — المعلا — خور مكسر", ["ساحة العروض", "المعلا الرئيسي", "حافون"]],
      ["خط البريقة", "البريقة — الشعب — خور مكسر", ["البريقة", "الشعب", "عمران"]]];
    let riders = 0;
    const pool = sample(students, 90);
    for (const [i, [name, route, stops]] of ROUTES.entries()) {
      const [bus] = await q(`INSERT INTO buses (tenant_id, name, plate, driver_name, driver_phone, supervisor, capacity, route, fee)
                             VALUES (app_tenant(), $1, $2, $3, $4, 'مشرف الأنشطة', 30, $5, 15000) RETURNING id`,
        [name, `عدن ${between(10000, 99999)}`, drivers[i]?.full_name || "سائق المدرسة", phone(), route]);
      const group = pool.slice(i * 30, i * 30 + between(20, 28));
      for (const st of group) {
        await q(`INSERT INTO bus_students (tenant_id, bus_id, student_id, stop, pickup_time) VALUES (app_tenant(), $1, $2, $3, $4)`,
          [bus.id, st.id, pick(stops), `6:${between(15, 50)}`]);
      }
      riders += group.length;
    }
    out.transport = { buses: ROUTES.length, riders };

    // المكتبة: كتب وإعارات (أغلبها مُرجعة)
    const BOOKS = [["قصص الأنبياء", "ابن كثير", "دينية"], ["رياض الصالحين", "النووي", "دينية"], ["كليلة ودمنة", "ابن المقفع", "أدب"],
      ["الأيام", "طه حسين", "أدب"], ["مختارات من الشعر العربي", null, "أدب"], ["موسوعة العلوم المصورة", null, "علوم"],
      ["أطلس العالم", null, "جغرافيا"], ["تاريخ اليمن", null, "تاريخ"], ["المعجم الوسيط", "مجمع اللغة العربية", "مراجع"],
      ["الرياضيات الممتعة", null, "علوم"], ["عبقريات العقاد", "عباس محمود العقاد", "أدب"], ["رجال حول الرسول", "خالد محمد خالد", "دينية"]];
    const books = [];
    for (const [i, [title, author, category]] of BOOKS.entries()) {
      const [b] = await q(`INSERT INTO library_books (tenant_id, title, author, category, shelf, copies) VALUES (app_tenant(), $1, $2, $3, $4, $5) RETURNING id`,
        [title, author, category, `${String.fromCharCode(1571 + (i % 4))}-${1 + (i % 6)}`, between(2, 6)]);
      books.push(b.id);
    }
    let loans = 0;
    for (const st of sample(students, 60)) {
      const d = pick(term2Days);
      const returned = chance(0.9);
      await q(`INSERT INTO library_loans (tenant_id, book_id, student_id, loaned_on, due_on, returned_on, created_by)
               VALUES (app_tenant(), $1, $2, $3::date, $3::date + 14, CASE WHEN $4 THEN $3::date + $5::int END, 'أمين المكتبة')`,
        [pick(books), st.id, d, returned, between(3, 16)]);
      loans++;
    }
    out.library = { books: BOOKS.length, loans };

    // المخزون والعهد
    const ITEMS = [["أقلام سبورة", "قرطاسية", "علبة", 40, 10], ["ورق تصوير A4", "قرطاسية", "كرتون", 25, 5], ["طباشير ملون", "قرطاسية", "علبة", 30, 8],
      ["جهاز عرض (بروجكتر)", "أجهزة", "جهاز", 6, 1], ["حاسوب محمول", "أجهزة", "جهاز", 10, 2], ["كرات قدم", "رياضة", "قطعة", 12, 4],
      ["منظفات", "نظافة", "لتر", 60, 20], ["كراسي طلاب", "أثاث", "قطعة", 40, 10], ["حقيبة إسعافات أولية", "العيادة", "حقيبة", 8, 2]];
    for (const [name, category, unit, qty, min] of ITEMS) {
      const [it] = await q(`INSERT INTO inventory_items (tenant_id, name, category, unit, quantity, min_quantity, location) VALUES (app_tenant(), $1, $2, $3, 0, $4, 'المخزن الرئيسي') RETURNING id`,
        [name, category, unit, min]);
      const moves = [["in", qty, null, `${y0}-09-01`, "رصيد بداية العام"]];
      if (category === "أجهزة") moves.push(["custody", 2, staffRows[0].id, `${y0}-09-10`, "عهدة للإدارة"]);
      else if (category !== "أثاث") moves.push(["out", Math.round(qty * (0.4 + R() * 0.5)), null, `${y0 + 1}-03-01`, "صرف للفصول"]);
      let bal = 0;
      for (const [kind, n, staffId, day, note] of moves) {
        bal += kind === "in" ? n : -n;
        await q(`INSERT INTO inventory_moves (tenant_id, item_id, kind, qty, staff_id, day, note, created_by) VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, 'أمين المخزن')`,
          [it.id, kind, n, staffId, day, note]);
      }
      await q("UPDATE inventory_items SET quantity = $2 WHERE id = $1", [it.id, bal]);
    }

    // العيادة: ملفات صحية لبعض الطلاب وزيارات
    const BLOOD = ["A+", "O+", "B+", "O-", "AB+", "A-"];
    for (const st of sample(students, 40)) {
      await q(`INSERT INTO health_profiles (tenant_id, student_id, blood_type, allergies, chronic, emergency_phone, updated_by) VALUES (app_tenant(), $1, $2, $3, $4, $5, 'ممرض المدرسة')`,
        [st.id, pick(BLOOD), chance(0.2) ? pick(["حساسية من الفول السوداني", "حساسية غبار", "حساسية من البنسلين"]) : null,
         chance(0.08) ? pick(["ربو", "سكري النوع الأول"]) : null, st.phone]);
    }
    const COMPLAINTS = [["صداع", "راحة وماء ومسكن خفيف"], ["ألم في البطن", "راحة ومتابعة"], ["ارتفاع حرارة", "خافض حرارة والتواصل مع ولي الأمر"],
      ["إصابة خفيفة في الملعب", "تنظيف وتضميد"], ["دوار", "راحة في العيادة"]];
    for (const st of sample(students, 35)) {
      const [complaint, action] = pick(COMPLAINTS);
      const hot = complaint === "ارتفاع حرارة";
      await q(`INSERT INTO clinic_visits (tenant_id, student_id, visited_at, complaint, action, temperature, sent_home, recorded_by)
               VALUES (app_tenant(), $1, $2::date + time '09:30', $3, $4, $5, $6, 'ممرض المدرسة')`,
        [st.id, pick(term2Days), complaint, action, hot ? 38 + between(0, 9) / 10 : 36.8, hot && chance(0.7)]);
    }

    // استبيان رضا أولياء الأمور (مغلق بنتائجه) واستبيان المنسوبين
    const SQ = [{ id: "q_rate01", type: "rating", text: "ما تقييمك العام للمدرسة؟", required: true },
      { id: "q_comm01", type: "choice", text: "أفضل وسيلة للتواصل معكم؟", required: true, options: ["إشعارات التطبيق", "واتساب", "رسالة نصية", "اتصال"] },
      { id: "q_bus001", type: "yesno", text: "هل أنتم راضون عن خدمة النقل؟", required: false },
      { id: "q_note01", type: "text", text: "اقتراحاتكم لتطوير المدرسة", required: false }];
    const [sv] = await q(`INSERT INTO surveys (tenant_id, title, description, audience, questions, anonymous, status, closes_on, created_by, created_at)
                          VALUES (app_tenant(), 'رضا أولياء الأمور — نهاية العام', 'نسعد برأيكم لتطوير المدرسة في العام القادم', 'parents', $1, false, 'closed', $2, 'الإدارة', $3::date)
                          RETURNING id`, [JSON.stringify(SQ), `${y0 + 1}-06-20`, `${y0 + 1}-06-01`]);
    const NOTES = ["زيادة الأنشطة الرياضية", "تفعيل نادي القراءة", "ممتازون، بارك الله فيكم", "تحسين المقصف المدرسي", null, null];
    const respondents = sample(students, 120);
    for (const st of respondents) {
      const a = { q_rate01: chance(0.55) ? 5 : chance(0.7) ? 4 : 3, q_comm01: chance(0.6) ? 0 : chance(0.6) ? 1 : 2 };
      if (chance(0.5)) a.q_bus001 = chance(0.8);
      const note = pick(NOTES); if (note) a.q_note01 = note;
      await q(`INSERT INTO survey_responses (tenant_id, survey_id, student_id, answers, created_at) VALUES (app_tenant(), $1, $2, $3, $4::date + time '18:00')`,
        [sv.id, st.id, JSON.stringify(a), `${y0 + 1}-06-${String(between(1, 15)).padStart(2, "0")}`]);
    }
    await q(`INSERT INTO surveys (tenant_id, title, audience, questions, anonymous, status, created_by)
             VALUES (app_tenant(), 'بيئة العمل للعام القادم', 'staff', $1, true, 'open', 'الإدارة')`,
      [JSON.stringify([{ id: "q_load01", type: "rating", text: "ما مدى رضاك عن توزيع النصاب؟", required: true },
        { id: "q_need01", type: "text", text: "ما الذي تحتاجه لتطوير أدائك؟", required: false }])]);
    out.survey_responses = respondents.length;

    // مواعيد أولياء الأمور: فترات لمعلمين في أسبوع اجتماع نهاية العام، بعضها محجوز
    let booked = 0;
    for (const t of sample(teachers, 4)) {
      for (let k = 0; k < 4; k++) {
        const [slot] = await q(`INSERT INTO meeting_slots (tenant_id, teacher_id, host_name, day, start_time, minutes, location, created_by)
                                VALUES (app_tenant(), $1, $2, $3, $4::time, 15, 'غرفة المعلمين', $2) RETURNING id`,
          [t.id, t.name, `${y0 + 1}-06-${String(14 + (k % 2)).padStart(2, "0")}`, `${9 + Math.floor(k / 2)}:${k % 2 ? "15" : "00"}`]);
        if (k < 2) {
          await q(`INSERT INTO meeting_bookings (tenant_id, slot_id, student_id, topic, status) VALUES (app_tenant(), $1, $2, $3, 'done')`,
            [slot.id, pick(students).id, pick(["مستوى الطالب في المادة", "خطة المراجعة للصيف", null])]);
          booked++;
        }
      }
    }
    out.meetings_booked = booked;

    /* 13) صفحة المدرسة العامة وقوالب الرسائل */
    await q(`UPDATE school_public_settings SET show_classes = true, show_teachers = true, show_announcements = true, show_timetable = true,
               show_contact = true, show_admissions = true,
               about = 'مدارس أهلية للبنين في عدن تضم المرحلتين الأساسية والثانوية، بكادر تعليمي متخصص وبيئة تعليمية محفزة، ونقل مدرسي لأحياء المدينة.'
             WHERE tenant_id = app_tenant()`);
    await q("INSERT INTO school_messages (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");

    await logEvent(q, { tenantId: tid, actor, action: `إنشاء مدرسة عرض كاملة (عدن): ${students.length} طالب، ${teachers.length} معلم، ${studyDays.length} يوم دراسي، عام ${y0}/${y0 + 1}` });
    progress(98, 100, "اللمسات الأخيرة");
    out.teacher_samples = creds;
    out.accountant = { username: "accountant", password: accPassword };
    out.parent_samples = students.slice(0, 3).map((s) => ({ name: s.name, class_id: s.class_id, access_key: s.key, student_id: s.id }));
    out.year = { name: `${y0}/${y0 + 1}`, start: yearStart, end: yearEnd };
    out.term = { id: term2.id, start: term2.start, end: term2.end };
    return out;
  });
}

/**
 * إكمال ما عجز عنه المولّد: كل حصة ناقصة توضع في وقت فراغ الشعبة والمعلم،
 * وإلا تُبادل مع حصة أخرى في الشعبة يمكن نقلها لوقت فارغ (تبديل واحد يكفي عادة).
 */
function fillGaps(slots, pairs, assignments, settings) {
  const teacherOf = new Map(assignments.map((a) => [`${a.class_id}:${a.subject_id}`, Number(a.t.id)]));
  const cell = new Map(slots.map((s) => [`${s.class_id}:${s.day}:${s.period}`, s]));
  const tBusy = new Set(slots.filter((s) => s.teacher_id).map((s) => `${s.teacher_id}:${s.day}:${s.period}`));
  const times = [];
  for (const day of settings.days) for (let p = 1; p <= settings.periods_per_day; p++) times.push([day, p]);
  const have = new Map();
  for (const s of slots) have.set(`${s.class_id}:${s.subject_id}`, (have.get(`${s.class_id}:${s.subject_id}`) || 0) + 1);
  const put = (s, day, period) => {
    Object.assign(s, { day, period });
    cell.set(`${s.class_id}:${day}:${period}`, s);
    if (s.teacher_id) tBusy.add(`${s.teacher_id}:${day}:${period}`);
  };
  for (const { c, s } of pairs) {
    let missing = Math.max(1, s.weekly_periods || 1) - (have.get(`${c.id}:${s.id}`) || 0);
    const tid = teacherOf.get(`${c.id}:${s.id}`) ?? null;
    const freeT = (t, d, p) => !t || !tBusy.has(`${t}:${d}:${p}`);
    while (missing > 0) {
      const slot = { class_id: c.id, day: 0, period: 0, subject_id: s.id, teacher_id: tid };
      const empty = times.find(([d, p]) => !cell.has(`${c.id}:${d}:${p}`) && freeT(tid, d, p));
      if (empty) { slots.push(slot); put(slot, ...empty); missing--; continue; }
      let done = false;
      for (const [d, p] of times) {
        const other = cell.get(`${c.id}:${d}:${p}`);
        if (!other || !freeT(tid, d, p)) continue;
        const dest = times.find(([d2, p2]) => !cell.has(`${c.id}:${d2}:${p2}`) && freeT(other.teacher_id, d2, p2));
        if (!dest) continue;
        cell.delete(`${c.id}:${d}:${p}`);
        if (other.teacher_id) tBusy.delete(`${other.teacher_id}:${d}:${p}`);
        put(other, ...dest);
        slots.push(slot); put(slot, d, p);
        done = true; break;
      }
      if (!done) break;
      missing--;
    }
  }
}
