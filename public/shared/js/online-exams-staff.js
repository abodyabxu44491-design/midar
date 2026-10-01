// الاختبارات الإلكترونية للمعلم والإدارة: النشر، والنتائج، وتصحيح الأسئلة المقالية، ورصد الدرجات
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, notice, dialog, confirmAction, stats } from "./ui.js";
import { fmtDateTime } from "./format.js";
import { rich } from "./exam/math.js";

const SHOW = { none: "لا تظهر الدرجة للطالب", score: "تظهر الدرجة بعد التسليم", answers: "الدرجة والإجابات الصحيحة بعد الإغلاق" };
const pad = (n) => String(n).padStart(2, "0");
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function publishDialog({ base, paper, classes = [], onDone }) {
  const now = new Date(); now.setMinutes(now.getMinutes() + 5, 0, 0);
  const end = new Date(now.getTime() + 2 * 86400000);
  const opens = input({ type: "datetime-local", value: localInput(now) });
  const closes = input({ type: "datetime-local", value: localInput(end) });
  const duration = input({ type: "number", min: 1, max: 600, value: paper.duration_min || 30, class: "ltr" });
  const show = select(Object.entries(SHOW), { value: "score" });
  const shuffle = h("input", { type: "checkbox", checked: true });
  const link = h("input", { type: "checkbox", checked: true });
  const cls = classes.length > 1 ? select(classes.map((c) => [c.id, c.name]), { value: paper.class_id }) : null;
  const d = dialog(`نشر «${paper.title}» إلكترونيًا`, h("div", {},
    sub("يحل الطلاب الاختبار من ملف الطالب على الجوال. الأسئلة الموضوعية تُصحح تلقائيًا، والمقالية تصححها أنت."),
    cls ? field("الشعبة", cls) : null,
    h("div", { class: "row" }, field("يفتح", opens), field("يُغلق", closes)),
    h("div", { class: "row" }, field("المدة بالدقائق", duration, "تبدأ من لحظة دخول الطالب"), field("النتيجة للطالب", show)),
    h("label", { class: "check-line" }, shuffle, "ترتيب مختلف للأسئلة والخيارات لكل طالب"),
    h("label", { class: "check-line" }, link, "رصد الدرجة في «رصد الدرجات» تلقائيًا")),
  [btn("نشر وإشعار الطلاب", async () => {
    const r = await api(base, { paper_id: paper.id, class_id: cls ? Number(cls.value) : paper.class_id || undefined,
      opens_at: new Date(opens.value).toISOString(), closes_at: new Date(closes.value).toISOString(),
      duration_min: Number(duration.value), show_result: show.value, shuffle: shuffle.checked, link_exam: link.checked });
    d.close(); toast(`نُشر الاختبار (${r.max_score} درجة)`); onDone?.();
  })]);
}

export async function onlineExamsPanel({ base }) {
  const root = h("div");
  const drawList = async () => {
    const rows = await api(base);
    const now = Date.now();
    const state = (x) => (now < new Date(x.opens_at) ? ["لم يبدأ", "gray"] : now > new Date(x.closes_at) || x.status !== "open" ? ["مغلق", "gray"] : ["مفتوح الآن", ""]);
    mount(root, panel("الاختبارات الإلكترونية", null,
      sub("انشر أي اختبار معتمد من قائمة الاختبارات بزر «نشر إلكترونيًا»."),
      rows.length ? rows.map((x) => line(
        h("div", {}, h("b", {}, x.title), " ", badge(...state(x)), x.to_grade ? badge(`${x.to_grade} بانتظار التصحيح`, "amber") : null,
          sub(`${x.class_name} — ${x.subject} — ${fmtDateTime(x.opens_at)} إلى ${fmtDateTime(x.closes_at)} — ${x.duration_min} دقيقة`),
          sub(`سلّم ${x.submitted} من ${x.class_size}${x.started > x.submitted ? ` — ${x.started - x.submitted} يحل الآن` : ""}`)),
        btn("النتائج", () => drawExam(x.id), "ghost sm"))) : empty("لم تنشر اختبارات إلكترونية بعد.")));
  };
  const drawExam = async (id) => {
    const d = await api(`${base}/${id}`);
    const x = d.exam;
    const done = d.students.filter((s) => s.submitted_at);
    const scores = done.filter((s) => !s.needs_grading).map((s) => Number(s.score));
    const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null;
    mount(root,
      h("div", { class: "toolbar" }, btn("رجوع", drawList, "ghost sm"),
        x.exam_id ? btn("رصد الدرجات", async () => { const r = await api(`${base}/${id}/sync`, {}); toast(`رُصدت ${r.synced} درجة${r.waiting ? ` — ${r.waiting} بانتظار التصحيح` : ""}`); }, "sm") : null,
        x.status === "open" ? btn("إغلاق الآن", async () => { if (!confirmAction("إغلاق الاختبار؟ يُسلَّم ما حفظه الطلاب.")) return; await api(`${base}/${id}/close`, {}); drawExam(id); }, "ghost sm") : null,
        !d.students.some((s) => s.attempt_id) ? btn("حذف", async () => { if (!confirmAction("حذف الاختبار الإلكتروني؟")) return; await api(`${base}/${id}`, undefined, "DELETE"); drawList(); }, "danger sm") : null),
      panel(x.title, null,
        stats([["سلّم", `${done.length} / ${d.students.length}`], ["المتوسط", avg === null ? "—" : `${avg} / ${x.max_score}`],
          ["بانتظار التصحيح", done.filter((s) => s.needs_grading).length], ["الأسئلة", x.question_count]]),
        sub(`${SHOW[x.show_result]}. الطالب الذي انتهى وقته يُسلَّم تلقائيًا بما حفظه.`),
        h("div", { class: "table-wrap" }, h("table", { class: "grid" },
          h("thead", {}, h("tr", {}, h("th", {}, "الطالب"), h("th", {}, "الحالة"), h("th", {}, "الدرجة"), h("th", {}, ""))),
          h("tbody", {}, d.students.map((s) => h("tr", {},
            h("td", {}, s.name),
            h("td", {}, s.submitted_at ? (s.needs_grading ? badge("يحتاج تصحيحًا", "amber") : badge("سلّم")) : s.attempt_id ? badge("يحل الآن", "amber") : badge("لم يبدأ", "gray")),
            h("td", {}, s.submitted_at && !s.needs_grading ? `${s.score} / ${x.max_score}` : s.auto_score !== null && s.submitted_at ? `${s.auto_score} + ؟` : "—"),
            h("td", {}, s.submitted_at ? btn(s.needs_grading ? "تصحيح" : "عرض", () => gradeDialog(id, s.attempt_id, () => drawExam(id)), "ghost sm") : null))))))));
  };
  await drawList();
  return root;

  async function gradeDialog(id, aid, after) {
    const d = await api(`${base}/${id}/attempts/${aid}`);
    const manual = {};
    const body = d.questions.map((q, i) => {
      const ans = q.answer;
      let shown;
      if (q.type === "mcq" || q.type === "multi") {
        const picked = new Set([].concat(ans || []));
        shown = h("ul", { class: "oe-opts" }, (q.options || []).map((o) => h("li", { class: `${(q.correct || []).includes(o.id) ? "right" : ""}${picked.has(o.id) ? " picked" : ""}` }, o.text)));
      } else if (q.type === "truefalse") shown = sub(`إجابته: ${ans === true ? "صح" : ans === false ? "خطأ" : "—"} — الصحيح: ${q.correct ? "صح" : "خطأ"}`);
      else if (q.type === "fill") shown = sub(`إجابته: ${[].concat(ans || []).join(" ، ") || "—"} — الصحيح: ${(q.answers || []).join(" ، ")}`);
      else if (q.type === "match") shown = h("ul", { class: "oe-opts" }, (q.left || []).map((l) => {
        const got = q.right.find((r) => r.id === ans?.[l.id]);
        const ok = q.key_pairs?.[l.id] === ans?.[l.id];
        return h("li", { class: ok ? "right picked" : "picked" }, `${l.text} ← ${got?.text || "—"}`);
      }));
      else if (q.type === "order") shown = sub(`ترتيبه: ${[].concat(ans || []).map((id) => (q.items || []).find((x) => x.id === id)?.text || "؟").join(" ← ")}`);
      else shown = h("div", { class: "oe-essay" }, ans ? String(ans) : h("span", { class: "muted" }, "لم يُجب"));
      const markInput = !q.auto ? input({ type: "number", min: 0, max: q.marks, step: 0.25, value: q.mark ?? "", class: "ltr", style: "max-width:90px" }) : null;
      markInput?.addEventListener("input", () => { manual[q.id] = markInput.value === "" ? null : Number(markInput.value); });
      return h("div", { class: "oe-review" },
        h("div", { class: "oe-q" }, h("b", {}, `${i + 1}. `), rich(q.text, { blanks: q.type === "fill" })),
        shown,
        q.model && !q.auto ? sub(`الإجابة النموذجية: ${q.model}`) : null,
        h("div", { class: "oe-mark" }, q.auto ? sub(`الدرجة: ${q.mark ?? 0} من ${q.marks}`) : [field(`درجة السؤال (من ${q.marks})`, markInput)]));
    });
    const dd = dialog(`إجابات ${d.student}`, h("div", { class: "oe-review-list" }, body),
      d.questions.some((q) => !q.auto) ? [btn("حفظ التصحيح", async () => {
        const r = await api(`${base}/${id}/attempts/${aid}/marks`, { marks: manual }, "PUT");
        toast(r.needs_grading ? "حُفظ. بقيت أسئلة بلا درجة." : `الدرجة النهائية ${r.score}`); dd.close(); after();
      })] : []);
  }
}

export const onlineBaseOf = (papersBase) => papersBase.replace(/\/papers$/, "/online-exams");

