// استيراد الطلاب من Excel/CSV: تحليل (بدون أي كتابة) ← تأكيد ← نتيجة.
// القواعد:
//   • التعرّف على الطالب الموجود برقم الطالب (أو معرّف الطالب) فقط، ولا يُعتمد على الاسم وحده أبدًا.
//   • الصف يُطابَق بذكاء، وأي التباس يُعرض على المستخدم ليختار (لا تخمين).
//   • الأسطر الخاطئة تُتجاوز وتُسجَّل في تقرير، والأسطر الصحيحة تُحفظ كلها في معاملة واحدة.
import { badRequest } from "../../core/http/errors.js";
import * as students from "./students.service.js";
import { cleanName, normalizePhone } from "./students.service.js";
import { structure } from "./structure.service.js";
import { buildXlsx } from "../../core/xlsx.js";
import { norm, buildIndex, matchGrade, pickSection } from "./grade-match.js";

/* ---------- الأعمدة ---------- */
export const COLUMNS = [
  { key: "student_no", header: "رقم الطالب", aliases: ["رقم الطالب", "الرقم الاكاديمي", "رقم القيد", "الرقم", "student no", "student id", "id"] },
  { key: "name", header: "اسم الطالب", required: true, aliases: ["اسم الطالب", "الاسم", "الاسم الكامل", "name", "student name", "full name"] },
  { key: "birth_date", header: "تاريخ الميلاد", aliases: ["تاريخ الميلاد", "الميلاد", "birth date", "dob", "date of birth"] },
  { key: "gender", header: "الجنس", aliases: ["الجنس", "النوع", "gender", "sex"] },
  { key: "stage", header: "المرحلة", aliases: ["المرحله", "stage"] },
  { key: "grade", header: "الصف", aliases: ["الصف", "grade", "level"] },
  { key: "section", header: "الشعبة", aliases: ["الشعبه", "section"] },
  { key: "guardian_name", header: "اسم ولي الأمر", aliases: ["اسم ولي الامر", "ولي الامر", "guardian", "guardian name", "parent name"] },
  { key: "guardian_phone", header: "جوال ولي الأمر", aliases: ["جوال ولي الامر", "رقم ولي الامر", "هاتف ولي الامر", "guardian phone", "parent phone"] },
  { key: "student_phone", header: "جوال الطالب", aliases: ["جوال الطالب", "هاتف الطالب", "student phone"] },
  { key: "fees_enabled", header: "الرسوم (نعم/لا)", aliases: ["الرسوم", "الرسوم نعم لا", "fees"] },
  // أعمدة قديمة تبقى مقبولة
  { key: "class_legacy", header: "الفصل", hidden: true, aliases: ["الفصل", "class"] },
  { key: "access_key", header: "معرّف الطالب", hidden: true, aliases: ["معرف الطالب", "المعرف", "access key"] },
];
const ALIAS = new Map();
for (const c of COLUMNS) for (const a of c.aliases) ALIAS.set(norm(a), c.key);

function mapRow(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const key = ALIAS.get(norm(String(k).replace(/[*：:]/g, " ")));
    if (!key || out[key] !== undefined && String(out[key]).trim() !== "") continue;
    out[key] = v === null || v === undefined ? "" : typeof v === "string" ? v.trim() : String(v);
  }
  return out;
}

/* ---------- تحويل القيم ---------- */
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const latin = (v) => String(v ?? "").replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).trim();
const YES = ["نعم", "yes", "true", "1", "y", "✓", "مفعل", "مفعلة"];
const NO = ["لا", "no", "false", "0", "n", "موقوف", "موقوفة"];
const GENDER = new Map([["ذكر", "male"], ["ولد", "male"], ["male", "male"], ["m", "male"], ["طالب", "male"],
  ["انثى", "female"], ["أنثى", "female"], ["بنت", "female"], ["female", "female"], ["f", "female"], ["طالبة", "female"]]);

function parseDate(v) {
  const s = latin(v);
  if (!s) return { value: undefined };
  let y, m, d, x;
  if ((x = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) [y, m, d] = [x[1], x[2], x[3]];
  else if ((x = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) [d, m, y] = [x[1], x[2], x[3]];
  else if (/^\d{4,6}(\.\d+)?$/.test(s) && Number(s) > 10000 && Number(s) < 80000) {     // رقم تسلسلي من Excel
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else return { error: `تاريخ الميلاد «${s}» غير مفهوم (استخدم 2015-03-28)` };
  y = Number(y); m = Number(m); d = Number(d);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { error: `تاريخ الميلاد «${s}» غير موجود في التقويم` };
  if (y < 1990 || dt > new Date()) return { error: `تاريخ الميلاد «${s}» خارج المدى المعقول` };
  return { value: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

/** مفتاح مطابقة الصف الملتبس: نص الصف + المرحلة، ليُحفظ اختيار المستخدم مرة واحدة لكل قيمة */
export const gradeKey = (grade, stage) => `${norm(grade)}|${norm(stage)}`;

/**
 * تحليل الملف بلا أي كتابة.
 * @param {{gradeMap?:Record<string,number>, includeDuplicates?:boolean}} opts
 */
export async function analyze(q, tenant, rawRows, { gradeMap = {}, includeDuplicates = false } = {}) {
  const struct = await structure(q);
  const index = buildIndex(struct);
  const gradeById = new Map(index.map((g) => [g.grade_id, g]));
  const sectionsEnabled = struct.sections_enabled;
  const rows = rawRows.map(mapRow);

  // بحث دفعة واحدة عن الموجودين (رقم الطالب/المعرّف) وعن التكرار المحتمل (الاسم + جوال ولي الأمر)
  const nos = [...new Set(rows.map((r) => latin(r.student_no)).filter(Boolean))];
  const keys = [...new Set(rows.map((r) => String(r.access_key || "").toUpperCase()).filter(Boolean))];
  const phones = [...new Set(rows.map((r) => normalizePhone(r.guardian_phone)).filter(Boolean))];
  const cols = `id, student_no, full_name, class_id, guardian_name, guardian_phone, birth_date::text AS birth_date, gender, student_phone, fees_enabled, status, access_key`;
  const existing = nos.length || keys.length
    ? await q(`SELECT ${cols} FROM students WHERE student_no = ANY($1::text[]) OR access_key = ANY($2::text[])`, [nos, keys]) : [];
  const byNo = new Map(existing.filter((s) => s.student_no).map((s) => [s.student_no, s]));
  const byKey = new Map(existing.map((s) => [s.access_key, s]));
  const sameGuardian = phones.length ? await q(`SELECT ${cols} FROM students WHERE guardian_phone = ANY($1::text[])`, [phones]) : [];

  const seenNo = new Map();
  const ambiguities = new Map();
  const out = [];

  rows.forEach((r, i) => {
    const res = { row: i + 2, status: "ok", action: "create", errors: [], notes: [], name: cleanName(r.name), student_no: latin(r.student_no) || null };
    const data = {};
    const fail = (m) => res.errors.push(m);

    // الاسم
    if (!res.name) fail("اسم الطالب مطلوب");
    else if (res.name.length < 2 || res.name.length > 120) fail("اسم الطالب يجب أن يكون بين 2 و120 حرفًا");
    else data.name = res.name;

    // رقم الطالب: لا يتكرر داخل الملف
    if (res.student_no) {
      if (res.student_no.length > 30) fail("رقم الطالب أطول من 30 خانة");
      else if (seenNo.has(res.student_no)) fail(`رقم الطالب «${res.student_no}» مكرر في السطر ${seenNo.get(res.student_no)}`);
      else seenNo.set(res.student_no, res.row);
    }

    // تاريخ الميلاد، الجنس، الجوالات، الرسوم
    const bd = parseDate(r.birth_date);
    if (bd.error) fail(bd.error); else if (bd.value) data.birth_date = bd.value;
    const g = norm(r.gender) ? GENDER.get(String(r.gender).trim().toLowerCase()) || GENDER.get(String(r.gender).trim()) : undefined;
    if (norm(r.gender) && !g) fail(`الجنس «${r.gender}» غير مفهوم (ذكر/أنثى)`); else if (g) data.gender = g;
    for (const [k, label] of [["guardian_phone", "جوال ولي الأمر"], ["student_phone", "جوال الطالب"]]) {
      if (!String(r[k] || "").trim()) continue;
      const p = normalizePhone(r[k]);
      if (!p || p.replace(/\D/g, "").length < 7) fail(`${label} «${r[k]}» غير صالح`); else data[k] = p;
    }
    const gn = cleanName(r.guardian_name); if (gn) data.guardian_name = gn.slice(0, 120);
    const fe = String(r.fees_enabled || "").trim().toLowerCase();
    if (fe) { if (YES.includes(fe)) data.fees_enabled = true; else if (NO.includes(fe)) data.fees_enabled = false; else fail(`قيمة الرسوم «${r.fees_enabled}» غير مفهومة (نعم/لا)`); }

    // الصف والشعبة
    const gradeText = String(r.grade || r.class_legacy || "").trim();
    if (gradeText) {
      const m = matchGrade(index, { grade: gradeText, stage: r.stage || "", section: r.section || "" });
      let grade = m.status === "exact" ? m.grade : null;
      let sectionText = m.section_text;
      let directClass = m.class_id;
      if (m.status === "ambiguous") {
        const key = gradeKey(gradeText, r.stage || "");
        const chosen = gradeMap[key] ? gradeById.get(Number(gradeMap[key])) : null;
        if (chosen && m.candidates.some((c) => c.grade_id === chosen.grade_id)) grade = chosen;
        else {
          res.status = "review"; res.review = "grade";
          res.notes.push(`الصف «${gradeText}» يحتمل أكثر من صف`);
          const a = ambiguities.get(key) || { key, value: gradeText, stage: String(r.stage || ""), candidates: m.candidates, count: 0 };
          a.count++; ambiguities.set(key, a);
        }
      } else if (m.status === "none") fail(`الصف «${gradeText}» غير موجود في هيكل المدرسة`);
      if (grade) {
        const sec = directClass ? { status: "ok", class_id: directClass } : pickSection(grade, sectionText, sectionsEnabled);
        if (sec.status === "ok") { data.class_id = sec.class_id; res.grade_label = grade.grade_name; res.section_label = sectionsEnabled ? grade.sections.find((s) => s.id === sec.class_id)?.name : null; res.stage_label = grade.stage_name; }
        else if (sec.status === "no_sections") fail(`الصف «${grade.grade_name}» بلا شعب. أنشئ شعبة له من الهيكل الأكاديمي`);
        else if (sec.status === "need_section") fail(`حدّد الشعبة للصف «${grade.grade_name}» (${sec.options.map((s) => s.short || s.name).join("، ")})`);
        else fail(`الشعبة «${r.section || sectionText}» غير موجودة في الصف «${grade.grade_name}»`);
      }
    } else if (String(r.section || "").trim()) fail("الشعبة مكتوبة بدون صف");

    // التعرّف على الطالب: رقم الطالب ثم المعرّف. الاسم وحده لا يكفي أبدًا.
    const ex = (res.student_no && byNo.get(res.student_no)) || (r.access_key && byKey.get(String(r.access_key).toUpperCase())) || null;
    if (r.access_key && !ex && !res.errors.length) fail(`المعرّف «${r.access_key}» لا يطابق أي طالب`);
    if (ex) {
      res.action = "update"; res.existing_id = ex.id;
      if (ex.status !== "active") res.notes.push("الطالب خارج القيد حاليًا (تُحدَّث بياناته فقط)");
      if (data.name && norm(data.name) !== norm(ex.full_name)) res.notes.push(`الاسم يتغير من «${ex.full_name}»`);
      const changes = {};
      const cmp = { name: ex.full_name, class_id: ex.class_id && Number(ex.class_id), guardian_name: ex.guardian_name, guardian_phone: ex.guardian_phone,
        birth_date: ex.birth_date, gender: ex.gender, student_phone: ex.student_phone, fees_enabled: ex.fees_enabled };
      for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== cmp[k]) changes[k] = v;
      data.__changes = changes;
      if (!Object.keys(changes).length && !res.errors.length) res.action = "unchanged";
    } else if (!res.errors.length) {
      // طالب جديد: ننبّه إن وُجد طالب بنفس الاسم وجوال ولي الأمر (تكرار محتمل) — لا ندمج تلقائيًا
      const dup = data.guardian_phone && sameGuardian.find((s) => s.guardian_phone === data.guardian_phone && norm(s.full_name) === norm(data.name));
      if (dup && !res.student_no) {
        if (includeDuplicates) res.notes.push(`أُضيف رغم تشابهه مع «${dup.full_name}»`);
        else { res.status = "review"; res.review = res.review || "duplicate"; res.action = "skip";
          res.notes.push(`يشبه طالبًا مسجلًا (${dup.full_name}) بنفس جوال ولي الأمر — أضف رقم الطالب لتحديثه، أو اسمح بإضافته كجديد`); }
      }
    }

    if (res.errors.length) { res.status = "error"; res.action = "skip"; }
    else if (res.status === "review") res.action = "skip";
    res.data = data;
    res.preview = { name: res.name, student_no: res.student_no, stage: res.stage_label || "", grade: res.grade_label || "", section: res.section_label || "",
      guardian_name: data.guardian_name || "", guardian_phone: data.guardian_phone || "" };
    out.push(res);
  });

  const count = (f) => out.filter(f).length;
  const willCreate = count((r) => r.status === "ok" && r.action === "create");
  const [{ n: active }] = await q("SELECT count(*)::int AS n FROM students WHERE archived_at IS NULL");
  return {
    summary: {
      total: out.length, valid: count((r) => r.status === "ok"), review: count((r) => r.status === "review"), errors: count((r) => r.status === "error"),
      create: willCreate, update: count((r) => r.status === "ok" && r.action === "update"), unchanged: count((r) => r.status === "ok" && r.action === "unchanged"),
    },
    capacity: { max: tenant.max_students, active, after: active + willCreate, exceeded: active + willCreate > tenant.max_students },
    ambiguities: [...ambiguities.values()],
    rows: out.map(({ data, ...r }) => r),
    _internal: out,
  };
}

/** التنفيذ: يعيد التحليل من الصفر في الخادم (لا يثق بما حلّله المتصفح) ثم يكتب الأسطر الصحيحة فقط */
export async function commit(q, tenant, rawRows, opts = {}) {
  const a = await analyze(q, tenant, rawRows, opts);
  if (a.capacity.exceeded) throw badRequest(`الاستيراد سيتجاوز حد الباقة (${a.capacity.max} طالب). المسجل حاليًا ${a.capacity.active} والجديد ${a.summary.create}.`);
  const [{ t: startedAt }] = await q("SELECT now() AS t");
  const rows = a._internal;
  const creates = rows.filter((r) => r.status === "ok" && r.action === "create");
  const updates = rows.filter((r) => r.status === "ok" && r.action === "update");

  const total = creates.length + updates.length;
  const report = (n) => opts.onProgress?.(n, total);
  const createdRows = creates.length ? await students.create(q, tenant, creates.map((r) => ({
    name: r.data.name, class_id: r.data.class_id ?? null, guardian_name: r.data.guardian_name ?? null, guardian_phone: r.data.guardian_phone ?? null,
    fees_enabled: r.data.fees_enabled ?? false, student_no: r.student_no, birth_date: r.data.birth_date ?? null, gender: r.data.gender ?? null,
    student_phone: r.data.student_phone ?? null })), report) : [];

  const COLUMN = { name: "full_name", class_id: "class_id", guardian_name: "guardian_name", guardian_phone: "guardian_phone", birth_date: "birth_date",
    gender: "gender", student_phone: "student_phone", fees_enabled: "fees_enabled" };
  let updated = 0;
  for (const r of updates) {
    const sets = [], vals = [r.existing_id];
    for (const [k, v] of Object.entries(r.data.__changes)) { vals.push(v); sets.push(`${COLUMN[k]} = $${vals.length}`); }
    await q(`UPDATE students SET ${sets.join(", ")} WHERE id = $1`, vals);
    report(createdRows.length + ++updated);
  }

  const failed = rows.filter((r) => r.status !== "ok");
  return {
    created: createdRows.length, updated: updates.length,
    unchanged: rows.filter((r) => r.status === "ok" && r.action === "unchanged").length,
    skipped: failed.length,
    problems: failed.map((r) => ({ row: r.row, name: r.name, student_no: r.student_no, status: r.status,
      message: [...r.errors, ...r.notes].join(" — ") })),
    started_at: startedAt,
  };
}

/* ---------- القالب ---------- */
const HEADERS = COLUMNS.filter((c) => !c.hidden);
const COL_INDEX = Object.fromEntries(HEADERS.map((c, i) => [c.key, i]));

/**
 * قالب Excel. بدون تحديد صف: قالب عام فارغ. مع صف (وشعبة اختيارية): أعمدة المرحلة والصف والشعبة معبّأة مسبقًا.
 * existing=true يضيف الطلاب الحاليين لذلك الصف، فيكون الملف نفسه أداة تحديث (رقم الطالب هو المفتاح).
 */
export async function buildTemplate(q, { grade_id, class_id, existing = false } = {}) {
  const struct = await structure(q);
  const index = buildIndex(struct);
  const sectionsEnabled = struct.sections_enabled;
  const stages = struct.stages.map((s) => s.name);
  let target = null, section = null;
  if (class_id) {
    for (const g of index) { const s = g.sections.find((x) => x.id === Number(class_id)); if (s) { target = g; section = s; } }
    if (!target) throw badRequest("الشعبة غير موجودة");
  } else if (grade_id) {
    target = index.find((g) => g.grade_id === Number(grade_id));
    if (!target) throw badRequest("الصف غير موجود");
  }

  const blank = () => HEADERS.map(() => "");
  // اسم الشعبة المختصر داخل صفها: «الأول - أ» ← «أ»
  const shortName = (c, g) => c.name.replace(g.grade_name, "").replace(/^[\s\-–—]+/, "") || c.name;
  let rows = [];
  if (target) {
    const classIds = section ? [section.id] : target.sections.map((s) => s.id);
    if (existing && classIds.length) {
      const list = await q(
        `SELECT s.student_no, s.full_name, s.birth_date::text AS birth_date, s.gender, s.guardian_name, s.guardian_phone, s.student_phone, s.fees_enabled, s.class_id
           FROM students s WHERE s.class_id = ANY($1::bigint[]) AND s.status = 'active' ORDER BY s.class_id, s.full_name`, [classIds]);
      rows = list.map((s) => {
        const r = blank();
        r[COL_INDEX.student_no] = s.student_no || ""; r[COL_INDEX.name] = s.full_name; r[COL_INDEX.birth_date] = s.birth_date || "";
        r[COL_INDEX.gender] = s.gender === "male" ? "ذكر" : s.gender === "female" ? "أنثى" : "";
        r[COL_INDEX.stage] = target.stage_name; r[COL_INDEX.grade] = target.grade_name;
        const cls = target.sections.find((x) => x.id === Number(s.class_id));
        r[COL_INDEX.section] = sectionsEnabled && cls ? shortName(cls, target) : "";
        r[COL_INDEX.guardian_name] = s.guardian_name || ""; r[COL_INDEX.guardian_phone] = s.guardian_phone || ""; r[COL_INDEX.student_phone] = s.student_phone || "";
        r[COL_INDEX.fees_enabled] = s.fees_enabled ? "نعم" : "لا";
        return r;
      });
    }
    // صفوف فارغة جاهزة للكتابة، بالمرحلة والصف (والشعبة إن اختيرت) معبّأة
    for (let i = 0; i < 40; i++) {
      const r = blank();
      r[COL_INDEX.stage] = target.stage_name; r[COL_INDEX.grade] = target.grade_name;
      if (sectionsEnabled && section) r[COL_INDEX.section] = shortName(section, target);
      rows.push(r);
    }
  }

  const gradeLines = index.flatMap((g) => [[g.stage_name, g.grade_name, sectionsEnabled ? g.sections.map((s) => shortName(s, g)).join("، ") : ""]]);
  const sheet1 = {
    name: "الطلاب", headers: HEADERS.map((c) => c.header + (c.required ? " *" : "")), rows,
    widths: [16, 28, 16, 10, 20, 18, 12, 24, 18, 18, 14],
    textColumns: [COL_INDEX.student_no, COL_INDEX.birth_date, COL_INDEX.guardian_phone, COL_INDEX.student_phone, COL_INDEX.grade, COL_INDEX.section],
    lists: { [COL_INDEX.gender]: ["ذكر", "أنثى"], [COL_INDEX.fees_enabled]: ["نعم", "لا"], [COL_INDEX.stage]: stages },
  };
  const help = {
    name: "تعليمات", headers: ["ملاحظة"], widths: [95],
    rows: [
      ["اسم الطالب هو العمود الوحيد الإلزامي. رقم الطالب هو مفتاح التحديث: إن وُجد طالب بنفس الرقم تُحدَّث بياناته بدل إضافته مرة ثانية."],
      ["الخلايا الفارغة عند التحديث لا تمسح البيانات الموجودة."],
      ["تاريخ الميلاد بصيغة 2015-03-28. الجنس: ذكر أو أنثى. الرسوم: نعم أو لا."],
      ["الصف يمكن كتابته بأي صيغة معقولة (الأول، الصف الأول، 1، Grade 1). إن كان يحتمل أكثر من صف سنسألك عند الفحص، فالأدق كتابة المرحلة أيضًا."],
      [sectionsEnabled ? "الشعبة اختيارية إذا كان للصف شعبة واحدة." : "مدرستك تعمل بدون شعب: اترك عمود الشعبة فارغًا."],
      [""], ["الهيكل الحالي (المرحلة — الصف — الشعب):"],
      ...gradeLines.map(([s, g, sec]) => [`${s} — ${g}${sec ? ` — ${sec}` : ""}`]),
    ],
  };
  return {
    buffer: buildXlsx([sheet1, help]),
    filename: target ? `قالب-طلاب-${target.grade_name}${section ? `-${section.name}` : ""}.xlsx` : "قالب-الطلاب.xlsx",
  };
}
