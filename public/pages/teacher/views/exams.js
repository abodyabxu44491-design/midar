// إنشاء الاختبارات وإدخال الدرجات وإرسالها للاعتماد
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, notice, confirmAction } from "/shared/js/ui.js";
import { EXAM, fmtDate, today } from "/shared/js/format.js";

const T = "/api/teacher/exams";

export default async function exams({ me, refresh }) {
  if (!me.load.length) return empty("لا توجد مواد مسندة لك.");
  const list = await api(T);
  const pair = select(me.load.map((l) => [`${l.class_id}:${l.subject_id}`, `${l.class_name} — ${l.subject_name}`]));
  const title = input({ placeholder: "اختبار الفترة الأولى" });
  const date = input({ type: "date", value: today() });
  const max = input({ type: "number", value: 20, min: 0.25, step: "0.25" });
  return [
    panel("اختبار جديد", null,
      h("div", { class: "row" }, field("العنوان", title), field("الفصل والمادة", pair)),
      h("div", { class: "row" }, field("التاريخ", date), field("الدرجة القصوى", max)),
      btn("إنشاء الاختبار", async () => {
        const [class_id, subject_id] = pair.value.split(":");
        await api(T, { class_id, subject_id, title: title.value, exam_date: date.value || null, max_score: max.value });
        toast("تم إنشاء الاختبار"); refresh();
      })),
    panel("اختباراتي", null, list.length ? list.map((e) => examRow(e, refresh)) : empty("لا توجد اختبارات بعد.")),
  ];
}

function examRow(e, refresh) {
  const box = h("div", { class: "hidden", style: "background:var(--bg);border-radius:8px;padding:10px;margin-top:8px;width:100%" });
  const toggle = btn(e.status === "draft" ? "إدخال الدرجات" : "عرض الدرجات", async () => {
    if (!box.classList.contains("hidden")) return box.classList.add("hidden");
    const rows = await api(`${T}/${e.id}/scores`);
    const locked = e.status !== "draft";
    const inputs = rows.map((r) => [r.id, input({ type: "number", min: 0, max: e.max_score, step: "0.25", value: r.score ?? "",
      disabled: locked, style: "width:90px", "aria-label": `درجة ${r.name}` })]);
    const collect = () => {
      const out = {};
      for (const [id, el] of inputs) {
        const v = el.value.trim();
        if (v !== "" && (Number(v) < 0 || Number(v) > e.max_score)) throw new Error(`درجة غير صحيحة: ${v} (القصوى ${e.max_score})`);
        out[id] = v === "" ? null : Number(v);
      }
      return out;
    };
    mount(box,
      locked ? notice("الدرجات مقفلة بعد الإرسال. تُفتح إذا أرجعتها الإدارة.", "warn") : null,
      rows.length ? rows.map((r, i) => line(h("span", {}, r.name), inputs[i][1])) : empty("لا يوجد طلاب في الفصل."),
      !locked && h("div", { class: "row spaced", style: "justify-content:flex-start" },
        btn("حفظ مسودة", async () => { const r = await api(`${T}/${e.id}/scores`, { scores: collect() }, "PUT"); toast(`تم حفظ ${r.saved} درجة`); }, "soft sm"),
        btn("حفظ وإرسال للاعتماد", async () => {
          const scores = collect();
          const missing = Object.values(scores).filter((v) => v === null).length;
          if (!confirmAction(missing ? `هناك ${missing} طالب بدون درجة. إرسال للاعتماد؟` : "إرسال الدرجات للإدارة؟ لن تستطيع تعديلها بعد ذلك.")) return;
          await api(`${T}/${e.id}/scores`, { scores }, "PUT");
          await api(`${T}/${e.id}/submit`, {});
          toast("تم الإرسال للإدارة"); refresh();
        }, "sm")));
    box.classList.remove("hidden");
  }, "ghost sm");
  return line(
    h("div", {}, h("b", {}, e.title), " ", badge(...EXAM[e.status]),
      sub(`${e.class_name} — ${e.subject_name} — ${fmtDate(e.exam_date)} — من ${e.max_score} — أُدخلت ${e.graded}`)),
    toggle, box);
}
