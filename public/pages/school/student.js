// ملف الطالب الكامل — يُفتح بمعرّف الطالب فقط
import { h, $, mount } from "/shared/js/dom.js";
import { api, idempotencyKey } from "/shared/js/api.js";
import { topbar, footer, btn, empty, badge, dialog, toast, line, sub, notice, keyText, field, input, select , showInstallBar} from "/shared/js/ui.js";
import { money, fmtDate, fmtDateTime, fmtDay, today, ATTENDANCE, METHODS } from "/shared/js/format.js";
import { timetableGrid } from "/shared/js/timetable.js";

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
  const s = d.student, f = d.fees;
  const avg = d.grades.length ? Math.round(d.grades.reduce((a, g) => a + (g.score / g.max_score) * 100, 0) / d.grades.length) : null;
  const count = (st) => d.attendance.filter((a) => a.status === st).length;
  document.title = `مِدار — ${s.name}`;

  mount(app,
    topbar({ school: d.school, subtitle: "ملف الطالب", onLogout: () => { sessionStorage.removeItem(KEY); back(); } }),
    h("main", {},
      h("div", { class: "toolbar" }, btn("الرجوع لقائمة الطلاب", back, "ghost sm"), btn("طباعة", () => window.print(), "ghost sm")),
      h("div", { class: "profile-head" },
        h("h1", {}, s.name),
        h("div", { style: "opacity:.85" }, s.class_name),
        h("div", { class: "kpis" },
          d.settings.profile_show_grades ? h("div", {}, h("b", {}, avg === null ? "—" : `${avg}%`), "متوسط الدرجات") : null,
          d.settings.profile_show_attendance ? h("div", {}, h("b", {}, count("absent")), "أيام الغياب") : null,
          d.settings.profile_show_attendance ? h("div", {}, h("b", {}, count("late")), "مرات التأخر") : null,
          f && h("div", {}, h("b", {}, f.status === "paid" ? "مسدد" : f.status === "unpaid" ? money(f.remaining) : "—"),
            f.status === "unpaid" ? "رسوم متبقية" : "حالة الرسوم"))),

      h("div", { class: "cols-2" },
      section("البيانات الأساسية",
        info("اسم الطالب", s.name), info("الفصل", s.class_name), info("ولي الأمر", s.guardian_name),
        info("جوال ولي الأمر", s.guardian_phone, "ltr"), info("تاريخ التسجيل", fmtDate(s.since))),

      f && feesSection(f),

      d.timetable?.length ? section("الجدول الدراسي",
        timetableGrid(d.timetable, { cell: (day, p, sl) => (sl
          ? [h("b", { class: "small" }, sl.subject), sl.teacher ? h("div", { class: "small muted" }, sl.teacher) : null]
          : h("span", { class: "muted" }, "—")) })) : null,

      d.settings.profile_show_grades ? section("الدرجات", d.grades.length ? d.grades.map((g) => {
        const p = Math.round((g.score / g.max_score) * 100);
        const color = p >= 65 ? "var(--teal)" : p >= 50 ? "var(--amber)" : "var(--red)";
        return h("div", { style: "padding:8px 0;border-top:1px solid var(--line)" },
          h("div", { class: "row", style: "justify-content:space-between" }, h("b", {}, `${g.subject} — ${g.title}`), h("span", { style: "flex:none" }, `${g.score} / ${g.max_score}`)),
          h("div", { class: "bar" }, h("i", { style: `width:${p}%;background:${color}` })),
          sub(fmtDate(g.exam_date)));
      }) : empty("لا توجد درجات منشورة بعد.")) : null,

      d.settings.profile_show_attendance ? section("الحضور والغياب", d.attendance.length ? d.attendance.map((a) => line(
        h("span", {}, fmtDay(a.day)), h("b", { style: `color:${ATTENDANCE[a.status][1]}` }, ATTENDANCE[a.status][0]))) : empty("لا يوجد سجل حضور بعد.")) : null,

      d.settings.profile_show_teachers ? section("المعلمون والمواد", d.teachers.length ? d.teachers.map((t) => line(h("span", {}, t.subject), h("b", {}, t.teacher))) : empty("لا يوجد.")) : null,

      section("الإعلانات", d.announcements.length ? d.announcements.map((a) => line(
        h("div", {}, h("b", {}, a.title), h("div", {}, a.body), sub(fmtDate(a.created_at))))) : empty("لا توجد إعلانات.")))),
    footer());
}

const CLAIM = { pending: ["بانتظار تأكيد المدرسة", "amber"], confirmed: ["تم التأكيد", ""], rejected: ["مرفوض", "red"] };

function feesSection(f) {
  const open = f.invoices.filter((i) => i.status === "open");
  const pendingFor = (id) => f.claims.filter((c) => c.invoice_id === id && c.status === "pending").reduce((a, c) => a + c.amount, 0);
  return section("الرسوم والسداد",
    line(h("span", {}, "الحالة"), f.status === "paid" ? badge("مسدد الرسوم") : f.status === "unpaid" ? badge("لم يسدد بعد", "red") : badge("لا توجد رسوم", "gray")),
    line(h("span", {}, "الإجمالي"), h("b", {}, money(f.total))),
    line(h("span", {}, "المدفوع"), h("b", {}, money(f.paid))),
    line(h("span", {}, "المتبقي"), h("b", { class: f.remaining > 0 ? "danger-text" : "" }, money(f.remaining))),

    h("h3", { class: "sec-title" }, "الفواتير"),
    open.length ? open.map((i) => {
      const rem = Math.round((i.amount - i.paid) * 100) / 100;
      const waiting = pendingFor(i.id);
      return line(
        h("div", {}, h("b", {}, i.title), " ", rem <= 0 ? badge("مسددة") : i.paid > 0 ? badge("مسددة جزئيًا", "amber") : badge("غير مسددة", "red"),
          sub(`فاتورة #${i.id} — ${money(i.amount)} — المتبقي ${money(rem)}${i.due_date ? ` — تستحق ${fmtDate(i.due_date)}` : ""}`),
          waiting > 0 ? sub(`بانتظار تأكيد تحويل بمبلغ ${money(waiting)}`) : null),
        rem > 0 ? btn("ادفع", () => payDialog(f, i, Math.round((rem - waiting) * 100) / 100)) : null);
    }) : empty("لا توجد فواتير."),

    f.claims.length ? [h("h3", { class: "sec-title" }, "إشعارات التحويل"),
      f.claims.map((c) => line(
        h("div", {}, h("b", {}, `${money(c.amount)} — تحويل بتاريخ ${fmtDate(c.transfer_date)}`), " ", badge(...CLAIM[c.status]),
          c.review_note ? sub(c.status === "rejected" ? `سبب الرفض: ${c.review_note}` : c.review_note) : null),
        c.receipt_no ? keyText(c.receipt_no) : null))] : null,

    f.receipts.length ? [h("h3", { class: "sec-title" }, "الإيصالات"),
      f.receipts.map((r) => line(
        h("div", {}, h("b", {}, `${r.kind === "refund" ? "استرداد — " : ""}${r.title}`), sub(`${METHODS[r.method]} — ${fmtDateTime(r.created_at)}`)),
        h("div", {}, h("b", {}, money(r.amount)), " ", keyText(r.receipt_no))))] : null);
}

// نافذة السداد: الحساب البنكي + إشعار التحويل + الدفع النقدي
function payDialog(f, inv, available) {
  const reference = `فاتورة ${inv.id} - ${document.title.replace("مِدار — ", "")}`;
  const copy = (text) => btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); }, "ghost sm");

  const accounts = f.accounts.length ? f.accounts.map((a) => h("div", { class: "bank-card" },
    h("b", {}, a.bank_name),
    line(h("span", { class: "sub" }, "اسم الحساب"), h("span", {}, a.account_holder)),
    line(h("span", { class: "sub" }, "الآيبان"), h("span", { class: "pill" }, keyText(a.iban.replace(/(.{4})/g, "$1 ").trim()), copy(a.iban))),
    a.account_number ? line(h("span", { class: "sub" }, "رقم الحساب"), h("span", { class: "pill" }, keyText(a.account_number), copy(a.account_number))) : null))
    : notice("لم تضف المدرسة حسابًا بنكيًا بعد. يمكنك السداد نقدًا لدى الإدارة.", "warn");

  const form = h("div", { class: "hidden" });
  if (f.accounts.length && available > 0) {
    const key = idempotencyKey();
    const amount = input({ type: "number", min: 0.01, max: available, step: "0.01", value: available });
    const date = input({ type: "date", value: today(), max: today() });
    const sender = input({ placeholder: "الاسم كما يظهر في البنك" });
    const ref = input({ class: "ltr", placeholder: "اختياري" });
    const account = select(f.accounts.map((a) => [a.id, `${a.bank_name} — ${a.iban.slice(-4)}`]));
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
      sub("بعد التحويل من تطبيق البنك، أرسل إشعار التحويل حتى تؤكده المدرسة."),
      btn("حوّلت المبلغ — إرسال إشعار", (ev) => { form.classList.remove("hidden"); ev.currentTarget.remove(); }, "soft")) : null,
    form,

    h("h3", { class: "sec-title" }, "2) الدفع نقدًا في المدرسة"),
    sub(f.payment_note || "يمكنك الحضور لإدارة المدرسة والدفع نقدًا، وتُسجَّل الدفعة ويصدر لك إيصال."),
  ));
}

load();
showInstallBar();
