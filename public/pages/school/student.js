// ملف الطالب الكامل — يُفتح بمعرّف الطالب فقط
import { h, $, mount } from "../shared/js/dom.js";
import { api, idempotencyKey } from "../shared/js/api.js";
import { topbar, footer, btn, empty, badge, dialog, toast, line, sub, notice, keyText, field, input, select, showInstallBar, schoolLogoUrl } from "../shared/js/ui.js";
import { money, setCurrency, fmtDate, fmtDateTime, fmtDay, today, ATTENDANCE, METHODS } from "../shared/js/format.js";
import { timetableGrid } from "../shared/js/timetable.js";
import { receiptDialog, statementDialog } from "../shared/js/receipt.js";
import { studentFile } from "../shared/js/student-file.js";
import { notificationCenter, notificationPrefs, pushInvite, pushToggle } from "../shared/js/inbox.js";
import { currentChild, closeChild, rememberChild, forgetChild, isRemembered, rememberedChildren } from "../shared/js/children.js";

const app = $("#app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();
const P = `/api/public/${encodeURIComponent(school)}`;
const back = () => { location.href = `/${encodeURIComponent(school)}`; };
const creds = currentChild(school);

async function load() {
  if (!creds) return back();
  try {
    const who = { student_id: creds.id, key: creds.key };
    const [d, inbox] = await Promise.all([api(`${P}/student`, who), api(`${P}/student/inbox`, who).catch(() => null)]);
    render(d, inbox);
  } catch (e) {
    if (e.status === 401 || e.status === 404) { closeChild(school); forgetChild(school, creds.id); return back(); }
    mount(app, topbar({}), h("main", {}, notice(e.message, "err"), btn("إعادة المحاولة", load)), footer());
  }
}

const section = (title, ...kids) => h("section", { class: "panel" }, h("h2", {}, title), ...kids);
const info = (label, value, cls = "") => line(h("span", { class: "sub" }, label), h("b", { class: cls }, value || "—"));

function render(d, inbox) {
  if (d.currency) setCurrency(d.currency);
  const s = d.student, f = d.fees;
  schoolName = d.school; studentName = s.name; className = s.class_name;
  document.title = `مدار — ${s.name}`;

  // ملف الطالب: مصدره المشترك public/shared/js/student-file.js (نفسه الذي تراه الإدارة، لكن هنا مع زر الدفع)
  const who = { student_id: creds.id, key: creds.key };
  const remember = () => rememberChild(school, { id: creds.id, key: creds.key, name: s.name, class_name: s.class_name });
  if (isRemembered(school, creds.id)) remember();   // تحديث الاسم والفصل المحفوظين
  const extra = inbox ? [{ key: "inbox", name: "الإشعارات", note: inbox.unread ? `${inbox.unread} جديد` : `${inbox.items.length}`,
    view: ({ reopen }) => inboxSection(inbox, who, remember, reopen, (k) => file.open(k)) }] : [];
  const file = studentFile(d, { fees: (fs, compact) => feesSection(fs, compact), scrollTop: true, extra, actions: {
    excuse: (date, text) => api(`${P}/student/excuse`, { ...who, date, text }),
    ack: (a) => api(`${P}/student/alerts/ack`, { ...who, alert_id: a.id }),
    who, api: (path, body) => api(`${P}${path}`, { ...who, ...body }),
    printCertificate: (id) => api(`${P}/student/certificates/print`, { ...who, id }),
    attendanceCard: () => api(`${P}/student/attendance-card`, who),
  } });

  mount(app,
    topbar({ logo: schoolLogoUrl(d.school_id, d.school_logo), school: d.school, subtitle: "ملف الطالب", onLogout: () => { closeChild(school); back(); } }),
    h("main", { class: "profile-page" },
      h("div", { class: "toolbar" }, btn("الرجوع لقائمة الطلاب", back, "ghost sm"), btn("طباعة", () => window.print(), "ghost sm")),
      inbox?.push.key ? pushInvite({ key: inbox.push.key, save: (sub) => savePushAll(sub, who, remember),
        text: `لتصلك أخبار ${s.name} مباشرة: الغياب والدرجات والواجبات والرسوم، حتى والتطبيق مغلق.` }) : null,
      file.el),
    footer());

  showInstallBar();
  // فتح القسم المطلوب من الإشعار (#attendance مثلًا) أو صندوق الإشعارات
  const want = location.hash.slice(1);
  // من إشعار الجوال: يُعلَّم مقروءًا ويُفتح القسم المرتبط مباشرة (أو مركز الإشعارات إن لم يكن له قسم)
  const nid = Number(new URLSearchParams(location.search).get("n")) || null;
  if (nid && inbox) api(`${P}/student/inbox/read`, { ...who, ids: [nid] }).catch(() => {});
  const target = { absence: "attendance", late: "attendance", present: "attendance" }[want] || want;
  let opened = false;
  if (target) { try { file.open(target); opened = true; } catch { /* قسم غير متاح */ } }
  if (!opened && nid && inbox) file.open("inbox");
}

// تسجيل هذا الجهاز لإشعارات هذا الابن ولكل الأبناء المحفوظين على الجهاز (ولي أمر لديه أكثر من طالب):
// كل ابن مسجّل بمعرّفه، فيصل إشعار كل طالب لولي أمره فقط
async function savePushAll(sub, who, remember) {
  remember();
  await api(`${P}/student/push`, { ...who, subscription: sub });
  for (const c of rememberedChildren(school).filter((c) => c.id !== who.student_id)) {
    await api(`${P}/student/push`, { student_id: c.id, key: c.key, subscription: sub }).catch(() => {});
  }
}

// مركز الإشعارات وإعداداته وتفعيلها على هذا الجهاز
function inboxSection(inbox, who, remember, reopen, openSection) {
  const saved = isRemembered(school, who.student_id);
  const center = notificationCenter({ audience: "parent", initial: inbox,
    load: (filter) => api(`${P}/student/inbox`, { ...who, filter }),
    read: (b) => api(`${P}/student/inbox/read`, { ...who, ...b }),
    archive: (ids) => api(`${P}/student/inbox/archive`, { ...who, ids }),
    onUnread: (n) => { inbox.unread = n; if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge?.())?.catch?.(() => {}); },
    onOpen: (n) => { const k = { absence: "attendance", late: "attendance", present: "attendance" }[n.link] || n.link; if (k) { try { openSection(k); } catch { /* قسم غير متاح */ } } } });
  return [
    section("الإشعارات", center.el),
    section("إعدادات الإشعارات",
      inbox.push.key ? pushToggle({ key: inbox.push.key, save: (sub) => savePushAll(sub, who, remember),
        remove: (endpoint) => api(`${P}/student/push/remove`, { ...who, endpoint }),
        label: "الإشعارات على هذا الجهاز" }) : sub("الإشعارات على الجوال غير مفعّلة في هذه المدرسة. تصلك الإشعارات هنا."),
      inbox.push.key ? notificationPrefs({ load: () => api(`${P}/student/notify-prefs`, who),
        save: (muted) => api(`${P}/student/notify-prefs/save`, { ...who, muted }) }) : null,
      line(h("div", {}, h("b", {}, "حفظ ملف الطالب على هذا الجهاز"),
        sub(saved ? "محفوظ: يفتح مباشرة من التطبيق ومن الإشعارات." : "يفتح الملف مباشرة دون إدخال المعرّف كل مرة. لا تفعّله على جهاز مشترك.")),
        saved ? btn("إزالة من الجهاز", () => { forgetChild(school, who.student_id); toast("أُزيل من هذا الجهاز"); reopen(); }, "ghost sm")
          : btn("حفظ", () => { remember(); toast("حُفظ على هذا الجهاز"); reopen(); }, "sm"))),
  ];
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
document.documentElement.dataset.app = "صفحة المدرسة";
showInstallBar();
