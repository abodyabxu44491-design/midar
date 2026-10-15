/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The transcript page (كشف الدرجات): a fixed official layout on A4, separate from certificate designs.
// Shows what the school chose to show (components, percentages, grades, subject status, attendance, rank).
import { h } from "./dom.js";
import { docLogo } from "./ui.js";
import { fmtDate } from "./format.js";

const val = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);

/**
 * @param {object} c An issued record ({ data, serial, code, qr, issued_at, status }) or a draft ({ data, draft: true }).
 */
export function transcriptPage(c) {
  const d = c.data || {};
  const o = d.options || {};
  const subjects = d.subjects || [];
  const weights = new Map();
  if (o.tr_components !== false) for (const s of subjects) for (const p of s.components || []) if (!weights.has(p.name)) weights.set(p.name, p.weight);
  const cols = [
    ["subject", "المادة"],
    ...[...weights].map(([name, w]) => [`c:${name}`, w ? `${name} (${w})` : name]),
    ["score", weights.size ? "المجموع" : "الدرجة"], ["max", "من"],
    o.tr_percent !== false ? ["percent", "النسبة"] : null,
    o.tr_grade !== false ? ["grade", "التقدير"] : null,
    o.tr_subject_result !== false ? ["passed", "الحالة"] : null,
  ].filter(Boolean);
  const cell = (s, k) => {
    if (k.startsWith("c:")) return val(s.components?.find((p) => p.name === k.slice(2))?.earned);
    if (k === "percent") return pct(s.percent);
    if (k === "passed") return s.passed === null || s.passed === undefined ? "—" : s.passed ? "ناجح" : "دور ثانٍ";
    return val(s[k]);
  };
  const sum = d.summary || {};
  const info = [["اسم الطالب", d.student?.name], ["الرقم التعريفي", d.student?.student_no], ["المرحلة", d.student?.stage],
    ["الصف والشعبة", d.student?.class_name], ["العام / الفصل الدراسي", d.scope], ["ولي الأمر", d.student?.guardian_name]];
  const boxes = [["المجموع", `${val(sum.total)} من ${val(sum.max)}`], ["النسبة العامة", pct(sum.percent)], ["التقدير العام", val(sum.grade)],
    ["النتيجة", val(d.result)], d.rank ? ["الترتيب", `${d.rank.position} من ${d.rank.of}`] : null,
    o.tr_absence !== false && d.attendance ? ["أيام الغياب", val(d.attendance.absent)] : null,
    o.tr_absence !== false && d.attendance?.rate != null ? ["نسبة الحضور", pct(d.attendance.rate)] : null].filter(Boolean);
  const voided = c.status === "replaced" ? "مستبدلة" : c.status === "revoked" || c.revoked_at ? "ملغاة" : null;
  const legal = d.approval?.at
    ? `النتائج معتمدة داخليًا من إدارة ${d.school} بتاريخ ${fmtDate(String(d.approval.at).slice(0, 10))}. يمكن التحقق من صحة الكشف بمسح الرمز. الاعتماد داخلي من المؤسسة ولا يعني اعتمادًا من جهة حكومية.`
    : "نسخة للاطلاع من النتائج الحالية، وليست كشفًا رسميًا.";
  return h("div", { class: "cp cp-portrait tp", style: "width:210mm;height:297mm;background:#fff" },
    h("div", { class: "tp-in" },
      h("header", { class: "tp-head" },
        h("div", { class: "tp-org" }, docLogo("tp-logo"), h("div", {}, h("b", {}, val(d.school)), h("span", {}, "كشف درجات رسمي"))),
        h("div", { class: "tp-ref" }, c.serial
          ? [h("div", {}, "رقم الكشف ", h("bdi", { dir: "ltr" }, c.serial)), d.version > 1 ? h("div", {}, `النسخة ${d.version}`) : null,
            c.issued_at ? h("div", {}, `تاريخ الإصدار ${fmtDate(String(c.issued_at).slice(0, 10))}`) : null]
          : h("span", { class: "tp-draft-tag" }, "مسودة للاطلاع"))),
      h("h1", { class: "tp-title" }, `كشف درجات ${val(d.scope)}`),
      h("div", { class: "tp-info" }, info.map(([k, v]) => h("div", {}, h("span", {}, k), h("b", {}, val(v))))),
      subjects.length ? h("table", { class: "tp-table" },
        h("thead", {}, h("tr", {}, cols.map(([, l]) => h("th", {}, l)))),
        h("tbody", {}, subjects.map((s) => h("tr", {}, cols.map(([k]) => h("td", { class: k === "passed" && s.passed === false ? "fail" : "" }, cell(s, k)))))))
        : h("p", { class: "tp-empty" }, "لا توجد درجات منشورة."),
      h("div", { class: "tp-sum" }, boxes.map(([k, v]) => h("div", {}, h("span", {}, k), h("b", {}, v)))),
      d.note ? h("div", { class: "tp-note" }, h("b", {}, "ملاحظات: "), d.note) : null,
      h("div", { class: "tp-foot" },
        h("div", { class: "tp-sign" }, h("span", {}, d.signer?.title || "مدير المدرسة"), h("i", {}), h("b", {}, d.signer?.name || "")),
        c.qr ? h("div", { class: "tp-qr" }, h("img", { src: c.qr, alt: "رمز التحقق" }), h("small", { dir: "ltr" }, c.code || "")) : null,
        o.tr_guardian_sign !== false ? h("div", { class: "tp-sign" }, h("span", {}, "توقيع ولي الأمر"), h("i", {}), h("b", {}, "")) : null),
      h("p", { class: "tp-legal" }, legal, d.footer_note ? h("span", {}, ` ${d.footer_note}`) : null)),
    c.draft ? h("div", { class: "cp-void tp-draft" }, "مسودة") : voided ? h("div", { class: "cp-void" }, voided) : null);
}

// Shrinks a transcript's text a little at a time until it fits its page (many subjects, long notes).
export function fitTranscripts(root) {
  for (const page of root.querySelectorAll(".tp")) {
    const inner = page.querySelector(".tp-in");
    let size = 10.5;
    inner.style.fontSize = `${size}pt`;
    for (let i = 0; i < 30 && size > 6.5 && inner.scrollHeight > inner.clientHeight + 1; i++) { size -= 0.25; inner.style.fontSize = `${size}pt`; }
  }
}
