/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, sub, toast, dialog, notice, kpiCard, kpiGrid, docLogo } from "../../shared/js/ui.js";
import { icons } from "../../shared/js/icons.js";
import { money, fmtDate, fmtDateTime, today } from "../../shared/js/format.js";
import { A } from "./common.js";

const TONE = { pending: "amber", approved: "violet", rejected: "red", paid: "", canceled: "gray" };

export default async function financeRequests({ me, refresh }) {
  let status = "";
  const box = h("div");
  const load = async () => {
    const d = await api(`${A}/finance-requests${status ? `?status=${status}` : ""}`);
    const seg = h("div", { class: "seg-tabs", role: "tablist", "aria-label": "حالة الطلب" },
      [["", "الكل"], ["pending", "بانتظار المراجعة"], ["approved", "بانتظار الصرف"], ["paid", "تم الصرف"], ["rejected", "مرفوضة"]].map(([k, label]) =>
        h("button", { type: "button", role: "tab", class: status === k ? "on" : "", onclick: () => { status = k; load(); } }, label)));
    mount(box,
      kpiGrid(
        kpiCard({ icon: "clock", tone: "amber", label: "بانتظار المراجعة", value: String(d.counts.pending) }),
        kpiCard({ icon: "check", tone: "violet", label: "معتمدة بانتظار الصرف", value: String(d.counts.approved), note: money(d.counts.to_pay) })),
      panel("الطلبات الإدارية والمالية", d.powers.create ? btn([icons.plus({ size: 16 }), "طلب جديد"], () => newRequest(d, load), "sm") : null,
        sub(d.powers.decide ? "راجع الطلب، ثم اعتمده أو ارفضه مع ذكر السبب، وبعد الاعتماد اصرفه بسند يُسجَّل في المالية."
          : "قدّم الطلب هنا ويصل للقسم المالي لمراجعته، وتتابع حالته حتى الصرف."),
        seg,
        d.items.length ? h("div", { class: "fr-list" }, d.items.map((r) => card(r, d, load))) : empty("لا توجد طلبات.")));
  };
  await load();
  return box;
}

function card(r, d, load) {
  const amount = Number(r.approved_amount ?? r.amount);
  const p = d.powers;
  return h("article", { class: `fr-card s-${r.status}` },
    h("header", {},
      h("div", { class: "fr-title" }, h("small", { class: "ltr" }, r.request_no), h("b", {}, r.title),
        h("span", { class: "sub" }, [d.kinds[r.kind], r.teacher_name || r.beneficiary].filter(Boolean).join(" · "))),
      h("div", { class: "fr-amt" }, h("b", {}, money(amount)),
        r.approved_amount && Number(r.approved_amount) !== Number(r.amount) ? h("del", {}, money(r.amount)) : null,
        badge(d.statuses[r.status], TONE[r.status]))),
    r.details ? h("p", { class: "fr-details" }, r.details) : null,
    h("ol", { class: "fr-trail" },
      h("li", {}, icons.edit({ size: 14 }), `طلبه ${r.requested_by} — ${fmtDateTime(r.requested_at)}`),
      r.decided_by ? h("li", {}, icons[r.status === "rejected" ? "close" : "check"]({ size: 14 }),
        `${r.status === "rejected" ? "رفضه" : r.status === "canceled" ? "ألغاه" : "اعتمده"} ${r.decided_by} — ${fmtDateTime(r.decided_at)}${r.decision_note ? `: ${r.decision_note}` : ""}`) : null,
      r.paid_by ? h("li", {}, icons.wallet({ size: 14 }), `صرفه ${r.paid_by} — ${fmtDateTime(r.paid_at)} — سند ${r.entry_no}`) : null),
    h("div", { class: "fr-acts" },
      r.status === "pending" && p.decide ? [btn("اعتماد", () => decide(r, "approve", load), "sm"), btn("رفض", () => decide(r, "reject", load), "danger sm")] : null,
      r.status === "approved" && p.pay ? btn([icons.wallet({ size: 15 }), "صرف"], () => pay(r, load), "sm") : null,
      r.status === "paid" ? btn([icons.print({ size: 15 }), "سند الصرف"], () => voucher(r, d), "ghost sm") : null,
      r.status === "pending" ? btn("إلغاء الطلب", async () => {
        try { await api(`${A}/finance-requests/${r.id}/cancel`, {}); toast("أُلغي الطلب"); load(); } catch (e) { toast(e.message, true); }
      }, "ghost sm") : null));
}

async function newRequest(d, load) {
  const teachers = await api(`${A}/teachers/`).catch(() => []);
  const f = {
    kind: select(Object.entries(d.kinds)), title: input({ placeholder: "مثال: سلفة شهرية للأستاذ خالد" }),
    amount: input({ type: "number", min: 1, inputMode: "decimal" }),
    teacher: select([["", "—"], ...teachers.map((x) => [x.id, x.name])]),
    beneficiary: input({ placeholder: "الجهة أو المورد" }), details: textarea({ rows: 3, placeholder: "التفاصيل والمبررات" }),
  };
  const sync = () => { f.teacher.closest(".f").hidden = f.kind.value !== "advance"; };
  const dd = dialog("طلب إداري أو مالي جديد", h("div", {},
    h("div", { class: "row" }, field("نوع الطلب", f.kind), field("المبلغ", f.amount)),
    field("عنوان الطلب", f.title),
    h("div", { class: "row" }, field("المعلم", f.teacher), field("المستفيد", f.beneficiary)),
    field("التفاصيل", f.details),
    sub("يصل الطلب للقسم المالي مباشرة، ويُسجَّل اسمك عليه.")), [
    btn("إرسال الطلب", async () => {
      try {
        const r = await api(`${A}/finance-requests`, { kind: f.kind.value, title: f.title.value, amount: f.amount.value,
          teacher_id: f.kind.value === "advance" ? f.teacher.value || null : null, beneficiary: f.beneficiary.value, details: f.details.value });
        dd.close(); toast(`أُرسل الطلب ${r.request_no}`); load();
      } catch (e) { toast(e.message, true); }
    })]);
  f.kind.addEventListener("change", sync); sync();
}

function decide(r, decision, load) {
  const amount = input({ type: "number", min: 1, value: r.amount });
  const note = textarea({ rows: 2, placeholder: decision === "reject" ? "سبب الرفض (مطلوب)" : "ملاحظة (اختياري)" });
  const dd = dialog(`${decision === "approve" ? "اعتماد" : "رفض"} الطلب ${r.request_no}`, h("div", {},
    h("p", {}, h("b", {}, r.title), " — ", money(r.amount)),
    decision === "approve" ? field("المبلغ المعتمد", amount, "يمكن اعتماد مبلغ أقل من المطلوب") : null,
    field(decision === "approve" ? "ملاحظة" : "سبب الرفض", note)), [
    btn(decision === "approve" ? "اعتماد" : "رفض الطلب", async () => {
      try {
        await api(`${A}/finance-requests/${r.id}/decide`, { decision, note: note.value, ...(decision === "approve" ? { approved_amount: amount.value } : {}) });
        dd.close(); toast(decision === "approve" ? "اعتُمد الطلب" : "رُفض الطلب"); load();
      } catch (e) { toast(e.message, true); }
    }, decision === "approve" ? "" : "danger")]);
}

async function pay(r, load) {
  const [accounts, categories] = await Promise.all([api(`${A}/ledger/accounts`), api(`${A}/ledger/categories`)]);
  const acc = (accounts.items || accounts).filter((a) => a.is_active && !a.purpose);
  const cats = (categories.items || categories).filter((c) => c.direction === "expense" && c.is_active !== false);
  const f = {
    account: select(acc.map((a) => [a.id, `${a.name}${a.balance !== undefined ? ` — ${money(a.balance, a.currency)}` : ""}`])),
    category: select(cats.map((c) => [c.id, c.name])),
    method: select([["cash", "نقدًا"], ["transfer", "تحويل بنكي"], ["card", "شبكة"], ["online", "دفع إلكتروني"]]),
    reference: input({ class: "ltr", placeholder: "رقم الحوالة إن وجد" }), date: input({ type: "date", value: today() }),
  };
  const dd = dialog(`صرف الطلب ${r.request_no}`, h("div", {},
    notice(`يُصرف ${money(r.approved_amount ?? r.amount)} ويُنشأ سند صرف في المالية باسمك.`, ""),
    h("div", { class: "row" }, field("من حساب", f.account), field("التصنيف", f.category)),
    h("div", { class: "row" }, field("طريقة الصرف", f.method), field("التاريخ", f.date)),
    field("المرجع", f.reference)), [
    btn("تأكيد الصرف", async () => {
      try {
        const x = await api(`${A}/finance-requests/${r.id}/pay`, { account_id: f.account.value, category_id: f.category.value, method: f.method.value,
          reference: f.reference.value, occurred_on: f.date.value });
        dd.close(); toast(`صُرف بالسند ${x.entry_no}`); load();
      } catch (e) { toast(e.message, true); }
    })]);
}

function voucher(r, d) {
  const row = (k, v) => h("div", { class: "vc-row" }, h("span", {}, k), h("b", {}, v || "—"));
  dialog("سند صرف", h("div", { class: "voucher" },
    h("header", {}, docLogo("vc-logo"), h("div", {}, h("h3", {}, "سند صرف"), h("small", { class: "ltr" }, r.entry_no))),
    row("رقم الطلب", r.request_no), row("نوع الطلب", d.kinds[r.kind]), row("البيان", r.title),
    row("المستفيد", r.teacher_name || r.beneficiary), row("المبلغ", money(r.approved_amount ?? r.amount)),
    row("التاريخ", fmtDate(r.paid_at)),
    h("div", { class: "vc-sign" },
      h("div", {}, h("small", {}, "مقدّم الطلب"), h("b", {}, r.requested_by)),
      h("div", {}, h("small", {}, "المعتمِد"), h("b", {}, r.decided_by)),
      h("div", {}, h("small", {}, "أمين الصرف"), h("b", {}, r.paid_by)),
      h("div", {}, h("small", {}, "توقيع المستلم"), h("b", {}, " ")))),
  [btn([icons.print({ size: 15 }), "طباعة"], () => window.print())]);
}
