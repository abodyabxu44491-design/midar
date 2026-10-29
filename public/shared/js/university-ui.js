/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h } from "./dom.js";
import { api } from "./api.js";
import { panel, sub, badge, empty, input, btn, dialog, notice, toast, confirmAction, field, select } from "./ui.js";
import { money } from "./format.js";

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


// The student's own page: this term's timetable, self-registration while it is open, and the academic record.
// `call` posts to the student API (with the student's key); without it the view is read-only (the registrar's preview).
export function uniStudentView(view, call = null) {
  const box = h("div");
  const td = (x, cls) => h("td", cls ? { class: cls } : {}, x ?? "—");
  const draw = (v) => {
    const credits = v.schedule.reduce((n, s) => n + s.credits, 0);
    const act = async (path, body, done) => {
      try { draw(await call(path, body)); toast(done); } catch (e) { toast(e.message, true); }
    };
    box.replaceChildren(
      v.term ? panel(`جدولي — ${v.term.name}`, null,
        v.schedule.length ? h("div", { class: "table-wrap" }, h("table", { class: "grid" },
          h("thead", {}, h("tr", {}, ["المقرر", "الشعبة", "الساعات", "الموعد", "القاعة", "المدرّس", ""].map((x) => h("th", {}, x)))),
          h("tbody", {}, v.schedule.map((s) => h("tr", {}, td(`${s.course_code} ${s.course_name}`), td(s.code), td(String(s.credits)), td(s.meeting), td(s.room), td(s.teacher),
            h("td", {}, call && v.registration?.open ? btn("حذف", () => { if (confirmAction(`حذف ${s.course_code} من جدولك؟`)) act("/student/university/drop", { registration_id: s.registration_id }, "حُذف المقرر"); }, "ghost sm") : null))))))
          : empty("لا توجد مقررات مسجلة في هذا الفصل."),
        sub(`مجموع الساعات ${credits}${v.registration ? ` من حد أعلى ${v.registration.max_credits}` : ""}`)) : null,
      v.registration && call ? panel(`التسجيل — ${v.registration.term}`, null,
        sub("تُطبق المتطلبات السابقة والسعة وحد الساعات وتعارض المواعيد. لأي استثناء راجع القبول والتسجيل."),
        v.registration.registered?.length ? [h("h3", {}, "مسجّل لك في هذا الفصل"), v.registration.registered.map((s) => h("div", { class: "uni-row" },
          h("div", {}, h("b", {}, `${s.course_code} ${s.course_name}`), sub([`شعبة ${s.code}`, `${s.credits} ساعات`, s.meeting].filter(Boolean).join(" · "))),
          btn("حذف", () => { if (confirmAction(`حذف ${s.course_code}؟`)) act("/student/university/drop", { registration_id: s.registration_id }, "حُذف المقرر"); }, "ghost sm"))),
          h("h3", {}, "الشعب المطروحة")] : null,
        v.registration.offered.length ? v.registration.offered.map((s) => h("div", { class: "uni-row" },
          h("div", {}, h("b", {}, `${s.course_code} ${s.course_name}`), " ", h("small", { class: "sub" }, `شعبة ${s.code} · ${s.credits} ساعات`),
            sub([s.meeting, s.room, s.teacher].filter(Boolean).join(" · "))),
          s.full ? badge("ممتلئة", "gray") : btn("تسجيل", () => act("/student/university/register", { section_id: s.id }, `سُجّل ${s.course_code}`), "sm")))
          : empty("لا توجد شعب أخرى مطروحة.")) : null,
      uniTranscript(v.transcript));
  };
  draw(view);
  return box;
}

// Tuition by credit hour for one term: what each student was invoiced and paid, and recording a payment on an invoice.
// `base` is the university API of the role; `financeBase` its invoice payments API.
export async function uniTuition({ base, financeBase }) {
  const meta = await api(`${base}/meta`);
  if (!meta.terms.length) return empty("لا توجد فصول بعد.");
  const term = select(meta.terms.map((t) => [t.id, t.name]));
  const q = input({ type: "search", placeholder: "ابحث بالاسم أو الرقم الجامعي" });
  const box = h("div");
  const td = (x, cls) => h("td", cls ? { class: cls } : {}, x ?? "—");
  let timer;
  const load = async () => {
    const r = await api(`${base}/tuition?term_id=${term.value}&q=${encodeURIComponent(q.value.trim())}`);
    box.replaceChildren(
      h("div", { class: "uni-kpis" }, h("div", { class: "uni-kpi" }, h("small", {}, "المطلوب"), h("b", {}, money(r.totals.amount))),
        h("div", { class: "uni-kpi" }, h("small", {}, "المحصّل"), h("b", {}, money(r.totals.paid))),
        h("div", { class: "uni-kpi" }, h("small", {}, "المتبقي"), h("b", {}, money(r.totals.remaining)))),
      r.invoices.length ? h("div", { class: "table-wrap" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, ["الرقم الجامعي", "الطالب", "الفاتورة", "الساعات", "المبلغ", "المدفوع", "المتبقي", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, r.invoices.map((i) => h("tr", {}, td(i.student_no, "ltr"), td(i.name), td(i.title), td(String(i.credits)), td(money(i.amount)), td(money(i.paid)),
          h("td", {}, i.status !== "open" ? badge("ملغاة", "gray") : i.remaining ? money(i.remaining) : badge("مسددة")),
          h("td", {}, i.status === "open" && i.remaining ? btn("تسجيل دفعة", () => pay(i), "sm") : null))))))
        : empty("لا توجد فواتير ساعات لهذا الفصل. تصدرها الإدارة من «الفصول والشعب» ← «فواتير الساعات»."));
  };
  const pay = (i) => {
    const amount = input({ type: "number", min: 0.01, step: "0.01", value: i.remaining, inputMode: "decimal" });
    const method = select([["cash", "نقدًا"], ["transfer", "تحويل بنكي"], ["card", "شبكة / بطاقة"]]);
    const note = input({ placeholder: "رقم الحوالة أو ملاحظة (اختياري)" });
    const key = `uni${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const d = dialog(`دفعة: ${i.name}`, h("div", {}, sub(`${i.title} · المتبقي ${money(i.remaining)}`), field("المبلغ", amount), field("طريقة الدفع", method), field("ملاحظة", note)),
      [btn("تسجيل", async () => {
        try {
          await api(`${financeBase}/invoices/${i.invoice_id}/payments`, { amount: Number(amount.value), method: method.value, note: note.value, idempotency_key: key });
          d.close(); toast("سُجلت الدفعة"); load();
        } catch (e) { toast(e.message, true); }
      })]);
  };
  term.addEventListener("change", load);
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  load();
  return [h("div", { class: "row", style: "gap:8px;flex-wrap:wrap;margin-bottom:8px" }, field("الفصل", term), q), box];
}
