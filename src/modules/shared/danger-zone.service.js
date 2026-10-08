// منطقة الحذر: العمليات الاستثنائية على بيانات مدرسة (للمالك، ولمدير المدرسة حسب صلاحيته).
// الاشتراكات والباقات والفواتير والتجديدات خارجها نهائيًا (لا تُنسخ ولا تُستعاد ولا تُحذف، إلا مع حذف المدرسة كلها).
//
// لا تنفيذ مباشر. كل عملية تمر بالمراحل:
//   1) اختيار المدرسة  2) اختيار العملية  3) الشرح  4) ما سيتأثر (بالأرقام الحقيقية)  5) ما لن يتأثر
//   6) نسخة احتياطية (إلزامية للعمليات المدمّرة، وتلقائية قبلها)  7) المراجعة  8) كتابة رمز المدرسة للتأكيد
//   9) إعادة التحقق من الهوية (كلمة المرور + رمز التحقق للمالك)  10) التنفيذ داخل معاملة واحدة  11) التسجيل الكامل
// المراحل 1–5 يعيدها plan()، والتنفيذ يتحقق من كل شرط في الخادم من جديد (لا يُعتمد على الواجهة).
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { transaction } from "../../core/db/pool.js";
import { badRequest, notFound, forbidden, unauthorized, conflict } from "../../core/http/errors.js";
import { z } from "../../core/http/validate.js";
import { hashPassword, verifyPassword } from "../../core/auth/password.js";
import { verifyTotp } from "../../core/auth/totp.js";
import { newTempPassword, newToken } from "../../core/auth/codes.js";
import { sealCredential } from "../../core/auth/secret-box.js";
import { logEvent, securityEvent, recentFailures, clearLoginFailures } from "../../core/audit.js";
import { env } from "../../config/env.js";
import { ensureDefaults } from "./academic.service.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
// التسجيل: في سجل المدرسة دائمًا، وعمليات المالك أيضًا في سجل المنصة (يراها في «سجل العمليات» بلوحته)
async function log(q, ctx, tid, action) {
  await logEvent(q, { tenantId: tid, actor: ctx.actor, action });
  if (ctx.scope === "owner") await logEvent(q, { tenantId: null, actor: ctx.actor, action: `${action} — مدرسة ${tid}` });
}
const PLAN_TTL_MIN = 20;          // صلاحية العملية المخططة
const KEEP_BACKUPS = 15;          // النسخ المحفوظة لكل مدرسة (الأقدم يُحذف تلقائيًا)

/* ---------- فئات البيانات القابلة للحذف ----------
   الجداول بأسمائها الثابتة هنا فقط، والدالة في قاعدة البيانات تتحقق منها مرة ثانية وترتبها بأمان. */
export const CATEGORIES = {
  attendance:    { label: "الحضور والغياب", note: "كل سجلات الحضور وأسباب الغياب وأعذار أولياء الأمور", tables: ["attendance"], admin: true },
  announcements: { label: "التعاميم", tables: ["announcements"], admin: true },
  homework:      { label: "الواجبات وتسليماتها", tables: ["assignment_submissions", "assignments"], admin: true },
  timetable:     { label: "حصص الجدول الدراسي", note: "إعدادات الجدول تبقى", tables: ["timetable_slots"], admin: true },
  alerts:        { label: "تنبيهات وملاحظات الطلاب", tables: ["student_alerts"], admin: true },
  admissions:    { label: "طلبات التسجيل", tables: ["admissions"], admin: true },
  exam_papers:   { label: "أوراق الاختبارات", note: "والتعليمات المحفوظة للمعلمين", tables: ["exam_papers", "exam_instruction_presets"], main: "exam_papers", admin: true },
  question_bank: { label: "بنك الأسئلة", tables: ["question_bank"], admin: true },
  grades:        { label: "الاختبارات والدرجات المرصودة", tables: ["scores", "exams"], admin: false },
  finance:       { label: "العمليات المالية", note: "الفواتير والدفعات والقيود والتبرعات والرواتب (الحسابات والتصنيفات وخطط الرسوم تبقى)",
    tables: ["payment_claims", "payments", "invoices", "fee_adjustments", "donations", "payroll_items", "payroll_runs", "finance_entries"], admin: false },
  students:      { label: "الطلاب وكل سجلاتهم", note: "الحضور والدرجات والفواتير والدفعات والتنبيهات والسجل الأكاديمي",
    tables: ["student_alerts", "student_years", "assignment_submissions", "scores", "attendance", "payment_claims", "payments", "invoices", "fee_adjustments", "students"], admin: false },
  teachers:      { label: "المعلمون وحساباتهم", note: "والإسناد (المواد والفصول)", tables: ["teacher_assignments", "teachers"], admin: false },
};
const SETTINGS_TABLES = ["school_public_settings", "exam_paper_settings", "timetable_settings", "school_messages"];
const REINIT = ["students", "grades", "homework", "announcements", "alerts", "admissions"];
const KEEP_ON_RESET = ["school_modules"];   // الأقسام المفعّلة مرتبطة بالاشتراك

const ALWAYS_SAFE = "سجل العمليات (لا يُحذف أبدًا)، والاشتراك والباقة والفواتير والتجديدات";

/* ---------- العمليات ----------
   severity: medium | high | critical. backup: none | auto (نسخة تلقائية إلزامية قبل التنفيذ).
   reauth: إعادة التحقق من الهوية. scopes: من يستطيعها (owner / admin). */
export const OPERATIONS = {
  sessions_kill: {
    label: "إيقاف جميع جلسات المستخدمين", severity: "medium", backup: "none", reauth: false, scopes: ["owner", "admin"], group: "الأمان",
    description: "يُخرج كل مستخدمي المدرسة (المدير والمعلمين والمحاسبين) من كل الأجهزة فورًا، ويحتاج كل منهم لتسجيل الدخول من جديد. مفيد عند الاشتباه بدخول غير مصرح أو فقدان جهاز.",
    unaffected: ["كل البيانات", "كلمات المرور", ALWAYS_SAFE],
  },
  accounts_reset: {
    label: "إعادة ضبط حسابات المدرسة", severity: "high", backup: "none", reauth: true, scopes: ["owner", "admin"], group: "الأمان",
    description: "يصدر كلمة مرور مؤقتة جديدة لكل حساب مشمول، ويُلزم صاحبه بتغييرها عند أول دخول، ويفك أي قفل، وينهي الجلسات. كلمات المعلمين المؤقتة تبقى ظاهرة في ملف المعلم حتى يغيّروها.",
    unaffected: ["أسماء المستخدمين", "البيانات كلها", ALWAYS_SAFE],
  },
  emergency_lock: {
    label: "قفل طارئ للمدرسة", severity: "high", backup: "none", reauth: true, scopes: ["owner"], group: "الطوارئ",
    description: "يوقف الدخول لكل حسابات المدرسة وصفحة أولياء الأمور فورًا ويُخرج الجميع، دون تغيير أي بيانات. يُرفع القفل من هنا متى شئت.",
    unaffected: ["كل البيانات", "كلمات المرور", ALWAYS_SAFE],
  },
  emergency_unlock: {
    label: "رفع القفل الطارئ", severity: "medium", backup: "none", reauth: true, scopes: ["owner"], group: "الطوارئ",
    description: "يعيد الدخول للمدرسة كما كان قبل القفل الطارئ.", unaffected: ["كل البيانات", ALWAYS_SAFE],
  },
  backup_create: {
    label: "إنشاء نسخة احتياطية", severity: "low", backup: "none", reauth: false, scopes: ["owner", "admin"], group: "النسخ الاحتياطي",
    description: "لقطة كاملة لبيانات المدرسة الآن (الهيكل والطلاب والمعلمون والحضور والدرجات والمالية والإعدادات والصور)، تُحفظ على الخادم مع بصمة للتحقق من سلامتها، ويمكن استعادتها لاحقًا.",
    unaffected: ["لا يتغير أي شيء"],
  },
  settings_reset: {
    label: "إعادة ضبط إعدادات المدرسة", severity: "medium", backup: "auto", reauth: true, scopes: ["owner", "admin"], group: "إعادة التهيئة",
    description: "يعيد إعدادات صفحة المدرسة العامة، وإعدادات أوراق الاختبارات، وإعدادات الجدول، وقوالب رسائل واتساب إلى قيمها الافتراضية.",
    unaffected: ["الطلاب والمعلمون والدرجات والحضور والمالية", "الهيكل الأكاديمي", "الشعار", ALWAYS_SAFE],
  },
  data_purge: {
    label: "حذف بيانات محددة", severity: "high", backup: "auto", reauth: true, scopes: ["owner", "admin"], group: "الحذف",
    description: "يحذف فئات البيانات التي تختارها فقط، وكل ما عداها يبقى كما هو.",
    unaffected: ["كل الفئات غير المختارة", "الهيكل الأكاديمي", "الإعدادات", ALWAYS_SAFE],
  },
  data_reinit: {
    label: "إعادة تهيئة بيانات المدرسة", severity: "critical", backup: "auto", reauth: true, scopes: ["owner"], group: "إعادة التهيئة",
    description: "يحذف الطلاب وكل سجلاتهم والدرجات والواجبات والتعاميم والتنبيهات وطلبات التسجيل، ويُبقي الهيكل الأكاديمي والمعلمين والحسابات والإعدادات والقيود المالية العامة — مثل بداية مدرسة جديدة بنفس التجهيز.",
    unaffected: ["المراحل والصفوف والشعب والمواد", "المعلمون وحساباتهم", "الإعدادات والشعار", "الحسابات والقيود المالية العامة", ALWAYS_SAFE],
  },
  school_reset: {
    label: "إعادة المدرسة إلى وضع البداية", severity: "critical", backup: "auto", reauth: true, scopes: ["owner"], group: "إعادة التهيئة",
    description: "يحذف كل بيانات المدرسة (الهيكل والطلاب والمعلمين والمالية والإعدادات)، ويُبقي حساب المدير فقط، ويفتح معالج الإعداد من جديد — كأن المدرسة أُنشئت اليوم.",
    unaffected: ["حساب المدير واسم المدرسة ورمزها", "الأقسام المفعّلة", ALWAYS_SAFE],
  },
  archive: {
    label: "أرشفة المدرسة", severity: "high", backup: "auto", reauth: true, scopes: ["owner"], group: "الأرشيف",
    description: "توقف المدرسة عن العمل (لا دخول ولا صفحة عامة) وتبقى بياناتها محفوظة كاملة، ويمكن استعادتها من الأرشيف في أي وقت.",
    unaffected: ["كل البيانات محفوظة", ALWAYS_SAFE],
  },
  unarchive: {
    label: "استعادة المدرسة من الأرشيف", severity: "medium", backup: "none", reauth: true, scopes: ["owner"], group: "الأرشيف",
    description: "تعود المدرسة للعمل ببياناتها كما كانت.", unaffected: ["كل البيانات", ALWAYS_SAFE],
  },
  backup_restore: {
    label: "استعادة نسخة احتياطية", severity: "critical", backup: "auto", reauth: true, scopes: ["owner"], group: "النسخ الاحتياطي",
    description: "يستبدل كل بيانات المدرسة الحالية ببيانات النسخة المختارة. تُؤخذ نسخة من الوضع الحالي تلقائيًا قبل الاستعادة (للتراجع إن لزم)، وتُنهى كل الجلسات.",
    unaffected: [ALWAYS_SAFE],
  },
  school_delete: {
    label: "حذف المدرسة نهائيًا", severity: "critical", backup: "auto", reauth: true, scopes: ["owner"], group: "الحذف",
    description: "يحذف المدرسة وكل بياناتها وحساباتها واشتراكاتها من المنصة نهائيًا. يُشترط أن تكون مؤرشفة أولًا، وتُحفظ نسخة احتياطية أخيرة تبقى في قائمة النسخ.",
    unaffected: ["سجل العمليات", "النسخة الاحتياطية الأخيرة"],
  },
};

export const planSchema = z.object({
  op: z.enum(Object.keys(OPERATIONS)),
  params: z.object({
    categories: z.array(z.enum(Object.keys(CATEGORIES))).max(20).optional(),
    backup_id: z.coerce.number().int().positive().optional(),
    include_admins: z.boolean().optional(),
    reason: z.string().trim().max(300).optional(),
  }).default({}),
});
export const stepSchema = z.object({ token: z.string().min(20).max(100) });
export const executeSchema = stepSchema.extend({
  confirm: z.string().trim().max(60),
  password: z.string().max(200).optional(),
  code: z.string().max(10).optional(),
});

export function catalog(scope) {
  return {
    operations: Object.entries(OPERATIONS).filter(([, o]) => o.scopes.includes(scope))
      .map(([key, o]) => ({ key, label: o.label, group: o.group, severity: o.severity, description: o.description, backup: o.backup, reauth: o.reauth })),
    categories: Object.entries(CATEGORIES).filter(([, c]) => scope === "owner" || c.admin)
      .map(([key, c]) => ({ key, label: c.label, note: c.note || null })),
    totp: scope === "owner" && Boolean(env.OWNER_TOTP_SECRET),
  };
}

/* ---------- الأرقام الحقيقية ---------- */
const TABLE_LABEL = {
  students: "الطلاب", attendance: "سجلات الحضور", scores: "الدرجات المرصودة", exams: "الاختبارات", invoices: "الفواتير", payments: "الدفعات",
  payment_claims: "إشعارات التحويل", fee_adjustments: "تعديلات الرسوم", student_alerts: "تنبيهات الطلاب", student_years: "السجل الأكاديمي السنوي",
  assignment_submissions: "تسليمات الواجبات", assignments: "الواجبات", announcements: "التعاميم", timetable_slots: "حصص الجدول",
  admissions: "طلبات التسجيل", exam_papers: "أوراق الاختبارات", grade_components: "توزيع الدرجات", exam_instruction_presets: "التعليمات المحفوظة", question_bank: "أسئلة البنك",
  donations: "التبرعات", payroll_items: "بنود الرواتب", payroll_runs: "مسيرات الرواتب", finance_entries: "القيود المالية",
  teacher_assignments: "إسنادات المعلمين", teachers: "المعلمون", users: "الحسابات", classes: "الشعب", grades: "الصفوف", stages: "المراحل",
  subjects: "المواد", sessions: "الجلسات المفتوحة", school_public_settings: "إعدادات الصفحة العامة", exam_paper_settings: "إعدادات أوراق الاختبارات",
  timetable_settings: "إعدادات الجدول", school_messages: "قوالب الرسائل", exam_images: "صور الاختبارات والشعار", attachments: "المرفقات",
  academic_years: "السنوات الدراسية", terms: "الفصول الدراسية", holidays: "الإجازات", fee_plans: "خطط الرسوم", staff: "الموظفون",
  subscriptions: "سجلات الاشتراك", subscription_invoices: "فواتير الاشتراك",
  custom_fields: "الحقول المخصصة", custom_values: "قيم الحقول المخصصة", exam_types: "أنواع الاختبارات",
  subject_grades: "ربط المواد بالصفوف", finance_accounts: "الحسابات المالية", finance_categories: "تصنيفات المالية",
  finance_method_accounts: "ربط طرق الدفع بالحسابات", payment_accounts: "حسابات التحويل البنكي", school_profile: "ملف المدرسة",
  school_modules: "الأقسام المفعّلة", tenant_counters: "عدادات الأرقام", jobs: "العمليات الطويلة", password_requests: "طلبات استعادة كلمة المرور",
  sync_changes: "تغييرات المزامنة", sync_devices: "أجهزة المزامنة", sync_operations: "عمليات المزامنة",
  notifications: "الإشعارات", push_subscriptions: "اشتراكات الإشعار الفوري", school_notify: "إعدادات الإشعارات",
  notification_prefs: "اختيارات الإشعارات", notification_deliveries: "سجل تسليم الإشعارات",
  attendance_credentials: "بطاقات الحضور", gates: "البوابات", gate_devices: "أجهزة البوابة", gate_join_codes: "رموز ربط جوالات البوابة", attendance_events: "سجل مسح البوابة",
  attendance_days: "حالة أيام الحضور", attendance_audit: "سجل تعديلات الحضور", attendance_stage_hours: "أوقات الحضور للمراحل",
  parents: "حسابات أولياء الأمور", parent_students: "ربط أولياء الأمور بالأبناء", parent_link_requests: "طلبات ربط الأبناء",
  school_feature_settings: "إعدادات الأقسام", behavior_categories: "تصنيفات السلوك", behavior_records: "سجلات السلوك",
  certificates: "الشهادات الصادرة", online_exams: "الاختبارات الإلكترونية", online_attempts: "محاولات الاختبارات الإلكترونية",
  staff_attendance: "دوام الموظفين", leave_requests: "طلبات الإجازة", substitutions: "حصص الانتظار", lesson_plans: "خطط الدروس",
  calendar_events: "فعاليات التقويم", buses: "الحافلات", bus_students: "ركاب الحافلات", bus_events: "سجل صعود ونزول الحافلات",
  library_books: "كتب المكتبة", library_loans: "إعارات المكتبة", inventory_items: "أصناف المخزون", inventory_moves: "حركات المخزون",
  health_profiles: "الملفات الصحية", clinic_visits: "زيارات العيادة", surveys: "الاستبيانات", survey_responses: "إجابات الاستبيانات",
  meeting_slots: "فترات المواعيد", meeting_bookings: "حجوزات المواعيد", reminder_log: "سجل التذكيرات",
  renewal_requests: "طلبات التجديد", subscription_events: "سجل أحداث الاشتراك", leads: "طلبات الاهتمام", sms_ledger: "رصيد الرسائل النصية",
  tenant_prices: "أسعار المدرسة الخاصة",
  school_ai: "مفتاح المساعد الذكي", school_sms_gateway: "بوابة رسائل المدرسة", wa_outbox: "قائمة إرسال واتساب",
};
export const tableLabel = (t) => TABLE_LABEL[t] || t;
async function counts(q, tid, tables) {
  const out = [];
  for (const t of tables) {
    const [r] = await q(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [tid]);   // أسماء ثابتة من هذا الملف فقط
    if (r.n) out.push({ table: t, label: TABLE_LABEL[t] || t, count: r.n });
  }
  return out;
}
const dataTables = async (q, kinds = ["data"]) => (await q("SELECT name FROM danger_tables() WHERE kind = ANY($1) ORDER BY depth DESC, name", [kinds])).map((r) => r.name);

// الجداول التي تحذفها كل عملية (القائمة نفسها تُعرض في «ما سيتأثر» وتُمرر للتنفيذ)
async function tablesFor(q, op, params) {
  switch (op) {
    case "data_purge": return [...new Set((params.categories || []).flatMap((c) => CATEGORIES[c].tables))];
    case "data_reinit": return [...new Set(REINIT.flatMap((c) => CATEGORIES[c].tables))];
    case "settings_reset": return SETTINGS_TABLES;
    case "school_reset": return (await dataTables(q, ["data", "transient"])).filter((t) => !KEEP_ON_RESET.includes(t));
    case "school_delete": return dataTables(q, ["data", "transient", "billing"]);
    default: return [];
  }
}

/* ---------- المرحلة 1–5: التخطيط ---------- */
export async function plan(ctx, tid, b) {
  const o = OPERATIONS[b.op];
  if (!o.scopes.includes(ctx.scope)) throw forbidden("هذه العملية لمالك المنصة فقط");
  const params = b.params || {};
  if (b.op === "data_purge") {
    if (!params.categories?.length) throw badRequest("اختر فئة واحدة على الأقل");
    if (ctx.scope === "admin" && params.categories.some((c) => !CATEGORIES[c].admin)) throw forbidden("إحدى الفئات لمالك المنصة فقط");
  }
  if (b.op === "accounts_reset" && ctx.scope === "admin") params.include_admins = false;
  const token = newToken();
  return transaction({ tenantId: tid, actor: ctx.actor, ip: ctx.ip, platform: true }, async (q) => {
    const [t] = await q("SELECT id, name, status, emergency_locked_at FROM tenants WHERE id = $1", [tid]);
    if (!t) throw notFound("المدرسة غير موجودة");
    // شروط كل عملية قبل أن تبدأ
    const pre = {
      archive: () => t.status === "archived" && "المدرسة مؤرشفة مسبقًا",
      unarchive: () => t.status !== "archived" && "المدرسة ليست مؤرشفة",
      school_delete: () => t.status !== "archived" && "أرشف المدرسة أولًا ثم احذفها (حماية من الحذف بالخطأ)",
      emergency_lock: () => t.emergency_locked_at && "المدرسة مقفلة طارئًا مسبقًا",
      emergency_unlock: () => !t.emergency_locked_at && "المدرسة غير مقفلة",
    }[b.op]?.();
    if (pre) throw conflict(pre);
    let backup = null;
    if (b.op === "backup_restore") {
      if (!params.backup_id) throw badRequest("اختر النسخة الاحتياطية");
      [backup] = await q("SELECT id, created_at, reason, tables, size_bytes, schema_version FROM tenant_backups WHERE id = $1 AND tenant_id = $2", [params.backup_id, tid]);
      if (!backup) throw notFound("النسخة غير موجودة لهذه المدرسة");
    }
    const tables = await tablesFor(q, b.op, params);
    let affected = await counts(q, tid, tables);
    if (b.op === "sessions_kill" || b.op === "archive" || b.op === "emergency_lock") {
      const [s] = await q(`SELECT count(*)::int AS n FROM sessions WHERE tenant_id = $1 ${ctx.scope === "admin" ? "AND user_id <> $2" : ""}`,
        ctx.scope === "admin" ? [tid, ctx.userId] : [tid]);
      affected = [{ table: "sessions", label: "الجلسات المفتوحة", count: s.n }];
    }
    if (b.op === "accounts_reset") {
      const [u] = await q(`SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND (role <> 'admin' OR $2)`, [tid, Boolean(params.include_admins)]);
      affected = [{ table: "users", label: params.include_admins ? "كل الحسابات (مع المدير)" : "حسابات المعلمين والمحاسبين", count: u.n }];
    }
    if (b.op === "backup_restore") {
      const cur = await counts(q, tid, await dataTables(q));
      affected = cur.map((x) => ({ ...x, after: backup.tables[x.table] ?? 0 }));
      for (const [table, n] of Object.entries(backup.tables)) {
        if (n && !affected.some((x) => x.table === table)) affected.push({ table, label: TABLE_LABEL[table] || table, count: 0, after: n });
      }
    }
    const [row] = await q(
      `INSERT INTO danger_operations (tenant_id, tenant_name, scope, op, params, impact, token_hash, requested_by, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(mins => $10)) RETURNING id, expires_at`,
      [tid, t.name, ctx.scope, b.op, params, { affected }, sha(token), ctx.actor, ctx.ip || null, PLAN_TTL_MIN]);
    await log(q, ctx, tid, `منطقة الحذر: تجهيز عملية «${o.label}» (#${row.id})`);
    return {
      id: row.id, token, expires_at: row.expires_at, op: b.op, label: o.label, severity: o.severity, description: o.description,
      school: { id: t.id, name: t.name, status: t.status },
      params, affected, unaffected: o.unaffected,
      backup_required: o.backup === "auto", reauth: o.reauth, confirm_text: o.severity === "low" ? null : t.id,
      restore_from: backup,
      category_labels: (params.categories || []).map((c) => CATEGORIES[c].label),
    };
  });
}

async function loadOp(q, ctx, id, token, tid) {
  const [op] = await q("SELECT * FROM danger_operations WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [id, tid]);
  if (!op || op.token_hash !== sha(token) || op.scope !== ctx.scope) throw notFound("العملية غير موجودة");
  if (op.status !== "planned") throw conflict("هذه العملية نُفذت أو أُلغيت مسبقًا");
  if (new Date(op.expires_at) < new Date()) throw conflict("انتهت صلاحية العملية (20 دقيقة). ابدأها من جديد.");
  return op;
}

/* ---------- النسخ الاحتياطي ---------- */
export async function createBackup(ctx, tid, reason, q0 = null) {
  const run = async (q) => {
    await q("SET LOCAL statement_timeout = '180s'");
    const [t] = await q("SELECT name FROM tenants WHERE id = $1", [tid]);
    if (!t) throw notFound("المدرسة غير موجودة");
    const [{ data }] = await q("SELECT danger_export($1) AS data", [tid]);
    const [{ v }] = await q("SELECT danger_schema_version() AS v");
    const json = Buffer.from(JSON.stringify({ format: "midar-backup-1", tenant: tid, schema: v, created_at: new Date().toISOString(), data }));
    const packed = await gzip(json);
    const tables = Object.fromEntries(Object.entries(data).map(([k, rows]) => [k, rows.length]));
    const [row] = await q(
      `INSERT INTO tenant_backups (tenant_id, tenant_name, reason, created_by, scope, schema_version, tables, size_bytes, sha256, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, created_at, size_bytes`,
      [tid, t.name, reason.slice(0, 200), ctx.actor, ctx.scope, v, tables, packed.length, sha(packed), packed]);
    // الاحتفاظ بآخر النسخ فقط (النسخة المرتبطة بعملية حذف المدرسة لا تُحذف لأن المدرسة لم تعد تنشئ نسخًا)
    await q(`DELETE FROM tenant_backups WHERE tenant_id = $1 AND id NOT IN (SELECT id FROM tenant_backups WHERE tenant_id = $1 ORDER BY id DESC LIMIT ${KEEP_BACKUPS})`, [tid]);
    await log(q, ctx, tid, `منطقة الحذر: نسخة احتياطية #${row.id} (${reason})`);
    return { ...row, tables };
  };
  return q0 ? run(q0) : transaction({ tenantId: tid, actor: ctx.actor, ip: ctx.ip, platform: true }, run);
}

export async function readBackup(q, id, tid = null) {
  const [b] = await q(`SELECT * FROM tenant_backups WHERE id = $1 ${tid ? "AND tenant_id = $2" : ""}`, tid ? [id, tid] : [id]);
  if (!b) throw notFound("النسخة غير موجودة");
  if (sha(b.data) !== b.sha256) throw conflict("النسخة تالفة (البصمة غير مطابقة)، لا يمكن استخدامها");
  const doc = JSON.parse((await gunzip(b.data)).toString("utf8"));
  if (doc.format !== "midar-backup-1" || doc.tenant !== b.tenant_id) throw conflict("صيغة النسخة غير معروفة");
  return { row: b, doc };
}

export const listBackups = (q, tid) => q(
  `SELECT id, tenant_id, tenant_name, reason, created_by, scope, schema_version, tables, size_bytes, created_at
     FROM tenant_backups WHERE ($1::text IS NULL OR tenant_id = $1) ORDER BY id DESC LIMIT 100`, [tid]);

export async function stepBackup(ctx, tid, id, token) {
  return transaction({ tenantId: tid, actor: ctx.actor, ip: ctx.ip, platform: true }, async (q) => {
    const op = await loadOp(q, ctx, id, token, tid);
    const b = await createBackup(ctx, tid, `قبل: ${OPERATIONS[op.op].label} (#${op.id})`, q);
    await q("UPDATE danger_operations SET backup_id = $2 WHERE id = $1", [op.id, b.id]);
    return b;
  });
}

/* ---------- إعادة التحقق من الهوية ---------- */
async function reauth(ctx, tid, b) {
  const fail = async (msg) => {
    await transaction({ tenantId: tid, actor: ctx.actor, ip: ctx.ip, platform: true }, async (q) => {
      await securityEvent(q, { kind: "danger_reauth_failed", subject: `${ctx.scope}:${ctx.userId || "owner"}`, tenantId: tid, ip: ctx.ip });
      await log(q, ctx, tid, "منطقة الحذر: فشل التحقق من الهوية قبل التنفيذ");
    });
    throw unauthorized(msg);
  };
  const locked = await transaction({ platform: true }, async (q) =>
    (await recentFailures(q, "danger_reauth_failed", `${ctx.scope}:${ctx.userId || "owner"}`, 15)) >= 5);
  if (locked) throw unauthorized("أوقفنا التحقق مؤقتًا بعد محاولات خاطئة. حاول بعد 15 دقيقة.");
  if (!b.password) return fail("أدخل كلمة المرور للتحقق من هويتك");
  if (ctx.scope === "owner") {
    const ok = await verifyPassword(b.password, env.OWNER_PASSWORD_HASH);
    const codeOk = !env.OWNER_TOTP_SECRET || verifyTotp(env.OWNER_TOTP_SECRET, b.code);
    if (!ok || !codeOk) return fail(env.OWNER_TOTP_SECRET ? "كلمة المرور أو رمز التحقق غير صحيح" : "كلمة المرور غير صحيحة");
  } else {
    const [u] = await transaction({ tenantId: tid }, (q) => q("SELECT password_hash FROM users WHERE id = $1", [ctx.userId]));
    if (!u || !(await verifyPassword(b.password, u.password_hash))) return fail("كلمة المرور غير صحيحة");
  }
}

/* ---------- المرحلة 8–11: التأكيد والتحقق والتنفيذ والتسجيل ---------- */
export async function execute(ctx, tid, id, b) {
  // 1) فحص الطلب والتأكيد قبل أي عمل ثقيل
  const op = await transaction({ tenantId: tid, platform: true }, async (q) => loadOp(q, ctx, id, b.token, tid));
  const o = OPERATIONS[op.op];
  if (o.severity !== "low" && b.confirm !== tid) throw badRequest(`اكتب رمز المدرسة «${tid}» كما هو للتأكيد`);
  if (o.reauth) await reauth(ctx, tid, b);
  // 2) النسخة الاحتياطية الإلزامية: إن لم تُنشأ في مرحلتها تُنشأ الآن تلقائيًا
  let backupId = op.backup_id;
  if (o.backup === "auto" && !backupId) backupId = (await stepBackup(ctx, tid, id, b.token)).id;
  // 3) الموافقة ثم التنفيذ في معاملة واحدة (تفشل كلها أو تنجح كلها)
  try {
    const result = await transaction({ tenantId: tid, actor: ctx.actor, ip: ctx.ip, platform: true }, async (q) => {
      await q("SET LOCAL statement_timeout = '300s'");
      // الموافقة مرة واحدة فقط: ضغطتان متزامنتان لا تنفذان العملية مرتين
      const ok = await q("UPDATE danger_operations SET status = 'approved', approved_at = now(), backup_id = $2 WHERE id = $1 AND status = 'planned' AND expires_at > now() RETURNING id", [op.id, backupId]);
      if (!ok.length) throw conflict("هذه العملية نُفذت أو أُلغيت أو انتهت صلاحيتها");
      const out = await run(q, ctx, tid, op, b.token);
      const { credentials, ...stored } = out;   // كلمات المرور الجديدة تُعرض مرة واحدة ولا تُحفظ في سجل العملية
      void credentials;
      await q("UPDATE danger_operations SET status = 'executed', executed_at = now(), result = $2 WHERE id = $1", [op.id, stored]);
      await log(q, ctx, tid, `منطقة الحذر: نُفذت «${o.label}» (#${op.id})${backupId ? ` — نسخة احتياطية #${backupId}` : ""}${out.deleted ? ` — حُذف ${Object.values(out.deleted).reduce((a, n) => a + n, 0)} سجل` : ""}`);
      return out;
    });
    return { ok: true, id: op.id, op: op.op, label: o.label, backup_id: backupId, result };
  } catch (e) {
    await transaction({ tenantId: tid, actor: ctx.actor, ip: ctx.ip, platform: true }, async (q) => {
      await q("UPDATE danger_operations SET status = 'failed', error = $2 WHERE id = $1 AND status = 'planned'", [op.id, String(e.message).slice(0, 500)]);
      await log(q, ctx, tid, `منطقة الحذر: فشل تنفيذ «${o.label}» (#${op.id}) ولم يتغير شيء`);
    }).catch(() => {});
    throw e;
  }
}

async function run(q, ctx, tid, op, token) {
  const tok = sha(token);
  const del = async (tables, opts = {}) => (await q("SELECT danger_delete($1, $2, $3, $4, $5, $6, $7) AS r",
    [op.id, tok, tid, op.op, tables, Boolean(opts.keepAdmins), Boolean(opts.whole)]))[0].r;
  const killSessions = async (exceptUser = null) =>
    (await q(`DELETE FROM sessions WHERE tenant_id = $1 ${exceptUser ? "AND user_id <> $2" : ""} RETURNING 1`, exceptUser ? [tid, exceptUser] : [tid])).length;
  const params = op.params || {};
  switch (op.op) {
    case "sessions_kill": return { sessions: await killSessions(ctx.scope === "admin" ? ctx.userId : null) };
    case "accounts_reset": {
      const users = await q(`SELECT id, username, full_name, role FROM users WHERE tenant_id = $1 AND (role <> 'admin' OR $2) ORDER BY role, id`,
        [tid, Boolean(params.include_admins)]);
      const creds = [];
      for (const u of users) {
        const pw = newTempPassword();
        await q(`UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL,
                   password_changed_at = now(), initial_password_enc = $3 WHERE id = $1`, [u.id, await hashPassword(pw), sealCredential(pw, tid)]);
        await clearLoginFailures(q, tid, u.username);
        creds.push({ name: u.full_name, username: u.username, role: u.role, password: pw });
      }
      const sessions = await killSessions(ctx.scope === "admin" ? ctx.userId : null);
      return { accounts: creds.length, sessions, credentials: creds };
    }
    case "emergency_lock":
      await q("UPDATE tenants SET emergency_locked_at = now(), emergency_reason = $2 WHERE id = $1", [tid, params.reason || null]);
      return { sessions: await killSessions() };
    case "emergency_unlock":
      await q("UPDATE tenants SET emergency_locked_at = NULL, emergency_reason = NULL WHERE id = $1", [tid]);
      return { unlocked: true };
    case "archive":
      await q("UPDATE tenants SET status = 'archived' WHERE id = $1", [tid]);
      return { sessions: await killSessions() };
    case "unarchive":
      await q("UPDATE tenants SET status = 'active', auto_suspended_at = NULL WHERE id = $1", [tid]);
      return { active: true };
    case "backup_create": {
      const bk = await createBackup(ctx, tid, params.reason || "نسخة يدوية", q);
      return { backup_id: bk.id, size_bytes: bk.size_bytes };
    }
    case "settings_reset": return { deleted: await del(SETTINGS_TABLES) };
    case "data_purge": return { deleted: await del(await tablesFor(q, op.op, params)) };
    case "data_reinit": return { deleted: await del(await tablesFor(q, op.op, params)) };
    case "school_reset": {
      const deleted = await del(await tablesFor(q, op.op, params), { keepAdmins: true });
      await ensureDefaults(q);   // سنة دراسية وفصولها كما عند إنشاء مدرسة جديدة
      await q("INSERT INTO school_profile (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO UPDATE SET setup_completed_at = NULL", [tid]);
      await killSessions();
      return { deleted };
    }
    case "backup_restore": {
      const { doc } = await readBackup(q, params.backup_id, tid);
      const [{ r }] = await q("SELECT danger_restore($1, $2, $3, $4, $5) AS r", [op.id, tok, tid, op.op, JSON.stringify(doc.data)]);
      return { restored: r, from_backup: params.backup_id, from_schema: doc.schema };
    }
    case "school_delete":
      return { deleted: await del(await tablesFor(q, op.op, params), { whole: true }), school_deleted: true };
    default: throw badRequest("عملية غير معروفة");
  }
}

export async function cancel(ctx, tid, id, token) {
  return transaction({ tenantId: tid, actor: ctx.actor, ip: ctx.ip, platform: true }, async (q) => {
    const op = await loadOp(q, ctx, id, token, tid);
    await q("UPDATE danger_operations SET status = 'cancelled' WHERE id = $1", [op.id]);
    await log(q, ctx, tid, `منطقة الحذر: أُلغيت «${OPERATIONS[op.op].label}» (#${op.id}) قبل التنفيذ`);
    return { ok: true };
  });
}

export const history = (q, tid) => q(
  `SELECT id, tenant_id, tenant_name, scope, op, params, status, requested_by, created_at, executed_at, backup_id, error,
          result - 'credentials' AS result, impact
     FROM danger_operations WHERE ($1::text IS NULL OR tenant_id = $1) ORDER BY id DESC LIMIT 100`, [tid]);

// ملخص المدرسة لشاشة البداية: الحالة وأرقام الفئات والنسخ
export async function summary(tid) {
  return transaction({ tenantId: tid, platform: true }, async (q) => {
    const [t] = await q("SELECT id, name, status, emergency_locked_at, emergency_reason, created_at FROM tenants WHERE id = $1", [tid]);
    if (!t) throw notFound("المدرسة غير موجودة");
    const cats = {};
    for (const [k, c] of Object.entries(CATEGORIES)) {
      const main = c.main || c.tables[c.tables.length - 1];   // الجدول الذي يمثل الفئة في العدّ
      const [r] = await q(`SELECT count(*)::int AS n FROM ${main} WHERE tenant_id = $1`, [tid]);
      cats[k] = r.n;
    }
    const [s] = await q("SELECT count(*)::int AS n FROM sessions WHERE tenant_id = $1", [tid]);
    const [u] = await q("SELECT count(*)::int AS n FROM users WHERE tenant_id = $1", [tid]);
    return { school: t, categories: cats, sessions: s.n, accounts: u.n, backups: await listBackups(q, tid) };
  });
}
