/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Shared institute UI: terminology, progress display, attendance and score sheets, certificate printing.
// Used by the institute administration, the accountant and the trainer portal.
import { printCertificateSheet } from "./cert-render.js";
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { btn, dialog, empty, badge, sub, toast, notice, select, input, textarea, field, docLogo } from "./ui.js";
import { icons } from "./icons.js";
import { fmtDate } from "./format.js";

export const inst = { base: "/api/admin/institute", meta: null };
export const T = (k) => inst.meta?.settings?.terms?.[k] || k;
// The plural after a preposition or a possessive («كل المتدربين»): sound masculine plurals take -ين.
export const Tg = (k) => T(k).replace(/ون$/, "ين");
export const L = (group, k) => inst.meta?.labels?.[group]?.[k] || k;
export const has = (cap) => (inst.meta?.caps || []).includes(cap);
export async function loadMeta(base) {
  inst.base = base;
  inst.meta = await api(`${base}/meta`);
  return inst.meta;
}

export const COURSE_TONE = { planned: "gray", open: "blue", running: "", completed: "violet", canceled: "red" };
export const ENROLL_TONE = { new: "blue", active: "", completed: "violet", failed: "red", withdrawn: "gray", deferred: "amber", suspended: "amber" };
export const courseBadge = (s) => badge(L("course_status", s), COURSE_TONE[s] ?? "");
export const enrollBadge = (s) => badge(L("enroll_status", s), ENROLL_TONE[s] ?? "");
export const num = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
export const pct = (v) => (v == null ? "—" : `${num(v)}%`);

export function bar(value, max, tone = "") {
  const w = max ? Math.max(0, Math.min(100, (Number(value) / Number(max)) * 100)) : 0;
  return h("div", { class: `in-bar ${tone}`, role: "progressbar", "aria-valuenow": Math.round(w), "aria-valuemin": 0, "aria-valuemax": 100 }, h("i", { style: `width:${w}%` }));
}

// One compact block that answers "where is this trainee in this course?"
export function progressBlock(p) {
  if (!p) return null;
  return h("div", { class: "in-prog" },
    h("div", { class: "in-prog-row" },
      h("div", {}, h("small", {}, "الساعات"), h("b", {}, `${num(p.attended_hours)} من ${num(p.course_hours)}`), bar(p.attended_hours, p.course_hours)),
      h("div", {}, h("small", {}, "الحضور"), h("b", { class: p.low_attendance ? "danger-text" : "" }, pct(p.attendance_pct)),
        bar(p.attendance_pct ?? 0, 100, p.low_attendance ? "warn" : "")),
      h("div", {}, h("small", {}, p.grading === "pass_fail" ? "التقييمات" : "النتيجة"),
        h("b", {}, p.grading === "pass_fail" ? `${p.items.filter((x) => x.passed === true).length} من ${p.items.length}` : pct(p.final_score)),
        p.grading === "pass_fail" ? bar(p.items.filter((x) => x.passed === true).length, p.items.length || 1) : bar(p.final_score ?? 0, 100))),
    p.eligible ? h("div", { class: "in-ok" }, icons.check({ size: 14 }), "استوفى شروط الإكمال")
      : p.reasons.length ? h("ul", { class: "in-why" }, p.reasons.map((r) => h("li", {}, r))) : null);
}

// Attendance sheet for one session: one tap per trainee, all present by default for a fresh session.
export async function attendanceDialog(sessionId, { onSaved } = {}) {
  const d = await api(`${inst.base}/sessions/${sessionId}/attendance`);
  const s = d.session;
  const STATES = [["present", "حاضر"], ["late", "متأخر"], ["absent", "غائب"], ["excused", "بعذر"]];
  const fresh = d.roster.every((r) => !r.status);
  const state = new Map(d.roster.map((r) => [Number(r.enrollment_id), { status: r.status || (fresh ? "present" : null), late: r.late_minutes || "" }]));
  const list = h("div", { class: "in-att" });
  const counts = h("div", { class: "in-att-counts" });
  const draw = () => {
    mount(counts, STATES.map(([k, l]) => h("span", { class: `c-${k}` }, `${l} ${[...state.values()].filter((v) => v.status === k).length}`)));
    mount(list, d.roster.length ? d.roster.map((r) => {
      const v = state.get(Number(r.enrollment_id));
      const late = input({ type: "number", min: 0, max: 600, value: v.late, placeholder: "دقائق", class: "in-late", "aria-label": "دقائق التأخر" });
      late.addEventListener("input", () => { v.late = late.value; });
      return h("div", { class: "in-att-row" },
        h("div", { class: "in-att-name" }, h("b", {}, r.full_name), r.student_no ? h("small", { dir: "ltr" }, r.student_no) : null),
        h("div", { class: "in-seg", role: "radiogroup", "aria-label": r.full_name }, STATES.map(([k, l]) => h("button", {
          type: "button", class: `s-${k}${v.status === k ? " on" : ""}`, role: "radio", "aria-checked": String(v.status === k),
          onclick: () => { v.status = k; draw(); },
        }, l))),
        v.status === "late" ? late : null);
    }) : empty(`ليس هناك أي ${T("trainee")} في هذه ${T("session")}.`));
  };
  draw();
  const locked = ["canceled", "rescheduled"].includes(s.status);
  const dd = dialog(`حضور ${s.course_name} — ${fmtDate(s.day)}`, h("div", {},
    sub(`${num(s.hours)} ساعة${s.topic ? ` · ${s.topic}` : ""}`),
    locked ? notice("الجلسة ملغاة أو معادة الجدولة، فلا يُسجل لها حضور.", "warn") : null,
    !locked && d.roster.length ? h("div", { class: "row", style: "justify-content:flex-start;gap:6px;margin:8px 0" },
      btn("الكل حاضر", () => { for (const v of state.values()) v.status = "present"; draw(); }, "ghost sm"),
      btn("الكل غائب", () => { for (const v of state.values()) v.status = "absent"; draw(); }, "ghost sm")) : null,
    counts, list), locked ? [] : [
    btn("حفظ الحضور", async () => {
      const records = [...state.entries()].filter(([, v]) => v.status).map(([id, v]) => ({ enrollment_id: id, status: v.status, late_minutes: v.status === "late" && v.late ? Number(v.late) : null }));
      if (!records.length) return toast("حدد حالة متدرب واحد على الأقل", true);
      try { await api(`${inst.base}/sessions/${sessionId}/attendance`, { records }, "PUT"); dd.close(); toast("حُفظ الحضور"); onSaved?.(); }
      catch (e) { toast(e.message, true); }
    })]);
  dd.classList.add("dialog-lg");
}

// Score sheet for one assessment: numbers for scored courses, pass/fail toggles otherwise. Edits ask for a reason.
export function scoresDialog(assessment, roster, { grading, onSaved } = {}) {
  const rows = roster.filter((e) => e.status !== "withdrawn");
  const values = new Map();
  const reason = input({ placeholder: "سبب التعديل (يُحفظ في سجل الدرجات)" });
  const body = h("div", { class: "in-scores" }, rows.map((e) => {
    const cur = e.progress?.items.find((x) => Number(x.id) === Number(assessment.id));
    const had = grading === "pass_fail" ? cur?.passed != null : cur?.score != null;
    if (grading === "pass_fail") {
      const sel = select([["", "—"], ["true", "اجتاز"], ["false", "لم يجتز"]], { value: cur?.passed == null ? "" : String(cur.passed), "aria-label": e.full_name });
      sel.addEventListener("change", () => values.set(Number(e.id), { passed: sel.value === "" ? null : sel.value === "true", had }));
      return h("label", { class: "in-score-row" }, h("span", {}, e.full_name, e.group_name ? h("small", {}, ` · ${e.group_name}`) : null), sel);
    }
    const inp = input({ type: "number", min: 0, max: assessment.max_score, step: "0.25", value: cur?.score ?? "", inputmode: "decimal", "aria-label": e.full_name });
    inp.addEventListener("input", () => values.set(Number(e.id), { score: inp.value === "" ? null : Number(inp.value), had }));
    return h("label", { class: "in-score-row" }, h("span", {}, e.full_name, e.group_name ? h("small", {}, ` · ${e.group_name}`) : null),
      h("div", { class: "in-score-in" }, inp, h("small", {}, `من ${num(assessment.max_score)}`)));
  }));
  const dd = dialog(`رصد: ${assessment.name}`, h("div", {},
    sub(`${L("assess_kind", assessment.kind)}${grading === "score" ? ` · الوزن ${num(assessment.weight)}%` : ""}`),
    rows.length ? body : empty(`ليس هناك أي ${T("trainee")}.`), field("سبب التعديل", reason, "مطلوب فقط عند تغيير درجة سبق رصدها")), [
    btn("حفظ الدرجات", async () => {
      const scores = [...values.entries()].map(([id, v]) => ({ enrollment_id: id, ...(grading === "pass_fail" ? { passed: v.passed } : { score: v.score }) }));
      if (!scores.length) return dd.close();
      const edited = [...values.values()].some((v) => v.had);
      if (edited && !reason.value.trim()) return toast("اكتب سبب تعديل الدرجات المرصودة سابقًا", true);
      try {
        const r = await api(`${inst.base}/assessments/${assessment.id}/scores`, { scores, reason: reason.value.trim() || null }, "PUT");
        dd.close(); toast(r.changed ? `حُفظت ${r.changed} درجة` : "لا تغييرات"); onSaved?.();
      } catch (e) { toast(e.message, true); }
    })]);
  dd.classList.add("dialog-lg");
}

// Course certificates and attendance letters, printed from the stored certificate data (with QR verification).
export async function printCertificates(ids) {
  printCertificateSheet(await api(`${inst.base}/certificates/print`, { ids }));
}

// Generic printable/exportable report table.
export function reportTable(r) {
  return h("div", { class: "in-report" },
    h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, r.columns.map((c) => h("th", {}, c.label)))),
      h("tbody", {}, r.rows.length ? r.rows.map((row) => h("tr", {}, r.columns.map((c) => h("td", {}, row[c.key] == null ? "—" : String(row[c.key])))))
        : h("tr", {}, h("td", { colspan: r.columns.length }, "لا توجد بيانات"))))));
}

export function printReport(r, school) {
  const sheet = h("div", { class: "ir-sheet" }, h("header", {}, docLogo("ir-logo"), h("div", {}, h("b", {}, school || ""), h("h1", {}, r.title),
    h("small", {}, `أُعد ${new Date().toLocaleString("ar-SA-u-ca-gregory-nu-latn")}`))), reportTable(r));
  document.body.append(sheet);
  document.body.classList.add("ir-printing");
  const done = () => { sheet.remove(); document.body.classList.remove("ir-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(() => { if (!matchMedia("print").matches) done(); }, 1500); }, 100);
}

export const textareaField = (label, value, max = 1000) => { const el = textarea({ rows: 3, maxlength: max }); el.value = value || ""; return [el, field(label, el)]; };
