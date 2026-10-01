// المساعد الذكي للإدارة: يجيب عن أسئلة المدير من بيانات مدرسته عبر أدوات قراءة فقط.
// - كل أداة تعمل في معاملة قصيرة خاصة بالمدرسة (RLS)، فلا يُحجز اتصال قاعدة البيانات أثناء انتظار النموذج
// - لا ترسل الأدوات أرقام الهواتف ولا مفاتيح الدخول ولا أي بيانات اعتماد
// - المفتاح من البيئة فقط ولا يُسجَّل؛ يُحفظ السؤال والجواب وعدد الرموز في ai_queries
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config/env.js";
import { inTenant } from "../../core/db/pool.js";
import { AppError } from "../../core/http/errors.js";
import { z } from "../../core/http/validate.js";

const MODEL = () => env.AI_MODEL || "claude-opus-5-5";
const MAX_ROUNDS = 8;          // أقصى عدد جولات أدوات للسؤال الواحد
const DAILY_LIMIT = 100;       // أسئلة المدرسة في اليوم
const RESULT_CAP = 24000;      // حد حجم نتيجة الأداة (حرف)

let testClient = null;
/** للاختبارات: عميل بديل له beta.messages.create */
export const setAiClient = (c) => { testClient = c; };
export const aiReady = () => Boolean(testClient || env.ANTHROPIC_API_KEY);

let realClient = null;
const client = () => testClient || (realClient ||= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 2 }));

/* ---------- نص التعليمات (ثابت تمامًا ليُخزَّن مؤقتًا مع الأدوات) ---------- */
const SYSTEM = `أنت «مساعد مدار»، مساعد تحليلي لمدير مدرسة على منصة مدار. تجيب بالعربية الفصحى المبسطة عن أسئلة المدير حول بيانات مدرسته.

طريقة العمل:
- استخدم الأدوات المتاحة لجلب الأرقام الفعلية قبل الإجابة، ولا تخمّن رقمًا لم تُرجعه أداة.
- إذا احتجت أكثر من أداة فاطلبها معًا في نفس الجولة.
- إذا لم تكفِ الأدوات للإجابة فقل ذلك بوضوح واقترح أقرب ما يمكن معرفته.
- الأدوات للقراءة فقط؛ لا تستطيع تعديل أي بيانات. إذا طُلب منك تعديل فوضّح أن ذلك يتم من أقسام المنصة.

أسلوب الإجابة:
- ابدأ بالجواب المباشر في جملة أو جملتين، ثم التفاصيل المهمة فقط.
- استخدم قوائم قصيرة أو جدولًا بسيطًا عند المقارنة. الأرقام بالأرقام العربية الغربية (0-9).
- النسب لأقرب رقم عشري واحد، والمبالغ بعملة المدرسة المذكورة في السياق.
- عند ذكر طلاب يحتاجون متابعة اقترح إجراءً عمليًا واحدًا أو اثنين.
- لا تذكر أسماء الأدوات ولا تفاصيل تقنية في الإجابة.`;

/* ---------- الأدوات ---------- */
const dateStr = { type: "string", description: "تاريخ بصيغة YYYY-MM-DD" };
const TOOLS = [
  { name: "school_overview", description: "ملخص المدرسة الآن: أعداد الطلاب والمعلمين والفصول، الفصل الدراسي الحالي، حضور اليوم، إجمالي الرسوم والمحصّل والمتبقي.",
    input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_classes", description: "قائمة الفصول مع عدد الطلاب في كل فصل.",
    input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "attendance_report", description: "تقرير حضور الطلاب لفترة: النسبة العامة، النسبة لكل فصل، وأكثر الطلاب غيابًا. الفترة الافتراضية من بداية الفصل الدراسي الحالي حتى اليوم.",
    input_schema: { type: "object", properties: { from: dateStr, to: dateStr, class_name: { type: "string", description: "اسم الفصل أو جزء منه (اختياري)" } }, additionalProperties: false } },
  { name: "exam_results", description: "نتائج الاختبارات كنسب مئوية: متوسط كل مادة في كل فصل، وأعلى وأدنى الطلاب متوسطًا.",
    input_schema: { type: "object", properties: {
      class_name: { type: "string", description: "اسم الفصل أو جزء منه (اختياري)" },
      subject_name: { type: "string", description: "اسم المادة أو جزء منه (اختياري)" },
      scope: { type: "string", enum: ["current_term", "all"], description: "الفصل الدراسي الحالي (الافتراضي) أو كل الاختبارات" } }, additionalProperties: false } },
  { name: "finance_report", description: "الرسوم: الإجمالي والمحصّل والمتبقي، الفواتير المتأخرة، تحصيل آخر 30 يومًا، وأعلى الطلاب في المبالغ المتبقية.",
    input_schema: { type: "object", properties: { class_name: { type: "string", description: "اسم الفصل (اختياري)" } }, additionalProperties: false } },
  { name: "behavior_report", description: "السلوك لفترة: مجموع النقاط الإيجابية والسلبية، أكثر الطلاب نقاطًا إيجابية وأكثرهم مخالفات، وأكثر المخالفات تكرارًا.",
    input_schema: { type: "object", properties: { from: dateStr, to: dateStr }, additionalProperties: false } },
  { name: "student_lookup", description: "البحث عن طالب بالاسم (حتى 5 نتائج) مع فصله وغيابه وتأخره في الفصل الدراسي الحالي ومتوسط درجاته ونقاط سلوكه والمتبقي عليه من الرسوم.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "اسم الطالب أو جزء منه" } }, required: ["name"], additionalProperties: false } },
  { name: "staff_report", description: "شؤون الموظفين لفترة: الغياب والتأخر لكل موظف، وطلبات الإجازة المعلقة. الفترة الافتراضية الشهر الحالي.",
    input_schema: { type: "object", properties: { from: dateStr, to: dateStr }, additionalProperties: false } },
];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const name = z.string().trim().min(1).max(80).optional();
const INPUTS = {
  school_overview: z.object({}).strict(),
  list_classes: z.object({}).strict(),
  attendance_report: z.object({ from: day, to: day, class_name: name }).strict(),
  exam_results: z.object({ class_name: name, subject_name: name, scope: z.enum(["current_term", "all"]).optional() }).strict(),
  finance_report: z.object({ class_name: name }).strict(),
  behavior_report: z.object({ from: day, to: day }).strict(),
  student_lookup: z.object({ name: z.string().trim().min(2).max(80) }).strict(),
  staff_report: z.object({ from: day, to: day }).strict(),
};

const like = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const n1 = (x) => (x == null ? null : Math.round(Number(x) * 10) / 10);
const n2 = (x) => (x == null ? null : Math.round(Number(x) * 100) / 100);

// بداية الفترة الافتراضية: بداية الفصل الدراسي الحالي، وإلا قبل 30 يومًا
const termStart = `COALESCE((SELECT start_date FROM terms WHERE id = current_term()), CURRENT_DATE - 30)`;

const RUN = {
  async school_overview(q) {
    const [o] = await q(`SELECT
      (SELECT count(*) FROM students WHERE archived_at IS NULL)::int AS students,
      (SELECT count(*) FROM teachers)::int AS teachers,
      (SELECT count(*) FROM classes)::int AS classes,
      (SELECT name FROM terms WHERE id = current_term()) AS current_term,
      (SELECT start_date FROM terms WHERE id = current_term()) AS term_start,
      (SELECT end_date FROM terms WHERE id = current_term()) AS term_end,
      (SELECT count(*) FROM attendance WHERE day = CURRENT_DATE)::int AS attendance_recorded_today,
      (SELECT count(*) FROM attendance WHERE day = CURRENT_DATE AND status = 'absent')::int AS absent_today,
      (SELECT count(*) FROM attendance WHERE day = CURRENT_DATE AND status = 'late')::int AS late_today`);
    const [f] = await q(`SELECT COALESCE(SUM(i.amount), 0) AS total, COALESCE(SUM(p.net), 0) AS paid
       FROM invoices i LEFT JOIN (SELECT invoice_id, SUM(CASE WHEN kind = 'payment' THEN amount ELSE -amount END) AS net
                                    FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
      WHERE i.status = 'open'`);
    return { ...o, fees_total: n2(f.total), fees_paid: n2(f.paid), fees_remaining: n2(f.total - f.paid) };
  },

  async list_classes(q) {
    return q(`SELECT c.name, count(s.id)::int AS students
                FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.archived_at IS NULL
               GROUP BY c.id, c.name ORDER BY c.name`);
  },

  async attendance_report(q, { from, to, class_name }) {
    const p = [from || null, to || null, class_name ? like(class_name) : null];
    const range = `a.day BETWEEN COALESCE($1::date, ${termStart}) AND COALESCE($2::date, CURRENT_DATE)
                   AND ($3::text IS NULL OR c.name ILIKE $3)`;
    const base = `FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id WHERE ${range}`;
    const [t] = await q(`SELECT COALESCE($1::date, ${termStart}) AS from, COALESCE($2::date, CURRENT_DATE) AS to,
        count(*)::int AS records, count(DISTINCT a.day)::int AS school_days,
        count(*) FILTER (WHERE a.status = 'absent')::int AS absent, count(*) FILTER (WHERE a.status = 'late')::int AS late,
        count(*) FILTER (WHERE a.status = 'excused')::int AS excused,
        100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0) AS attendance_rate ${base}`, p);
    const byClass = await q(`SELECT c.name AS class, count(*)::int AS records,
        100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*), 0) AS attendance_rate,
        count(*) FILTER (WHERE a.status = 'absent')::int AS absent ${base} GROUP BY c.name ORDER BY attendance_rate`, p);
    const top = await q(`SELECT s.full_name AS student, c.name AS class,
        count(*) FILTER (WHERE a.status = 'absent')::int AS absent, count(*) FILTER (WHERE a.status = 'late')::int AS late ${base}
        GROUP BY s.id, s.full_name, c.name HAVING count(*) FILTER (WHERE a.status = 'absent') > 0
        ORDER BY absent DESC, late DESC LIMIT 10`, p);
    return { ...t, attendance_rate: n1(t.attendance_rate),
      by_class: byClass.map((r) => ({ ...r, attendance_rate: n1(r.attendance_rate) })), most_absent: top };
  },

  async exam_results(q, { class_name, subject_name, scope = "current_term" }) {
    const p = [class_name ? like(class_name) : null, subject_name ? like(subject_name) : null, scope === "current_term"];
    const base = `FROM scores sc JOIN exams e ON e.id = sc.exam_id JOIN classes c ON c.id = e.class_id
                  JOIN subjects su ON su.id = e.subject_id JOIN students s ON s.id = sc.student_id
                 WHERE sc.score IS NOT NULL AND e.status <> 'draft' AND s.archived_at IS NULL
                   AND ($1::text IS NULL OR c.name ILIKE $1) AND ($2::text IS NULL OR su.name ILIKE $2)
                   AND (NOT $3 OR e.term_id = current_term())`;
    const pct = `100.0 * sc.score / e.max_score`;
    const bySubject = await q(`SELECT c.name AS class, su.name AS subject, count(DISTINCT e.id)::int AS exams,
        avg(${pct}) AS average, count(*) FILTER (WHERE ${pct} < 50)::int AS below_50 ${base}
        GROUP BY c.name, su.name ORDER BY c.name, average`, p);
    const students = await q(`SELECT s.full_name AS student, c.name AS class, avg(${pct}) AS average, count(*)::int AS scores ${base}
        GROUP BY s.id, s.full_name, c.name`, p);
    students.sort((a, b) => a.average - b.average);
    const fmt = (r) => ({ ...r, average: n1(r.average) });
    return { scope, exams_found: bySubject.reduce((n, r) => n + r.exams, 0),
      overall_average: students.length ? n1(students.reduce((n, r) => n + Number(r.average), 0) / students.length) : null,
      by_class_subject: bySubject.slice(0, 120).map(fmt),
      lowest_students: students.slice(0, 10).map(fmt), top_students: students.slice(-10).reverse().map(fmt) };
  },

  async finance_report(q, { class_name }) {
    const p = [class_name ? like(class_name) : null];
    const rows = await q(`SELECT s.full_name AS student, c.name AS class, i.amount, i.due_date, COALESCE(p.net, 0) AS paid
       FROM invoices i JOIN students s ON s.id = i.student_id LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN (SELECT invoice_id, SUM(CASE WHEN kind = 'payment' THEN amount ELSE -amount END) AS net
                    FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
      WHERE i.status = 'open' AND ($1::text IS NULL OR c.name ILIKE $1)`, p);
    const today = new Date().toISOString().slice(0, 10);
    let total = 0, paid = 0, overdue = 0, overdueAmount = 0;
    const owing = new Map();
    for (const r of rows) {
      const rem = Number(r.amount) - Number(r.paid);
      total += Number(r.amount); paid += Number(r.paid);
      if (rem > 0) {
        const k = `${r.student}|${r.class || ""}`;
        owing.set(k, (owing.get(k) || 0) + rem);
        if (r.due_date && String(r.due_date instanceof Date ? r.due_date.toISOString() : r.due_date).slice(0, 10) < today) { overdue++; overdueAmount += rem; }
      }
    }
    const [c] = await q(`SELECT COALESCE(SUM(CASE WHEN p.kind = 'payment' THEN p.amount ELSE -p.amount END), 0) AS collected
       FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN students s ON s.id = i.student_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE p.created_at > now() - interval '30 days' AND ($1::text IS NULL OR c.name ILIKE $1)`, p);
    const top = [...owing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k, v]) => { const [student, cls] = k.split("|"); return { student, class: cls || null, remaining: n2(v) }; });
    return { fees_total: n2(total), fees_paid: n2(paid), fees_remaining: n2(total - paid),
      collection_rate: total ? n1(100 * paid / total) : null, students_owing: owing.size,
      overdue_invoices: overdue, overdue_amount: n2(overdueAmount), collected_last_30_days: n2(c.collected), top_remaining: top };
  },

  async behavior_report(q, { from, to }) {
    const p = [from || null, to || null];
    const base = `FROM behavior_records b JOIN students s ON s.id = b.student_id LEFT JOIN classes c ON c.id = s.class_id
                 WHERE b.day BETWEEN COALESCE($1::date, ${termStart}) AND COALESCE($2::date, CURRENT_DATE)`;
    const [t] = await q(`SELECT count(*)::int AS records, COALESCE(SUM(points) FILTER (WHERE kind = 'positive'), 0)::int AS positive_points,
        COALESCE(-SUM(points) FILTER (WHERE kind = 'negative'), 0)::int AS negative_points,
        count(*) FILTER (WHERE kind = 'negative')::int AS incidents ${base}`, p);
    const best = await q(`SELECT s.full_name AS student, c.name AS class, SUM(b.points)::int AS points ${base} AND b.kind = 'positive'
        GROUP BY s.id, s.full_name, c.name ORDER BY points DESC LIMIT 10`, p);
    const worst = await q(`SELECT s.full_name AS student, c.name AS class, count(*)::int AS incidents, (-SUM(b.points))::int AS points ${base} AND b.kind = 'negative'
        GROUP BY s.id, s.full_name, c.name ORDER BY incidents DESC, points DESC LIMIT 10`, p);
    const common = await q(`SELECT b.title, count(*)::int AS times ${base} AND b.kind = 'negative' GROUP BY b.title ORDER BY times DESC LIMIT 8`, p);
    return { ...t, top_positive: best, most_incidents: worst, common_incidents: common };
  },

  async student_lookup(q, { name: n }) {
    const rows = await q(`SELECT s.id, s.full_name AS student, c.name AS class, s.archived_at IS NOT NULL AS archived
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.full_name ILIKE $1 ORDER BY s.archived_at NULLS FIRST, s.full_name LIMIT 5`, [like(n)]);
    for (const r of rows) {
      const [a] = await q(`SELECT count(*) FILTER (WHERE status = 'absent')::int AS absent, count(*) FILTER (WHERE status = 'late')::int AS late,
          count(*)::int AS recorded_days FROM attendance WHERE student_id = $1 AND day >= ${termStart}`, [r.id]);
      const [e] = await q(`SELECT avg(100.0 * sc.score / e.max_score) AS average, count(*)::int AS scores
          FROM scores sc JOIN exams e ON e.id = sc.exam_id WHERE sc.student_id = $1 AND sc.score IS NOT NULL AND e.status <> 'draft' AND e.term_id = current_term()`, [r.id]);
      const subj = await q(`SELECT su.name AS subject, avg(100.0 * sc.score / e.max_score) AS average
          FROM scores sc JOIN exams e ON e.id = sc.exam_id JOIN subjects su ON su.id = e.subject_id
         WHERE sc.student_id = $1 AND sc.score IS NOT NULL AND e.status <> 'draft' AND e.term_id = current_term() GROUP BY su.name ORDER BY average`, [r.id]);
      const [b] = await q(`SELECT COALESCE(SUM(points), 0)::int AS behavior_points, count(*) FILTER (WHERE kind = 'negative')::int AS incidents
          FROM behavior_records WHERE student_id = $1 AND day >= ${termStart}`, [r.id]);
      const [f] = await q(`SELECT COALESCE(SUM(i.amount - invoice_net_paid(i.id)), 0) AS remaining FROM invoices i WHERE i.student_id = $1 AND i.status = 'open'`, [r.id]);
      Object.assign(r, { this_term: { ...a, average: n1(e.average), scores: e.scores,
        subjects: subj.map((x) => ({ subject: x.subject, average: n1(x.average) })), ...b }, fees_remaining: n2(f.remaining) });
      delete r.id;
    }
    return rows.length ? rows : { found: 0 };
  },

  async staff_report(q, { from, to }) {
    const p = [from || null, to || null];
    const range = `sa.day BETWEEN COALESCE($1::date, date_trunc('month', CURRENT_DATE)::date) AND COALESCE($2::date, CURRENT_DATE)`;
    const rows = await q(`SELECT st.full_name AS staff,
        count(*) FILTER (WHERE sa.status = 'absent')::int AS absent, count(*) FILTER (WHERE sa.status = 'late')::int AS late,
        COALESCE(SUM(sa.late_min), 0)::int AS late_minutes, count(*) FILTER (WHERE sa.status = 'leave')::int AS leave_days
       FROM staff st JOIN staff_attendance sa ON sa.staff_id = st.id AND ${range}
      GROUP BY st.id, st.full_name HAVING count(*) FILTER (WHERE sa.status IN ('absent', 'late', 'leave')) > 0
      ORDER BY absent DESC, late DESC LIMIT 30`, p);
    const [l] = await q(`SELECT count(*)::int AS pending FROM leave_requests WHERE status = 'pending'`);
    return { staff_with_absence_or_lateness: rows, pending_leave_requests: l.pending };
  },
};

async function runTool(req, call) {
  const schema = INPUTS[call.name];
  if (!schema) return { error: `أداة غير معروفة: ${call.name}` };
  const input = schema.safeParse(call.input ?? {});
  if (!input.success) return { error: `مدخلات غير صحيحة: ${input.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}` };
  try {
    return await inTenant(req, (q) => RUN[call.name](q, input.data));
  } catch (e) {
    // جداول الأقسام موجودة دائمًا؛ أي خطأ هنا يُعاد للنموذج دون تفاصيل داخلية
    console.error("ai tool failed", call.name, e.message);
    return { error: "تعذر جلب هذه البيانات الآن" };
  }
}

const json = (v) => { const s = JSON.stringify(v); return s.length > RESULT_CAP ? `${s.slice(0, RESULT_CAP)}…(مقتطع)` : s; };
const textOf = (content) => content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

/** يجيب عن سؤال المدير. history: آخر أسئلة وأجوبة الجلسة كنصوص */
export async function ask(req, { question, history = [] }) {
  if (!aiReady()) throw new AppError(503, "المساعد الذكي غير مفعّل على المنصة بعد", "ai_unavailable");
  const [{ used }] = await inTenant(req, (q) => q(`SELECT count(*)::int AS used FROM ai_queries WHERE created_at > now() - interval '1 day'`));
  if (used >= DAILY_LIMIT) throw new AppError(429, `بلغت المدرسة حد ${DAILY_LIMIT} سؤالًا في اليوم، حاول لاحقًا`, "rate_limited");

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Aden" });
  const context = `السياق: المدرسة «${req.tenant.name}»، العملة ${req.tenant.currency || "YER"}، تاريخ اليوم ${today}، السائل: ${req.user.full_name}.`;
  const messages = [];
  for (const h of history.slice(-4)) {
    messages.push({ role: "user", content: h.q }, { role: "assistant", content: h.a });
  }
  messages.push({ role: "user", content: [{ type: "text", text: context }, { type: "text", text: question }] });

  let tokensIn = 0, tokensOut = 0, answer = "";
  const used_tools = [];
  for (let round = 0; ; round++) {
    let res;
    try {
      res = await client().beta.messages.create({
        model: MODEL(),
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        system: SYSTEM,
        tools: TOOLS,
        messages,
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new AppError(429, "المساعد مشغول الآن، حاول بعد قليل", "rate_limited");
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        console.error("ai auth failed", e.status);
        throw new AppError(503, "إعداد المساعد على المنصة غير صحيح، تواصل مع الدعم", "ai_unavailable");
      }
      if (e instanceof Anthropic.APIError) { console.error("ai api error", e.status, e.message); throw new AppError(502, "تعذر الوصول إلى المساعد الآن، حاول بعد قليل", "ai_unavailable"); }
      throw e;
    }
    tokensIn += (res.usage?.input_tokens || 0) + (res.usage?.cache_read_input_tokens || 0) + (res.usage?.cache_creation_input_tokens || 0);
    tokensOut += res.usage?.output_tokens || 0;

    if (res.stop_reason === "refusal") { answer = "لا أستطيع الإجابة عن هذا السؤال. جرّب صياغته بشكل آخر يتعلق ببيانات المدرسة."; break; }
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
    if (res.stop_reason !== "tool_use") {
      answer = textOf(res.content) || "لم أجد إجابة مناسبة.";
      if (res.stop_reason === "max_tokens") answer += "\n\n(الإجابة طويلة وتوقفت هنا؛ اسأل عن جزء محدد)";
      break;
    }
    if (round >= MAX_ROUNDS) { answer = textOf(res.content) || "السؤال يحتاج خطوات كثيرة؛ جرّب تقسيمه إلى أسئلة أصغر."; break; }

    const calls = res.content.filter((b) => b.type === "tool_use");
    messages.push({ role: "assistant", content: res.content });
    const results = await Promise.all(calls.map(async (c) => {
      used_tools.push(c.name);
      const out = await runTool(req, c);
      return { type: "tool_result", tool_use_id: c.id, content: json(out), ...(out?.error ? { is_error: true } : {}) };
    }));
    messages.push({ role: "user", content: results });
  }

  answer = answer.slice(0, 20000);
  const [row] = await inTenant(req, (q) => q(
    `INSERT INTO ai_queries (tenant_id, user_id, question, answer, tokens_in, tokens_out)
     VALUES (app_tenant(), $1, $2, $3, $4, $5) RETURNING id, created_at`,
    [req.user.id ?? null, question, answer, tokensIn, tokensOut]));
  return { id: row.id, answer, created_at: row.created_at, tools: [...new Set(used_tools)], remaining_today: DAILY_LIMIT - used - 1 };
}

export const recentQuestions = (req) => inTenant(req, (q) => q(
  `SELECT id, question, answer, created_at FROM ai_queries WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY id DESC LIMIT 20`, [req.user.id ?? null]));

// للاختبارات
export const _tools = { TOOLS, RUN, INPUTS };
