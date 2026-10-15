/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Results approval panel shared by schools (class + term/year) and institutes (course):
// status and steps, completeness checks naming the student/subject/reason, the students' outcome,
// the actions the user may take, and the record of who did what.
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { panel, btn, badge, notice, sub, empty, textarea, field, toast, dialog } from "./ui.js";
import { fmtDateTime } from "./format.js";

const TONE = { none: "gray", draft: "gray", review: "", returned: "red", approved: "green" };
const STEPS = [["prepare", "إعداد النتائج"], ["review", "المراجعة"], ["approved", "الاعتماد الداخلي"], ["issue", "إصدار الشهادات"]];
const stepOf = (r) => (r.status === "approved" ? (r.certificates_issued ? 4 : 3) : r.status === "review" ? 2 : 1);

function reasonDialog(title, { label = "السبب", hint, confirm, extra = null, required = true } = {}) {
  return new Promise((resolve) => {
    const t = textarea({ rows: 3, maxLength: 300 });
    const msg = h("div");
    let done = false;
    const d = dialog(title, h("div", {}, hint ? sub(hint) : null, extra, field(label, t), msg), [
      btn(confirm, () => {
        const v = t.value.trim();
        if (required && v.length < 2) return mount(msg, notice("اكتب السبب.", "err"));
        done = true; d.close(); resolve(v);
      })]);
    d.addEventListener("close", () => { if (!done) resolve(null); });
    t.focus();
  });
}

const issueList = (items, tone) => h("ul", { class: `ra-issues ${tone}` }, items.map((i) => h("li", {},
  i.student ? h("b", {}, i.student) : null, i.student && i.subject ? " — " : null, i.subject ? h("span", { class: "ra-subj" }, i.subject) : null,
  i.student || i.subject ? ": " : null, i.reason)));

/**
 * @param {object} o
 * @param {() => Promise<object>} o.load              GET the overview
 * @param {(step: string, body?: object) => Promise} o.act  POST submit | return | approve | reopen
 * @param {(r: object) => Node} o.studentsTable       renders the students' outcome
 * @param {() => void} [o.onIssue]                     go to issuing once approved
 * @param {string} [o.unit]                            «الطالب» / «المتدرب»
 */
export function resultsApproval(o) {
  const box = h("div", { class: "ra" }, empty("جارٍ تحميل النتائج…"));
  const run = async (fn, ok) => {
    try { await fn(); if (ok) toast(ok); } catch (e) {
      const list = e.errors;
      toast(e.message, true);
      if (list?.length) mount(box.querySelector(".ra-msg") || box, notice(h("div", {}, e.message, issueList(list.slice(0, 20), "err")), "err"));
      return;
    }
    render();
  };
  async function render() {
    let r;
    try { r = await o.load(); } catch (e) { return mount(box, notice(e.message, "err")); }
    const b = r.batch;
    const step = stepOf(r);
    const actions = [];
    if (["none", "draft", "returned"].includes(r.status)) {
      actions.push(btn("إرسال للمراجعة", () => run(() => o.act("submit"), "أُرسلت النتائج للمراجعة")));
    }
    if (r.status === "review") {
      actions.push(btn("إعادة للتعديل", async () => {
        const reason = await reasonDialog("إعادة النتائج للتعديل", { confirm: "إعادة", hint: "يظهر السبب لمن يعدّ النتائج." });
        if (reason) run(() => o.act("return", { reason }), "أُعيدت النتائج للتعديل");
      }, "ghost"));
      if (r.can_approve) {
        actions.push(btn("اعتماد النتائج داخليًا", async () => {
          if (!r.errors.length) return run(() => o.act("approve", {}), "اعتُمدت النتائج");
          const reason = await reasonDialog("اعتماد نتائج غير مكتملة", { confirm: "اعتماد باستثناء", label: "سبب الاعتماد رغم الملاحظات",
            extra: notice(`توجد ${r.errors.length} ملاحظة تمنع الاعتماد. الاعتماد باستثناء يُسجَّل باسمك مع السبب.`, "warn") });
          if (reason) run(() => o.act("approve", { allow_incomplete: true, reason }), "اعتُمدت النتائج باستثناء");
        }));
      }
    }
    if (r.status === "approved") {
      if (o.onIssue) actions.push(btn(r.certificates_issued ? "الشهادات والإصدار" : "إصدار الشهادات", o.onIssue));
      if (r.can_approve) {
        actions.push(btn("إعادة فتح للتعديل", async () => {
          const reason = await reasonDialog("إعادة فتح النتائج المعتمدة", { confirm: "إعادة فتح", hint: "تعود النتائج للمراجعة ولا تصدر شهادات جديدة حتى يُعاد اعتمادها. الشهادات الصادرة تبقى كما هي." });
          if (reason) run(() => o.act("reopen", { reason }), "أُعيد فتح النتائج");
        }, "ghost"));
      }
    }
    const who = [b?.prepared_by && `أعدّها: ${b.prepared_by}`, b?.submitted_by && `أرسلها للمراجعة: ${b.submitted_by}`,
      b?.reviewed_by && `راجعها: ${b.reviewed_by}`, b?.approved_by && `اعتمدها: ${b.approved_by} — ${fmtDateTime(b.approved_at)}`].filter(Boolean);
    mount(box,
      h("div", { class: "ra-head" },
        h("div", {}, h("small", {}, "حالة النتائج"), h("div", { class: "ra-status" }, badge(r.status_label, TONE[r.status]), h("span", {}, r.label))),
        h("ol", { class: "ra-steps" }, STEPS.map(([, label], i) => h("li", { class: i + 1 < step ? "done" : i + 1 === step ? "on" : "" }, h("i", {}, String(i + 1)), label)))),
      r.status === "returned" && b?.return_reason ? notice(`أُعيدت للتعديل: ${b.return_reason}`, "err") : null,
      r.status === "review" && b?.reopened ? notice("أُعيدت للمراجعة لأن الدرجات أو النتائج تغيّرت بعد الاعتماد. راجعها واعتمدها من جديد.", "warn") : null,
      r.status === "approved" && !r.ready ? notice("تغيّرت النتائج بعد الاعتماد. حدّث الصفحة لتظهر الحالة الجديدة.", "warn") : null,
      r.status === "approved" ? notice("النتائج معتمدة داخليًا من المؤسسة. هذا الاعتماد لا يعني اعتمادًا من الوزارة أو أي جهة حكومية.", "") : null,
      b?.exception_reason ? notice(`اعتُمدت باستثناء: ${b.exception_reason}`, "warn") : null,
      who.length ? sub(who.join(" · ")) : null,
      h("div", { class: "ra-msg" }),
      actions.length ? h("div", { class: "row ra-actions" }, actions) : null,
      panel(`فحص الاكتمال`, r.errors.length ? badge(`${r.errors.length} ملاحظة تمنع الاعتماد`, "red") : badge("مكتملة", "green"),
        r.errors.length ? issueList(r.errors.slice(0, 60), "err") : sub("لا توجد ملاحظات تمنع الاعتماد."),
        r.errors.length > 60 ? sub(`و${r.errors.length - 60} ملاحظة أخرى.`) : null,
        r.warnings.length ? [h("h4", { class: "ra-sub" }, `تنبيهات (${r.warnings.length})`), issueList(r.warnings.slice(0, 40), "warn")] : null),
      panel(`النتائج (${r.students.length})`, null, r.students.length ? o.studentsTable(r) : empty("لا يوجد أحد في هذا النطاق.")),
      r.events.length ? panel("سجل الاعتماد", null, h("ol", { class: "ra-log" }, r.events.map((e) => h("li", {},
        h("b", {}, e.label), h("span", {}, ` — ${e.actor}`), h("small", {}, fmtDateTime(e.created_at)), e.reason ? h("div", { class: "sub" }, e.reason) : null)))) : null);
  }
  render();
  box.refresh = render;
  return box;
}

export const resultsApi = (getUrl, postBase, key = {}) => ({
  load: () => api(getUrl),
  act: (step, body = {}) => api(`${postBase}/${step}`, { ...key, ...body }),
});
