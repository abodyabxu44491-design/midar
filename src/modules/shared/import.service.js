// الاستيراد من ملفات CSV: قالب جاهز لكل قسم، ثم معاينة، ثم استيراد كامل أو لا شيء
import { z, t } from "../../core/http/validate.js";
import { badRequest, conflict } from "../../core/http/errors.js";
import * as students from "./students.service.js";
import { cleanName, normalizePhone } from "./students.service.js";

/**
 * تعريف كل نوع استيراد: أعمدته بالعربية، وأيها إلزامي، ومثال يُكتب في القالب.
 */
export const KINDS = {
  students: {
    name: "الطلاب",
    note: "اسم الطالب إلزامي. الباقي اختياري: إن تُرك اسم ولي الأمر يُستنتج من اسم الطالب.",
    columns: [
      { key: "name", header: "اسم الطالب", required: true },
      { key: "class_name", header: "الفصل" },
      { key: "guardian_name", header: "اسم ولي الأمر" },
      { key: "guardian_phone", header: "جوال ولي الأمر" },
      { key: "fees_enabled", header: "الرسوم (نعم/لا)" },
    ],
    sample: [
      ["محمد عبدالله سالم", "الأول - أ", "عبدالله سالم", "0500000001", "نعم"],
      ["ريم عبدالله سالم", "الأول - أ", "", "0500000001", "لا"],
    ],
  },
  teachers: {
    name: "المعلمون",
    note: "اسم المعلم واسم المستخدم إلزاميان. كلمة المرور تُنشأ تلقائيًا وتظهر بعد الاستيراد.",
    columns: [
      { key: "name", header: "اسم المعلم", required: true },
      { key: "username", header: "اسم المستخدم (إنجليزي)", required: true },
      { key: "phone", header: "الجوال" },
    ],
    sample: [["أحمد سعيد", "ahmad", "0500000010"], ["نورة خالد", "noura", "0500000011"]],
  },
  classes: {
    name: "الفصول",
    note: "اسم الفصل إلزامي ولا يتكرر.",
    columns: [{ key: "name", header: "اسم الفصل", required: true }],
    sample: [["الأول - أ"], ["الأول - ب"], ["الثاني - أ"]],
  },
  subjects: {
    name: "المواد",
    note: "اسم المادة إلزامي ولا يتكرر.",
    columns: [{ key: "name", header: "اسم المادة", required: true }],
    sample: [["القرآن الكريم"], ["اللغة العربية"], ["الرياضيات"]],
  },
  staff: {
    name: "الموظفون (الرواتب)",
    note: "الاسم إلزامي. النوع: معلم أو إداري أو عامل. الراتب بالأرقام.",
    columns: [
      { key: "full_name", header: "اسم الموظف", required: true },
      { key: "job_title", header: "المسمى الوظيفي" },
      { key: "category", header: "النوع (معلم/إداري/عامل)" },
      { key: "phone", header: "الجوال" },
      { key: "base_salary", header: "الراتب الأساسي" },
    ],
    sample: [["سالم أحمد", "محاسب", "إداري", "0500000020", "4000"], ["فهد ناصر", "حارس", "عامل", "", "2500"]],
  },
};

export const rowsSchema = z.object({
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1, "الملف فارغ").max(2000, "الحد 2000 سطر في المرة"),
  dry_run: z.boolean().default(false),
});

/** بناء ملف القالب (CSV بترميز يدعم العربية في Excel) */
export function template(kind) {
  const def = KINDS[kind];
  if (!def) throw badRequest("نوع الاستيراد غير معروف");
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [def.columns.map((c) => esc(c.header)).join(","), ...def.sample.map((r) => r.map(esc).join(","))];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

const YES = ["نعم", "yes", "true", "1", "✓"];
const CATEGORY = { "معلم": "teacher", "إداري": "admin", "اداري": "admin", "عامل": "worker", "أخرى": "other", "اخرى": "other" };

// تحويل صف من عناوين عربية إلى حقول النظام
function mapRow(def, raw) {
  const out = {};
  for (const col of def.columns) {
    const value = raw[col.header] ?? raw[col.key] ?? "";
    out[col.key] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

/**
 * استيراد موحّد: يتحقق من كل الأسطر أولًا، فإذا وُجد خطأ لم يُستورد شيء.
 * @returns {{ created:number, rows:Array, errors:Array }}
 */
export async function importRows(q, tenant, kind, rawRows, { dryRun = false, actor }) {
  const def = KINDS[kind];
  if (!def) throw badRequest("نوع الاستيراد غير معروف");
  const rows = rawRows.map((r) => mapRow(def, r));
  const errors = [];

  rows.forEach((row, i) => {
    for (const col of def.columns) {
      if (col.required && !String(row[col.key] || "").trim()) {
        errors.push({ row: i + 2, message: `${col.header} مطلوب` });    // +2: العنوان أولًا ثم ترقيم Excel
      }
    }
  });
  if (errors.length) return { created: 0, rows: [], errors };

  const handlers = { students: importStudents, teachers: importTeachers, classes: importClasses,
    subjects: importSubjects, staff: importStaff };
  return handlers[kind](q, tenant, rows, { dryRun, actor });
}

/* ---------- الطلاب ---------- */
async function importStudents(q, tenant, rows, { dryRun }) {
  const classes = await q("SELECT id, name FROM classes");
  const byName = new Map(classes.map((c) => [cleanName(c.name), c.id]));
  const errors = [];
  const prepared = rows.map((r, i) => {
    const className = cleanName(r.class_name);
    if (className && !byName.has(className)) errors.push({ row: i + 2, message: `الفصل «${r.class_name}» غير موجود` });
    return {
      name: cleanName(r.name),
      class_id: className ? byName.get(className) ?? null : null,
      guardian_name: cleanName(r.guardian_name) || null,
      guardian_phone: normalizePhone(r.guardian_phone),
      fees_enabled: YES.includes(String(r.fees_enabled || "").trim().toLowerCase()),
    };
  });
  if (errors.length) return { created: 0, rows: [], errors };
  if (dryRun) return { created: 0, rows: prepared.map((p) => ({ ...p, preview: true })), errors: [] };
  const created = await students.create(q, tenant, prepared);
  return { created: created.length, rows: created, errors: [] };
}

/* ---------- المعلمون ---------- */
async function importTeachers(q, tenant, rows, { dryRun }) {
  const { newTempPassword } = await import("../../core/auth/codes.js");
  const { hashPassword } = await import("../../core/auth/password.js");
  const errors = [];
  const seen = new Set();
  const prepared = rows.map((r, i) => {
    const username = String(r.username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) errors.push({ row: i + 2, message: `اسم المستخدم «${r.username}» غير صالح (حروف إنجليزية وأرقام)` });
    if (seen.has(username)) errors.push({ row: i + 2, message: `اسم المستخدم «${username}» مكرر داخل الملف` });
    seen.add(username);
    return { name: cleanName(r.name), username, phone: normalizePhone(r.phone) };
  });
  if (!errors.length) {
    const taken = await q("SELECT username FROM users WHERE username = ANY($1::text[])", [[...seen]]);
    for (const u of taken) errors.push({ row: 0, message: `اسم المستخدم «${u.username}» مستخدم مسبقًا` });
  }
  if (errors.length) return { created: 0, rows: [], errors };
  if (dryRun) return { created: 0, rows: prepared.map((p) => ({ ...p, preview: true })), errors: [] };

  const out = [];
  for (const p of prepared) {
    const [teacher] = await q(
      "INSERT INTO teachers (tenant_id, full_name, phone) VALUES (app_tenant(), $1, $2) RETURNING id", [p.name, p.phone]);
    const password = newTempPassword();
    await q(
      `INSERT INTO users (tenant_id, role, full_name, username, password_hash, teacher_id, must_change_password)
       VALUES (app_tenant(), 'teacher', $1, $2, $3, $4, true)`,
      [p.name, p.username, await hashPassword(password), teacher.id]);
    out.push({ id: teacher.id, name: p.name, username: p.username, password });
  }
  return { created: out.length, rows: out, errors: [] };
}

/* ---------- الفصول والمواد ---------- */
const importClasses = (q, tenant, rows, opts) => importSimple(q, "classes", "الفصل", rows, opts);
const importSubjects = (q, tenant, rows, opts) => importSimple(q, "subjects", "المادة", rows, opts);

async function importSimple(q, table, label, rows, { dryRun }) {
  const names = rows.map((r) => cleanName(r.name)).filter(Boolean);
  const errors = [];
  const seen = new Set();
  names.forEach((n, i) => {
    if (seen.has(n)) errors.push({ row: i + 2, message: `«${n}» مكرر داخل الملف` });
    seen.add(n);
  });
  const existing = await q(`SELECT name FROM ${table} WHERE name = ANY($1::text[])`, [[...seen]]);
  for (const e of existing) errors.push({ row: 0, message: `${label} «${e.name}» موجود مسبقًا` });
  if (errors.length) return { created: 0, rows: [], errors };
  if (dryRun) return { created: 0, rows: names.map((name) => ({ name, preview: true })), errors: [] };

  const out = [];
  for (const name of names) {
    const [row] = await q(`INSERT INTO ${table} (tenant_id, name) VALUES (app_tenant(), $1) RETURNING id, name`, [name]);
    out.push(row);
  }
  return { created: out.length, rows: out, errors: [] };
}

/* ---------- الموظفون ---------- */
async function importStaff(q, tenant, rows, { dryRun }) {
  const prepared = rows.map((r) => ({
    full_name: cleanName(r.full_name),
    job_title: cleanName(r.job_title) || null,
    category: CATEGORY[String(r.category || "").trim()] || "other",
    phone: normalizePhone(r.phone),
    base_salary: Number(String(r.base_salary || "0").replace(/[^\d.]/g, "")) || 0,
  }));
  const errors = prepared.flatMap((p, i) => (p.base_salary > 1_000_000 ? [{ row: i + 2, message: "الراتب كبير جدًا" }] : []));
  if (errors.length) return { created: 0, rows: [], errors };
  if (dryRun) return { created: 0, rows: prepared.map((p) => ({ ...p, preview: true })), errors: [] };

  const out = [];
  for (const p of prepared) {
    const [row] = await q(
      `INSERT INTO staff (tenant_id, full_name, job_title, category, phone, base_salary)
       VALUES (app_tenant(), $1, $2, $3, $4, $5) RETURNING id, full_name`,
      [p.full_name, p.job_title, p.category, p.phone, p.base_salary]);
    out.push(row);
  }
  return { created: out.length, rows: out, errors: [] };
}
