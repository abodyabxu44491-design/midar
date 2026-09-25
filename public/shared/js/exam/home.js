// صفحة «الاختبارات والامتحانات»: القائمة والإحصاءات وطرق الإنشاء، وبنك الأسئلة، والقوالب.
// تُستخدم في بوابة المعلم وفي لوحة الإدارة (base يحدد الواجهة البرمجية، والصلاحيات من الخادم).
import { h, mount } from "../dom.js";
import { api } from "../api.js";
import { panel, field, input, textarea, select, btn, badge, notice, toast, confirmAction, dialog, empty, sub, stats } from "../ui.js";
import { icons } from "../icons.js";
import { STATUS, QTYPES, DIFFICULTY, fmtNum, newQuestion } from "./engine.js";
import { preloadModule } from "../ui.js";
import { rich, loadMath } from "./math.js";

const today = () => new Date().toISOString().slice(0, 10);

export async function examSection({ base, me, admin = false }) {
  const root = h("div");
  // الطلبات الثلاثة مستقلة: تبدأ معًا بدل انتظار السياق ثم طلب القائمة
  let prefetched = Promise.all([api(`${base}?status=all`), api(`${base}/stats`)]);
  prefetched.catch(() => {});
  const ctx = await api(`${base}/context`);
  let filter = "active";
  let search = "";
  let sort = "updated";

  const nav = {
    list: () => drawList(),
    open: async (id, step = "info", autoPrint = false) => {
      mount(root, empty("جارٍ فتح الاختبار…"));
      preloadModule(new URL("./builder.js", import.meta.url).pathname);   // المصمم يُحمّل عند فتح اختبار فقط
      const { builder } = await import("./builder.js");
      mount(root, await builder({ base, id, ctx, me, step, autoPrint,
        onExit: (o) => (o?.open ? nav.open(o.open) : nav.list()) }));
    },
    bank: () => drawBank(),
    templates: () => drawTemplates(),
  };

  /* ---------- اختيار الصف والمادة (مشترك بين نوافذ الإنشاء) ---------- */
  const pairSelect = () => select(ctx.load.map((l) => [`${l.class_id}:${l.subject_id}`, `${l.class_name} — ${l.subject_name}`]));
  const pairOf = (el) => { const [c, s] = el.value.split(":").map(Number); return { class_id: c, subject_id: s }; };
  const typeSelect = () => select([...ctx.types.defaults, ...ctx.types.custom.filter((t) => t.is_active).map((t) => t.name)].map((t) => [t, t]));
  const noLoad = () => (!ctx.load.length ? notice(admin ? "لا توجد صفوف ومواد بعد. أنشئ الهيكل الأكاديمي أولًا." : "لا توجد مواد مسندة لك. تواصل مع الإدارة.", "warn") : null);

  function createDialog() {
    const title = input({ placeholder: "مثل: اختبار الفصل الأول" });
    const pair = pairSelect();
    const type = typeSelect();
    const date = input({ type: "date" });
    const duration = input({ type: "number", min: 1, placeholder: "60" });
    const total = input({ type: "number", min: 0.25, step: 0.25, placeholder: "20" });
    const def = ctx.presets?.find((p) => p.is_default)?.body || ctx.settings.default_instructions || "";
    const d = dialog("إنشاء اختبار جديد", h("div", {}, noLoad(),
      field("اسم الاختبار", title), field("الصف والشعبة والمادة", pair, "من المواد المسندة لك"),
      h("div", { class: "row" }, field("نوع الاختبار", type), field("التاريخ", date)),
      h("div", { class: "row" }, field("المدة (دقيقة)", duration), field("الدرجة النهائية", total))),
    [btn("إنشاء ومتابعة", async () => {
      if (!ctx.load.length) return;
      const r = await api(base, { title: title.value || `${type.value}`, ...pairOf(pair), exam_type: type.value, exam_date: date.value || null,
        duration_min: duration.value || null, total_marks: total.value || null, instructions: def || null });
      d.close(); nav.open(r.id, "questions");
    })]);
    title.focus();
  }

  function quickDialog() {
    const pair = pairSelect(); const type = typeSelect();
    const total = input({ type: "number", min: 1, value: 20 });
    const count = input({ type: "number", min: 1, max: 100, value: 10 });
    const d = dialog("إنشاء اختبار سريع", h("div", {}, noLoad(),
      sub("حدد الأساسيات فقط. النظام يجهز مسودة بأقسام وأسئلة (من البنك إن وُجدت، وإلا أسئلة فارغة لتكتبها) ودرجات موزعة."),
      field("الصف والمادة", pair), field("نوع الاختبار", type),
      h("div", { class: "row" }, field("الدرجة النهائية", total), field("عدد الأسئلة", count))),
    [btn("تجهيز المسودة", async () => {
      const r = await api(`${base}/quick`, { ...pairOf(pair), exam_type: type.value, total_marks: Number(total.value), count: Number(count.value) });
      d.close(); toast(r.from_bank ? `سُحب ${r.from_bank} سؤال من البنك${r.filled ? ` وأُضيف ${r.filled} سؤال فارغ` : ""}` : "جُهزت المسودة، اكتب الأسئلة");
      nav.open(r.id, "questions");
    })]);
  }

  function fromBankDialog() {
    const pair = pairSelect(); const type = typeSelect();
    const total = input({ type: "number", min: 1, value: 20 });
    const diff = select([["mixed", "مختلط"], ...Object.entries(DIFFICULTY)]);
    const spec = [{ type: "mcq", count: 5 }, { type: "truefalse", count: 5 }, { type: "fill", count: 5 }, { type: "essay", count: 5 }];
    const specBox = h("div");
    const drawSpec = () => mount(specBox, spec.map((row, i) => {
      const t = select(Object.entries(QTYPES).map(([k, v]) => [k, v.label]), { value: row.type });
      t.addEventListener("change", () => { row.type = t.value; });
      const c = input({ type: "number", min: 1, max: 100, value: row.count });
      c.addEventListener("input", () => { row.count = Number(c.value) || 1; sum.textContent = `المجموع: ${spec.reduce((a, s) => a + s.count, 0)} سؤال`; });
      return h("div", { class: "xb-spec" }, t, c, h("button", { type: "button", class: "xb-icon danger", "aria-label": "حذف", onclick: () => { spec.splice(i, 1); drawSpec(); } }, icons.trash({ size: 16 })));
    }), btn("+ نوع", () => { spec.push({ type: "short", count: 1 }); drawSpec(); }, "ghost sm"));
    const sum = h("b", { class: "small" }, "المجموع: 20 سؤال");
    drawSpec();
    const d = dialog("إنشاء من بنك الأسئلة", h("div", {}, noLoad(),
      h("div", { class: "row" }, field("الصف والمادة", pair), field("نوع الاختبار", type)),
      specBox, sum, h("div", { class: "row spaced" }, field("مستوى الصعوبة", diff), field("الدرجة النهائية", total))),
    [btn("إنشاء الاختبار", async () => {
      const r = await api(`${base}/from-bank`, { ...pairOf(pair), exam_type: type.value, difficulty: diff.value, total_marks: Number(total.value), spec });
      d.close();
      if (r.shortages.length) toast(`البنك لا يكفي لبعض الأنواع: أُضيف ${r.filled} سؤال فارغ لتكتبه`, true);
      nav.open(r.id, "questions");
    })]);
  }

  async function copyPrevDialog() {
    const list = await api(`${base}?status=all`);
    if (!list.length) return toast("لا توجد اختبارات سابقة", true);
    const pick = select(list.map((p) => [p.id, `${p.title} — ${p.subject_name}${p.class_name ? ` — ${p.class_name}` : ""}${p.exam_date ? ` (${p.exam_date})` : ""}`]));
    const mode = select([["same", "نفس الأسئلة"], ["bank", "أسئلة جديدة من البنك من النوع نفسه"]]);
    const shuffle = h("input", { type: "checkbox" });
    const total = input({ type: "number", min: 0.25, step: 0.25, placeholder: "كما هي" });
    const date = input({ type: "date" });
    const d = dialog("نسخ اختبار سابق", h("div", {}, field("الاختبار", pick), field("الأسئلة", mode),
      h("label", { class: "row", style: "align-items:center;gap:6px;margin-bottom:12px" }, shuffle, "تغيير ترتيب الأسئلة"),
      h("div", { class: "row" }, field("درجة نهائية جديدة", total), field("تاريخ جديد", date))),
    [btn("نسخ", async () => {
      const r = await api(`${base}/${pick.value}/copy`, { mode: mode.value, shuffle: shuffle.checked, total_marks: total.value ? Number(total.value) : null, exam_date: date.value || null });
      d.close(); nav.open(r.id);
    })]);
  }

  function importDialog() {
    const file = h("input", { type: "file", accept: ".json,application/json" });
    const pair = pairSelect();
    const d = dialog("استيراد اختبار", h("div", {}, noLoad(),
      sub("ملف اختبار مصدَّر من مدار (زر «تصدير ملف» داخل أي اختبار). الصور لا تنتقل بين المدارس."),
      field("الملف", file), field("الصف والمادة", pair)),
    [btn("استيراد", async () => {
      const f = file.files[0];
      if (!f) return toast("اختر الملف", true);
      let data;
      try { data = JSON.parse(await f.text()); } catch { return toast("الملف غير صالح", true); }
      const r = await api(`${base}/import`, { ...pairOf(pair), data });
      d.close(); toast("استُورد الاختبار"); nav.open(r.id);
    })]);
  }

  /* ---------- القائمة ---------- */
  async function drawList() {
    mount(root, empty("جارٍ التحميل…"));
    const [all, st] = prefetched ? await prefetched : await Promise.all([api(`${base}?status=all`), api(`${base}/stats`)]);
    prefetched = null;
    const P = st.papers;
    const pending = admin ? all.filter((p) => p.status === "ready") : [];
    const recentDraft = !admin && all.find((p) => p.status === "draft" && Date.now() - new Date(p.updated_at) < 3 * 86400000);

    const listBox = h("div");
    const chips = h("div", { class: "xb-chips" });
    const FILTERS = [["active", "الكل", P.total], ["draft", "مسودة", P.draft], ["ready", "جاهز", P.ready], ["approved", "معتمد", P.approved],
      ["printed", "مطبوع", P.printed], ["scheduled", "مجدولة", P.scheduled], ["past", "سابقة", P.past], ["archived", "مؤرشفة", P.archived]];
    const drawChips = () => mount(chips, FILTERS.map(([k, l, n]) => h("button", { type: "button", class: `xb-chip${filter === k ? " on" : ""}`,
      onclick: () => { filter = k; drawChips(); drawRows(); } }, l, h("span", { class: "n" }, n ?? 0))));
    const q = input({ placeholder: "بحث بالاسم أو المادة أو الصف…", value: search });
    q.addEventListener("input", () => { search = q.value.trim(); drawRows(); });
    const sortSel = select([["updated", "آخر تعديل"], ["date", "تاريخ الاختبار"], ["title", "الاسم"], ["subject", "المادة"]], { value: sort });
    sortSel.addEventListener("change", () => { sort = sortSel.value; drawRows(); });

    const drawRows = () => {
      let rows = all.filter((p) => ({
        active: p.status !== "archived", archived: p.status === "archived",
        scheduled: p.status !== "archived" && p.exam_date && p.exam_date >= today(), past: p.status !== "archived" && p.exam_date && p.exam_date < today(),
      }[filter] ?? p.status === filter));
      if (search) rows = rows.filter((p) => `${p.title} ${p.subject_name} ${p.class_name || ""} ${p.grade_name || ""} ${p.teacher_name || ""} ${p.exam_type}`.includes(search));
      const by = { updated: (a, b) => String(b.updated_at).localeCompare(a.updated_at), date: (a, b) => String(b.exam_date || "").localeCompare(a.exam_date || ""),
        title: (a, b) => a.title.localeCompare(b.title, "ar"), subject: (a, b) => a.subject_name.localeCompare(b.subject_name, "ar") };
      rows.sort(by[sort]);
      mount(listBox, rows.length ? rows.map(row) : empty("لا توجد اختبارات هنا."));
    };
    const act = (label, fn, cls = "ghost sm") => btn(label, fn, cls);
    const row = (p) => h("div", { class: "xb-list-row" },
      h("div", {}, h("b", {}, p.title), " ", badge(...STATUS[p.status]),
        sub([p.subject_name, p.class_name || p.grade_name, p.exam_type, p.exam_date, `${p.question_count} سؤال · ${fmtNum(p.computed_marks)}${p.total_marks ? ` من ${fmtNum(p.total_marks)}` : ""} درجة`,
          admin ? p.teacher_name : null, p.print_count ? `طُبع ${p.print_count} مرة` : null].filter(Boolean).join(" · "))),
      h("div", { class: "acts" },
        act(p.status === "draft" || p.status === "ready" ? "تعديل" : "فتح", () => nav.open(p.id)),
        act(p.status === "approved" || p.status === "printed" ? "طباعة" : "معاينة", () => nav.open(p.id, "preview")),
        act("نسخ", async () => { const r = await api(`${base}/${p.id}/copy`, {}); toast("أُنشئت نسخة"); nav.open(r.id); }),
        p.status === "archived"
          ? act("استعادة", async () => { await api(`${base}/${p.id}/status`, { action: "unarchive" }); drawList(); })
          : act("أرشفة", async () => { if (!confirmAction("أرشفة الاختبار؟")) return; await api(`${base}/${p.id}/status`, { action: "archive" }); drawList(); }),
        p.status === "draft" ? act("حذف", async () => { if (!confirmAction("حذف المسودة نهائيًا؟")) return; await api(`${base}/${p.id}`, undefined, "DELETE"); drawList(); }, "danger sm") : null));

    const B = st.bank;
    const actionCard = (title, note, fn, primary) => h("button", { type: "button", class: `xb-action${primary ? " primary" : ""}`, onclick: fn }, h("b", {}, title), h("small", {}, note));
    mount(root,
      recentDraft ? panel(null, null, h("div", { class: "xb-resume" },
        h("div", {}, h("b", {}, "لديك اختبار غير مكتمل، هل تريد المتابعة؟"), sub(`${recentDraft.title} — ${recentDraft.question_count} سؤال`)),
        h("div", { class: "row", style: "flex:none" }, btn("متابعة", () => nav.open(recentDraft.id, "questions")), btn("لاحقًا", (e) => e.currentTarget.closest(".panel").remove(), "ghost")))) : null,
      pending.length ? panel(`بانتظار اعتمادك (${pending.length})`, null, pending.map((p) => h("div", { class: "xb-list-row" },
        h("div", {}, h("b", {}, p.title), sub(`${p.teacher_name || ""} · ${p.subject_name} · ${p.class_name || p.grade_name || ""}`)),
        h("div", { class: "acts" }, btn("مراجعة واعتماد", () => nav.open(p.id, "preview"), "sm"))))) : null,
      h("div", { class: "xb-hero" },
        actionCard("إنشاء اختبار جديد", "خطوة بخطوة: المعلومات ثم الأسئلة ثم التصميم", createDialog, true),
        actionCard("إنشاء سريع", "المادة والدرجة وعدد الأسئلة فقط", quickDialog),
        actionCard("إنشاء من بنك الأسئلة", "حدد عدد كل نوع ويسحبها النظام", fromBankDialog),
        actionCard("نسخ اختبار سابق", "بنفس الأسئلة أو بأسئلة جديدة", copyPrevDialog),
        actionCard("قوالب الاختبارات", `${P.templates} قالب محفوظ`, () => nav.templates()),
        actionCard("بنك الأسئلة", `${B.total} سؤال`, () => nav.bank()),
        actionCard("استيراد اختبار", "من ملف مصدَّر من مدار", importDialog)),
      stats([["الاختبارات", P.total], ["مسودات", P.draft], ["معتمدة", P.approved], ["مطبوعة", P.printed], ["أسئلة البنك", B.total]]),
      panel(admin ? "كل الاختبارات" : "اختباراتي", null, chips, h("div", { class: "toolbar" }, q, sortSel), listBox));
    drawChips(); drawRows();
  }

  /* ---------- القوالب ---------- */
  async function drawTemplates() {
    const list = await api(`${base}?templates=1&status=all`);
    mount(root, h("div", { class: "section-head" }, btn("رجوع", nav.list, "ghost sm"), h("h2", {}, "قوالب الاختبارات")),
      notice("احفظ أي اختبار كقالب من شاشة المعاينة («حفظ كقالب»)، ثم استخدمه في العام التالي وعدّل الأسئلة فقط.", ""),
      panel(null, null, list.length ? list.map((p) => h("div", { class: "xb-list-row" },
        h("div", {}, h("b", {}, p.template_name), sub(`${p.subject_name}${p.grade_name ? ` · ${p.grade_name}` : ""} · ${p.question_count} سؤال · ${fmtNum(p.computed_marks)} درجة`)),
        h("div", { class: "acts" },
          btn("استخدام القالب", async () => {
            const r = await api(`${base}/${p.id}/copy`, { title: p.title });
            toast("أُنشئ اختبار من القالب"); nav.open(r.id);
          }, "sm"),
          btn("تعديل القالب", () => nav.open(p.id, "questions"), "ghost sm"),
          btn("حذف", async () => { if (!confirmAction("حذف القالب؟")) return; await api(`${base}/${p.id}`, undefined, "DELETE"); drawTemplates(); }, "danger sm"))))
        : empty("لا توجد قوالب بعد.")));
  }

  /* ---------- بنك الأسئلة ---------- */
  async function drawBank() {
    const st = (await api(`${base}/stats`)).bank;
    const subjects = [...new Map(ctx.load.map((l) => [l.subject_id, l.subject_name])).entries()];
    const grades = [...new Map(ctx.load.filter((l) => l.grade_id).map((l) => [l.grade_id, l.grade_name])).entries()];
    const fSubject = select([["", "كل المواد"], ...subjects]);
    const fType = select([["", "كل الأنواع"], ...Object.entries(QTYPES).map(([k, v]) => [k, v.label])]);
    const fDiff = select([["", "كل المستويات"], ...Object.entries(DIFFICULTY)]);
    const fUnit = input({ placeholder: "الوحدة" });
    const fq = input({ placeholder: "بحث في نص السؤال" });
    const mine = h("input", { type: "checkbox" });
    const listBox = h("div");

    const load = async () => {
      const p = new URLSearchParams(Object.entries({ subject_id: fSubject.value, type: fType.value, difficulty: fDiff.value, unit: fUnit.value.trim(), q: fq.value.trim(), mine: mine.checked ? "1" : "" }).filter(([, v]) => v));
      const rows = await api(`${base}/bank?${p}`);
      if (rows.some((r) => /\$/.test(r.text || ""))) await loadMath();
      mount(listBox, rows.length ? rows.map((r) => h("div", { class: "xb-list-row" },
        h("div", {}, h("div", {}, rich(r.text || "(بدون نص)", { blanks: true })),
          sub([QTYPES[r.type].label, DIFFICULTY[r.difficulty], `${fmtNum(r.marks)} درجة`, r.subject_name, r.grade_name, r.unit, r.lesson,
            r.is_shared ? "مشترك" : null, r.used_count ? `استُخدم ${r.used_count} مرة` : null, admin || r.teacher_name !== me.name ? r.teacher_name : null].filter(Boolean).join(" · "))),
        h("div", { class: "acts" },
          btn("تعديل", () => editBankQuestion(r), "ghost sm"),
          btn("حذف", async () => { if (!confirmAction("حذف السؤال من البنك؟ الاختبارات التي استخدمته لا تتأثر.")) return; await api(`${base}/bank/${r.id}`, undefined, "DELETE"); load(); }, "danger sm"))))
        : empty("لا توجد أسئلة مطابقة."));
    };
    for (const el of [fSubject, fType, fDiff, mine]) el.addEventListener("change", load);
    for (const el of [fUnit, fq]) el.addEventListener("input", () => { clearTimeout(el._t); el._t = setTimeout(load, 300); });

    // تعديل أو إضافة سؤال في البنك بنفس محرر الأسئلة
    async function editBankQuestion(row) {
      const { questionEditor } = await import("./editor.js");   // المحرر يُحمّل عند فتحه فقط
      const isNew = !row;
      const q = row ? structuredClone({ ...row, id: undefined }) : newQuestion("mcq");
      if (!q.id) q.id = "q_bank";
      const subj = select(subjects, { value: row?.subject_id ?? subjects[0]?.[0] });
      const grade = select([["", "كل الصفوف"], ...grades], { value: row?.grade_id ?? "" });
      const unit = input({ value: row?.unit || "", placeholder: "مثل: الوحدة الأولى" });
      const lesson = input({ value: row?.lesson || "", placeholder: "مثل: الجمع" });
      const shared = h("input", { type: "checkbox", checked: !!row?.is_shared });
      const extra = h("div", {},
        h("div", { class: "row" }, field("المادة", subj), field("الصف", grade)),
        h("div", { class: "row" }, field("الوحدة", unit), field("الدرس", lesson)),
        h("label", { class: "row", style: "align-items:center;gap:6px;margin-bottom:12px" }, shared, "مشاركة السؤال مع معلمي المادة في المدرسة"));
      const d = dialog(isNew ? "سؤال جديد في البنك" : "تعديل سؤال", questionEditor(q, { base, bankFields: extra }), [btn("حفظ", async () => {
        const body = { ...q, id: undefined, bank_id: undefined, subject_id: Number(subj.value), grade_id: grade.value ? Number(grade.value) : null,
          unit: unit.value.trim(), lesson: lesson.value.trim(), is_shared: shared.checked };
        for (const k of ["teacher_id", "term_id", "used_count", "created_at", "updated_at", "subject_name", "grade_name", "teacher_name", "body"]) delete body[k];
        if (isNew) await api(`${base}/bank`, body); else await api(`${base}/bank/${row.id}`, body, "PUT");
        d.close(); toast("حُفظ السؤال"); load();
      })]);
      d.classList.add("xb-wide");
    }

    const bars = (rows, labelOf) => {
      const max = Math.max(1, ...rows.map((r) => r.n));
      return h("div", { class: "xb-bars" }, rows.map((r) => h("div", { class: "bar-row" }, h("span", {}, labelOf(r)),
        h("div", { class: "bar", style: `width:${Math.max(4, (r.n / max) * 100)}%` }), h("b", {}, r.n))));
    };
    mount(root,
      h("div", { class: "section-head" }, btn("رجوع", nav.list, "ghost sm"), h("h2", {}, "بنك الأسئلة")),
      stats([["كل الأسئلة", st.total], ["أسئلتي", st.mine]]),
      h("details", { class: "panel" }, h("summary", { style: "cursor:pointer;font-weight:700" }, "إحصاءات البنك"),
        h("div", { class: "row spaced", style: "align-items:flex-start" },
          h("div", {}, h("b", { class: "small" }, "حسب الصعوبة"), bars(st.byDifficulty, (r) => DIFFICULTY[r.difficulty])),
          h("div", {}, h("b", { class: "small" }, "حسب النوع"), bars(st.byType, (r) => QTYPES[r.type].label))),
        h("b", { class: "small" }, "حسب المادة والوحدة"), bars(st.bySubject, (r) => `${r.subject} — ${r.unit}`)),
      panel("الأسئلة", ctx.load.length ? btn("+ سؤال جديد", () => editBankQuestion(null), "sm") : null,
        h("div", { class: "toolbar" }, fSubject, fType, fDiff),
        h("div", { class: "toolbar" }, fUnit, fq, h("label", { class: "row", style: "align-items:center;gap:6px;flex:none" }, mine, "أسئلتي فقط")),
        listBox));
    load();
  }

  drawList();
  return root;
}

/* ---------- إعدادات الإدارة ---------- */
export async function examSettingsPanel() {
  const s = await api("/api/admin/papers-settings");
  const types = await api("/api/admin/papers/context").then((c) => c.types);
  const box = h("div");
  const save = async (patch) => { await api("/api/admin/papers-settings", patch, "PUT"); toast("تم الحفظ"); };
  const tog = (k, label, hint) => h("label", { class: "row", style: "align-items:flex-start;gap:8px;margin-bottom:10px;cursor:pointer" },
    h("input", { type: "checkbox", checked: s[k], style: "width:18px;height:18px;margin-top:4px;flex:none", onchange: (e) => save({ [k]: e.target.checked }) }),
    h("div", {}, h("b", {}, label), hint ? sub(hint) : null));
  const logoBox = h("div");
  const drawLogo = () => mount(logoBox,
    s.logo_image_id ? h("img", { src: `/api/admin/papers/images/${s.logo_image_id}`, alt: "شعار المدرسة", style: "max-height:90px;display:block;margin-bottom:8px" }) : sub("لم يُرفع شعار بعد."),
    h("div", { class: "row", style: "justify-content:flex-start" },
      btn(s.logo_image_id ? "تغيير الشعار" : "رفع الشعار", () => fileIn.click(), "ghost sm"),
      s.logo_image_id ? btn("إزالة", async () => { await api("/api/admin/papers-settings/logo", undefined, "DELETE"); s.logo_image_id = null; drawLogo(); }, "danger sm") : null));
  const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "hidden" });
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files[0]; if (!f) return;
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); });
    try { const r = await api("/api/admin/papers-settings/logo", { mime: f.type, data }); s.logo_image_id = r.id; drawLogo(); toast("رُفع الشعار"); }
    catch (e) { toast(e.message, true); }
  });
  drawLogo();
  const ins = textarea({ rows: 3, value: s.default_instructions || "", placeholder: "اقرأ جميع الأسئلة بعناية.\nأجب في المكان المخصص." });
  const foot = input({ value: s.footer_text || "" });
  mount(box,
    panel("سياسة الاعتماد والصلاحيات", null,
      tog("require_approval", "الإدارة تعتمد الاختبارات قبل طباعتها", "المعلم يرسل الاختبار للاعتماد، ولا يطبعه رسميًا إلا بعد اعتمادك."),
      tog("teacher_can_reopen", "المعلم يعيد فتح اختباره المعتمد للتعديل", "يعمل فقط عند عدم اشتراط اعتماد الإدارة."),
      tog("teacher_answer_keys", "المعلم يطبع نموذج إجابة اختباره", "نموذج الإجابة لا يظهر للطلاب أو أولياء الأمور في أي حال، والتحقق في الخادم.")),
    panel("شعار المدرسة في الاختبارات", null, tog("show_logo", "إظهار شعار المدرسة في أوراق الاختبارات"), logoBox, fileIn),
    panel("القيم الافتراضية", null,
      field("التعليمات الافتراضية للاختبارات الجديدة", ins), field("نص التذييل", foot),
      btn("حفظ", () => save({ default_instructions: ins.value, footer_text: foot.value }))),
    types.custom.length ? panel("أنواع الاختبارات المضافة", null, types.custom.map((t) => h("div", { class: "line" }, h("span", {}, t.name),
      h("label", { class: "row", style: "align-items:center;gap:6px;flex:none" },
        h("input", { type: "checkbox", checked: t.is_active, onchange: (e) => api(`/api/admin/papers-settings/types/${t.id}`, { is_active: e.target.checked }, "PUT") }), "مفعّل")))) : null);
  return box;
}
