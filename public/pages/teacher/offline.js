// المعلم بدون إنترنت: مصدر بيانات محلي للحضور والدرجات، ومؤشر الاتصال والمزامنة.
// القراءة من القاعدة المحلية أولًا، والكتابة عمليات تُحفظ على الجهاز فورًا ثم تُرسل — بنفس المسار متصلًا أو لا.
import { h, mount } from "../shared/js/dom.js";
import { btn, dialog, notice, sub, badge, empty, toast } from "../shared/js/ui.js";
import { ATTENDANCE } from "../shared/js/format.js";
import { getSync, onSyncChange } from "../shared/js/offline/sync.js";

const noData = () => new Error("لا توجد بيانات على هذا الجهاز بعد. اتصل بالإنترنت مرة واحدة لتجهيز العمل بدون اتصال.");

/* ---------- الحضور ---------- */
export const attendanceSource = {
  offline: true,
  async list(classId, date) {
    const s = getSync();
    if (!s || !(await s.hasData())) throw noData();
    const students = (await s.db.all("students", "class_id", Number(classId))).sort((a, b) => a.name.localeCompare(b.name, "ar"));
    const marks = new Map((await s.db.all("attendance", "day", date)).map((a) => [Number(a.student_id), a]));
    return students.map((st) => ({ id: st.id, name: st.name, status: marks.get(Number(st.id))?.status || null, pending: Boolean(marks.get(Number(st.id))?.pending) }));
  },
  async save(date, reason, entries) {
    const s = getSync();
    if (!s) throw noData();
    let changed = 0;
    for (const e of entries) {
      const cur = await s.db.get("attendance", `${e.student_id}|${date}`);
      if (cur && cur.status === e.status && !e.excuse) continue;
      if (cur && cur.status !== e.status) changed++;
      await s.enqueue("attendance.mark", { student_id: e.student_id, day: date, status: e.status, reason: reason || null, excuse: e.excuse || null });
    }
    return { saved: entries.length, changed, local: true };
  },
};

/* ---------- الدرجات ---------- */
export async function localExam(examId) {
  const s = getSync();
  return s && (await s.hasData()) ? s.db.get("exams", Number(examId)) : null;
}
export async function localScoreRows(exam) {
  const s = getSync();
  const students = (await s.db.all("students", "class_id", Number(exam.class_id))).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const scores = new Map((await s.db.all("scores", "exam_id", Number(exam.id))).map((x) => [Number(x.student_id), x]));
  return students.map((st) => ({ id: st.id, name: st.name, score: scores.get(Number(st.id))?.score ?? null, pending: Boolean(scores.get(Number(st.id))?.pending) }));
}
export async function saveScoresLocal(exam, values) {
  const s = getSync();
  let n = 0;
  for (const [sid, score] of Object.entries(values)) {
    const cur = await s.db.get("scores", `${exam.id}|${sid}`);
    const same = cur ? (cur.score === null ? score === null : Number(cur.score) === score) : score === null;
    if (same) continue;
    await s.enqueue("score.set", { exam_id: Number(exam.id), student_id: Number(sid), score });
    n++;
  }
  return n;
}
// قبل الإرسال للاعتماد: كل درجات هذا الاختبار يجب أن تكون وصلت الخادم
export async function examSynced(examId) {
  const s = getSync();
  if (!s) return true;
  await s.syncNow();
  const q = await s.db.all("queue");
  return !q.some((o) => o.type === "score.set" && Number(o.payload.exam_id) === Number(examId));
}

/* ---------- مؤشر الاتصال والمزامنة (دائم أعلى الصفحة) ---------- */
export function syncIndicator() {
  const pill = h("button", { type: "button", class: "sync-pill", "aria-live": "polite" });
  onSyncChange((st) => {
    const [cls, text] = st.conflicts ? ["warn", `تعارض يحتاج مراجعة (${st.conflicts})`]
      : !st.online ? ["off", st.pending ? `غير متصل · ${st.pending} محفوظ على الجهاز` : "غير متصل · العمل محفوظ على الجهاز"]
      : st.syncing ? ["busy", "تتم المزامنة…"]
      : st.pending ? ["busy", `بانتظار المزامنة (${st.pending})`]
      : st.error ? ["warn", "تنبيه مزامنة"]
      : ["ok", "متصل · تمت المزامنة"];
    // نص كامل للشاشات الواسعة، ومختصر للجوال (شريط علوي ضيق)
    const short = st.conflicts ? `تعارض (${st.conflicts})` : !st.online ? `غير متصل${st.pending ? ` · ${st.pending}` : ""}`
      : st.syncing || st.pending ? `مزامنة${st.pending ? ` · ${st.pending}` : ""}` : st.error ? "تنبيه" : "متزامن";
    pill.className = `sync-pill ${cls}`;
    pill.title = text;
    pill.setAttribute("aria-label", text);
    mount(pill, h("span", { class: "full" }, text), h("span", { class: "short", "aria-hidden": "true" }, short));
  });
  pill.addEventListener("click", syncPanel);
  return pill;
}

async function syncPanel() {
  const s = getSync();
  if (!s) return;
  const box = h("div");
  const draw = async () => {
    const st = s.state;
    const conflicts = await s.conflicts();
    const last = st.lastSync ? new Date(st.lastSync).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }) : "لم تتم بعد";
    const describe = (o) => (o.type === "attendance.mark"
      ? [`الحضور ${o.payload.day}`, ATTENDANCE[o.server?.status]?.[0] || o.server?.status, ATTENDANCE[o.local?.status]?.[0] || o.local?.status]
      : ["درجة", o.server?.score ?? "—", o.local?.score ?? "—"]);
    const names = new Map((await s.db.all("students")).map((x) => [Number(x.id), x.name]));
    mount(box,
      h("div", { class: "row", style: "flex-wrap:wrap;gap:16px" },
        h("div", {}, sub("الحالة"), h("b", {}, st.online ? "متصل" : "غير متصل")),
        h("div", {}, sub("بانتظار المزامنة"), h("b", {}, st.pending)),
        h("div", {}, sub("آخر مزامنة"), h("b", {}, last))),
      st.error ? notice(st.error, "warn") : null,
      !st.online ? notice("يمكنك تسجيل الحضور وإدخال الدرجات الآن. كل ما تسجله محفوظ على هذا الجهاز ويُرسل تلقائيًا عند عودة الاتصال.", "") : null,
      conflicts.length ? [h("h3", {}, "تعارضات تحتاج قرارك"),
        sub("عدّل شخص آخر هذه السجلات بعد أن حُفظت على جهازك. اختر القيمة الصحيحة:"),
        conflicts.map((o) => {
          const [what, server, local] = describe(o);
          return h("div", { class: "line" },
            h("div", {}, h("b", {}, `${names.get(Number(o.payload.student_id)) || "طالب"} — ${what}`),
              sub(`على الخادم: ${server}${o.server?.by ? ` (${o.server.by})` : ""} — على جهازك: ${local}`)),
            h("div", { class: "row", style: "flex:none" },
              btn("اعتماد قيمة جهازي", async () => { await s.resolveConflict(o.operation_id, "local"); toast("حُلّ التعارض"); draw(); }, "primary sm"),
              btn("إبقاء قيمة الخادم", async () => { await s.resolveConflict(o.operation_id, "server"); toast("حُلّ التعارض"); draw(); }, "ghost sm")));
        })] : null);
  };
  await draw();
  dialog("المزامنة", box, [btn("مزامنة الآن", async () => { await s.syncNow(); draw(); }, "secondary")]);
}
