// شاشة حل الاختبار الإلكتروني للطالب: عدّاد الوقت من الخادم، حفظ تلقائي، كل أنواع الأسئلة الموضوعية والمقالية
import { h, mount } from "./dom.js";
import { btn, sub, toast, notice, textarea, input, confirmAction } from "./ui.js";
import { rich } from "./exam/math.js";

/**
 * @param {{ call: (path:string, body?:object) => Promise<any>, id: number, onExit: () => void }} o
 */
export async function takeExam({ call, id, onExit }) {
  const d = await call(`/student/online-exams/${id}/start`);
  const answers = { ...(d.answers || {}) };
  const offset = Date.now() - new Date(d.server_now).getTime();          // فرق ساعة الجهاز عن الخادم
  const deadline = new Date(d.deadline_at).getTime() + offset;
  const qs = d.content.sections.flatMap((s) => s.questions.map((q) => ({ ...q, section: s })));
  let dirty = false, saving = false, finished = false;

  const root = h("div", { class: "oe-take" });
  const timer = h("b", { class: "oe-timer", role: "timer", "aria-live": "off" });
  const status = h("small", { class: "muted" });
  const progress = h("small", { class: "muted" });
  const changed = () => { dirty = true; mount(status, "لم يُحفظ بعد"); drawProgress(); };
  const answered = (q) => {
    const a = answers[q.id];
    if (a === undefined || a === null || a === "") return false;
    if (Array.isArray(a)) return a.some((x) => x !== "" && x !== null && x !== undefined);
    if (typeof a === "object") return Object.keys(a).length > 0;
    return true;
  };
  const drawProgress = () => mount(progress, `أجبت ${qs.filter(answered).length} من ${qs.length}`);

  const save = async () => {
    if (!dirty || saving || finished) return;
    saving = true;
    try { await call(`/student/online-exams/${id}/save`, { answers }); dirty = false; mount(status, "حُفظت إجاباتك"); }
    catch (e) { mount(status, e.message); }
    finally { saving = false; }
  };
  const submit = async (auto = false) => {
    if (finished) return;
    if (!auto) {
      const left = qs.filter((q) => !answered(q)).length;
      if (!confirmAction(left ? `بقي ${left} سؤال بلا إجابة. تسليم الاختبار الآن؟` : "تسليم الاختبار الآن؟ لا يمكن التعديل بعده.")) return;
    }
    finished = true;
    clearInterval(tick); clearInterval(autosave);
    try {
      const r = await call(`/student/online-exams/${id}/submit`, { answers });
      mount(root, h("section", { class: "panel oe-done" },
        h("h2", {}, auto ? "انتهى الوقت وسُلّم الاختبار" : "سُلّم الاختبار"),
        r.score !== null && r.score !== undefined ? h("p", { class: "oe-score" }, `درجتك: ${r.score} من ${r.max_score}`)
          : r.pending ? sub("ستظهر درجتك بعد تصحيح المعلم للأسئلة المقالية.") : sub("تظهر النتيجة حسب ما تحدده المدرسة."),
        btn("رجوع لملف الطالب", onExit)));
    } catch (e) { finished = false; toast(e.message, true); }
  };

  const tick = setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    timer.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    timer.classList.toggle("low", left < 120000);
    if (left <= 0) submit(true);
  }, 500);
  const autosave = setInterval(save, 15000);
  // إغلاق الصفحة أو الانتقال لتطبيق آخر: حفظ فوري
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });

  const imageCache = new Map();
  const image = (q) => {
    if (!q.image?.id) return null;
    const img = h("img", { class: "oe-img", alt: "" , style: `max-width:${q.image.width || 60}%` });
    const load = imageCache.get(q.image.id) || call(`/student/online-exams/${id}/image`, { image_id: q.image.id }).then((r) => r.src);
    imageCache.set(q.image.id, load);
    load.then((src) => { img.src = src; }).catch(() => {});
    return img;
  };

  const control = (q) => {
    switch (q.type) {
      case "mcq": return h("div", { class: "oe-choices" }, (q.options || []).map((o) => h("label", {},
        h("input", { type: "radio", name: q.id, checked: answers[q.id] === o.id, onchange: () => { answers[q.id] = o.id; changed(); } }), h("span", {}, rich(o.text)))));
      case "multi": return h("div", { class: "oe-choices" }, (q.options || []).map((o) => h("label", {},
        h("input", { type: "checkbox", checked: (answers[q.id] || []).includes(o.id), onchange: (e) => {
          const set = new Set(answers[q.id] || []); e.target.checked ? set.add(o.id) : set.delete(o.id); answers[q.id] = [...set]; changed(); } }),
        h("span", {}, rich(o.text)))));
      case "truefalse": return h("div", { class: "oe-choices tf" }, [[true, "صح"], [false, "خطأ"]].map(([v, l]) => h("label", {},
        h("input", { type: "radio", name: q.id, checked: answers[q.id] === v, onchange: () => { answers[q.id] = v; changed(); } }), h("span", {}, l))));
      case "fill": {
        const cur = answers[q.id] || [];
        return h("div", { class: "oe-fill" }, Array.from({ length: q.blanks || 1 }, (_, i) => {
          const el = input({ value: cur[i] || "", placeholder: `الفراغ ${i + 1}` });
          el.addEventListener("input", () => { const a = [...(answers[q.id] || [])]; a[i] = el.value; answers[q.id] = a; changed(); });
          return el;
        }));
      }
      case "match": return h("div", { class: "oe-match" }, (q.left || []).map((l) => {
        const sel = h("select", {}, h("option", { value: "" }, "اختر…"), (q.right || []).map((r) => h("option", { value: r.id, selected: answers[q.id]?.[l.id] === r.id }, r.text)));
        sel.addEventListener("change", () => { answers[q.id] = { ...(answers[q.id] || {}), [l.id]: sel.value || undefined }; changed(); });
        return h("div", { class: "oe-match-row" }, h("span", {}, rich(l.text)), sel);
      }));
      case "order": {
        let order = answers[q.id] && answers[q.id].length === (q.items || []).length ? answers[q.id] : (q.items || []).map((x) => x.id);
        const box = h("ol", { class: "oe-order" });
        const draw = () => mount(box, order.map((oid, i) => h("li", {}, h("span", {}, (q.items || []).find((x) => x.id === oid)?.text || ""),
          h("span", { class: "oe-order-btns" },
            btn("أعلى", () => { if (i) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; answers[q.id] = [...order]; changed(); draw(); } }, "ghost sm"),
            btn("أسفل", () => { if (i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; answers[q.id] = [...order]; changed(); draw(); } }, "ghost sm")))));
        draw();
        return box;
      }
      default: {
        const t = textarea({ rows: q.type === "essay" ? 6 : 3, value: answers[q.id] || "", maxLength: 4000, placeholder: "اكتب إجابتك هنا" });
        t.addEventListener("input", () => { answers[q.id] = t.value; changed(); });
        return t;
      }
    }
  };

  const tableEl = (tb) => (tb?.rows?.length ? h("table", { class: "oe-table" }, tb.rows.map((row, ri) => h("tr", {},
    row.filter((c) => !c.hide).map((c) => h(tb.header && ri === 0 ? "th" : "td", { colspan: c.cs || 1, rowspan: c.rs || 1 }, c.t))))) : null);

  let lastSection = null;
  const items = qs.map((q, i) => {
    const head = q.section !== lastSection && (q.section.title || q.section.instructions)
      ? h("div", { class: "oe-section" }, q.section.title ? h("h3", {}, q.section.title) : null, q.section.instructions ? sub(q.section.instructions) : null) : null;
    lastSection = q.section;
    return [head, h("article", { class: "oe-question" },
      h("div", { class: "oe-qhead" }, h("b", {}, `السؤال ${i + 1}`), h("small", { class: "muted" }, `${q.marks} ${q.marks === 1 ? "درجة" : "درجات"}`)),
      q.image?.position === "before" ? image(q) : null,
      h("div", { class: "oe-qtext" }, rich(q.text, { blanks: q.type === "fill" })),
      tableEl(q.table),
      q.image && q.image.position !== "before" ? image(q) : null,
      control(q))];
  });

  mount(root,
    h("div", { class: "oe-bar" }, h("div", {}, h("b", {}, d.title), progress), h("div", { class: "oe-bar-side" }, status, timer)),
    d.instructions ? notice(d.instructions, "") : null,
    items,
    h("div", { class: "oe-submit" }, btn("تسليم الاختبار", () => submit(false), "primary wide")));
  drawProgress();
  return root;
}
