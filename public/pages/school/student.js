// ملف الطالب الكامل — يُفتح بمعرّف الطالب فقط
import { h, $, mount } from "../shared/js/dom.js";
import { api, idempotencyKey } from "../shared/js/api.js";
import { topbar, footer, btn, empty, badge, dialog, toast, line, sub, notice, keyText, field, input, select, showInstallBar, schoolLogoUrl } from "../shared/js/ui.js";
import { money, setCurrency, fmtDate, fmtDateTime, fmtDay, today, ATTENDANCE, METHODS } from "../shared/js/format.js";
import { timetableGrid } from "../shared/js/timetable.js";
import { receiptDialog, statementDialog } from "../shared/js/receipt.js";
import { studentFile } from "../shared/js/student-file.js";

const app = $("#app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();
const P = `/api/public/${encodeURIComponent(school)}`;
const KEY = `midar_student_${school}`;
const back = () => { location.href = `/${encodeURIComponent(school)}`; };
const creds = JSON.parse(sessionStorage.getItem(KEY) || "null");

async function load() {
  if (!creds) return back();
  try { render(await api(`${P}/student`, { student_id: creds.id, key: creds.key })); }
  catch (e) {
    if (e.status === 401 || e.status === 404) { sessionStorage.removeItem(KEY); return back(); }
    mount(app, topbar({}), h("main", {}, notice(e.message, "err"), btn("إعادة المحاولة", load)), footer());
  }
}

const section = (title, ...kids) => h("section", { class: "panel" }, h("h2", {}, title), ...kids);
const info = (label, value, cls = "") => line(h("span", { class: "sub" }, label), h("b", { class: cls }, value || "—"));

function render(d) {
  if (d.currency) setCurrency(d.currency);
  const s = d.student, f = d.fees;
  schoolName = d.school; studentName = s.name; className = s.class_name;
  document.title = `مدار — ${s.name}`;

  // ملف الطالب: مصدره المشترك public/shared/js/student-file.js (نفسه الذي تراه الإدارة، لكن هنا مع زر الدفع)
  const who = { student_id: creds.id, key: creds.key };
  const file = studentFile(d, { fees: (fs, compact) => feesSection(fs, compact), scrollTop: true, actions: {
    excuse: (date, text) => api(`${P}/student/excuse`, { ...who, date, text }),
    ack: (a) => api(`${P}/student/alerts/ack`, { ...who, alert_id: a.id }),
  } });

  mount(app,
    topbar({ logo: schoolLogoUrl(d.school_id, d.school_logo), school: d.school, subtitle: "ملف الطالب", onLogout: () => { sessionStorage.removeItem(KEY); back(); } }),
    h("main", { class: "profile-page" },
      h("div", { class: "toolbar" }, btn("الرجوع لقائمة الطلاب", back, "ghost sm"), btn("طباعة", () => window.print(), "ghost sm")),
      file.el),
    footer());

  showInstallBar();
}

// سطر درجة واحد

let schoolName = "", studentName = "", className = "";

function feesSection(f, compact = false) {
  const open = f.invoices.filter((i) => i.status === "open");
  const pendingFor = (id) => f.claims.filter((c) => c.invoice_id === id && c.status === "pending").reduce((a, c) => a + c.amount, 0);
  return section("الرسوم والسداد",
    line(h("span", {}, "الحالة"), f.status === "paid" ? badge("مسدد الرسوم") : f.status === "unpaid" ? badge("لم يسدد بعد", "red") : badge("لا توجد رسوم", "gray")),
    line(h("span", {}, "الإجمالي"), h("b", {}, money(f.total))),
    line(h("span", {}, "المدفوع"), h("b", {}, money(f.paid))),
    line(h("span", {}, "المتبقي"), h("b", { class: f.remaining > 0 ? "danger-text" : "" }, money(f.remaining))),

    compact ? null : h("h3", { class: "sec-title" }, "الفواتير"),
    compact ? null : open.length ? open.map((i) => {
      const rem = Math.round((i.amount - i.paid) * 100) / 100;
      const waiting = pendingFor(i.id);
      return line(
        h("div", {}, h("b", {}, i.title), " ", rem <= 0 ? badge("مسددة") : i.paid > 0 ? badge("مسددة جزئيًا", "amber") : badge("غير مسددة", "red"),
          sub(`فاتورة #${i.id} — ${money(i.amount)} — المتبقي ${money(rem)}${i.due_date ? ` — تستحق ${fmtDate(i.due_date)}` : ""}`),
          waiting > 0 ? sub(`بانتظار تأكيد تحويل بمبلغ ${money(waiting)}`) : null),
        rem > 0 ? btn("ادفع", () => payDialog(f, i, Math.round((rem - waiting) * 100) / 100)) : null);
    }) : empty("لا توجد فواتير."),

    !compact && f.claims.length ? [h("h3", { class: "sec-title" }, "إشعارات التحويل"),
      f.claims.map((c) => line(
        h("div", {}, h("b", {}, `${money(c.amount)} — تحويل بتاريخ ${fmtDate(c.transfer_date)}`), " ", badge(...CLAIM[c.status]),
          c.review_note ? sub(c.status === "rejected" ? `سبب الرفض: ${c.review_note}` : c.review_note) : null),
        c.receipt_no ? keyText(c.receipt_no) : null))] : null,

    !compact && f.receipts.length ? [
      h("div", { class: "toolbar" },
        h("h3", { class: "sec-title", style: "margin:0" }, "الإيصالات"),
        btn("كشف الحساب", () => statementDialog({
          school: schoolName, student: studentName, class_name: className,
          invoices: f.invoices, payments: f.receipts,
        }), "ghost sm")),
      f.receipts.map((r) => line(
        h("div", {}, h("b", {}, `${r.kind === "refund" ? "استرداد — " : ""}${r.title}`), sub(`${METHODS[r.method]} — ${fmtDateTime(r.created_at)}`)),
        h("div", { class: "row", style: "flex:none;align-items:center" },
          h("b", {}, money(r.amount)), keyText(r.receipt_no),
          btn("إيصال", () => receiptDialog({
            school: schoolName, student: studentName, class_name: className,
            receipt_no: r.receipt_no, amount: r.amount, method: r.method,
            created_at: r.created_at, title: r.title, kind: r.kind,
          }), "ghost sm"))))] : null);
}

// نافذة السداد: الحساب البنكي + إشعار التحويل + الدفع النقدي
function payDialog(f, inv, available) {
  const reference = `فاتورة ${inv.id} - ${document.title.replace("مدار — ", "")}`;
  const copy = (text) => btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); }, "ghost sm");

  const accounts = f.accounts.length ? f.accounts.map((a) => h("div", { class: "bank-card" },
    h("b", {}, a.bank_name),
    line(h("span", { class: "sub" }, "اسم الحساب"), h("span", {}, a.account_holder)),
    a.account_number ? line(h("span", { class: "sub" }, "رقم الحساب"), h("span", { class: "pill" }, keyText(a.account_number), copy(a.account_number))) : null,
    a.iban ? line(h("span", { class: "sub" }, "الآيبان"), h("span", { class: "pill" }, keyText(a.iban.replace(/(.{4})/g, "$1 ").trim()), copy(a.iban))) : null))
    : notice("لم تضف المدرسة حسابًا بنكيًا بعد. يمكنك السداد نقدًا لدى الإدارة.", "warn");

  const form = h("div", { class: "hidden" });
  if (f.accounts.length && available > 0) {
    const key = idempotencyKey();
    const amount = input({ type: "number", min: 0.01, max: available, step: "0.01", value: available });
    const date = input({ type: "date", value: today(), max: today() });
    const sender = input({ placeholder: "الاسم كما في حساب التحويل" });
    const ref = input({ class: "ltr", placeholder: "اختياري" });
    const account = select(f.accounts.map((a) => [a.id, `${a.bank_name} — ${String(a.account_number || a.iban).slice(-4)}`]));
    const msg = h("div");
    mount(form,
      h("h3", { class: "sec-title" }, "إشعار التحويل"),
      h("div", { class: "row" }, field("المبلغ المحوَّل", amount), field("تاريخ التحويل", date)),
      field("اسم المحوِّل", sender),
      h("div", { class: "row" }, field("حُوِّل إلى", account), field("رقم العملية في البنك", ref)),
      msg,
      btn("إرسال الإشعار للمدرسة", async () => {
        mount(msg);
        try {
          await api(`${P}/transfer-claims`, { student_id: creds.id, key: creds.key, invoice_id: inv.id, account_id: account.value,
            amount: amount.value, transfer_date: date.value, sender_name: sender.value, bank_reference: ref.value || null, idempotency_key: key });
          d.close();
          toast("تم إرسال الإشعار. سيظهر السداد بعد تأكيد المدرسة.");
          load();
        } catch (e) { mount(msg, notice(e.message, "err")); }
      }, "wide"));
  }

  const d = dialog(`سداد: ${inv.title}`, h("div", {},
    line(h("span", {}, "المبلغ المتبقي"), h("b", {}, money(available))),
    available <= 0 ? notice("يوجد إشعار تحويل بانتظار تأكيد المدرسة يغطي المبلغ المتبقي.", "warn") : null,

    h("h3", { class: "sec-title" }, "1) التحويل البنكي"),
    accounts,
    f.accounts.length ? line(h("span", { class: "sub" }, "اكتب في ملاحظة التحويل"), h("span", { class: "pill" }, h("span", { class: "key plain" }, reference), copy(reference))) : null,
    f.accounts.length && available > 0 ? h("div", { class: "spaced" },
      sub("بعد التحويل، أرسل الإشعار لتؤكده المدرسة."),
      btn("حوّلت المبلغ — إرسال إشعار", (ev) => { form.classList.remove("hidden"); ev.currentTarget.remove(); }, "soft")) : null,
    form,

    h("h3", { class: "sec-title" }, "2) الدفع نقدًا في المدرسة"),
    sub(f.payment_note || "يمكنك الحضور لإدارة المدرسة والدفع نقدًا، وتُسجَّل الدفعة ويصدر لك إيصال."),
  ));
}

load();
showInstallBar();
