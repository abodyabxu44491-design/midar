/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, sub, toast, dialog, notice, kpiCard, kpiGrid, docLogo } from "../../shared/js/ui.js";
import { icons } from "../../shared/js/icons.js";
import { money, fmtDate } from "../../shared/js/format.js";
import { A } from "./common.js";

const TONE = { held: "amber", refunded: "", partial: "violet", forfeited: "red" };
const METHODS = [["cash", "نقدًا"], ["transfer", "تحويل بنكي"], ["card", "شبكة"], ["online", "دفع إلكتروني"]];

export default async function bookDeposits() {
  let status = "held", search = "";
  const box = h("div");
  const load = async () => {
    const d = await api(`${A}/book-deposits${status ? `?status=${status}` : ""}`);
    const q = input({ placeholder: "ابحث باسم الطالب أو الكتاب", value: search });
    const listBox = h("div", { class: "bd-list" });
    const draw = () => {
      const s = search.trim();
      const rows = s ? d.items.filter((x) => `${x.student_name} ${x.book_title} ${x.student_no || ""}`.includes(s)) : d.items;
      mount(listBox, rows.length ? rows.map((x) => row(x, d, load)) : empty(status === "held" ? "لا توجد تأمينات محتجزة." : "لا توجد سجلات."));
    };
    q.addEventListener("input", () => { search = q.value; draw(); });
    mount(box,
      kpiGrid(
        kpiCard({ icon: "wallet", tone: "teal", label: d.fund.name, value: money(d.fund.balance), note: "رصيد الصندوق الآن" }),
        kpiCard({ icon: "book", tone: "amber", label: "تأمينات محتجزة", value: String(d.held_count), note: money(d.held_amount) }),
        kpiCard({ icon: "minus", tone: "red", label: "خصومات على الكتب", value: money(d.deducted) })),
      panel("تأمين الكتب المدرسية", btn([icons.plus({ size: 16 }), "صرف كتاب بتأمين"], () => issue(d, load), "sm"),
        sub("يُستلم التأمين عند صرف الكتاب ويُودع في صندوق مستقل، وعند الإرجاع يُقيَّم الكتاب ويُرد التأمين كاملًا أو بخصم بسند صرف."),
        h("div", { class: "seg-tabs", role: "tablist", "aria-label": "الحالة" },
          [["held", "محتجزة"], ["refunded", "مستردة"], ["partial", "بخصم"], ["forfeited", "مصادرة"], ["", "الكل"]].map(([k, label]) =>
            h("button", { type: "button", role: "tab", class: status === k ? "on" : "", onclick: () => { status = k; load(); } }, label))),
        field("بحث", q), listBox));
    draw();
  };
  await load();
  return box;
}

function row(x, d, load) {
  return h("div", { class: "bd-row" },
    h("span", { class: "bd-ic", "aria-hidden": "true" }, icons.book({ size: 20 })),
    h("div", { class: "bd-main" },
      h("b", {}, x.book_title),
      h("span", { class: "sub" }, [x.student_name, x.class_name, `استُلم ${fmtDate(x.received_on)}`].filter(Boolean).join(" · ")),
      x.status !== "held" ? h("span", { class: "sub" },
        `${d.conditions[x.condition]} — رُد ${money(x.refund_amount)}${x.deduction_reason ? ` (خصم: ${x.deduction_reason})` : ""}`) : null),
    h("div", { class: "bd-side" }, h("b", {}, money(x.amount)), badge(d.statuses[x.status], TONE[x.status]),
      h("div", { class: "row" },
        x.status === "held" ? btn("إرجاع الكتاب", () => settle(x, d, load), "sm") : null,
        btn([icons.print({ size: 14 }), x.status === "held" ? "إيصال" : "سند"], () => voucher(x.id, d), "ghost sm"))));
}

async function issue(d, load) {
  const students = await api(A.endsWith("accountant") ? `${A}/students` : `${A}/students?fields=basic`);
  const list = h("datalist", { id: "bd-students" }, students.map((s) => h("option", { value: `${s.name} — ${s.class_name || ""}` })));
  const f = {
    student: input({ list: "bd-students", placeholder: "اكتب اسم الطالب واختره" }),
    book: select([["", "كتاب غير مسجل في المكتبة"], ...d.books.map((b) => [b.id, `${b.title}${b.available <= 0 ? " (لا توجد نسخة)" : ""}`])]),
    title: input({ placeholder: "اسم الكتاب" }), amount: input({ type: "number", min: 1, inputMode: "decimal" }),
    method: select(METHODS), note: textarea({ rows: 2 }),
  };
  const sync = () => { f.title.closest(".f").hidden = Boolean(f.book.value); };
  const dd = dialog("صرف كتاب بتأمين", h("div", {}, list,
    field("الطالب", f.student), field("الكتاب", f.book), field("اسم الكتاب", f.title),
    h("div", { class: "row" }, field("مبلغ التأمين", f.amount), field("طريقة الاستلام", f.method)),
    field("ملاحظة", f.note), sub("يُسجَّل المبلغ في صندوق تأمين الكتب، ويُطبع للطالب إيصال استلام.")), [
    btn("استلام التأمين", async () => {
      const st = students.find((s) => `${s.name} — ${s.class_name || ""}` === f.student.value) || students.find((s) => s.name === f.student.value.trim());
      if (!st) return toast("اختر الطالب من القائمة", true);
      try {
        const r = await api(`${A}/book-deposits`, { student_id: st.id, book_id: f.book.value || null, book_title: f.title.value, amount: f.amount.value,
          method: f.method.value, note: f.note.value });
        dd.close(); toast(`استُلم التأمين — ${r.receipt_no}`); load(); voucher(r.id, d);
      } catch (e) { toast(e.message, true); }
    })]);
  f.book.addEventListener("change", sync); sync();
}

function settle(x, d, load) {
  const cond = select(Object.entries(d.conditions));
  const amount = input({ type: "number", min: 0, max: x.amount, value: x.amount });
  const reason = textarea({ rows: 2, placeholder: "سبب الخصم: نوع التلف أو فقدان الكتاب" });
  const method = select(METHODS);
  const hint = h("div");
  const syncHint = () => {
    const back = Math.min(Number(amount.value || 0), Number(x.amount));
    mount(hint, notice(back === Number(x.amount) ? `يُرد التأمين كاملًا ${money(back)}.`
      : back === 0 ? "لا يُرد شيء، ويبقى المبلغ في الصندوق." : `يُرد ${money(back)} ويُخصم ${money(Number(x.amount) - back)}.`, ""));
  };
  cond.addEventListener("change", () => { amount.value = cond.value === "good" ? x.amount : cond.value === "lost" ? 0 : amount.value; syncHint(); });
  amount.addEventListener("input", syncHint); syncHint();
  const dd = dialog(`إرجاع «${x.book_title}»`, h("div", {},
    h("p", {}, `${x.student_name} — التأمين ${money(x.amount)}`),
    h("div", { class: "row" }, field("حالة الكتاب", cond), field("المبلغ المسترد", amount)),
    field("سبب الخصم", reason), field("طريقة الرد", method), hint), [
    btn("تأكيد الإرجاع وإصدار السند", async () => {
      try {
        const r = await api(`${A}/book-deposits/${x.id}/return`, { condition: cond.value, refund_amount: amount.value, deduction_reason: reason.value, method: method.value });
        dd.close(); toast(r.voucher_no ? `صدر سند الصرف ${r.voucher_no}` : "أُغلق التأمين"); load(); voucher(x.id, d);
      } catch (e) { toast(e.message, true); }
    })]);
}

async function voucher(id, d) {
  const v = await api(`${A}/book-deposits/${id}/voucher`);
  const held = v.status === "held";
  const row = (k, val) => h("div", { class: "vc-row" }, h("span", {}, k), h("b", {}, val || "—"));
  dialog(held ? "إيصال استلام تأمين" : "سند صرف تأمين", h("div", { class: "voucher" },
    h("header", {}, docLogo("vc-logo"), h("div", {}, h("h3", {}, held ? "إيصال استلام تأمين كتاب" : "سند صرف تأمين كتاب"),
      h("small", { class: "ltr" }, held ? v.receipt_no : v.voucher_no || v.receipt_no))),
    row("المدرسة", v.school), row("الطالب", `${v.student_name}${v.class_name ? ` — ${v.class_name}` : ""}`), row("رقم الطالب", v.student_no),
    row("الكتاب", v.book_title), row("مبلغ التأمين", money(v.amount)), row("تاريخ الاستلام", fmtDate(v.received_on)),
    held ? null : [row("حالة الكتاب عند الإرجاع", d.conditions[v.condition]), row("المبلغ المسترد", money(v.refund_amount)),
      Number(v.refund_amount) < Number(v.amount) ? row("الخصم وسببه", `${money(Number(v.amount) - Number(v.refund_amount))} — ${v.deduction_reason}`) : null,
      row("تاريخ الإرجاع", fmtDate(v.returned_on))],
    h("div", { class: "vc-sign" },
      h("div", {}, h("small", {}, held ? "المستلم" : "أمين الصرف"), h("b", {}, held ? v.received_by : v.refunded_by)),
      h("div", {}, h("small", {}, "توقيع ولي الأمر"), h("b", {}, " ")))),
  [btn([icons.print({ size: 15 }), "طباعة"], () => window.print())]);
}
