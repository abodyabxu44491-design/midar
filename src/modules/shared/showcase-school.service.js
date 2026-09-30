// مدرسة عرض كاملة (يمنية): مدارس بنين شاملة (الأساسي والثانوي) ببيانات واقعية لفصل دراسي كامل حتى اليوم.
// يُبنى بخدمات المنصة نفسها (قالب المعالج، ربط المواد بالصفوف، توليد الجدول، الطلاب، الفواتير والسداد والقيود)
// حتى تكون المدرسة مطابقة تمامًا لمدرسة أنشأها مديرها بنفسه، مع إدخال مجمّع للبيانات الكثيرة (الحضور والدرجات).
// البيانات ثابتة بالبذرة: نفس المدخلات تعطي نفس المدرسة.
import { transaction } from "../../core/db/pool.js";
import { hashPassword } from "../../core/auth/password.js";
import { newTempPassword, newStudentKey } from "../../core/auth/codes.js";
import { sealCredential } from "../../core/auth/secret-box.js";
import { logEvent } from "../../core/audit.js";
import * as S from "./structure.service.js";
import * as academic from "./academic.service.js";
import * as gen from "./timetable-gen.service.js";
import * as finance from "./finance.service.js";

/* ---------- أسماء واقعية (بنين) ---------- */
const FIRST = ["محمد", "أحمد", "علي", "عبدالله", "عبدالرحمن", "صالح", "حسين", "ياسر", "أيمن", "وضاح", "أكرم", "هيثم", "عمار", "نبيل",
  "فؤاد", "جمال", "مراد", "شهاب", "بسام", "رشاد", "عادل", "سامي", "ماجد", "مجاهد", "زكريا", "إبراهيم", "يوسف", "خالد", "أسامة", "عمرو",
  "طارق", "عصام", "أنور", "معاذ", "براء", "أنس", "ريان", "عبدالملك", "عبدالسلام", "عبدالكريم", "صقر", "منير", "نشوان", "همدان", "أوس",
  "حمزة", "عبدالرحيم", "مصطفى", "يحيى", "فارس", "بلال", "عبدالعزيز", "محمود", "سليم", "قيس", "مهيب", "وسيم", "رامي", "ضياء", "هاشم"];
const FATHER = ["محمد", "أحمد", "علي", "عبدالله", "صالح", "حسن", "حسين", "عبده", "قاسم", "ناجي", "سعيد", "عبدالرحمن", "يحيى", "عبدالوهاب",
  "فضل", "ناصر", "مقبل", "سيف", "عبدالكريم", "عبدالجليل", "منصور", "عبدالقادر", "إسماعيل", "عبدالرزاق", "فيصل", "أمين", "شرف", "هادي", "مطهر", "غالب"];
const FAMILY = ["العريقي", "الشميري", "المخلافي", "الصبري", "الحكيمي", "العبسي", "الأغبري", "القدسي", "الشرعبي", "الحميري", "السقاف",
  "باوزير", "العولقي", "الإرياني", "الكبسي", "الأهدل", "الزبيري", "الريمي", "الوصابي", "العديني", "الحداد", "البعداني", "المقطري",
  "الذبحاني", "الجرادي", "العمودي", "الشامي", "السنباني", "الحبيشي", "اليافعي", "الهمداني", "الآنسي", "الأكوع", "العنسي", "الخولاني",
  "الصنعاني", "المحويتي", "الشرجبي", "التعزي", "الحضرمي"];
// جوال يمني: 9 أرقام تبدأ بـ 77 أو 73 أو 71 أو 70 أو 78
const PREFIX = ["77", "77", "73", "71", "70", "78"];

// مولّد أرقام ثابت بالبذرة (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

/**
 * يبني المدرسة كاملة داخل مدرسة موجودة فارغة (أنشأها createTenant للتو).
 * @returns ملخص الأرقام وحسابات عيّنة للدخول
 */
export async function buildShowcase(tid, { actor = "إعداد مدرسة العرض", ip = null, perSection = 24, seed = 2026, progress = () => {} } = {}) {
  const R = rng(seed);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const chance = (p) => R() < p;
  const phone = () => `${pick(PREFIX)}${String(Math.floor(R() * 1e7)).padStart(7, "0")}`;
  const today = new Date(`${iso(new Date())}T00:00:00Z`);
  // السنة الدراسية الحالية: من أواخر أغسطس إلى منتصف يونيو، بثلاثة فصول
  const y0 = today.getUTCMonth() >= 7 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const yearStart = new Date(Date.UTC(y0, 7, 23)), yearEnd = new Date(Date.UTC(y0 + 1, 5, 10));

  return transaction({ tenantId: tid, actor, ip }, async (q) => {
    await q("SET LOCAL statement_timeout = '120s'");
    const out = {};

    progress(5, 100, "الهيكل والسنة الدراسية");
    /* 1) ملف المدرسة والهيكل (قالب «مدرسة شاملة»، شعبتان لكل صف، ربط المواد الذكي) */
    await q(`INSERT INTO school_profile (tenant_id, school_type, gender, country, city, address, email, phone, template)
             VALUES (app_tenant(), 'private', 'boys', 'اليمن', 'صنعاء', 'حي حدة، شارع الستين الجنوبي', 'info@alrowad-school.ye', '01441234', 'full')
             ON CONFLICT (tenant_id) DO UPDATE SET school_type = 'private', gender = 'boys', country = EXCLUDED.country, city = EXCLUDED.city,
               address = EXCLUDED.address, email = EXCLUDED.email, phone = EXCLUDED.phone, template = 'full'`);
    await S.setSectionsMode(q, true);
    await S.applyCountry(q, "YE");   // رمز واتساب 967 والريال اليمني
    out.structure = await S.applyTemplate(q, { template: "full", sections_per_grade: 2, naming: "arabic", grade_set: "yemen" });
    await academic.configureYear(q, { name: `${y0}/${y0 + 1}`, start_date: iso(yearStart), end_date: iso(yearEnd), terms: 3 });
    // الفصل الحالي هو الذي يحوي اليوم
    const terms = await q("SELECT id, start_date::text, end_date::text FROM terms WHERE year_id = (SELECT id FROM academic_years WHERE is_current) ORDER BY ordinal");
    const term = terms.find((t) => iso(today) >= t.start_date && iso(today) <= t.end_date) || terms[0];
    await academic.setCurrentTerm(q, term.id);
    await gen.saveSettings(q, { days: [0, 1, 2, 3, 4], periods_per_day: 7, start_time: "07:30", period_minutes: 45, break_after: 3, break_minutes: 25 });
    // المناسبات الوطنية اليمنية الواقعة في السنة الدراسية، وإجازة قصيرة في منتصف الفصل الأول
    const holidays = [
      { name: "ثورة 26 سبتمبر", kind: "official", start_date: `${y0}-09-26`, end_date: `${y0}-09-26` },
      { name: "ثورة 14 أكتوبر", kind: "official", start_date: `${y0}-10-14`, end_date: `${y0}-10-14` },
      { name: "إجازة منتصف الفصل", kind: "mid_term", start_date: iso(addDays(yearStart, 67)), end_date: iso(addDays(yearStart, 71)) },
      { name: "عيد الاستقلال 30 نوفمبر", kind: "official", start_date: `${y0}-11-30`, end_date: `${y0}-11-30` },
      { name: "عيد الوحدة 22 مايو", kind: "official", start_date: `${y0 + 1}-05-22`, end_date: `${y0 + 1}-05-22` },
    ];
    for (const hd of holidays) await academic.addHoliday(q, { ...hd, notes: null, affects_attendance: true, show_in_calendar: true });
    await S.completeSetup(q);

    const classes = await q(`SELECT c.id, c.name, c.grade_id, g.name AS grade_name, g.sort_order AS g_order, st.code AS stage
                               FROM classes c JOIN grades g ON g.id = c.grade_id JOIN stages st ON st.id = g.stage_id
                              ORDER BY st.sort_order, g.sort_order, c.sort_order, c.id`);
    const subjects = await q(`SELECT s.id, s.name, s.weekly_periods, array_agg(sg.grade_id) AS grades
                                FROM subjects s JOIN subject_grades sg ON sg.subject_id = s.id WHERE s.is_active GROUP BY s.id ORDER BY s.sort_order, s.id`);

    progress(12, 100, "المعلمون وإسناد المواد");
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
          const name = `أ. ${personName()}`;
          cur = { name, subject: p.s.name, stage: p.c.stage, username: `t${seq}`, employee_no: `EMP-${seq}` };
          seq++; load = 0;
          teachers.push(cur);
        }
        load += w;
        assignments.push({ t: cur, class_id: p.c.id, subject_id: p.s.id });
      }
    }
    const STAGE_AR = { primary: "الأساسي (1–6)", middle: "الأساسي (7–9)", secondary: "الثانوي" };
    const QUAL = ["بكالوريوس", "بكالوريوس تربوي", "ماجستير", "بكالوريوس مع دبلوم تربوي"];
    const creds = [];
    for (const t of teachers) {
      const [row] = await q(
        `INSERT INTO teachers (tenant_id, full_name, phone, employee_no, email, specialty, department, job_title, qualification, hire_date, employment_type, gender)
         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, 'معلم', $7, $8, 'full_time', 'male') RETURNING id`,
        [t.name, phone(), t.employee_no, `${t.username}@alrowad-school.ye`, t.subject,
         STAGE_AR[t.stage] || null, pick(QUAL), iso(addDays(today, -Math.floor(365 * (1 + R() * 12))))]);
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

    progress(22, 100, "الجدول الدراسي");
    /* 3) الجدول الدراسي: مولّد المنصة نفسه، ثم حفظ مجمّع */
    const draft = await gen.generate(q, { replace: true });
    fillGaps(draft.slots, pairs, assignments, draft.settings);
    const rooms = new Map(classes.map((c, i) => [Number(c.id), `قاعة ${101 + i}`]));
    await q(`INSERT INTO timetable_slots (tenant_id, class_id, day, period, subject_id, teacher_id, room)
             SELECT app_tenant(), * FROM unnest($1::bigint[], $2::int[], $3::int[], $4::bigint[], $5::bigint[], $6::text[])`,
      [draft.slots.map((s) => s.class_id), draft.slots.map((s) => s.day), draft.slots.map((s) => s.period),
       draft.slots.map((s) => s.subject_id), draft.slots.map((s) => s.teacher_id), draft.slots.map((s) => rooms.get(Number(s.class_id)))]);
    out.periods = draft.slots.length;

    progress(30, 100, "الطلاب وأولياء الأمور");
    /* 4) الطلاب: أعمار مناسبة لكل صف، إخوة بجوال ولي أمر واحد، أرقام طلاب متسلسلة */
    const students = [];
    const keys = new Set();
    let no = 1;
    const families = [];
    for (const c of classes) {
      const stageBase = { primary: 6, middle: 12, secondary: 15 }[c.stage] ?? 6;
      const age = stageBase + (Number(c.g_order) - 1);
      const size = perSection - 2 + Math.floor(R() * 5);
      for (let i = 0; i < size; i++) {
        // ثلث الطلاب لهم أخ في المدرسة (نفس الأب والعائلة والجوال)
        let fam = families.length && chance(0.3) ? pick(families) : null;
        if (!fam || fam.kids >= 3) {
          fam = { father: pick(FATHER), grand: pick(FATHER), family: pick(FAMILY), phone: phone(), kids: 0 };
          families.push(fam);
        }
        let first;
        do { first = pick(FIRST); } while (first === fam.father);
        fam.kids++;
        let key; do { key = newStudentKey(); } while (keys.has(key)); keys.add(key);
        const born = addDays(new Date(Date.UTC(y0 - age, 0, 1)), Math.floor(R() * 365));
        students.push({ class_id: c.id, stage: c.stage, name: `${first} ${fam.father} ${fam.grand} ${fam.family}`,
          guardian: `${fam.father} ${fam.grand} ${fam.family}`, phone: fam.phone, key, no: `${y0}${String(no++).padStart(4, "0")}`,
          birth: iso(born), ability: 0.55 + R() * 0.43, absentProne: chance(0.08) });
      }
    }
    const ids = await q(`INSERT INTO students (tenant_id, class_id, full_name, guardian_name, guardian_phone, access_key, fees_enabled, student_no, birth_date, gender, created_at)
                          SELECT app_tenant(), c, n, g, p, k, true, sn, b::date, 'male', $8::date + time '08:00'
                            FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS x(c, n, g, p, k, sn, b)
                          RETURNING id`,
      [students.map((s) => s.class_id), students.map((s) => s.name), students.map((s) => s.guardian), students.map((s) => s.phone),
       students.map((s) => s.key), students.map((s) => s.no), students.map((s) => s.birth), iso(addDays(yearStart, -20))]);
    students.forEach((s, i) => { s.id = ids[i].id; });
    out.students = students.length;

    progress(38, 100, "الحضور اليومي");
    /* 5) الحضور لكل يوم دراسي من بداية الفصل حتى اليوم (بلا الإجازات)، مع أسباب لبعض الغياب */
    const REASONS = ["مراجعة طبية", "ظرف عائلي", "مرض", "سفر مع الأسرة", "موعد في المستشفى"];
    const off = new Set();
    for (const hd of holidays) for (let d = new Date(`${hd.start_date}T00:00:00Z`); iso(d) <= hd.end_date; d = addDays(d, 1)) off.add(iso(d));
    let days = 0, attRows = 0;
    const teacherOfClass = new Map(assignments.map((a) => [Number(a.class_id), a.t.name]));
    for (let d = new Date(`${term.start_date}T00:00:00Z`); d <= today; d = addDays(d, 1)) {
      if (d.getUTCDay() > 4 || off.has(iso(d))) continue;
      days++;
      const rows = { id: [], st: [], ex: [], by: [] };
      for (const s of students) {
        const r = R();
        const pa = s.absentProne ? 0.14 : 0.03;
        const st = r < pa ? "absent" : r < pa + 0.025 ? "late" : r < pa + 0.035 ? "excused" : "present";
        rows.id.push(s.id); rows.st.push(st);
        rows.ex.push(st === "excused" || (st === "absent" && chance(0.3)) ? pick(REASONS) : st === "late" && chance(0.4) ? "زحام مروري" : null);
        rows.by.push(teacherOfClass.get(Number(s.class_id)) || "الإدارة");
      }
      await q(`INSERT INTO attendance (tenant_id, student_id, day, status, excuse, recorded_by)
               SELECT app_tenant(), sid, $1::date, st, ex, rb FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[]) AS x(sid, st, ex, rb)`,
        [iso(d), rows.id, rows.st, rows.ex, rows.by]);
      attRows += rows.id.length;
      progress(38 + Math.min(16, days / 4), 100);
    }
    out.school_days = days; out.attendance = attRows;

    progress(55, 100, "الاختبارات والدرجات");
    /* 6) الاختبارات والدرجات: اختبار قصير وشهري لكل مادة في كل شعبة، منشورة، والدرجة حسب مستوى الطالب */
    const byClass = new Map();
    for (const s of students) { if (!byClass.has(Number(s.class_id))) byClass.set(Number(s.class_id), []); byClass.get(Number(s.class_id)).push(s); }
    const termStart = new Date(`${term.start_date}T00:00:00Z`);
    const elapsed = Math.max(7, Math.floor((today - termStart) / 86400000));
    const examPlan = [["اختبار قصير 1", 10, 0.35], ["اختبار شهري", 20, 0.8]].filter(([, , at]) => elapsed * at >= 7);
    let exams = 0, scoreRows = 0;
    const examIds = [];
    for (const a of assignments) {
      for (const [title, max, at] of examPlan) {
        const date = addDays(termStart, Math.floor(elapsed * at));
        const [e] = await q(`INSERT INTO exams (tenant_id, class_id, subject_id, title, exam_date, max_score, status, created_by, published_at, term_id)
                             VALUES (app_tenant(), $1, $2, $3, $4, $5, 'draft', $6, NULL, $7) RETURNING id`,
          [a.class_id, a.subject_id, title, iso(date), max, a.t.name, term.id]);
        examIds.push(e.id);
        const kids = byClass.get(Number(a.class_id)) || [];
        const sc = kids.map((k) => Math.max(0, Math.min(max, Math.round((k.ability + (R() - 0.5) * 0.25) * max * 2) / 2)));
        await q(`INSERT INTO scores (tenant_id, exam_id, student_id, score, updated_by)
                 SELECT app_tenant(), $1, sid, sc, $2 FROM unnest($3::bigint[], $4::numeric[]) AS x(sid, sc)`, [e.id, a.t.name, kids.map((k) => k.id), sc]);
        exams++; scoreRows += kids.length;
        progress(55 + (20 * exams) / (assignments.length * examPlan.length), 100);
      }
    }
    // النشر بعد إدخال الدرجات (الدرجات تُقفل عند النشر)، ثم تاريخ النشر يوم الاختبار
    await q("UPDATE exams SET status = 'published' WHERE id = ANY($1::bigint[])", [examIds]);
    await q("UPDATE exams SET published_at = exam_date + time '13:00' WHERE id = ANY($1::bigint[])", [examIds]);
    out.exams = exams; out.scores = scoreRows;

    progress(75, 100, "الواجبات");
    /* 7) الواجبات: واجبان لكل شعبة في مادتين أساسيتين، مع التسليم */
    let hw = 0;
    const HW = ["حل تمارين الدرس", "مراجعة الوحدة الأولى", "بحث قصير", "ورقة عمل", "تلخيص الدرس"];
    for (const c of classes) {
      const mine = assignments.filter((a) => Number(a.class_id) === Number(c.id)).slice(0, 2);
      for (const a of mine) {
        const due = addDays(today, -Math.floor(R() * 10) - 1);
        const [w] = await q(`INSERT INTO assignments (tenant_id, class_id, subject_id, teacher_id, title, details, due_date, created_by, term_id)
                             VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [a.class_id, a.subject_id, a.t.id, pick(HW), "تُسلَّم في الحصة القادمة.", iso(due), a.t.name, term.id]);
        const kids = byClass.get(Number(c.id)) || [];
        await q(`INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, submitted, marked_by)
                 SELECT app_tenant(), $1, sid, sub, $2 FROM unnest($3::bigint[], $4::bool[]) AS x(sid, sub)`,
          [w.id, a.t.name, kids.map((k) => k.id), kids.map((k) => R() < k.ability + 0.1)]);
        hw++;
      }
    }
    out.homework = hw;

    progress(80, 100, "الرسوم والسداد");
    /* 8) الرسوم: فاتورة الفصل لكل طالب حسب المرحلة، وسداد واقعي (كامل، جزئي، لم يسدد) بإيصالات وقيود */
    // رسوم الفصل بالريال اليمني، وحساب في بنك محلي ومحفظة إلكترونية (برقم حساب بلا آيبان كما هو الواقع)
    const FEES = { primary: 90000, middle: 110000, secondary: 130000 };
    await q(`INSERT INTO payment_accounts (tenant_id, bank_name, account_holder, account_number) VALUES
               (app_tenant(), 'بنك الكريمي', 'مدارس الرواد الأهلية', '3012045871'),
               (app_tenant(), 'محفظة جوالي', 'مدارس الرواد الأهلية', '777000123')`);
    const invIds = await q(`INSERT INTO invoices (tenant_id, student_id, title, amount, due_date, created_by, term_id)
                             SELECT app_tenant(), sid, 'رسوم الفصل الدراسي الأول', amt, $3::date, 'المحاسب', $4 FROM unnest($1::bigint[], $2::numeric[]) AS x(sid, amt)
                             RETURNING id, student_id, amount`,
      [students.map((s) => s.id), students.map((s) => FEES[s.stage] ?? 100000), iso(addDays(termStart, 45)), term.id]);
    let paid = 0, partial = 0;
    for (const [i, inv] of invIds.entries()) {
      progress(80 + (15 * i) / invIds.length, 100);
      const r = R();
      if (r < 0.7) { paid++; await finance.recordPayment(q, { invoiceId: inv.id, amount: inv.amount, method: pick(["transfer", "cash", "card"]), note: null, idempotencyKey: `showcase-${tid}-${i}-a`, actor: "المحاسب" }); }
      else if (r < 0.88) { partial++; await finance.recordPayment(q, { invoiceId: inv.id, amount: Math.round(inv.amount / 2000) * 1000, method: pick(["transfer", "cash"]), note: "الدفعة الأولى", idempotencyKey: `showcase-${tid}-${i}-b`, actor: "المحاسب" }); }
    }
    out.invoices = invIds.length; out.paid = paid; out.partial = partial;

    progress(95, 100, "التعاميم والتنبيهات");
    /* 9) التعاميم والتنبيهات */
    const ANN = [
      ["بداية الفصل الدراسي", "نرحب بأبنائنا الطلاب في بداية الفصل الدراسي، ونتمنى لهم عامًا حافلًا بالتميز."],
      ["اجتماع أولياء الأمور", "يُعقد اجتماع أولياء الأمور يوم الخميس القادم الساعة السابعة مساءً في مسرح المدرسة."],
      ["الاختبارات الشهرية", "تبدأ الاختبارات الشهرية الأسبوع القادم وفق الجدول المعلن في ملف الطالب."],
      ["الزي المدرسي", "نذكّر بالالتزام بالزي المدرسي الرسمي والحضور قبل الساعة 7:30 صباحًا."],
      ["إجازة 26 سبتمبر", "إجازة رسمية بمناسبة عيد ثورة 26 سبتمبر المجيدة، ويستأنف الدوام في اليوم التالي."],
    ];
    for (const [t, b] of ANN) await q("INSERT INTO announcements (tenant_id, title, body, created_by) VALUES (app_tenant(), $1, $2, 'الإدارة')", [t, b]);
    const top = [...students].sort((a, b) => b.ability - a.ability).slice(0, 12);
    for (const s of top) await q(`INSERT INTO student_alerts (tenant_id, student_id, kind, level, title, body, for_parent, created_by)
      VALUES (app_tenant(), $1, 'praise', 'positive', 'تميز دراسي', 'حصل على درجات متميزة في الاختبارات الشهرية، نفخر به.', true, 'الإدارة')`, [s.id]);
    const risky = students.filter((s) => s.absentProne).slice(0, 10);
    for (const s of risky) await q(`INSERT INTO student_alerts (tenant_id, student_id, kind, level, title, body, for_parent, created_by)
      VALUES (app_tenant(), $1, 'attendance', 'warning', 'تكرار الغياب', 'نأمل متابعة انتظام الطالب في الحضور والتواصل مع المرشد الطلابي.', true, 'المرشد الطلابي')`, [s.id]);

    progress(98, 100, "صفحة المدرسة");
    /* 10) صفحة المدرسة العامة وقوالب الرسائل */
    await q(`INSERT INTO school_public_settings (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING`);
    await q(`UPDATE school_public_settings SET show_classes = true, show_teachers = true, show_announcements = true, show_timetable = true,
               show_contact = true, about = 'مجمع مدارس أهلية للبنين يضم المراحل الابتدائية والمتوسطة والثانوية، بكادر تعليمي متخصص وبيئة تعليمية محفزة.'
             WHERE tenant_id = app_tenant()`);
    await q("INSERT INTO school_messages (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");

    await logEvent(q, { tenantId: tid, actor, action: `إنشاء مدرسة عرض كاملة: ${students.length} طالب، ${teachers.length} معلم، ${days} يوم دراسي` });
    out.teacher_samples = creds;
    out.parent_samples = students.slice(0, 3).map((s) => ({ name: s.name, class_id: s.class_id, access_key: s.key, student_id: s.id }));
    out.term = { id: term.id, start: term.start_date, end: term.end_date };
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
