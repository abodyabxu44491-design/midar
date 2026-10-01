// تحضير الدروس: خطة أسبوعية لكل شعبة ومادة، تُرسل للإدارة للاعتماد
import { h } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, line, sub, toast, notice, confirmAction, dialog } from "../../shared/js/ui.js";
import { fmtDate, today } from "../../shared/js/format.js";

const PSTATE = { draft: ["مسودة", "gray"], submitted: ["بانتظار المراجعة", "amber"], approved: ["معتمد", ""], returned: ["معاد للتعديل", "red"] };
const FIELDS = [["objectives", "الأهداف", 2000], ["content", "المحتوى وخطوات الدرس", 4000], ["activities", "الأنشطة", 2000],
  ["assessment", "التقويم", 1000], ["homework", "الواجب", 1000], ["resources", "الوسائل", 1000]];

export default async function lessons({ me, refresh }) {
  const plans = await api("/api/teacher/lesson-plans");
  const pairs = me.load || [];
  if (!pairs.length) return notice("لا توجد مواد مسندة لك.", "warn");
  const editor = (p) => {
    const pair = select(pairs.map((l) => [`${l.class_id}:${l.subject_id}`, `${l.class_name} — ${l.subject_name}`]), { value: p ? `${p.class_id}:${p.subject_id}` : undefined });
    const week = input({ type: "date", value: p?.week_start || today() });
    const topic = input({ value: p?.topic || "", maxLength: 200, placeholder: "موضوع الدرس أو الوحدة" });
    const areas = Object.fromEntries(FIELDS.map(([k, , max]) => [k, textarea({ rows: 3, maxLength: max, value: p?.[k] || "" })]));
    const body = (submit) => { const [c, s] = pair.value.split(":").map(Number); return { class_id: c, subject_id: s, week_start: week.value, topic: topic.value.trim(),
      ...Object.fromEntries(Object.entries(areas).map(([k, el]) => [k, el.value.trim() || null])), submit }; };
    const save = async (submit) => {
      if (topic.value.trim().length < 2) return toast("اكتب موضوع الدرس", true);
      if (p) await api(`/api/teacher/lesson-plans/${p.id}`, body(submit), "PUT"); else await api("/api/teacher/lesson-plans", body(submit));
      d.close(); toast(submit ? "أُرسل للإدارة" : "حُفظ"); refresh();
    };
    const d = dialog(p ? "تعديل التحضير" : "تحضير جديد", h("div", { class: "lp-form" },
      p?.review_note ? notice(`ملاحظة الإدارة: ${p.review_note}`, p.status === "returned" ? "warn" : "") : null,
      h("div", { class: "row" }, field("الشعبة والمادة", pair), field("الأسبوع (أي يوم فيه)", week)), field("الموضوع", topic),
      FIELDS.map(([k, label]) => field(label, areas[k]))),
    [btn("حفظ مسودة", () => save(false), "ghost"), btn("حفظ وإرسال للإدارة", () => save(true))]);
  };
  return [
    panel("تحضير الدروس", btn("+ تحضير جديد", () => editor(null), "sm"),
      sub("خطة لكل شعبة ومادة في كل أسبوع. أرسلها للإدارة لتعتمدها، وإن أعادتها تصلك ملاحظتها."),
      plans.length ? plans.map((p) => line(
        h("div", {}, h("b", {}, p.topic), " ", badge(...PSTATE[p.status]), sub(`${p.class_name} — ${p.subject} — أسبوع ${fmtDate(p.week_start)}`),
          p.review_note && p.status === "returned" ? sub(`ملاحظة: ${p.review_note}`) : null),
        h("div", { class: "row", style: "flex:none;gap:6px" },
          p.status !== "approved" ? btn("تعديل", () => editor(p), "ghost sm") : btn("عرض", () => editor({ ...p }), "ghost sm"),
          p.status === "draft" || p.status === "returned" ? btn("حذف", async () => { if (!confirmAction("حذف التحضير؟")) return; await api(`/api/teacher/lesson-plans/${p.id}`, undefined, "DELETE"); refresh(); }, "ghost sm") : null)))
        : empty("لم تكتب تحضيرًا بعد.")),
  ];
}
