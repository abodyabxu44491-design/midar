/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, notice, dialog, confirmAction, stats } from "./ui.js";
import { fmtDateTime } from "./format.js";
import { rich } from "./exam/math.js";
import { mediaPlayer } from "./exam/editor.js";

const LAYOUT = { one: "سؤال واحد في كل صفحة", section: "كل قسم في صفحة", all: "كل الأسئلة في صفحة واحدة" };
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
  const layout = select(Object.entries(LAYOUT), { value: "one" });
  const noBack = h("input", { type: "checkbox" });
  const code = input({ class: "ltr", maxLength: 12, placeholder: "اختياري", autocomplete: "off" });
  const leaves = select([["0", "يُسجَّل فقط"], ["1", "يُسلَّم بعد مرة واحدة"], ["3", "يُسلَّم بعد 3 مرات"], ["5", "يُسلَّم بعد 5 مرات"]], { value: "0" });
  const cls = classes.length > 1 ? select(classes.map((c) => [c.id, c.name]), { value: paper.class_id }) : null;
  const d = dialog(`نشر «${paper.title}» إلكترونيًا`, h("div", {},
    sub("يحل الطلاب الاختبار من ملف الطالب على الجوال. الأسئلة الموضوعية تُصحح تلقائيًا، والمقالية تصححها أنت."),
    cls ? field("الشعبة", cls) : null,
    h("div", { class: "row" }, field("يفتح", opens), field("يُغلق", closes)),
    h("div", { class: "row" }, field("المدة بالدقائق", duration, "تبدأ من لحظة دخول الطالب"), field("النتيجة للطالب", show)),
    h("div", { class: "row" }, field("طريقة العرض", layout, "ينتقل الطالب بين الصفحات بزر التالي"), field("رمز الدخول", code, "يكتبه الطالب قبل البدء")),
    field("الخروج من صفحة الاختبار", leaves, "كل خروج إلى تطبيق آخر يُسجَّل ويظهر لك"),
    h("label", { class: "check-line" }, noBack, "منع الرجوع إلى صفحة بعد الانتقال منها"),
    h("label", { class: "check-line" }, shuffle, "ترتيب مختلف للأسئلة والخيارات لكل طالب"),
    h("label", { class: "check-line" }, link, "رصد الدرجة في «رصد الدرجات» تلقائيًا")),
  [btn("نشر وإشعار الطلاب", async () => {
    const r = await api(base, { paper_id: paper.id, class_id: cls ? Number(cls.value) : paper.class_id || undefined,
      opens_at: new Date(opens.value).toISOString(), closes_at: new Date(closes.value).toISOString(),
      duration_min: Number(duration.value), show_result: show.value, shuffle: shuffle.checked, link_exam: link.checked,
      layout: layout.value, no_back: noBack.checked, access_code: code.value.trim(), max_leaves: Number(leaves.value) });
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
  let liveTimer = null;
  const drawExam = async (id) => {
    clearTimeout(liveTimer);
    const d = await api(`${base}/${id}`);
    const x = d.exam;
    const st = x.settings || {};
    const done = d.students.filter((s) => s.submitted_at);
    const live = d.students.filter((s) => s.attempt_id && !s.submitted_at);
    const scores = done.filter((s) => !s.needs_grading).map((s) => Number(s.score));
    const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null;
    const open = x.status === "open" && new Date(x.closes_at) > new Date();
    const exportCsv = () => {
      const rows = [["الطالب", "الحالة", "الدرجة", "من", "أجاب عن", "الخروج من الصفحة", "بدأ", "سلّم"],
        ...d.students.map((s) => [s.name, s.submitted_at ? (s.needs_grading ? "يحتاج تصحيحًا" : "سلّم") : s.attempt_id ? "يحل الآن" : "لم يبدأ",
          s.submitted_at && !s.needs_grading ? s.score : "", x.max_score, s.attempt_id ? s.answered : "", s.events?.leaves || 0,
          s.started_at ? fmtDateTime(s.started_at) : "", s.submitted_at ? fmtDateTime(s.submitted_at) : ""])];
      const csv = "\ufeff" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `${x.title}.csv` });
      document.body.append(a); a.click(); a.remove();
    };
    const studentActions = (s) => {
      const out = [];
      if (s.submitted_at) out.push(btn(s.needs_grading ? "تصحيح" : "عرض", () => gradeDialog(id, s.attempt_id, () => drawExam(id)), "ghost sm"));
      if (s.attempt_id) out.push(btn(s.submitted_at ? "إعادة فتح" : "وقت إضافي", () => extendDialog(id, s, () => drawExam(id)), "ghost sm"));
      if (s.attempt_id && open) out.push(btn("بدء من جديد", async () => {
        if (!confirmAction(`حذف محاولة ${s.name} ليبدأ الاختبار من جديد؟ تُحذف إجاباته.`)) return;
        await api(`${base}/${id}/attempts/${s.attempt_id}`, undefined, "DELETE"); toast("يستطيع الطالب البدء من جديد"); drawExam(id);
      }, "ghost sm"));
      return h("div", { class: "row", style: "gap:4px;flex-wrap:wrap;justify-content:flex-end" }, out);
    };
    const statusOf = (s) => s.submitted_at ? (s.needs_grading ? badge("يحتاج تصحيحًا", "amber") : badge("سلّم"))
      : s.attempt_id ? [badge("يحل الآن", "amber"), h("div", { class: "oe-live" }, `أجاب ${s.answered} من ${x.question_count}`)] : badge("لم يبدأ", "gray");
    const tabBox = h("div");
    const tabs = h("div", { class: "xb-chips", role: "tablist" });
    const showTab = (k) => {
      for (const b of tabs.children) b.classList.toggle("on", b.dataset.k === k);
      if (k === "students") mount(tabBox, h("div", { class: "table-wrap" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, h("th", {}, "الطالب"), h("th", {}, "الحالة"), h("th", {}, "الدرجة"), h("th", {}, "الخروج من الصفحة"), h("th", {}, ""))),
        h("tbody", {}, d.students.map((s) => h("tr", {},
          h("td", {}, s.name),
          h("td", {}, statusOf(s)),
          h("td", {}, s.submitted_at && !s.needs_grading ? `${s.score} / ${x.max_score}` : s.auto_score !== null && s.submitted_at ? `${s.auto_score} + ؟` : "—"),
          h("td", {}, s.events?.leaves ? badge(`${s.events.leaves} ${s.events.leaves === 1 ? "مرة" : "مرات"}`, s.events.leaves > 2 ? "red" : "amber") : "—"),
          h("td", {}, studentActions(s))))))));
      if (k === "analysis") mount(tabBox, analysisView(d.analysis || [], done.length));
      if (k === "settings") mount(tabBox, settingsView(x, () => drawExam(id)));
    };
    for (const [k, l] of [["students", "الطلاب"], ["analysis", "تحليل الأسئلة"], ["settings", "الإعدادات"]]) {
      tabs.append(h("button", { type: "button", role: "tab", class: "xb-chip", "data-k": k, onclick: () => showTab(k) }, l));
    }
    mount(root,
      h("div", { class: "toolbar" }, btn("رجوع", () => { clearTimeout(liveTimer); drawList(); }, "ghost sm"),
        x.exam_id ? btn("رصد الدرجات", async () => { const r = await api(`${base}/${id}/sync`, {}); toast(`رُصدت ${r.synced} درجة${r.waiting ? ` — ${r.waiting} بانتظار التصحيح` : ""}`); }, "sm") : null,
        btn("تنزيل Excel", exportCsv, "ghost sm"),
        x.status === "open" ? btn("إغلاق الآن", async () => { if (!confirmAction("إغلاق الاختبار؟ يُسلَّم ما حفظه الطلاب.")) return; await api(`${base}/${id}/close`, {}); drawExam(id); }, "ghost sm") : null,
        !d.students.some((s) => s.attempt_id) ? btn("حذف", async () => { if (!confirmAction("حذف الاختبار الإلكتروني؟")) return; await api(`${base}/${id}`, undefined, "DELETE"); drawList(); }, "danger sm") : null),
      panel(x.title, null,
        stats([["سلّم", `${done.length} / ${d.students.length}`], ["يحل الآن", live.length], ["المتوسط", avg === null ? "—" : `${avg} / ${x.max_score}`],
          ["بانتظار التصحيح", done.filter((s) => s.needs_grading).length], ["الأسئلة", x.question_count]]),
        sub(`${SHOW[x.show_result]} — ${LAYOUT[st.layout || "all"]}${st.no_back ? " — بلا رجوع" : ""}${st.access_code ? ` — رمز الدخول: ${st.access_code}` : ""}. الطالب الذي انتهى وقته يُسلَّم تلقائيًا بما حفظه.`),
        live.length ? h("div", { class: "oe-live" }, "تتحدث القائمة كل 20 ثانية أثناء الاختبار.") : null,
        tabs, tabBox));
    showTab("students");
    // While students are solving, the list refreshes by itself.
    if (live.length) liveTimer = setTimeout(() => { if (root.isConnected && tabs.querySelector(".on")?.dataset.k === "students") drawExam(id); }, 20000);
  };

  // Each question: how many got it right, the average, and which options were chosen. Weak questions stand out.
  function analysisView(rows, n) {
    if (!n) return empty("يظهر التحليل بعد أن يسلّم الطلاب.");
    return h("div", { class: "oe-analysis" },
      sub("نسبة من أخذ الدرجة كاملة في كل سؤال. السؤال الذي تقل نسبته عن 40% يستحق المراجعة: قد يكون صعبًا أو غير واضح."),
      rows.map((r) => {
        const pct = r.right_pct;
        return h("div", { class: "oe-an-row" },
          h("div", { class: "oe-an-head" }, h("b", {}, `${r.n}. ${r.text || "سؤال"}`),
            h("small", { class: "muted" }, pct === null ? "بانتظار التصحيح" : `${pct}% أجابوا إجابة كاملة — المتوسط ${r.avg} من ${r.marks}`)),
          pct === null ? null : h("div", { class: `oe-an-bar${pct < 40 ? " low" : pct < 70 ? " mid" : ""}` }, h("i", { style: `width:${pct}%` })),
          r.options ? h("div", { class: "oe-an-opts" }, r.options.map((o) => h("span", { class: o.correct ? "right" : "" },
            `${o.correct ? "✓ " : ""}${o.text || "(صورة)"} — اختاره ${o.picked}`))) : null,
          r.answered < r.attempts ? h("small", { class: "muted" }, `لم يُجب عنه ${r.attempts - r.answered} طالب`) : null);
      }));
  }

  function settingsView(x, after) {
    const st = x.settings || {};
    const closes = input({ type: "datetime-local", value: localInput(new Date(x.closes_at)) });
    const layout = select(Object.entries(LAYOUT), { value: st.layout || "all" });
    const show = select(Object.entries(SHOW), { value: x.show_result });
    const code = input({ class: "ltr", maxLength: 12, value: st.access_code || "", placeholder: "بلا رمز" });
    const leaves = select([["0", "يُسجَّل فقط"], ["1", "يُسلَّم بعد مرة واحدة"], ["3", "يُسلَّم بعد 3 مرات"], ["5", "يُسلَّم بعد 5 مرات"]], { value: String(st.max_leaves || 0) });
    const noBack = h("input", { type: "checkbox", checked: !!st.no_back });
    return h("div", { class: "spaced" },
      sub("تعديلات تسري على الطلاب من الآن. تمديد موعد الإغلاق يعيد فتح الاختبار المغلق."),
      h("div", { class: "row" }, field("يُغلق", closes), field("النتيجة للطالب", show)),
      h("div", { class: "row" }, field("طريقة العرض", layout), field("رمز الدخول", code)),
      field("الخروج من صفحة الاختبار", leaves),
      h("label", { class: "check-line" }, noBack, "منع الرجوع إلى صفحة بعد الانتقال منها"),
      btn("حفظ الإعدادات", async () => {
        await api(`${base}/${x.id}`, { closes_at: new Date(closes.value).toISOString(), show_result: show.value, layout: layout.value,
          access_code: code.value.trim(), max_leaves: Number(leaves.value), no_back: noBack.checked }, "PATCH");
        toast("حُفظت الإعدادات"); after();
      }));
  }

  function extendDialog(id, s, after) {
    const minutes = select([["5", "5 دقائق"], ["10", "10 دقائق"], ["15", "15 دقيقة"], ["30", "30 دقيقة"], ["60", "ساعة"]], { value: "10" });
    const d = dialog(s.submitted_at ? `إعادة فتح الاختبار لـ ${s.name}` : `وقت إضافي لـ ${s.name}`, h("div", {},
      sub(s.submitted_at ? "تُفتح محاولته بإجاباته المحفوظة ليكملها، ثم يسلّم من جديد. مفيد عند انقطاع الاتصال أو خطأ." : "يُضاف الوقت إلى عدّاده الآن."),
      field("المدة", minutes)),
    [btn(s.submitted_at ? "إعادة فتح" : "إضافة الوقت", async () => {
      await api(`${base}/${id}/attempts/${s.attempt_id}/extend`, { minutes: Number(minutes.value) });
      d.close(); toast(s.submitted_at ? "أُعيد فتح الاختبار للطالب" : "أُضيف الوقت"); after();
    })]);
  }
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
        shown = h("ul", { class: "oe-opts" }, (q.options || []).map((o) => h("li", { class: `${(q.correct || []).includes(o.id) ? "right" : ""}${picked.has(o.id) ? " picked" : ""}` },
          o.image?.id ? h("img", { class: "oe-opt-img", src: `${base}/${id}/assets/image/${o.image.id}`, alt: "", loading: "lazy" }) : null, o.text)));
      } else if (q.type === "truefalse") shown = sub(`إجابته: ${ans === true ? "صح" : ans === false ? "خطأ" : "—"} — الصحيح: ${q.correct ? "صح" : "خطأ"}`);
      else if (q.type === "fill") shown = sub(`إجابته: ${[].concat(ans || []).join(" ، ") || "—"} — الصحيح: ${(q.answers || []).join(" ، ")}`);
      else if (q.type === "match") shown = h("ul", { class: "oe-opts" }, (q.left || []).map((l) => {
        const got = q.right.find((r) => r.id === ans?.[l.id]);
        const ok = q.key_pairs?.[l.id] === ans?.[l.id];
        return h("li", { class: ok ? "right picked" : "picked" }, `${l.text} ← ${got?.text || "—"}`);
      }));
      else if (q.type === "order") shown = sub(`ترتيبه: ${[].concat(ans || []).map((id) => (q.items || []).find((x) => x.id === id)?.text || "؟").join(" ← ")}`);
      else if (q.file) {
        const src = `${base}/${id}/attempts/${aid}/files/${q.id}`;
        shown = h("div", { class: "oe-file" }, q.respond === "audio" ? h("audio", { src, controls: true, preload: "metadata" })
          : h("a", { href: src, target: "_blank", rel: "noopener", title: "فتح الصورة كاملة" }, h("img", { src, alt: "صورة حل الطالب", loading: "lazy" })));
      } else if (q.respond === "image" || q.respond === "audio") shown = h("span", { class: "muted" }, q.respond === "audio" ? "لم يسجّل إجابة" : "لم يرفع صورة");
      else shown = h("div", { class: "oe-essay" }, typeof ans === "string" && ans ? ans : h("span", { class: "muted" }, "لم يُجب"));
      const markInput = !q.auto ? input({ type: "number", min: 0, max: q.marks, step: 0.25, value: q.mark ?? "", class: "ltr", style: "max-width:90px" }) : null;
      markInput?.addEventListener("input", () => { manual[q.id] = markInput.value === "" ? null : Number(markInput.value); });
      return h("div", { class: "oe-review" },
        h("div", { class: "oe-q" }, h("b", {}, `${i + 1}. `), rich(q.text, { blanks: q.type === "fill" })),
        q.media ? h("div", { class: "oe-media" }, mediaPlayer(q.media, q.media.id ? `${base}/${id}/assets/media/${q.media.id}` : null)) : null,
        shown,
        q.model && !q.auto ? sub(`الإجابة النموذجية: ${q.model}`) : null,
        h("div", { class: "oe-mark" }, q.auto ? sub(`الدرجة: ${q.mark ?? 0} من ${q.marks}`) : [field(`درجة السؤال (من ${q.marks})`, markInput)]));
    });
    const dd = dialog(`إجابات ${d.student}`, h("div", { class: "oe-review-list" }, body),
      d.questions.some((q) => !q.auto) ? [btn("حفظ التصحيح", async () => {
        const r = await api(`${base}/${id}/attempts/${aid}/marks`, { marks: manual }, "PUT");
        toast(r.needs_grading ? "حُفظ. بقيت أسئلة بلا درجة." : `الدرجة النهائية ${r.score}`); dd.close(); after();
      })] : []);
    dd.classList.add("oe-grade-dialog");
  }
}

export const onlineBaseOf = (papersBase) => papersBase.replace(/\/papers$/, "/online-exams");

