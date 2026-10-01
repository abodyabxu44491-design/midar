// التقارير الذكية: إجابات فورية ومجانية بلا ذكاء اصطناعي.
// تستخدم أدوات القراءة نفسها التي يستخدمها المساعد، وتصوغ النتيجة جملًا عربية وجداول ونصائح عملية.
// لا تكلفة على المنصة ولا على المدرسة، وتعمل حتى بلا أي مفتاح.
import { inTenant } from "../../core/db/pool.js";
import { notFound } from "../../core/http/errors.js";
import { z } from "../../core/http/validate.js";
import { dataTools } from "./ai.service.js";

const pct = (v) => (v == null ? "—" : `${v}%`);
const num = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const days = (n) => plural(n, "يوم واحد", "يومان", "أيام", "يومًا");
const table = (title, head, rows) => (rows.length ? { title, head, rows } : null);

/* ---------- كتالوج التقارير ----------
   params: ما تحتاجه (class: اختيار فصل، name: اسم طالب). module: القسم الذي يلزم تفعيله. */
export const REPORTS = [
  { key: "overview", title: "ملخص المدرسة اليوم", hint: "الأعداد وحضور اليوم والرسوم", icon: "home" },
  { key: "attendance", title: "الحضور والغياب", hint: "النسبة لكل فصل وأكثر الطلاب غيابًا", icon: "check", params: ["class"], module: "attendance" },
  { key: "exams", title: "نتائج الاختبارات", hint: "أضعف المواد والمتفوقون ومن يحتاج دعمًا", icon: "award", params: ["class"], module: "exams" },
  { key: "finance", title: "الرسوم والمتأخرون", hint: "المحصّل والمتبقي وأعلى المبالغ المتأخرة", icon: "money", params: ["class"], module: "fees" },
  { key: "behavior", title: "السلوك", hint: "المتميزون والأكثر مخالفات", icon: "star", module: "behavior" },
  { key: "staff", title: "دوام الموظفين", hint: "الغياب والتأخر هذا الشهر والإجازات المعلقة", icon: "briefcase", module: "staff_attendance" },
  { key: "student", title: "ملف طالب سريع", hint: "اكتب اسم الطالب", icon: "users", params: ["name"] },
];

export const reportParams = z.object({
  class_name: z.string().trim().max(80).optional().transform((v) => v || undefined),
  name: z.string().trim().max(80).optional().transform((v) => v || undefined),
});

const BUILD = {
  async overview(q, _p, ctx) {
    const o = await dataTools.school_overview(q, {});
    const lines = [`في المدرسة **${num(o.students)}** طالبًا و**${num(o.teachers)}** معلمًا موزعين على **${num(o.classes)}** فصلًا.`];
    if (o.current_term) lines.push(`الفصل الدراسي الحالي: ${o.current_term}.`);
    if (o.attendance_recorded_today) {
      const rate = Math.round(1000 * (o.attendance_recorded_today - o.absent_today) / o.attendance_recorded_today) / 10;
      lines.push(`حضور اليوم: **${rate}%** — غائب ${num(o.absent_today)} ومتأخر ${num(o.late_today)} من ${num(o.attendance_recorded_today)} سُجّل حضورهم.`);
    } else lines.push("لم يُسجَّل حضور اليوم بعد.");
    if (o.fees_total) lines.push(`الرسوم: المحصّل **${num(o.fees_paid)}** من ${num(o.fees_total)} ${ctx.currency}، والمتبقي **${num(o.fees_remaining)}**.`);
    const tips = [];
    if (!o.attendance_recorded_today) tips.push("ذكّر المعلمين بتسجيل حضور اليوم.");
    if (o.fees_total && o.fees_remaining / o.fees_total > 0.3) tips.push("المتبقي من الرسوم أكثر من 30%، راجع تقرير «الرسوم والمتأخرون».");
    return { lines, tables: [], tips };
  },

  async attendance(q, { class_name }) {
    const r = await dataTools.attendance_report(q, { class_name });
    if (!r.records) return { lines: [`لا توجد سجلات حضور من ${r.from} إلى ${r.to}${class_name ? ` للفصل «${class_name}»` : ""}.`], tables: [], tips: [] };
    const lines = [`نسبة الحضور **${pct(r.attendance_rate)}** خلال ${days(r.school_days)} دراسية (من ${r.from} إلى ${r.to}).`,
      `إجمالي الغياب ${num(r.absent)} والتأخر ${num(r.late)} والغياب بعذر ${num(r.excused)}.`];
    const low = r.by_class.slice(0, 5);
    if (low.length > 1) lines.push(`أقل الفصول حضورًا: **${low[0].class}** (${pct(low[0].attendance_rate)}).`);
    const tips = [];
    const heavy = r.most_absent.filter((s) => s.absent >= 5);
    if (heavy.length) tips.push(`تواصل مع أولياء أمور ${heavy.length === 1 ? "الطالب" : `${heavy.length} طلاب`} تجاوز غيابهم 5 أيام، ويمكنك إرسال تنبيه لهم من «التواصل».`);
    if (r.attendance_rate != null && r.attendance_rate < 90) tips.push("النسبة أقل من 90%، يفيد تفعيل إشعار الغياب الفوري لأولياء الأمور.");
    return { lines, tips, tables: [
      table("الحضور حسب الفصل (الأقل أولًا)", ["الفصل", "الحضور", "الغياب"], r.by_class.slice(0, 12).map((c) => [c.class || "—", pct(c.attendance_rate), num(c.absent)])),
      table("أكثر الطلاب غيابًا", ["الطالب", "الفصل", "الغياب", "التأخر"], r.most_absent.map((s) => [s.student, s.class || "—", num(s.absent), num(s.late)])),
    ].filter(Boolean) };
  },

  async exams(q, { class_name }) {
    let r = await dataTools.exam_results(q, { class_name, scope: "current_term" });
    let scopeText = "في الفصل الدراسي الحالي";
    if (!r.by_class_subject.length) { r = await dataTools.exam_results(q, { class_name, scope: "all" }); scopeText = "في كل الاختبارات المسجلة"; }
    if (!r.by_class_subject.length) return { lines: ["لا توجد درجات مرصودة بعد."], tables: [], tips: [] };
    const subj = new Map();
    for (const x of r.by_class_subject) {
      const s = subj.get(x.subject) || { sum: 0, n: 0, below: 0 };
      s.sum += x.average * x.exams; s.n += x.exams; s.below += x.below_50; subj.set(x.subject, s);
    }
    const bySubject = [...subj.entries()].map(([name, s]) => ({ name, avg: Math.round(10 * s.sum / s.n) / 10, below: s.below })).sort((a, b) => a.avg - b.avg);
    const lines = [`المتوسط العام ${scopeText}: **${pct(r.overall_average)}**${class_name ? ` (الفصل «${class_name}»)` : ""}.`];
    if (bySubject.length > 1) lines.push(`أضعف مادة: **${bySubject[0].name}** (${pct(bySubject[0].avg)})، وأقواها **${bySubject.at(-1).name}** (${pct(bySubject.at(-1).avg)}).`);
    const weak = r.lowest_students.filter((s) => s.average < 50);
    const tips = [];
    if (weak.length) tips.push(`${weak.length === 1 ? "طالب واحد" : `${weak.length} طلاب`} متوسطهم أقل من 50%، اقترح لهم حصص تقوية وتواصلًا مع أولياء أمورهم.`);
    if (bySubject[0] && bySubject[0].avg < 60) tips.push(`راجع مع معلمي ${bySubject[0].name} أسباب انخفاض المتوسط وخطة العلاج.`);
    return { lines, tips, tables: [
      table("متوسط المواد (الأضعف أولًا)", ["المادة", "المتوسط", "درجات تحت 50%"], bySubject.slice(0, 15).map((s) => [s.name, pct(s.avg), num(s.below)])),
      table("الطلاب الأقل متوسطًا", ["الطالب", "الفصل", "المتوسط"], r.lowest_students.map((s) => [s.student, s.class, pct(s.average)])),
      table("المتفوقون", ["الطالب", "الفصل", "المتوسط"], r.top_students.map((s) => [s.student, s.class, pct(s.average)])),
    ].filter(Boolean) };
  },

  async finance(q, { class_name }, ctx) {
    const r = await dataTools.finance_report(q, { class_name });
    if (!r.fees_total) return { lines: ["لا توجد فواتير مفتوحة."], tables: [], tips: [] };
    const c = ctx.currency;
    const lines = [`نسبة التحصيل **${pct(r.collection_rate)}**: المحصّل ${num(r.fees_paid)} من ${num(r.fees_total)} ${c}.`,
      `المتبقي **${num(r.fees_remaining)} ${c}** على ${num(r.students_owing)} طالبًا، منها ${num(r.overdue_amount)} ${c} متأخرة في ${num(r.overdue_invoices)} فاتورة.`,
      `المحصّل آخر 30 يومًا: ${num(r.collected_last_30_days)} ${c}.`];
    const tips = [];
    if (r.overdue_invoices) tips.push("أرسل تذكيرًا بالرسوم المتأخرة من «التواصل» عبر واتساب أو الإشعارات.");
    if (r.collection_rate != null && r.collection_rate < 70) tips.push("التحصيل أقل من 70%، يفيد تقسيط الرسوم من «خطط الرسوم».");
    return { lines, tips, tables: [table("أعلى المبالغ المتبقية", ["الطالب", "الفصل", `المتبقي (${c})`], r.top_remaining.map((s) => [s.student, s.class || "—", num(s.remaining)]))].filter(Boolean) };
  },

  async behavior(q) {
    const r = await dataTools.behavior_report(q, {});
    if (!r.records) return { lines: ["لا توجد سجلات سلوك في الفصل الدراسي الحالي."], tables: [], tips: [] };
    const lines = [`سُجّل ${num(r.records)} موقفًا: نقاط إيجابية **${num(r.positive_points)}** ونقاط سلبية **${num(r.negative_points)}** في ${num(r.incidents)} مخالفة.`];
    if (r.common_incidents[0]) lines.push(`أكثر المخالفات تكرارًا: **${r.common_incidents[0].title}** (${num(r.common_incidents[0].times)} مرة).`);
    const tips = [];
    if (r.top_positive.length) tips.push("كرّم المتميزين سلوكيًا في الطابور أو بشهادة شكر من قسم «الشهادات».");
    if (r.most_incidents[0]?.incidents >= 3) tips.push("الطلاب ذوو 3 مخالفات فأكثر يحتاجون جلسة مع المرشد وتواصلًا مع ولي الأمر.");
    return { lines, tips, tables: [
      table("المتميزون سلوكيًا", ["الطالب", "الفصل", "النقاط"], r.top_positive.map((s) => [s.student, s.class || "—", num(s.points)])),
      table("الأكثر مخالفات", ["الطالب", "الفصل", "المخالفات", "النقاط المخصومة"], r.most_incidents.map((s) => [s.student, s.class || "—", num(s.incidents), num(s.points)])),
      table("أكثر المخالفات تكرارًا", ["المخالفة", "المرات"], r.common_incidents.map((x) => [x.title, num(x.times)])),
    ].filter(Boolean) };
  },

  async staff(q) {
    const r = await dataTools.staff_report(q, {});
    const list = r.staff_with_absence_or_lateness;
    const lines = [list.length ? `${list.length === 1 ? "موظف واحد" : `${list.length} موظفين`} لديهم غياب أو تأخر أو إجازة هذا الشهر.` : "لا غياب ولا تأخر مسجل للموظفين هذا الشهر."];
    if (r.pending_leave_requests) lines.push(`طلبات إجازة بانتظار قرارك: **${num(r.pending_leave_requests)}**.`);
    const tips = r.pending_leave_requests ? ["راجع طلبات الإجازة المعلقة من «شؤون الموظفين»."] : [];
    return { lines, tips, tables: [table("الغياب والتأخر هذا الشهر", ["الموظف", "غياب", "تأخر", "دقائق التأخر", "إجازة"],
      list.map((s) => [s.staff, num(s.absent), num(s.late), num(s.late_minutes), num(s.leave_days)]))].filter(Boolean) };
  },

  async student(q, { name }) {
    if (!name || name.length < 2) return { lines: ["اكتب اسم الطالب أو جزءًا منه (حرفان على الأقل)."], tables: [], tips: [] };
    const r = await dataTools.student_lookup(q, { name });
    if (!Array.isArray(r)) return { lines: [`لم أجد طالبًا باسم «${name}».`], tables: [], tips: [] };
    const lines = [], tables = [], tips = [];
    for (const s of r) {
      const t = s.this_term;
      lines.push(`**${s.student}** — ${s.class || "بلا فصل"}${s.archived ? " (مؤرشف)" : ""}: غياب ${num(t.absent)} وتأخر ${num(t.late)}، متوسط الدرجات ${pct(t.average)}، نقاط السلوك ${num(t.behavior_points)}، المتبقي من الرسوم ${num(s.fees_remaining)}.`);
      if (r.length === 1 && t.subjects.length) tables.push(table("متوسط المواد هذا الفصل", ["المادة", "المتوسط"], t.subjects.map((x) => [x.subject, pct(x.average)])));
      if (t.absent >= 5) tips.push(`غياب ${s.student} مرتفع، يفيد التواصل مع ولي أمره.`);
      if (t.average != null && t.average < 50) tips.push(`متوسط ${s.student} أقل من 50%، يحتاج خطة دعم.`);
    }
    if (r.length === 5) lines.push("تظهر أول 5 نتائج فقط، اكتب الاسم أدق لنتيجة واحدة.");
    return { lines, tables: tables.filter(Boolean), tips };
  },
};

/** تشغيل تقرير: يعيد { key, title, lines, tables, tips, generated_at } */
export async function runReport(req, key, params) {
  const def = REPORTS.find((r) => r.key === key);
  if (!def || (def.module && req.modules?.[def.module] === false)) throw notFound("التقرير غير موجود");
  const ctx = { currency: req.tenant.currency || "YER" };
  const out = await inTenant(req, (q) => BUILD[key](q, params, ctx));
  return { key, title: def.title, ...out, generated_at: new Date().toISOString() };
}

/** التقارير المتاحة حسب الأقسام المفعّلة */
export const availableReports = (modules = {}) => REPORTS.filter((r) => !r.module || modules[r.module] !== false)
  .map(({ key, title, hint, icon, params = [] }) => ({ key, title, hint, icon, params }));
