/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// كشف الدرجات: view any student's transcript from the current results (a draft), issue official copies from
// approved results (serial number, verification code, a new version after each correction), print one student,
// a selection, a class or a whole grade, and export the class results to Excel.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, btn, empty, badge, sub, toast, notice, switchBtn, line, confirmAction, askReason } from "../../shared/js/ui.js";
import { fmtDate } from "../../shared/js/format.js";
import { certificateSheet, printCertificateSheet } from "../../shared/js/cert-render.js";
import { A, loadClasses } from "./common.js";

const OPTION_LABELS = {
  tr_components: "توزيع الدرجة (أعمال السنة، النهائي…) إن وُجد",
  tr_percent: "النسبة لكل مادة",
  tr_grade: "التقدير لكل مادة",
  tr_subject_result: "حالة كل مادة (ناجح / دور ثانٍ)",
  tr_absence: "الحضور والغياب",
  tr_guardian_sign: "مكان توقيع ولي الأمر",
};

export default async function reports() {
  const [classes, academic] = await Promise.all([loadClasses(), api(`${A}/academic`)]);
  if (!classes.length) return notice("أنشئ الشعب أولًا من الهيكل الأكاديمي.", "warn");
  const terms = academic.terms.filter((t) => t.year_id === academic.current?.year_id);
  const S = { classId: classes[0].id, scope: "term", termId: academic.current?.term_id || terms[0]?.id || null, chosen: new Set(), notes: new Map(), data: null };
  const classSel = select(classes.map((c) => [c.id, c.name]), { value: S.classId });
  const scopeSel = select([["term", "نتيجة الفصل الدراسي"], ["year", "نتيجة العام الدراسي"]], { value: S.scope });
  const termSel = select(terms.map((t) => [t.id, t.name]), { value: S.termId });
  const termField = field("الفصل الدراسي", termSel);
  const listBox = h("div"), out = h("div");
  const key = () => ({ class_id: S.classId, scope: S.scope, ...(S.scope === "term" && S.termId ? { term_id: S.termId } : {}) });
  const query = () => new URLSearchParams(Object.entries(key()).map(([k, v]) => [k, String(v)])).toString();
  const notesBody = () => Object.fromEntries([...S.notes].filter(([, v]) => v.trim()).map(([k, v]) => [String(k), v.trim()]));
  classSel.addEventListener("change", () => { S.classId = Number(classSel.value); reload(); });
  scopeSel.addEventListener("change", () => { S.scope = scopeSel.value; termField.hidden = S.scope !== "term"; reload(); });
  termSel.addEventListener("change", () => { S.termId = Number(termSel.value); reload(); });

  async function reload() {
    S.chosen.clear(); S.notes.clear(); mount(out);
    mount(listBox, empty("جارٍ التحميل…"));
    try { S.data = await api(`${A}/certificates/transcripts/preview`, key()); draw(); }
    catch (e) { mount(listBox, notice(e.message, "err")); }
  }

  const show = (rows, title) => mount(out, panel(title, null,
    h("div", { class: "toolbar" }, btn("طباعة / حفظ PDF", () => printCertificateSheet(rows)), sub(`${rows.length} كشف — صفحة A4 لكل طالب`)),
    certificateSheet(rows)));
  const selected = () => (S.chosen.size ? [...S.chosen] : S.data.students.filter((s) => s.subjects).map((s) => s.id));

  async function viewDrafts() {
    const ids = selected();
    if (!ids.length) return toast("لا توجد درجات منشورة لهؤلاء الطلاب", true);
    const p = await api(`${A}/certificates/transcripts/preview`, { ...key(), student_ids: ids, notes: notesBody() });
    show(p.transcripts.map((d) => ({ kind: "transcript", data: d, draft: true })), "معاينة الكشوف (مسودة من الدرجات الحالية)");
  }
  async function printIssued(ids, title) {
    if (!ids.length) return toast("لا توجد كشوف رسمية صادرة بعد", true);
    show(await api(`${A}/certificates/print`, { ids }), title);
  }
  async function issue() {
    const d = S.data, ids = selected();
    const again = d.students.filter((s) => ids.includes(s.id) && s.issued).length;
    let reason = null;
    if (again) {
      reason = await askReason({ title: "إصدار نسخة جديدة", action: "إصدار", label: "سبب النسخة الجديدة",
        explain: `${again} من الطلاب المحددين لهم كشف رسمي صادر. ستصدر نسخة جديدة برقم جديد، وتبقى السابقة في السجل «مستبدلة».`,
        value: "تصحيح النتائج" });
      if (!reason) return;
    } else if (!confirmAction(`إصدار ${ids.length} كشف درجات رسمي من النتائج المعتمدة؟ يصل إشعار لأولياء الأمور.`)) return;
    try {
      const r = await api(`${A}/certificates/transcripts/issue`, { ...key(), student_ids: ids, notes: notesBody(), ...(reason ? { reason } : {}) });
      toast(`صدر ${r.issued} كشف${r.new_versions ? ` (منها ${r.new_versions} نسخة جديدة)` : ""}`);
      const keep = new Map(S.notes);
      await reload();
      S.notes = keep;
      await printIssued(r.ids, "الكشوف الرسمية الصادرة");
    } catch (e) { toast(e.message, true); }
  }

  function draw() {
    const d = S.data;
    const withGrades = d.students.filter((s) => s.subjects);
    const all = h("input", { type: "checkbox", "aria-label": "تحديد الكل", checked: S.chosen.size > 0 && S.chosen.size === withGrades.length });
    all.addEventListener("change", () => { S.chosen = new Set(all.checked ? withGrades.map((s) => s.id) : []); draw(); });
    const issuedHere = d.students.filter((s) => s.issued).map((s) => s.issued.id);
    const n = S.chosen.size || withGrades.length;
    const state = d.ready
      ? notice(`النتائج معتمدة داخليًا. ${d.can_issue ? "يمكنك إصدار كشوف رسمية لها رقم ورمز تحقق." : "إصدار الكشوف الرسمية لإدارة المدرسة العامة."}`, "")
      : notice(h("span", {}, `حالة النتائج: ${d.status_label}. يمكنك عرض الكشوف وطباعتها كمسودة للاطلاع، أما الكشف الرسمي فيصدر بعد اعتماد النتائج من `,
        h("a", { href: "#/certificates", class: "au-link" }, "الشهادات ← اعتماد النتائج"), "."), "warn");
    mount(listBox,
      state,
      h("div", { class: "tr-actions" },
        btn(`عرض ${S.chosen.size ? `المحددين (${n})` : "كل الكشوف"}`, viewDrafts, "soft"),
        d.ready && d.can_issue ? btn(`إصدار رسمي ${S.chosen.size ? `للمحددين (${n})` : `للجميع (${n})`}`, issue) : null,
        issuedHere.length ? btn(`طباعة الرسمية الصادرة (${issuedHere.length})`, () => printIssued(issuedHere, "الكشوف الرسمية لهذه الشعبة"), "ghost") : null,
        d.grade_id ? btn(`الرسمية لكل شعب ${d.grade_name}`, async () => {
          const qs = new URLSearchParams({ grade_id: String(d.grade_id), scope: S.scope, ...(S.scope === "term" && S.termId ? { term_id: String(S.termId) } : {}) });
          await printIssued(await api(`${A}/certificates/transcripts/issued?${qs}`), `الكشوف الرسمية لكل شعب ${d.grade_name}`);
        }, "ghost") : null,
        h("a", { class: "btn ghost", href: `${A}/certificates/transcripts/export.xlsx?${query()}`, download: "" }, "تنزيل Excel")),
      d.students.length ? h("div", { class: "tr-list" },
        h("div", { class: "tr-row tr-head" }, h("label", { class: "tr-check" }, all, "الطالب"), h("span", {}, "النسبة"), h("span", {}, "النتيجة"), h("span", {}, "الكشف الرسمي")),
        d.students.map((s) => {
          const cb = h("input", { type: "checkbox", disabled: !s.subjects, checked: S.chosen.has(s.id), "aria-label": `تحديد ${s.name}` });
          cb.addEventListener("change", () => { cb.checked ? S.chosen.add(s.id) : S.chosen.delete(s.id); draw(); });
          const note = h("input", { class: "tr-note", maxLength: 300, placeholder: "ملاحظة تظهر في كشف هذا الطالب (اختياري)", value: S.notes.get(s.id) || "", hidden: !S.notes.has(s.id) });
          note.addEventListener("input", () => S.notes.set(s.id, note.value));
          return h("div", { class: `tr-row${s.subjects ? "" : " off"}` },
            h("label", { class: "tr-check" }, cb, h("span", {}, h("b", {}, s.name), s.student_no ? h("small", { dir: "ltr" }, s.student_no) : null)),
            h("span", {}, s.percent === null ? "—" : `${s.percent}%`),
            h("span", {}, s.subjects ? badge(s.result, s.passed ? "green" : "red") : badge("لا درجات", "gray")),
            h("span", {}, s.issued ? h("small", {}, badge(`نسخة ${s.issued.version}`, "green"), " ", h("bdi", { dir: "ltr" }, s.issued.serial), ` — ${fmtDate(String(s.issued.issued_at).slice(0, 10))}`) : h("small", { class: "muted" }, "لم يصدر")),
            s.subjects ? h("button", { type: "button", class: "tr-note-b", onclick: () => { if (!S.notes.has(s.id)) S.notes.set(s.id, ""); note.hidden = false; note.focus(); } }, "+ ملاحظة") : null,
            note);
        })) : empty("لا يوجد طلاب في هذه الشعبة."),
      optionsBox(d));
  }

  function optionsBox(d) {
    const save = async (patch) => { await api(`${A}/communication/features/certificates`, patch, "PUT"); Object.assign(d.options, patch); toast("حُفظ — يظهر في الكشوف التي تُعرض أو تصدر من الآن"); return true; };
    return h("details", { class: "tr-opts" }, h("summary", {}, "ما يظهر في الكشف"),
      sub("اختر ما يناسب نظام مدرستك. الكشوف الصادرة سابقًا تبقى كما صدرت."),
      Object.entries(OPTION_LABELS).map(([k, label]) => line(h("span", {}, label), d.can_issue ? switchBtn(d.options[k], label, (v) => save({ [k]: v })) : badge(d.options[k] ? "يظهر" : "لا يظهر", "gray"))),
      line(h("span", {}, "ترتيب الطالب في الشعبة"), d.can_issue ? switchBtn(d.show_rank, "ترتيب الطالب", async (v) => { await save({ show_rank: v }); d.show_rank = v; return true; }) : badge(d.show_rank ? "يظهر" : "لا يظهر", "gray")));
  }

  termField.hidden = S.scope !== "term";
  reload();
  return [panel("كشف الدرجات", null,
    sub("اعرض كشف أي طالب من الدرجات المنشورة واطبعه، وأصدر نسخة رسمية برقم ورمز تحقق بعد اعتماد النتائج. كل تصحيح لاحق يصدر نسخة جديدة ويبقى السابق في السجل."),
    h("div", { class: "row" }, field("الشعبة", classSel), field("النطاق", scopeSel), termField),
    listBox), out];
}
