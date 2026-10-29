/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h } from "./dom.js";
import { api } from "./api.js";
import { panel, sub, badge, empty, input, btn, dialog, notice, toast, confirmAction } from "./ui.js";

// The academic record of a university student: one table per term with its GPA, then the cumulative GPA, the credits
// earned against the programme, the standing and the required courses still to take. Used by the registrar and the student.
export function uniTranscript(tr, { print = false } = {}) {
  const s = tr.student;
  const head = panel(s.name, null,
    sub([s.student_no ? `الرقم الجامعي ${s.student_no}` : null, s.program, tr.degree_name, s.department, s.college].filter(Boolean).join(" · ")),
    h("div", { class: "uni-kpis" },
      kpi("المعدل التراكمي", tr.cgpa === null ? "—" : `${tr.cgpa.toFixed(2)} من ${tr.max_points}`),
      kpi("الساعات المكتسبة", s.total_credits ? `${tr.earned} من ${s.total_credits}` : String(tr.earned)),
      kpi("الإنجاز", tr.progress === null ? "—" : `${tr.progress}%`),
      kpi("الحالة الأكاديمية", tr.standing_name ? badge(tr.standing_name, tr.standing === "probation" ? "red" : "") : "—")),
    s.total_credits ? h("span", { class: "qr-bar big" }, h("i", { style: `width:${tr.progress || 0}%` })) : null);
  const terms = tr.terms.length ? tr.terms.map((t) => panel(t.term, null,
    h("div", { class: "table-wrap" }, h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, ["الرمز", "المقرر", "الساعات", "الدرجة", "التقدير", "النقاط"].map((x) => h("th", {}, x)))),
      h("tbody", {}, t.courses.map((c) => h("tr", {}, h("td", { class: "ltr" }, c.code), h("td", {}, c.name), h("td", {}, String(c.credits)),
        h("td", {}, c.mark === null ? "—" : String(c.mark)), h("td", {}, c.letter ? badge(c.letter, c.points === 0 ? "red" : "") : "لم تُرصد"),
        h("td", {}, c.points === null ? "—" : c.points.toFixed(2))))))),
    sub(`ساعات الفصل ${t.credits} · المعدل الفصلي ${t.gpa === null ? "—" : t.gpa.toFixed(2)} · التراكمي حتى نهايته ${t.cgpa === null ? "—" : t.cgpa.toFixed(2)}`)))
    : [panel("الفصول", null, empty("لم يُسجَّل في أي مقرر بعد."))];
  const left = tr.remaining.length && !print ? panel(`مقررات إجبارية متبقية في الخطة (${tr.remaining.length})`, null,
    h("div", { class: "xb-chips" }, tr.remaining.map((c) => h("span", { class: "xb-chip", style: "cursor:default" }, `${c.code} ${c.name} (${c.credits})`)))) : null;
  return h("div", { class: "uni-transcript" }, head, terms, left);
}
const kpi = (label, value) => h("div", { class: "uni-kpi" }, h("small", {}, label), h("b", {}, value));

// A section's students and marks. The instructor saves and submits; after submission only the registrar edits or reopens.
export async function rosterDialog(sectionId, reload, { base, admin = false }) {
  const r = await api(`${base}/sections/${sectionId}/roster`);
  const sec = r.section;
  const locked = !admin && sec.grades_submitted_at;
  const ins = r.students.map((s) => ({ s, el: input({ type: "number", min: 0, max: 100, step: "0.5", value: s.mark ?? "", disabled: locked, inputMode: "decimal" }) }));
  const save = async (submit) => {
    try {
      await api(`${base}/sections/${sectionId}/marks`, { marks: ins.map((x) => ({ id: x.s.id, mark: x.el.value === "" ? null : Number(x.el.value) })), submit }, "PUT");
      d.close(); toast(submit ? "سُلّمت الدرجات" : "حُفظت الدرجات"); reload?.();
    } catch (e) { toast(e.message, true); }
  };
  const td = (x, cls) => h("td", cls ? { class: cls } : {}, x ?? "—");
  const table = (head, rows) => h("div", { class: "table-wrap" }, h("table", { class: "grid" },
    h("thead", {}, h("tr", {}, head.map((x) => h("th", {}, x)))), h("tbody", {}, rows)));
  const d = dialog(`${sec.course_code} ${sec.course_name} — شعبة ${sec.code}`, h("div", { class: "uni-marks" },
    sub(`${sec.term} · ${sec.registered} طالب · الدرجة من 100 وتتحول إلى تقدير بسلّم الجامعة`),
    sec.grades_submitted_at ? notice(admin ? "سلّم المدرّس الدرجات. أي تعديل هنا يُسجَّل في السجل." : "سلّمت درجات هذه الشعبة. للتعديل تواصل مع القبول والتسجيل.", admin ? "" : "warn") : null,
    r.students.length ? table(["الطالب", "الرقم", "الدرجة", "التقدير"], ins.map((x) => h("tr", {}, td(x.s.name), td(x.s.student_no, "ltr"), h("td", {}, x.el), td(x.s.letter))))
      : empty("لا يوجد طلاب مسجلون.")),
  [locked ? null : btn("حفظ", () => save(false), "ghost"), locked || !r.students.length ? null : btn("حفظ وتسليم", () => {
    if (confirmAction("تسليم الدرجات؟ بعد التسليم لا يعدّلها إلا القبول والتسجيل.")) save(true);
  }), admin && sec.grades_submitted_at ? btn("إعادة فتح الرصد", async () => { await api(`${base}/sections/${sectionId}/reopen`, {}); d.close(); reload?.(); }, "ghost") : null].filter(Boolean));
  d.classList.add("xb-wide");
}

