// تبويب الرسوم: الفواتير، الدفعات، الاسترداد، الإلغاء
import { h } from "/shared/js/dom.js";
import { api, idempotencyKey } from "/shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, dialog, stats, confirmAction } from "/shared/js/ui.js";
import { money, csv, fmtDate, fmtDateTime, METHODS } from "/shared/js/format.js";
import { waButton, messageVars } from "/shared/js/whatsapp.js";
import { A, loadClasses } from "./common.js";

export default async function finance({ refresh }) {
  const [{ invoices, totals }, classes, students, claims, templates, me2] = await Promise.all([
    api(`${A}/finance/invoices`), loadClasses(), api(`${A}/students`), api(`${A}/finance/claims`),
    api(`${A}/messaging/templates`), api(`${A}/me`)]);
  const byId = new Map(students.map((s) => [s.id, s]));
  const pending = claims.filter((c) => c.status === "pending");
  const target = select([["", "اختر"], ...classes.map((c) => [`class:${c.id}`, `فصل كامل: ${c.name}`]),
    ...students.map((s) => [`student:${s.id}`, `طالب: ${s.name}`])]);
  const title = input({ placeholder: "رسوم الفصل الدراسي الأول" });
  const amount = input({ type: "number", min: 0.01, step: "0.01" });
  const due = input({ type: "date" });

  return [
    stats([["إجمالي الفواتير", money(totals.fees_total)], ["المحصّل", money(totals.fees_paid)], ["المتبقي", money(totals.fees_remaining)],
      ["تحويلات بانتظار التأكيد", pending.length]]),
    panel(`إشعارات التحويل البنكي (${pending.length} بانتظار المراجعة)`, null,
      sub("قارن الإشعار بكشف حساب البنك قبل التأكيد. التأكيد يسجل الدفعة ويصدر إيصالًا تلقائيًا."),
      claims.length ? claims.slice(0, 50).map((c) => claimRow(c, refresh)) : empty("لا توجد إشعارات تحويل.")),
    panel("إصدار فاتورة", null,
      h("div", { class: "row" }, field("لـ", target), field("البند", title)),
      h("div", { class: "row" }, field("المبلغ (ر.س)", amount), field("تاريخ الاستحقاق", due)),
      sub("إصدار فاتورة يفعّل الرسوم تلقائيًا في صفحة الطالب."),
      btn("إصدار الفاتورة", async () => {
        const [kind, id] = target.value.split(":");
        if (!id) return toast("اختر الطالب أو الفصل", true);
        if (!confirmAction(`إصدار فاتورة «${title.value}» بمبلغ ${money(amount.value)}${kind === "class" ? " لكل طلاب الفصل" : ""}؟`)) return;
        const r = await api(`${A}/finance/invoices`, { target: kind, target_id: id, title: title.value, amount: amount.value, due_date: due.value || null });
        toast(`تم إصدار ${r.created} فاتورة`); refresh();
      })),
    panel("الفواتير", btn("تصدير", () => csv("الفواتير.csv", [["رقم", "الطالب", "الفصل", "البند", "المبلغ", "المدفوع", "المتبقي", "الحالة", "الاستحقاق"],
      ...invoices.map((i) => [i.id, i.student_name, i.class_name, i.title, i.amount, i.paid, i.amount - i.paid, i.status === "void" ? "ملغاة" : "", i.due_date])]), "ghost sm"),
      invoices.length ? invoices.map((i) => invoiceRow(i, refresh, { templates, me: me2, student: byId.get(i.student_id) })) : empty("لم تُصدر فواتير بعد.")),
  ];
}

const CLAIM = { pending: ["بانتظار المراجعة", "amber"], confirmed: ["مؤكد", ""], rejected: ["مرفوض", "red"] };

function claimRow(c, refresh) {
  return line(
    h("div", { class: c.status === "pending" ? "" : "muted-row" },
      h("b", {}, `${c.student_name} — ${money(c.amount)}`), " ", badge(...CLAIM[c.status]),
      sub(`${c.invoice_title} (#${c.invoice_id}) — ${c.class_name || ""} — المتبقي على الفاتورة ${money(c.invoice_amount - c.invoice_paid)}`),
      sub(`المحوِّل: ${c.sender_name} — بتاريخ ${fmtDate(c.transfer_date)}${c.bank_name ? ` — إلى ${c.bank_name} (${c.iban.slice(-4)})` : ""}${c.bank_reference ? ` — مرجع ${c.bank_reference}` : ""}`),
      c.status !== "pending" ? sub(`${c.reviewed_by || ""} — ${fmtDateTime(c.reviewed_at)}${c.review_note ? ` — ${c.review_note}` : ""}${c.receipt_no ? ` — إيصال ${c.receipt_no}` : ""}`) : null),
    c.status === "pending" && h("div", { class: "row", style: "flex:none" },
      btn("تأكيد الاستلام", () => {
        const amount = input({ type: "number", min: 0.01, step: "0.01", value: c.amount });
        const note = input({ placeholder: "اختياري" });
        const d = dialog("تأكيد التحويل", h("div", {},
          sub(`${c.student_name} — ${c.sender_name} — ${fmtDate(c.transfer_date)}`),
          field("المبلغ الذي وصل فعليًا", amount), field("ملاحظة", note)),
        [btn("تأكيد وتسجيل الدفعة", async () => {
          const r = await api(`${A}/finance/claims/${c.id}/review`, { decision: "confirm", amount: amount.value, note: note.value || null });
          d.close(); toast(`تم التأكيد. رقم الإيصال ${r.receipt}`); refresh();
        })]);
      }, "sm"),
      btn("رفض", () => {
        const note = input({ placeholder: "مثال: لم يصل المبلغ إلى الحساب" });
        const d = dialog("رفض الإشعار", h("div", {}, sub("السبب يظهر لولي الأمر في صفحة الطالب."), field("سبب الرفض", note)),
          [btn("رفض الإشعار", async () => {
            await api(`${A}/finance/claims/${c.id}/review`, { decision: "reject", note: note.value });
            d.close(); toast("تم الرفض"); refresh();
          }, "danger")]);
      }, "danger sm")));
}

function invoiceRow(i, refresh, ctx = {}) {
  const rem = Math.round((i.amount - i.paid) * 100) / 100;
  const status = i.status === "void" ? badge("ملغاة", "gray") : rem <= 0 ? badge("مسددة") : i.paid > 0 ? badge("مسددة جزئيًا", "amber") : badge("غير مسددة", "red");
  return line(
    h("div", { class: i.status === "void" ? "muted-row" : "" }, h("b", {}, `#${i.id} ${i.student_name}`), " ", status,
      sub(`${i.title} — ${money(i.amount)} — المدفوع ${money(i.paid)} — المتبقي ${money(rem)}${i.due_date ? ` — يستحق ${fmtDate(i.due_date)}` : ""}`),
      i.void_reason && sub(`سبب الإلغاء: ${i.void_reason}`)),
    i.status === "open" && h("div", { class: "row", style: "flex:none" },
      rem > 0 && btn("دفعة نقدية / تحويل", () => payDialog(i, rem, refresh), "soft sm"),
      rem > 0 && ctx.student ? waButton({ phone: ctx.student.guardian_phone, template: ctx.templates.fees, countryCode: ctx.templates.country_code,
        vars: messageVars({ student: ctx.student, school: ctx.me.school.name, fees: { remaining: rem },
          link: `${location.origin}/${ctx.me.school.id}` }), label: "تذكير واتساب" }) : null,
      i.paid > 0 && btn("استرداد", () => refundDialog(i, refresh), "ghost sm"),
      btn("السجل", () => history(i), "ghost sm"),
      i.paid <= 0 && btn("إلغاء", () => voidDialog(i, refresh), "danger sm")));
}

function payDialog(i, rem, refresh) {
  const amount = input({ type: "number", min: 0.01, max: rem, step: "0.01", value: rem });
  const method = select(Object.entries(METHODS).filter(([k]) => k !== "online"));
  const note = input({ placeholder: "اختياري" });
  const key = idempotencyKey(); // ثابت لهذه النافذة: الضغط المزدوج لا يكرر الدفعة
  const d = dialog(`دفعة — ${i.student_name}`, h("div", {},
    sub(`${i.title} — المتبقي ${money(rem)}`), field("المبلغ", amount), field("طريقة الدفع", method), field("ملاحظة", note)),
  [btn("تسجيل", async () => {
    const r = await api(`${A}/finance/invoices/${i.id}/payments`, { amount: amount.value, method: method.value, note: note.value || null, idempotency_key: key });
    d.close(); toast(`تم التسجيل. رقم الإيصال ${r.receipt}`); refresh();
  })]);
}

function refundDialog(i, refresh) {
  const amount = input({ type: "number", min: 0.01, max: i.paid, step: "0.01" });
  const note = input({ placeholder: "سبب الاسترداد (مطلوب)" });
  const key = idempotencyKey();
  const d = dialog(`استرداد — ${i.student_name}`, h("div", {},
    sub(`المدفوع ${money(i.paid)}. الدفعات لا تُحذف؛ التصحيح يكون بقيد استرداد.`), field("المبلغ", amount), field("السبب", note)),
  [btn("تسجيل الاسترداد", async () => {
    const r = await api(`${A}/finance/invoices/${i.id}/refunds`, { amount: amount.value, note: note.value, idempotency_key: key });
    d.close(); toast(`تم. رقم القيد ${r.receipt}`); refresh();
  }, "danger")]);
}

function voidDialog(i, refresh) {
  const reason = input({ placeholder: "سبب الإلغاء (مطلوب)" });
  const d = dialog(`إلغاء الفاتورة #${i.id}`, h("div", {}, sub("الفاتورة الملغاة تبقى في السجل ولا يمكن إعادة فتحها."), field("السبب", reason)),
    [btn("إلغاء الفاتورة", async () => {
      await api(`${A}/finance/invoices/${i.id}/void`, { reason: reason.value }); d.close(); toast("تم الإلغاء"); refresh();
    }, "danger")]);
}

async function history(i) {
  const rows = (await api(`${A}/finance/students/${i.student_id}/payments`)).filter((p) => p.invoice_id === i.id);
  dialog(`سجل مدفوعات ${i.student_name}`, h("div", {}, rows.length ? rows.map((p) => line(
    h("div", {}, h("b", {}, p.kind === "refund" ? "استرداد" : "دفعة"), sub(`${METHODS[p.method]} — ${fmtDateTime(p.created_at)}${p.note ? ` — ${p.note}` : ""}`)),
    h("div", {}, h("b", { class: p.kind === "refund" ? "danger-text" : "" }, `${p.kind === "refund" ? "−" : ""}${money(p.amount)}`), " ", h("span", { class: "key" }, p.receipt_no))))
    : empty("لا توجد دفعات.")));
}
