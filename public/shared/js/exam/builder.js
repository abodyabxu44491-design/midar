// مصمم الاختبار: معلومات ← الأسئلة ← تصميم الورقة ← المعاينة والطباعة
// كل تغيير يُحفظ تلقائيًا بعد لحظات من التوقف عن الكتابة، مع حماية من التعديل المتزامن من جهازين.
import { h, mount } from "../dom.js";
import { api, ApiError } from "../api.js";
import { panel, field, input, textarea, select, btn, badge, notice, toast, confirmAction, dialog, empty, sub } from "../ui.js";
import { icons } from "../icons.js";
import { sortable } from "../sortable.js";
import {
  QTYPES, DIFFICULTY, STATUS, PAPER_TEMPLATES, FONTS, STUDENT_FIELDS, ORDINALS, VERSION_CODES,
  newQuestion, newSection, totals, checkPaper, sectionSummary, fmtNum, withLayoutDefaults, buildVersion, uid,
} from "./engine.js";
import { questionEditor } from "./editor.js";
import { rich, loadMath, paperNeedsMath } from "./math.js";
import { previewPanel, imageUrlFor, logoUrlFor } from "./preview.js";
import { paperBlocks } from "./render.js";
import { paginate } from "./paginate.js";

const STEPS = [["info", "معلومات الاختبار"], ["questions", "الأسئلة"], ["design", "تصميم الورقة"], ["preview", "المعاينة والطباعة"]];

export async function builder({ base, id, ctx, me, step = "info", onExit, autoPrint = false }) {
  let paper = await api(`${base}/${id}`);
  const root = h("div", { class: "xb" });
  const saveState = h("span", { class: "xb-save" }, "محفوظ");
  const totalChip = h("span", { class: "xb-total" });
  const titleEl = h("h2");
  const statusEl = h("span");
  const stepsEl = h("nav", { class: "xb-steps" });
  const body = h("div");
  let current = step;
  let pending = {};            // meta / content / layout بانتظار الحفظ
  let timer = null;
  let saving = null;
  let conflict = false;
  const openEditors = new Set();

  /* ---------- الحفظ التلقائي ---------- */
  const queue = (part) => {
    if (!paper.perms.edit) return;
    pending[part] = true;
    saveState.textContent = "تغييرات غير محفوظة…";
    saveState.classList.remove("err");
    clearTimeout(timer);
    timer = setTimeout(flush, 1200);
    if (part === "content" || part === "meta") updateTotals();
  };
  async function flush() {
    clearTimeout(timer);
    if (conflict || !Object.keys(pending).length) return saving;
    if (saving) { await saving; return flush(); }
    const parts = pending;
    pending = {};
    const bodyReq = { version: paper.version };
    if (parts.meta) bodyReq.meta = metaOf(paper);
    if (parts.content) bodyReq.content = paper.content;
    if (parts.layout) bodyReq.layout = paper.layout;
    saveState.textContent = "جارٍ الحفظ…";
    saving = api(`${base}/${paper.id}`, bodyReq, "PUT").then((r) => {
      paper.version = r.version;
      paper.computed_marks = r.computed_marks;
      paper.question_count = r.question_count;
      paper.check = r.check;
      saveState.textContent = `محفوظ ${new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}`;
    }).catch((e) => {
      if (e.status === 409) {
        conflict = true;
        saveState.textContent = "تعارض: عُدّل من مكان آخر";
        saveState.classList.add("err");
        dialog("تعارض في التعديل", notice(e.message, "err"), [btn("إعادة التحميل", () => location.reload())]);
      } else {
        pending = { ...parts, ...pending };
        saveState.textContent = `لم يُحفظ: ${e.message}`;
        saveState.classList.add("err");
      }
    }).finally(() => { saving = null; });
    return saving;
  }
  const beforeUnload = (e) => { if (Object.keys(pending).length) { flush(); e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
  const exit = async () => { await flush(); window.removeEventListener("beforeunload", beforeUnload); onExit(); };

  const reload = async () => { await flush(); paper = await api(`${base}/${paper.id}`); drawTop(); show(current); };

  /* ---------- الشريط العلوي ---------- */
  function updateTotals() {
    const t = totals(paper.content);
    const declared = Number(paper.total_marks || 0);
    const off = declared && declared !== t.total;
    totalChip.className = `xb-total${off ? " warn" : ""}`;
    totalChip.textContent = declared
      ? `المجموع ${fmtNum(t.total)} من ${fmtNum(declared)}${off ? " — غير متطابق" : ""} · ${t.count} سؤال`
      : `المجموع ${fmtNum(t.total)} · ${t.count} سؤال`;
    titleEl.textContent = paper.title;
  }
  function drawTop() {
    mount(statusEl, badge(...STATUS[paper.status]));
    mount(stepsEl, STEPS.map(([k, label], i) => h("button", { type: "button", class: k === current ? "on" : "", onclick: () => show(k) },
      h("span", { class: "no" }, i + 1), label)));
    updateTotals();
  }
  const top = h("div", { class: "xb-top" },
    h("div", { class: "line1" },
      h("div", { class: "row", style: "align-items:center;gap:8px;flex:1;min-width:0" }, btn("رجوع", exit, "ghost sm"), titleEl, statusEl),
      h("div", { class: "xb-top-meta" }, totalChip, saveState)),
    stepsEl);

  async function show(k) {
    await flush();
    current = k;
    drawTop();
    openEditors.clear();
    mount(body, empty("جارٍ التحميل…"));
    try {
      const view = { info, questions, design, preview }[k];
      mount(body, await view());
    } catch (e) { mount(body, notice(e.message, "err")); }
    window.scrollTo({ top: 0 });
  }

  const lockedNote = () => (paper.perms.edit ? null : h("div", {},
    notice(paper.status === "archived" ? "الاختبار مؤرشف. استعده لتعديله." : "الاختبار معتمد ومقفل من التعديل. للتعديل أعد فتحه (سيعود مسودة ويحتاج اعتمادًا من جديد).", "warn"),
    h("div", { class: "row", style: "justify-content:flex-start;margin-bottom:12px" },
      paper.perms.reopen ? btn("إعادة فتح للتعديل", async () => {
        if (!confirmAction("إعادة فتح الاختبار للتعديل؟ سيعود مسودة ويحتاج اعتمادًا من جديد قبل الطباعة.")) return;
        await api(`${base}/${paper.id}/status`, { action: "reopen" }); toast("أعيد فتح الاختبار"); reload();
      }, "soft") : null,
      paper.perms.unarchive ? btn("استعادة من الأرشيف", async () => { await api(`${base}/${paper.id}/status`, { action: "unarchive" }); reload(); }, "soft") : null)));

  /* ======================= 1) معلومات الاختبار ======================= */
  async function info() {
    const ro = !paper.perms.edit;
    const on = (el, fn, ev = "input") => { el.disabled = ro; el.addEventListener(ev, fn); return el; };
    const setMeta = (k, v) => { paper[k] = v; queue("meta"); };

    const title = on(input({ value: paper.title }), (e) => setMeta("title", e.target.value));
    // الصف والشعبة والمادة من إسناد المعلم (تعبئة تلقائية)
    const pairs = [];
    const seenGrade = new Set();
    for (const l of ctx.load) {
      pairs.push([`c:${l.class_id}:${l.subject_id}`, `${l.class_name} — ${l.subject_name}`]);
      if (l.grade_id && !seenGrade.has(`${l.grade_id}:${l.subject_id}`)) {
        seenGrade.add(`${l.grade_id}:${l.subject_id}`);
        pairs.push([`g:${l.grade_id}:${l.subject_id}`, `${l.grade_name} (كل الشعب) — ${l.subject_name}`]);
      }
    }
    const curPair = paper.class_id ? `c:${paper.class_id}:${paper.subject_id}` : paper.grade_id ? `g:${paper.grade_id}:${paper.subject_id}` : "";
    if (curPair && !pairs.some(([v]) => v === curPair)) pairs.unshift([curPair, `${paper.class_name || paper.grade_name || ""} — ${paper.subject_name}`]);
    if (!curPair) pairs.unshift(["", `${paper.subject_name} (بدون صف محدد)`]);
    const pair = on(select(pairs, { value: curPair }), () => {
      const [kind, a, s] = pair.value.split(":");
      if (!kind) return;
      paper.subject_id = Number(s);
      paper.class_id = kind === "c" ? Number(a) : null;
      paper.grade_id = kind === "g" ? Number(a) : (ctx.load.find((l) => l.class_id === Number(a))?.grade_id ?? null);
      queue("meta");
    }, "change");

    const types = [...ctx.types.defaults, ...ctx.types.custom.filter((t) => t.is_active).map((t) => t.name)];
    if (!types.includes(paper.exam_type)) types.push(paper.exam_type);
    const type = on(select([...types.map((t) => [t, t]), ["__new", "+ نوع جديد…"]], { value: paper.exam_type }), async () => {
      if (type.value !== "__new") return setMeta("exam_type", type.value);
      const name = (prompt("اسم نوع الاختبار الجديد") || "").trim();
      if (!name) { type.value = paper.exam_type; return; }
      try {
        await api(`${base}/types`, { name });
        ctx.types.custom.push({ name, is_active: true });
        type.insertBefore(h("option", { value: name }, name), type.lastElementChild);
        type.value = name; setMeta("exam_type", name);
        toast("أُضيف النوع");
      } catch (e) { toast(e.message, true); type.value = paper.exam_type; }
    }, "change");

    const term = on(select([["", "بدون"], ...ctx.terms.map((t) => [t.id, `${t.name} — ${t.year_name}`])], { value: paper.term_id ?? "" }),
      () => setMeta("term_id", term.value ? Number(term.value) : null), "change");
    const date = on(input({ type: "date", value: paper.exam_date || "" }), (e) => setMeta("exam_date", e.target.value || null));
    const duration = on(input({ type: "number", min: 1, max: 600, value: paper.duration_min ?? "", placeholder: "60" }),
      (e) => setMeta("duration_min", e.target.value ? Number(e.target.value) : null));
    const total = on(input({ type: "number", min: 0.25, step: 0.25, value: paper.total_marks ?? "" }),
      (e) => setMeta("total_marks", e.target.value ? Number(e.target.value) : null));
    const pagesIn = on(input({ type: "number", min: 1, max: 50, value: paper.expected_pages ?? "" }),
      (e) => setMeta("expected_pages", e.target.value ? Number(e.target.value) : null));
    const ins = on(textarea({ rows: 4, value: paper.instructions || "", placeholder: "اكتب كل تعليمة في سطر" }), (e) => setMeta("instructions", e.target.value));

    const presetSel = ctx.presets?.length ? select([["", "إدراج تعليمات محفوظة…"], ...ctx.presets.map((p) => [p.id, p.title])]) : null;
    presetSel?.addEventListener("change", () => {
      const p = ctx.presets.find((x) => String(x.id) === presetSel.value);
      if (p) { ins.value = ins.value ? `${ins.value}\n${p.body}` : p.body; setMeta("instructions", ins.value); }
      presetSel.value = "";
    });
    const savePreset = me.role === "teacher" && !ro ? btn("حفظ كتعليمات محفوظة", async () => {
      if (!ins.value.trim()) return toast("اكتب التعليمات أولًا", true);
      const t = (prompt("اسم التعليمات المحفوظة", "تعليماتي") || "").trim();
      if (!t) return;
      const row = await api(`${base}/presets`, { title: t, body: ins.value, is_default: confirmAction("استخدامها افتراضيًا في اختباراتي الجديدة؟") });
      ctx.presets = [row, ...(ctx.presets || [])];
      toast("حُفظت التعليمات");
    }, "ghost sm") : null;

    const versions = on(select([1, 2, 3, 4].map((n) => [n, n === 1 ? "نموذج واحد" : `${n} نماذج (${VERSION_CODES.slice(0, n).join(" ")})`]), { value: paper.versions }),
      () => { setMeta("versions", Number(versions.value)); shuffleBox.classList.toggle("hidden", Number(versions.value) === 1); }, "change");
    const chk = (k, label) => h("label", {}, on(h("input", { type: "checkbox", checked: paper[k] }), (e) => setMeta(k, e.target.checked), "change"), label);
    const shuffleBox = h("div", { class: `xb-toggles ${paper.versions > 1 ? "" : "hidden"}` },
      chk("shuffle_questions", "تغيير ترتيب الأسئلة في كل نموذج"), chk("shuffle_options", "تغيير ترتيب الخيارات في كل نموذج"));

    const t = totals(paper.content);
    return [
      lockedNote(),
      panel("بيانات الاختبار", null,
        field("اسم الاختبار", title),
        h("div", { class: "row" }, field("الصف والشعبة والمادة", pair, "تُعبأ من المواد المسندة لك"), field("نوع الاختبار", type)),
        h("div", { class: "row" }, field("الفصل الدراسي", term), field("تاريخ الاختبار", date), field("المدة (دقيقة)", duration)),
        h("div", { class: "row" },
          field("الدرجة النهائية", total, `مجموع درجات الأسئلة الآن: ${fmtNum(t.total)}`),
          field("عدد الصفحات المتوقع", pagesIn),
          field("المعلم", input({ value: paper.teacher_name || me.name || "", disabled: true }))),
        !ro && t.total && Number(paper.total_marks) !== t.total
          ? btn(`اجعل الدرجة النهائية = مجموع الأسئلة (${fmtNum(t.total)})`, () => { total.value = t.total; setMeta("total_marks", t.total); }, "ghost sm") : null),
      panel("التعليمات", presetSel, field("تعليمات الاختبار", ins), savePreset),
      panel("النماذج", null, field("عدد النماذج", versions,
        "النموذج A بترتيبك، وباقي النماذج بنفس الأسئلة وترتيب مختلف ثابت (النموذج B هو نفسه في كل طباعة)"), shuffleBox),
      h("div", { class: "row", style: "justify-content:flex-end" }, btn("التالي: الأسئلة", () => show("questions"))),
    ];
  }

  /* ======================= 2) الأسئلة ======================= */
  async function questions() {
    const ro = !paper.perms.edit;
    if (paperNeedsMath(paper.content)) await loadMath();
    const wrap = h("div");
    const S = () => paper.content.sections;

    const redraw = () => {
      let n = 0;
      const numbering = withLayoutDefaults(paper.layout).numbering;
      mount(wrap, S().length ? S().map((s, si) => {
        if (numbering === "per_section") n = 0;
        return sectionEl(s, si, () => ++n);
      }) : empty("لا توجد أقسام بعد. أضف قسمًا أو ولّد الأسئلة من البنك."),
      ro ? null : h("div", { class: "xb-add" },
        btn("+ قسم جديد", () => { S().push(newSection(`السؤال ${ORDINALS[S().length] || S().length + 1}`)); queue("content"); redraw(); }, "ghost"),
        btn("توليد تلقائي من بنك الأسئلة", () => generateDialog(), "soft"),
        btn("حفظ أسئلتي الجديدة في البنك", saveAllToBank, "ghost")));
      // السحب والإفلات بين الأسئلة وبين الأقسام
      if (!ro) for (const list of wrap.querySelectorAll(".xb-qlist")) {
        sortable(list, { item: ".xb-q", handle: ".xb-handle", group: `q-${paper.id}`, onDrop: () => { syncFromDom(); queue("content"); redraw(); } });
      }
    };

    const syncFromDom = () => {
      const all = new Map(S().flatMap((s) => s.questions).map((q) => [q.id, q]));
      for (const secEl of wrap.querySelectorAll(".xb-section")) {
        const s = S().find((x) => x.id === secEl.dataset.sid);
        s.questions = [...secEl.querySelectorAll(".xb-q")].map((el) => all.get(el.dataset.id)).filter(Boolean);
      }
    };

    function sectionEl(s, si, nextNo) {
      const title = input({ value: s.title, placeholder: "عنوان القسم (مثل: السؤال الأول: اختر الإجابة الصحيحة)", disabled: ro });
      const sum = h("span", { class: "xb-s-sum" }, sectionSummary(s));
      title.addEventListener("input", () => { s.title = title.value; queue("content"); });
      const ins = textarea({ rows: 1, value: s.instructions, placeholder: "تعليمات القسم (اختياري)", disabled: ro });
      ins.addEventListener("input", () => { s.instructions = ins.value; queue("content"); });
      const mv = (d) => { const j = si + d; if (j < 0 || j >= S().length) return; [S()[si], S()[j]] = [S()[j], S()[si]]; queue("content"); redraw(); };
      const list = h("div", { class: "xb-qlist" }, s.questions.map((q) => questionCard(q, s, nextNo(), sum)));
      const addType = select([["", "+ إضافة سؤال…"], ...Object.entries(QTYPES).map(([k, v]) => [k, v.label])], { disabled: ro });
      addType.addEventListener("change", () => {
        if (!addType.value) return;
        const last = s.questions[s.questions.length - 1];
        const q = newQuestion(addType.value, last?.type === addType.value ? last.marks : 1);
        s.questions.push(q);
        openEditors.add(q.id);
        queue("content"); redraw();
        requestAnimationFrame(() => wrap.querySelector(`[data-id="${q.id}"] textarea`)?.focus());
      });
      return h("section", { class: "xb-section", "data-sid": s.id },
        h("div", { class: "xb-s-head" }, title,
          ro ? null : h("div", { class: "xb-q-acts" },
            h("button", { type: "button", class: "xb-icon", "aria-label": "تحريك القسم لأعلى", onclick: () => mv(-1) }, icons.up({ size: 16 })),
            h("button", { type: "button", class: "xb-icon", "aria-label": "تحريك القسم لأسفل", onclick: () => mv(1) }, icons.down({ size: 16 })),
            h("button", { type: "button", class: "xb-icon danger", "aria-label": "حذف القسم", onclick: () => {
              if (s.questions.length && !confirmAction(`حذف القسم وأسئلته (${s.questions.length})؟`)) return;
              S().splice(si, 1); queue("content"); redraw();
            } }, icons.trash({ size: 16 })))),
        h("div", { class: "row", style: "align-items:center" }, ins, sum),
        list,
        ro ? null : h("div", { class: "xb-add" }, addType, btn("إضافة من بنك الأسئلة", () => bankDialog(s), "ghost sm")));
    }

    function questionCard(q, s, no, sectionSum) {
      const card = h("div", { class: `xb-q${openEditors.has(q.id) ? " open" : ""}`, "data-id": q.id });
      const prev = h("div", { class: "xb-qprev", onclick: () => toggle() });
      const paintPrev = () => {
        const txt = q.text || (q.type === "match" ? (q.pairs || []).map((p) => p.left).filter(Boolean).join(" — ") : q.type === "order" ? (q.items || []).map((i) => i.text).join(" — ") : "");
        prev.classList.toggle("empty-q", !String(txt).trim() && !q.image);
        mount(prev, String(txt).trim() ? rich(txt, { blanks: true }) : q.image ? "(سؤال بصورة)" : "اكتب نص السؤال…");
      };
      paintPrev();
      const marks = input({ type: "number", class: "xb-marks", min: 0.25, step: 0.25, value: q.marks, "aria-label": "الدرجة", disabled: ro });
      marks.addEventListener("input", () => { q.marks = Number(marks.value) || 0; sectionSum.textContent = sectionSummary(s); queue("content"); });
      const edBox = h("div", { class: "xb-editor" });
      const toggle = () => {
        if (ro) return;
        if (openEditors.has(q.id)) { openEditors.delete(q.id); card.classList.remove("open"); edBox.remove(); return; }
        openEditors.add(q.id); card.classList.add("open"); drawEditor(); card.append(edBox);
      };
      const drawEditor = () => mount(edBox, questionEditor(q, {
        base,
        onChange: () => { marks.value = q.marks; paintPrev(); sectionSum.textContent = sectionSummary(s); queue("content"); },
        onTypeChange: () => { typeBadge.textContent = QTYPES[q.type].short; },
      }));
      const typeBadge = h("span", { class: "xb-type" }, QTYPES[q.type].short);
      const idx = () => s.questions.indexOf(q);
      const act = (icon, label, fn, cls = "") => h("button", { type: "button", class: `xb-icon ${cls}`, "aria-label": label, title: label, onclick: fn }, icon);
      card.append(h("div", { class: "xb-q-row" },
        ro ? null : h("span", { class: "xb-handle", title: "اسحب لتغيير الترتيب", "aria-label": "اسحب لتغيير الترتيب" }, icons.grip({ size: 18 })),
        h("span", { class: "xb-qno" }, no), typeBadge, prev, marks,
        ro ? null : h("div", { class: "xb-q-acts" },
          act(icons.edit({ size: 16 }), "تعديل", toggle),
          act(icons.up({ size: 16 }), "لأعلى", () => { const i = idx(); if (i > 0) { [s.questions[i - 1], s.questions[i]] = [s.questions[i], s.questions[i - 1]]; queue("content"); redraw(); } }),
          act(icons.down({ size: 16 }), "لأسفل", () => { const i = idx(); if (i < s.questions.length - 1) { [s.questions[i + 1], s.questions[i]] = [s.questions[i], s.questions[i + 1]]; queue("content"); redraw(); } }),
          act(icons.copy({ size: 16 }), "تكرار السؤال", () => {
            const c = structuredClone(q); c.id = uid("q"); c.bank_id = null;
            for (const k of ["options", "pairs", "items"]) if (c[k]) {
              const map = new Map();
              c[k] = c[k].map((o) => { const nid = uid(k[0]); map.set(o.id, nid); return { ...o, id: nid }; });
              if (k === "options" && Array.isArray(c.correct)) c.correct = c.correct.map((x) => map.get(x)).filter(Boolean);
            }
            s.questions.splice(idx() + 1, 0, c); queue("content"); redraw();
          }),
          act(icons.refresh({ size: 16 }), "استبدال بسؤال آخر من البنك", () => replaceFromBank(q, s)),
          act(icons.bank({ size: 16 }), "حفظ في بنك الأسئلة", () => saveToBank([q.id])),
          act(icons.trash({ size: 16 }), "حذف", () => { if (!confirmAction("حذف السؤال؟")) return; s.questions.splice(idx(), 1); queue("content"); redraw(); }, "danger"))));
      if (openEditors.has(q.id)) { drawEditor(); card.append(edBox); }
      return card;
    }

    /* ----- البنك ----- */
    const bankIds = () => S().flatMap((s) => s.questions).map((q) => q.bank_id).filter(Boolean);
    async function replaceFromBank(q, s) {
      const r = await api(`${base}/bank/pick`, { subject_id: paper.subject_id, grade_id: paper.grade_id || undefined, difficulty: q.difficulty || "mixed",
        spec: [{ type: q.type, count: 1 }], exclude: bankIds() });
      let alt = r.questions[0];
      if (!alt) alt = (await api(`${base}/bank/pick`, { subject_id: paper.subject_id, grade_id: paper.grade_id || undefined, difficulty: "mixed", spec: [{ type: q.type, count: 1 }], exclude: bankIds() })).questions[0];
      if (!alt) return toast(`لا يوجد في البنك سؤال آخر من نوع «${QTYPES[q.type].label}» لهذه المادة`, true);
      s.questions[s.questions.indexOf(q)] = { ...alt, marks: q.marks };
      queue("content"); redraw(); toast("استُبدل السؤال");
    }
    async function saveToBank(ids) {
      await flush();
      const r = await api(`${base}/bank/from-paper`, { paper_id: paper.id, question_ids: ids });
      toast(`حُفظ ${r.saved} سؤال في بنك الأسئلة`);
    }
    function saveAllToBank() {
      const ids = S().flatMap((s) => s.questions).filter((q) => !q.bank_id).map((q) => q.id);
      if (!ids.length) return toast("كل الأسئلة مأخوذة من البنك أصلًا");
      if (confirmAction(`حفظ ${ids.length} سؤال جديد في بنك الأسئلة لاستخدامها لاحقًا؟`)) saveToBank(ids).catch((e) => toast(e.message, true));
    }

    async function bankDialog(section) {
      const units = await api(`${base}/bank/units?subject_id=${paper.subject_id}`);
      const unit = select([["", "كل الوحدات"], ...[...new Set(units.map((u) => u.unit).filter(Boolean))].map((u) => [u, u])]);
      const lesson = select([["", "كل الدروس"], ...[...new Set(units.map((u) => u.lesson).filter(Boolean))].map((u) => [u, u])]);
      const type = select([["", "كل الأنواع"], ...Object.entries(QTYPES).map(([k, v]) => [k, v.label])]);
      const diff = select([["", "كل المستويات"], ...Object.entries(DIFFICULTY)]);
      const q = input({ placeholder: "بحث في نص السؤال" });
      const count = input({ type: "number", min: 1, max: 50, value: 5, style: "max-width:80px" });
      const list = h("div", { class: "xb-dialog-list" });
      let rows = [];
      const used = new Set(bankIds().map(Number));
      const load = async () => {
        const params = new URLSearchParams({ subject_id: paper.subject_id, ...(paper.grade_id ? { grade_id: paper.grade_id } : {}),
          ...(unit.value ? { unit: unit.value } : {}), ...(lesson.value ? { lesson: lesson.value } : {}), ...(type.value ? { type: type.value } : {}),
          ...(diff.value ? { difficulty: diff.value } : {}), ...(q.value.trim() ? { q: q.value.trim() } : {}) });
        rows = await api(`${base}/bank?${params}`);
        if (rows.some((r) => /\$/.test(r.text || ""))) await loadMath();
        mount(list, rows.length ? rows.map((r) => h("label", { class: used.has(r.id) ? "muted-row" : "" },
          h("input", { type: "checkbox", value: r.id, disabled: used.has(r.id) }),
          h("div", {}, h("div", {}, rich(r.text || "(بدون نص)", { blanks: true })),
            sub(`${QTYPES[r.type].label} · ${DIFFICULTY[r.difficulty]} · ${fmtNum(r.marks)} درجة${r.unit ? ` · ${r.unit}` : ""}${r.lesson ? ` · ${r.lesson}` : ""}${used.has(r.id) ? " · مضاف مسبقًا" : ""}`))))
          : empty("لا توجد أسئلة مطابقة في البنك."));
      };
      for (const el of [unit, lesson, type, diff]) el.addEventListener("change", load);
      q.addEventListener("input", () => { clearTimeout(q._t); q._t = setTimeout(load, 300); });
      const add = (picked) => {
        if (!picked.length) return toast("اختر سؤالًا على الأقل", true);
        for (const r of picked) section.questions.push(fromBankRow(r));
        queue("content"); d.close(); redraw();
        toast(`أُضيف ${picked.length} سؤال`);
      };
      const d = dialog("إضافة من بنك الأسئلة", h("div", {},
        h("div", { class: "row" }, field("الوحدة", unit), field("الدرس", lesson)),
        h("div", { class: "row" }, field("النوع", type), field("الصعوبة", diff)), q, h("div", { class: "spaced" }), list,
        h("div", { class: "row spaced", style: "align-items:center;justify-content:flex-start" }, "اختيار عشوائي:", count,
          btn("اختر عشوائيًا", () => {
            const boxes = [...list.querySelectorAll("input:not(:disabled)")].sort(() => Math.random() - 0.5);
            list.querySelectorAll("input").forEach((b) => { b.checked = false; });
            boxes.slice(0, Number(count.value) || 1).forEach((b) => { b.checked = true; });
          }, "ghost sm"))),
      [btn("إضافة إلى الاختبار", () => add(rows.filter((r) => list.querySelector(`input[value="${r.id}"]`)?.checked)))]);
      d.classList.add("xb-wide");
      await load();
    }

    async function generateDialog() {
      const spec = [{ type: "mcq", count: 5 }, { type: "truefalse", count: 5 }, { type: "fill", count: 5 }, { type: "short", count: 5 }];
      const specBox = h("div");
      const drawSpec = () => mount(specBox, spec.map((row, i) => {
        const t = select(Object.entries(QTYPES).map(([k, v]) => [k, v.label]), { value: row.type });
        t.addEventListener("change", () => { row.type = t.value; });
        const c = input({ type: "number", min: 1, max: 100, value: row.count });
        c.addEventListener("input", () => { row.count = Number(c.value) || 1; });
        return h("div", { class: "xb-spec" }, t, c, h("button", { type: "button", class: "xb-icon danger", "aria-label": "حذف", onclick: () => { spec.splice(i, 1); drawSpec(); } }, icons.trash({ size: 16 })));
      }), btn("+ نوع", () => { spec.push({ type: "short", count: 1 }); drawSpec(); }, "ghost sm"));
      drawSpec();
      const diff = select([["mixed", "مختلط"], ...Object.entries(DIFFICULTY)]);
      const units = await api(`${base}/bank/units?subject_id=${paper.subject_id}`);
      const unit = select([["", "كل الوحدات"], ...[...new Set(units.map((u) => u.unit).filter(Boolean))].map((u) => [u, u])]);
      const result = h("div");
      let last = null;
      const run = async () => {
        last = await api(`${base}/bank/pick`, { subject_id: paper.subject_id, grade_id: paper.grade_id || undefined, difficulty: diff.value,
          unit: unit.value || null, spec, exclude: bankIds() });
        const byType = {};
        for (const q of last.questions) byType[q.type] = (byType[q.type] || 0) + 1;
        mount(result, notice(`سُحب ${last.questions.length} سؤال من البنك: ${Object.entries(byType).map(([k, n]) => `${QTYPES[k].label} ${n}`).join("، ") || "لا شيء"}`, last.questions.length ? "" : "warn"),
          last.shortages.length ? notice(`البنك لا يكفي: ${last.shortages.map((s) => `${QTYPES[s.type].label} (المطلوب ${s.wanted}، الموجود ${s.found})`).join("، ")}`, "warn") : null);
      };
      const apply = (replace) => {
        if (!last?.questions.length) return toast("ولّد الأسئلة أولًا", true);
        const groups = new Map();
        for (const q of last.questions) groups.set(q.type, [...(groups.get(q.type) || []), { ...q, id: uid("q") }]);
        const base0 = replace ? 0 : S().length;
        const secs = [...groups.entries()].map(([type, qs], i) => ({ ...newSection(`السؤال ${ORDINALS[base0 + i] || base0 + i + 1}: ${QTYPES[type].label}`), questions: qs }));
        if (replace) { if (!confirmAction("استبدال كل أقسام الاختبار وأسئلته بالأسئلة المولَّدة؟")) return; paper.content.sections = secs; }
        else paper.content.sections.push(...secs);
        queue("content"); d.close(); redraw();
      };
      const d = dialog("توليد الأسئلة تلقائيًا من البنك", h("div", {},
        sub("حدد عدد الأسئلة من كل نوع، والنظام يسحبها عشوائيًا من بنك الأسئلة لهذه المادة."),
        specBox, h("div", { class: "row spaced" }, field("مستوى الصعوبة", diff), field("الوحدة", unit)), result),
      [btn("توليد", run, "soft"), btn("توليد نسخة أخرى", run, "ghost"), btn("إضافة كأقسام جديدة", () => apply(false)), btn("استبدال كل الأسئلة", () => apply(true), "danger")]);
      d.classList.add("xb-wide");
    }

    redraw();
    const check = checkPaper(paper);
    return [lockedNote(),
      check.issues.length ? h("details", { class: "spaced", style: "margin-bottom:10px" },
        h("summary", { class: "small", style: "cursor:pointer" }, `تنبيهات المراجعة (${check.issues.length})`),
        check.issues.map((i) => notice(i.text, i.level === "error" ? "err" : "warn"))) : null,
      sub("اسحب السؤال من المقبض لتغيير ترتيبه أو نقله لقسم آخر، أو استخدم أزرار الأعلى والأسفل."),
      h("div", { class: "spaced" }), wrap,
      h("div", { class: "row spaced", style: "justify-content:space-between" }, btn("السابق", () => show("info"), "ghost"), btn("التالي: تصميم الورقة", () => show("design")))];
  }

  /* ======================= 3) تصميم الورقة ======================= */
  async function design() {
    const ro = !paper.perms.edit;
    const L = withLayoutDefaults(paper.layout);
    paper.layout = L;
    const set = (k, v) => { L[k] = v; queue("layout"); miniRender(); };
    const sel = (k, opts) => { const el = select(opts, { value: L[k], disabled: ro }); el.addEventListener("change", () => set(k, isNaN(Number(el.value)) || el.value === "" ? el.value : Number(el.value))); return el; };
    const tog = (k, label) => h("label", {}, h("input", { type: "checkbox", checked: L[k], disabled: ro, onchange: (e) => set(k, e.target.checked) }), label);
    const tpls = h("div", { class: "xb-tpls" }, Object.entries(PAPER_TEMPLATES).map(([k, t]) => h("button", {
      type: "button", class: `xb-tpl${L.template === k ? " on" : ""}`, disabled: ro,
      onclick: (e) => { tpls.querySelectorAll(".xb-tpl").forEach((b) => b.classList.remove("on")); e.currentTarget.classList.add("on"); set("template", k); },
    }, h("b", {}, t.label), h("small", {}, t.note))));
    const fields = h("div", { class: "xb-toggles" }, STUDENT_FIELDS.map(([k, label]) => h("label", {},
      h("input", { type: "checkbox", checked: L.student_fields.includes(k), disabled: ro, onchange: (e) => {
        const cur = new Set(L.student_fields);
        if (e.target.checked) cur.add(k); else cur.delete(k);
        set("student_fields", STUDENT_FIELDS.map(([x]) => x).filter((x) => cur.has(x)));
      } }), label)));
    const extra = input({ value: (L.extra_fields || []).join("، "), placeholder: "مثل: رقم الجلوس، اسم المدرسة السابقة", disabled: ro });
    extra.addEventListener("input", () => set("extra_fields", extra.value.split(/[،,]/).map((x) => x.trim()).filter(Boolean).slice(0, 4)));
    const note = textarea({ rows: 2, value: L.header_note, placeholder: "مثل: المملكة العربية السعودية\nوزارة التعليم", disabled: ro });
    note.addEventListener("input", () => set("header_note", note.value));
    const foot = input({ value: L.footer_text, placeholder: "نص التذييل (مثل: مع تمنياتنا بالتوفيق)", disabled: ro });
    foot.addEventListener("input", () => set("footer_text", foot.value));
    const logoInfo = ctx.settings.logo_image_id
      ? (ctx.settings.show_logo ? "شعار المدرسة يُضاف تلقائيًا من إعدادات الإدارة." : "الإدارة أوقفت إظهار الشعار في الاختبارات.")
      : "لم ترفع الإدارة شعار المدرسة بعد (من الإعدادات ← الاختبارات الورقية).";

    // معاينة مصغرة للصفحة الأولى
    const mini = h("div", { class: "xb-mini-box" });
    let t;
    const miniRender = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const host = h("div", { style: "zoom:.42" });
        mount(mini, host);
        if (paperNeedsMath(paper.content)) await loadMath();
        const { blocks, running } = paperBlocks({ paper, version: buildVersion(paper, 0), layout: L, school: ctx.school,
          logoUrl: logoUrlFor(base, ctx.settings, L), imageUrl: imageUrlFor(base) });
        const pages = await paginate(host, { blocks, running, layout: L });
        pages.slice(1).forEach((p) => p.remove());
      }, 350);
    };
    queueMicrotask(miniRender);

    const form = h("div", {},
      lockedNote(),
      panel("قالب الورقة", null, tpls),
      panel("الورق والخط", null,
        h("div", { class: "row" },
          field("حجم الورق", sel("paper", [["A4", "A4"], ["A5", "A5"], ["Letter", "Letter"]])),
          field("الاتجاه", sel("orientation", [["portrait", "عمودي"], ["landscape", "أفقي"]])),
          field("الهوامش (مم)", sel("margins", [8, 10, 12, 14, 16, 18, 20, 25].map((n) => [n, n])))),
        h("div", { class: "row" },
          field("خط الأسئلة", sel("font", Object.entries(FONTS).map(([k, [, l]]) => [k, l]))),
          field("خط العناوين", sel("heading_font", [["same", "نفس خط الأسئلة"], ...Object.entries(FONTS).map(([k, [, l]]) => [k, l])]))),
        h("div", { class: "row" },
          field("حجم الخط", sel("fontSize", [10, 11, 12, 13, 14, 15, 16, 18].map((n) => [n, `${n} نقطة`]))),
          field("المسافات", sel("spacing", [["compact", "متقاربة"], ["normal", "عادية"], ["relaxed", "واسعة"]])),
          field("ترقيم الأسئلة", sel("numbering", [["continuous", "متصل (1، 2، 3…)"], ["per_section", "يبدأ من 1 في كل قسم"]])))),
      panel("ما يظهر في الورقة", null,
        h("div", { class: "xb-toggles" }, tog("show_logo", "شعار المدرسة"), tog("show_school", "اسم المدرسة"), tog("show_teacher", "اسم المعلم"),
          tog("show_marks", "درجات الأسئلة"), tog("show_date", "التاريخ"), tog("show_duration", "مدة الاختبار"), tog("show_version", "رقم النموذج"),
          tog("page_numbers", "ترقيم الصفحات (صفحة 1 من 5)"), tog("show_instructions", "التعليمات"), tog("show_signature", "توقيع المعلم والمراجع"), tog("color", "طباعة ملونة")),
        sub(logoInfo)),
      panel("بيانات الطالب أعلى الورقة", null, fields, field("حقول إضافية (مفصولة بفاصلة، حتى 4)", extra)),
      panel("الترويسة والتذييل", null, field("أسطر أعلى الترويسة", note), field("التذييل", foot)),
      h("div", { class: "row", style: "justify-content:space-between" }, btn("السابق", () => show("questions"), "ghost"), btn("التالي: المعاينة والطباعة", () => show("preview"))));
    return h("div", { class: "xb-design" }, form, h("div", { class: "xb-mini" }, panel("معاينة الصفحة الأولى", null, mini)));
  }

  /* ======================= 4) المعاينة والطباعة ======================= */
  async function preview() {
    await flush();
    paper = await api(`${base}/${paper.id}`);
    drawTop();
    const p = paper.perms;
    const extras = h("div", { class: "row spaced", style: "justify-content:flex-start" },
      btn("نسخ الاختبار", () => copyDialog(), "ghost sm"),
      btn("حفظ كقالب", async () => {
        const name = (prompt("اسم القالب", `${paper.title}${paper.grade_name ? ` — ${paper.grade_name}` : ""}`) || "").trim();
        if (!name) return;
        await api(`${base}/${paper.id}/template`, { name }); toast("حُفظ القالب في «قوالب الاختبارات»");
      }, "ghost sm"),
      btn("تصدير ملف", async () => {
        const data = await api(`${base}/${paper.id}/export`);
        const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })), download: `${paper.title}.midar-exam.json` });
        document.body.append(a); a.click(); a.remove();
      }, "ghost sm"),
      me.role === "teacher" && me.modules?.exams && paper.class_id && (paper.status === "approved" || paper.status === "printed")
        ? btn("إنشاء سجل درجات لهذا الاختبار", async () => {
          await api("/api/teacher/exams", { class_id: paper.class_id, subject_id: paper.subject_id, title: paper.title,
            exam_date: paper.exam_date || null, max_score: Number(paper.total_marks || paper.computed_marks) });
          toast("أُنشئ سجل الدرجات في «رصد الدرجات»");
        }, "ghost sm") : null,
      p.reopen ? btn("إعادة فتح للتعديل", async () => {
        if (!confirmAction("إعادة فتح الاختبار للتعديل؟ سيعود مسودة ويحتاج اعتمادًا من جديد.")) return;
        await api(`${base}/${paper.id}/status`, { action: "reopen" }); reload();
      }, "ghost sm") : null,
      p.archive ? btn("أرشفة", async () => { if (!confirmAction("أرشفة الاختبار؟ يمكنك استعادته لاحقًا.")) return; await api(`${base}/${paper.id}/status`, { action: "archive" }); exit(); }, "ghost sm") : null);
    const pv = await previewPanel(paper, {
      base, school: ctx.school, settings: ctx.settings, autoPrint,
      onChanged: async (status, o = {}) => { autoPrint = !!o.thenPrint; paper.status = status; if (o.reload) await reload(); else drawTop(); autoPrint = false; },
    });
    return [lockedNote(), pv, extras];
  }

  async function copyDialog() {
    const title = input({ value: `${paper.title} (نسخة)` });
    const mode = select([["same", "نفس الأسئلة"], ["bank", "أسئلة جديدة من البنك (من النوع نفسه)"]]);
    const shuffle = h("input", { type: "checkbox" });
    const total = input({ type: "number", min: 0.25, step: 0.25, placeholder: fmtNum(paper.total_marks || paper.computed_marks) });
    const date = input({ type: "date" });
    const d = dialog("نسخ الاختبار", h("div", {},
      field("اسم النسخة", title), field("الأسئلة", mode),
      h("label", { class: "row", style: "align-items:center;gap:6px;margin-bottom:12px" }, shuffle, "تغيير ترتيب الأسئلة"),
      h("div", { class: "row" }, field("درجة نهائية جديدة (اختياري)", total, "تُوزَّع درجات الأسئلة بالتناسب"), field("تاريخ جديد", date))),
    [btn("إنشاء النسخة", async () => {
      const r = await api(`${base}/${paper.id}/copy`, { title: title.value, mode: mode.value, shuffle: shuffle.checked,
        total_marks: total.value ? Number(total.value) : null, exam_date: date.value || null });
      d.close();
      toast(`أُنشئت النسخة${r.notes?.length ? ` — ${r.notes.join("، ")}` : ""}`);
      onExit({ open: r.id });
    })]);
  }

  drawTop();
  mount(root, top, body);
  show(current);
  return root;
}

// سؤال البنك ← سؤال داخل الورقة (نسخة مستقلة بمعرّف جديد)
const BODY = ["text", "options", "correct", "answers", "answer", "pairs", "items", "table", "image", "space", "lined", "cols", "solution", "notes"];
export const fromBankRow = (r) => ({
  ...Object.fromEntries(BODY.filter((k) => r[k] !== undefined && r[k] !== null).map((k) => [k, structuredClone(r[k])])),
  id: uid("q"), type: r.type, marks: Number(r.marks), difficulty: r.difficulty, bank_id: Number(r.id), unit: r.unit || "", lesson: r.lesson || "",
});

const metaOf = (p) => ({
  title: p.title, subject_id: p.subject_id, class_id: p.class_id ?? null, grade_id: p.grade_id ?? null, term_id: p.term_id ?? null,
  exam_type: p.exam_type, exam_date: p.exam_date || null, duration_min: p.duration_min ?? null, total_marks: p.total_marks ?? null,
  instructions: p.instructions ?? "", expected_pages: p.expected_pages ?? null, versions: p.versions,
  shuffle_questions: p.shuffle_questions, shuffle_options: p.shuffle_options,
});
