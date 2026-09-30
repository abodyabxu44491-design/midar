// نافذة «لصق أسئلة جاهزة»: نص ملصوق أو ملف Word ← معاينة فورية ← إضافة.
// مشتركة بين مصمم الاختبار (إضافة لأقسام الورقة) وبنك الأسئلة (حفظ دفعة واحدة).
import { h, mount } from "../dom.js";
import { field, input, textarea, btn, notice, toast, dialog, empty } from "../ui.js";
import { QTYPES, OPTION_LETTERS, fmtNum } from "./engine.js";
import { parseQuestions } from "./parse.js";
import { rich, loadMath } from "./math.js";

const EXAMPLE = "الصق أسئلتك هنا، أو ارفع ملف Word. مثال:\n\n1- عاصمة المملكة العربية السعودية هي:\nأ) الرياض *\nب) جدة\nج) مكة\n\n2- الشمس نجم (صح)\n3- عاصمة مصر هي ______ (القاهرة)";

function answerText(q) {
  if (q.options) { const c = q.options.filter((o) => (q.correct || []).includes(o.id)).map((o) => o.text); return c.length ? `✓ ${c.join("، ")}` : "⚠ بدون إجابة صحيحة"; }
  if (q.type === "truefalse") return q.correct === true ? "✓ صح" : q.correct === false ? "✓ خطأ" : "⚠ حدد صح أو خطأ";
  if (q.type === "fill") return q.answers?.length ? `✓ ${q.answers.join("، ")}` : "";
  if (q.type === "match") return `${q.pairs.length} أزواج`;
  return q.answer ? `✓ ${q.answer}` : "";
}

/**
 * pasteDialog({ title, fields, addLabel, onAdd })
 *   fields: عناصر إضافية أسفل النص (مثل: إلى أي قسم، المادة والوحدة)
 *   onAdd(parsed): يعيد true لإغلاق النافذة (يمكن أن يكون async)
 */
export function pasteDialog({ title = "لصق أسئلة جاهزة", fields = null, addLabel = "إضافة الأسئلة", onAdd }) {
  const ta = textarea({ rows: 14, dir: "auto", class: "xb-paste", placeholder: EXAMPLE });
  const marksIn = input({ type: "number", min: 0.25, step: 0.25, value: 1, style: "max-width:90px" });
  const out = h("div", { class: "xb-paste-prev" });
  let parsed = { sections: [], count: 0, warnings: [] };
  let fileNote = null;

  const paint = async () => {
    parsed = parseQuestions(ta.value, { marks: Number(marksIn.value) || 1 });
    if (/\$/.test(ta.value)) await loadMath();
    let n = 0;
    const byType = parsed.sections.flatMap((x) => x.questions).reduce((a, q) => ({ ...a, [q.type]: (a[q.type] || 0) + 1 }), {});
    const missing = parsed.sections.flatMap((x) => x.questions).filter((q) => /⚠/.test(answerText(q))).length;
    mount(out, !parsed.count
      ? empty(ta.value.trim() ? "لم يُتعرّف على أسئلة. رقّم الأسئلة (1- 2- …) أو افصل بينها بسطر فارغ." : "المعاينة تظهر هنا أثناء اللصق.")
      : [h("div", { class: "xb-paste-sum" }, `تعرّفنا على ${parsed.count} سؤال`,
          ...Object.entries(byType).map(([k, c]) => h("span", { class: "xb-type" }, `${QTYPES[k].short} ${c}`))),
        missing ? notice(`${missing} سؤال بلا إجابة صحيحة. يمكنك إضافتها بعد الإضافة، أو ضع * بعد الخيار الصحيح هنا.`, "warn") : null,
        fileNote,
        parsed.sections.map((sec) => h("div", {},
          sec.title ? h("div", { class: "xb-paste-sec" }, sec.title) : null,
          sec.questions.map((q) => h("div", { class: "xb-paste-q" },
            h("span", { class: "xb-qno" }, ++n), h("span", { class: "xb-type" }, QTYPES[q.type].short),
            h("div", {}, h("div", {}, q.text ? rich(q.text, { blanks: true }) : q.type === "match" ? q.pairs.map((p) => `${p.left} ← ${p.right}`).join(" · ") : "—"),
              q.options ? h("div", { class: "small muted" }, q.options.map((o, i) => `${OPTION_LETTERS[i]}) ${o.text}`).join("   ")) : null,
              h("div", { class: `small ${/⚠/.test(answerText(q)) ? "xb-warn-t" : "xb-ok-t"}` }, answerText(q))),
            h("span", { class: "small muted" }, `${fmtNum(q.marks)} د`))))),
        parsed.warnings.map((w) => notice(w, "warn"))]);
  };
  ta.addEventListener("input", () => { clearTimeout(ta._t); ta._t = setTimeout(paint, 250); });
  marksIn.addEventListener("input", paint);

  // رفع ملف Word: يُقرأ في المتصفح ويوضع نصه في الخانة لمراجعته قبل الإضافة
  const fileIn = h("input", { type: "file", accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain", class: "hidden" });
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files[0];
    fileIn.value = "";
    if (!f) return;
    try {
      if (/\.doc$/i.test(f.name)) throw new Error("صيغة .doc القديمة غير مدعومة. احفظ الملف من Word بصيغة .docx ثم ارفعه.");
      if (/\.txt$/i.test(f.name) || f.type === "text/plain") { ta.value = await f.text(); fileNote = null; }
      else {
        const { docxToText } = await import("./docx.js");
        const r = await docxToText(f);
        ta.value = r.text;
        fileNote = r.images ? notice(`في الملف ${r.images} صورة لا تُنقل تلقائيًا. أضفها للسؤال بعد الإضافة من «خيارات إضافية».`, "warn") : null;
      }
      await paint();
      toast(`قُرئ الملف: ${parsed.count} سؤال`);
    } catch (e) { toast(e.message, true); }
  });

  const help = h("details", { class: "xb-paste-help" }, h("summary", {}, "كيف أكتب الأسئلة ليتعرّف عليها النظام؟"),
    h("ul", {},
      h("li", {}, "رقّم الأسئلة: 1- أو 1) أو 1. — أو افصل بين الأسئلة بسطر فارغ. الترقيم التلقائي في Word يُقرأ أيضًا."),
      h("li", {}, "اختيار من متعدد: الخيارات في أسطر تبدأ بـ أ) ب) ج) — وضع ", h("b", {}, "*"), " بعد الإجابة الصحيحة، أو سطر «الإجابة: ب»."),
      h("li", {}, "صح أو خطأ: اكتب (صح) أو (خطأ) في آخر العبارة."),
      h("li", {}, "أكمل الفراغ: اكتب ____ أو ..... مكان الفراغ، والإجابة بين قوسين في آخر السطر."),
      h("li", {}, "توصيل: كل زوج في سطر: الماء = H2O"),
      h("li", {}, "عنوان قسم: سطر يبدأ بـ «السؤال الأول:» أو «السؤال الثاني:»."),
      h("li", {}, "الدرجة: اكتب (2 درجة) في آخر السؤال، وإلا تُستخدم الدرجة الافتراضية.")));

  const add = async () => {
    if (!parsed.count) return toast("الصق الأسئلة أو ارفع ملف Word أولًا", true);
    if (await onAdd(parsed)) d.close();
  };
  const d = dialog(title, h("div", { class: "xb-paste-grid" },
    h("div", {},
      h("div", { class: "row", style: "justify-content:flex-start;margin-bottom:6px" }, btn("رفع ملف Word", () => fileIn.click(), "ghost sm"), fileIn),
      ta, help,
      h("div", { class: "row", style: "align-items:end" }, field("درجة كل سؤال (افتراضيًا)", marksIn), fields)),
    h("div", {}, h("b", { class: "small" }, "المعاينة"), out)),
  [btn(addLabel, add)]);
  d.classList.add("xb-xwide");
  paint();
  ta.focus();
  return d;
}
