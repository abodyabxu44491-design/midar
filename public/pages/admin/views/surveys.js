// الاستبيانات (الإدارة): إنشاء استبيان بأسئلة متنوعة، ونتائج مجمعة، وإغلاق
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, line, sub, toast, confirmAction, dialog } from "../../shared/js/ui.js";
import { fmtDate } from "../../shared/js/format.js";
import { A } from "./common.js";

const QT = { rating: "تقييم 1 إلى 5", yesno: "نعم / لا", choice: "اختيار واحد", multi: "اختيار متعدد", text: "إجابة مكتوبة" };
const AUD = { parents: "أولياء الأمور", staff: "المعلمون", all: "الجميع" };

export default async function surveys({ nav }) {
  const list = await api(`${A}/engagement/surveys`);
  const root = h("div");
  const drawList = () => mount(root, panel("الاستبيانات", btn("+ استبيان", builder, "sm"),
    list.length ? list.map((s) => line(h("div", {}, h("b", {}, s.title), " ", badge(s.status === "open" ? "مفتوح" : "مغلق", s.status === "open" ? "" : "gray"),
      sub(`${AUD[s.audience]} — ${s.questions} سؤال — ${s.responses} إجابة${s.closes_on ? ` — يُغلق ${fmtDate(s.closes_on)}` : ""}${s.anonymous ? " — بلا أسماء" : ""}`)),
      h("div", { class: "row", style: "flex:none;gap:6px" }, btn("النتائج", () => resultsView(s.id), "sm"),
        btn(s.status === "open" ? "إغلاق" : "فتح", async () => { await api(`${A}/engagement/surveys/${s.id}/status`, { status: s.status === "open" ? "closed" : "open" }); nav.show(); }, "ghost sm"),
        btn("حذف", async () => { if (!confirmAction("حذف الاستبيان وإجاباته؟")) return; await api(`${A}/engagement/surveys/${s.id}`, undefined, "DELETE"); nav.show(); }, "ghost sm"))))
      : empty("اسأل أولياء الأمور أو المعلمين عن رأيهم: رضا، اقتراحات، مواعيد مناسبة…")));
  const resultsView = async (id) => {
    const r = await api(`${A}/engagement/surveys/${id}`);
    const bar = (label, n, total) => h("div", { class: "sv-bar" }, h("span", {}, label), h("i", { style: `width:${total ? Math.round((n / total) * 100) : 0}%` }), h("b", {}, n));
    mount(root, h("div", { class: "toolbar" }, btn("رجوع", drawList, "ghost sm"), btn("طباعة", () => window.print(), "ghost sm")),
      panel(r.survey.title, null, sub(`${r.responses} إجابة`),
        r.questions.map((q, i) => h("div", { class: "oe-review" }, h("b", {}, `${i + 1}. ${q.text}`), sub(`أجاب ${q.answered}`),
          q.type === "rating" ? [sub(`المتوسط ${q.average ?? "—"} من 5`), q.counts.map((n, k) => bar(`${k + 1}`, n, q.answered))]
            : q.type === "yesno" ? [bar("نعم", q.counts.yes, q.answered), bar("لا", q.counts.no, q.answered)]
              : q.options ? q.options.map((o) => bar(o.text, o.count, q.answered))
                : q.texts.length ? q.texts.map((x) => sub(`${x.text}${x.who ? ` — ${x.who}` : ""}`)) : sub("لا إجابات")))));
  };
  function builder() {
    const title = input({ maxLength: 150 }), desc = textarea({ rows: 2, maxLength: 1000 });
    const audience = select(Object.entries(AUD)), closes = input({ type: "date" });
    const anon = h("input", { type: "checkbox", checked: true });
    const qs = [{ type: "rating", text: "", options: [] }];
    const qBox = h("div");
    const drawQs = () => mount(qBox, qs.map((q, i) => {
      const type = select(Object.entries(QT), { value: q.type });
      const text = input({ value: q.text, placeholder: `السؤال ${i + 1}` });
      const opts = textarea({ rows: 2, value: (q.options || []).join("\n"), placeholder: "خيار في كل سطر" });
      const optF = field("الخيارات", opts); optF.hidden = !["choice", "multi"].includes(q.type);
      type.addEventListener("change", () => { q.type = type.value; optF.hidden = !["choice", "multi"].includes(q.type); });
      text.addEventListener("input", () => { q.text = text.value; });
      opts.addEventListener("input", () => { q.options = opts.value.split("\n").map((x) => x.trim()).filter(Boolean); });
      return h("div", { class: "oe-review" }, h("div", { class: "row" }, field(`السؤال ${i + 1}`, text), field("النوع", type)), optF,
        qs.length > 1 ? btn("حذف السؤال", () => { qs.splice(i, 1); drawQs(); }, "ghost sm") : null);
    }));
    drawQs();
    const d = dialog("استبيان جديد", h("div", { style: "display:grid;gap:8px;min-width:min(620px,86vw)" },
      field("العنوان", title), field("وصف قصير", desc), h("div", { class: "row" }, field("موجّه إلى", audience), field("يُغلق في (اختياري)", closes)),
      h("label", { class: "check-line" }, anon, "بلا أسماء (لا تظهر هوية المجيب)"), qBox,
      btn("+ سؤال", () => { qs.push({ type: "choice", text: "", options: [] }); drawQs(); }, "ghost sm")),
    [btn("نشر وإشعار", async () => {
      await api(`${A}/engagement/surveys`, { title: title.value.trim(), description: desc.value.trim() || null, audience: audience.value, closes_on: closes.value || null,
        anonymous: anon.checked, questions: qs.map((q) => ({ type: q.type, text: q.text.trim(), options: q.options })) });
      d.close(); toast("نُشر الاستبيان"); nav.show();
    })]);
  }
  drawList();
  return root;
}
