// إيصال السداد وكشف حساب الطالب — جاهزان للطباعة أو الحفظ PDF
import { h } from "./dom.js";
import { brandLogo, dialog, btn, line, sub } from "./ui.js";
import { money, fmtDate, fmtDateTime, METHODS } from "./format.js";

const row = (label, value, cls = "") => line(h("span", { class: "sub" }, label), h("b", { class: cls }, value));

/**
 * إيصال سداد واحد.
 * @param {{school, student, class_name, receipt_no, amount, method, created_at, title, kind, currency}} r
 */
export function receiptDialog(r) {
  const refund = r.kind === "refund";
  const card = h("article", { class: "report receipt" },
    h("header", {}, h("div", {}, h("h2", {}, r.school), sub(refund ? "إيصال استرداد" : "إيصال سداد")), brandLogo("print-logo", false)),
    row("رقم الإيصال", r.receipt_no),
    row("التاريخ", fmtDateTime(r.created_at)),
    row("الطالب", r.student + (r.class_name ? ` — ${r.class_name}` : "")),
    row("البند", r.title || "رسوم دراسية"),
    row("طريقة الدفع", METHODS[r.method] || r.method),
    row(refund ? "المبلغ المسترد" : "المبلغ المستلم", money(r.amount, r.currency), refund ? "danger-text" : ""),
    r.remaining !== undefined ? row("المتبقي على الفاتورة", money(r.remaining, r.currency)) : null,
    h("div", { class: "sign" }, h("span", {}, "المستلم: ......................"), h("span", {}, "ختم المدرسة")));
  dialog("إيصال", card, [btn("طباعة / حفظ PDF", () => window.print())]);
}

/**
 * كشف حساب الطالب: الفواتير والدفعات والمتبقي.
 */
export function statementDialog({ school, student, class_name, invoices = [], payments = [], currency }) {
  const billed = invoices.filter((i) => i.status !== "void").reduce((s, i) => s + Number(i.amount), 0);
  const paid = payments.reduce((s, p) => s + (p.kind === "refund" ? -Number(p.amount) : Number(p.amount)), 0);
  const card = h("article", { class: "report" },
    h("header", {}, h("div", {}, h("h2", {}, school), sub("كشف حساب الطالب")), brandLogo("print-logo", false)),
    row("الطالب", student + (class_name ? ` — ${class_name}` : "")),
    row("تاريخ الكشف", fmtDate(new Date().toISOString().slice(0, 10))),

    h("h3", { class: "sec-title" }, "الفواتير"),
    invoices.length ? h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, h("th", {}, "البند"), h("th", {}, "المبلغ"), h("th", {}, "المدفوع"), h("th", {}, "المتبقي"), h("th", {}, "الاستحقاق"))),
      h("tbody", {}, invoices.map((i) => h("tr", {},
        h("td", {}, i.title), h("td", {}, money(i.amount, currency)), h("td", {}, money(i.paid, currency)),
        h("td", {}, money(Number(i.amount) - Number(i.paid), currency)), h("td", {}, i.due_date ? fmtDate(i.due_date) : "—")))))
      : sub("لا توجد فواتير."),

    h("h3", { class: "sec-title" }, "الدفعات"),
    payments.length ? h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, h("th", {}, "الإيصال"), h("th", {}, "النوع"), h("th", {}, "المبلغ"), h("th", {}, "الطريقة"), h("th", {}, "التاريخ"))),
      h("tbody", {}, payments.map((p) => h("tr", {},
        h("td", {}, p.receipt_no), h("td", {}, p.kind === "refund" ? "استرداد" : "دفعة"),
        h("td", {}, money(p.amount, currency)), h("td", {}, METHODS[p.method] || p.method),
        h("td", {}, fmtDate(String(p.created_at).slice(0, 10)))))))
      : sub("لا توجد دفعات."),

    h("div", { class: "total" },
      h("div", {}, h("b", {}, money(billed, currency)), "إجمالي الفواتير"),
      h("div", {}, h("b", {}, money(paid, currency)), "المدفوع"),
      h("div", {}, h("b", {}, money(billed - paid, currency)), "المتبقي")),
    h("div", { class: "sign" }, h("span", {}, "المحاسب: ......................"), h("span", {}, "ختم المدرسة")));
  dialog("كشف حساب", card, [btn("طباعة / حفظ PDF", () => window.print())]);
}
