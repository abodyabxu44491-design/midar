// المالية: لوحة التحكم، الحركات، الحسابات، التبرعات، الرواتب، التقارير
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, line, sub, stats, toast,
  dialog, notice, confirmAction, docLogo } from "../../shared/js/ui.js";
import { barChart } from "../../shared/js/charts.js";
import { money, setCurrency, getCurrency, CURRENCIES, fmtDate, fmtDateTime, today } from "../../shared/js/format.js";
import { A } from "./common.js";

const METHODS = { cash: "نقدًا", transfer: "تحويل بنكي", card: "شبكة / بطاقة", online: "دفع إلكتروني" };
const KINDS = { bank: "حساب بنكي", cash: "صندوق نقدي", online: "محفظة إلكترونية", other: "أخرى" };
const SOURCES = { manual: "قيد يدوي", fee: "رسوم", refund: "استرداد", donation: "تبرع", salary: "رواتب", expense: "مصروف", withdrawal: "سحب" };
const STATUS = { pending: ["بانتظار الاعتماد", "amber"], approved: ["معتمدة", ""], rejected: ["مرفوضة", "gray"], void: ["ملغاة", "gray"] };
const monthName = (ym) => new Date(`${ym}-15`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { month: "short", year: "2-digit" });
const monthStart = () => today().slice(0, 8) + "01";

// الفترات الجاهزة
function periodRange(key) {
  const d = new Date(); const iso = (x) => x.toISOString().slice(0, 10);
  if (key === "today") return { from: today(), to: today() };
  if (key === "week") { const s = new Date(d); s.setDate(d.getDate() - 6); return { from: iso(s), to: today() }; }
  if (key === "year") return { from: `${d.getFullYear()}-01-01`, to: today() };
  return { from: monthStart(), to: today() };
}

// أقسام المالية بالترتيب: كل ما يحتاجه المحاسب والمدير في شريط واحد، بلا قوائم متداخلة
const PARTS = {
  overview: "نظرة عامة", fees: "الرسوم", staff: "الموظفون", payroll: "الرواتب",
  money: "مصروف أو إيراد", entries: "سجل الحركات", donations: "التبرعات", accounts: "الحسابات",
};
// فتح قسم معيّن من خارج المالية (مثل «فواتير متأخرة» في الرئيسية)
export const openFinancePart = (part) => { try { sessionStorage.setItem("midar_finance_part", part); } catch { /* تجاهل */ } };

export default async function ledgerView({ refresh, me }) {
  const perms = me?.permissions || { approve: true, payroll: true, accounts: true };
  const mods = me?.modules || {};
  const list = ["overview"];
  if (mods.fees !== false) list.push("fees");
  if (perms.payroll && mods.payroll !== false) list.push("staff", "payroll");
  list.push("money", "entries");
  if (mods.donations) list.push("donations");
  if (perms.accounts) list.push("accounts");

  let part = "overview";
  try { const want = sessionStorage.getItem("midar_finance_part"); if (want && list.includes(want)) part = want; sessionStorage.removeItem("midar_finance_part"); } catch { /* تجاهل */ }
  const chips = h("div", { class: "xb-chips fin-parts", role: "tablist" });
  const box = h("div");
  const views = {
    overview: (ctx) => overview(ctx), fees: async () => (await import("./finance.js")).default({ refresh: () => show("fees"), me }),
    staff: (ctx) => staffView(ctx), payroll: (ctx) => payrollView(ctx), money: (ctx) => expenses(ctx), entries: (ctx) => entries(ctx),
    donations: (ctx) => donationsView(ctx), accounts: async (ctx) => [...(mods.transfers !== false ? await transfer(ctx) : []), ...(await accounts(ctx))],
  };
  const show = async (next = part) => {
    part = next;
    mount(chips, list.map((k) => h("button", { type: "button", role: "tab", "aria-selected": String(k === part),
      class: `xb-chip${k === part ? " on" : ""}`, onclick: () => show(k) }, PARTS[k])));
    mount(box, empty("جارٍ التحميل…"));
    try { mount(box, await views[part]({ show: () => show(part), go: show, me, refresh })); }
    catch (e) { mount(box, notice(e.message, "err")); }
  };
  await show(part);
  return [chips, box];
}

/* ---------------- نظرة عامة ---------------- */
async function overview({ show, go }) {
  const range = select([["today", "اليوم"], ["week", "هذا الأسبوع"], ["month", "هذا الشهر"], ["year", "هذا العام"], ["custom", "فترة مخصصة"]], { value: "month" });
  const from = input({ type: "date", value: monthStart() });
  const to = input({ type: "date", value: today() });
  const box = h("div");

  const load = async () => {
    mount(box, empty("جارٍ الحساب…"));
    const d = await api(`${A}/ledger/overview?from=${from.value}&to=${to.value}`);
    if (d.currency) setCurrency(d.currency);
    const low = d.accounts.filter((a) => a.is_active && a.low_balance !== null && Number(a.balance) < Number(a.low_balance));
    const p = d.payroll;
    const monthLabel = p ? new Date(`${p.period}T12:00:00`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric" }) : "";
    const payState = !p ? null : !p.run ? ["لم يُنشأ مسير هذا الشهر", "amber", "إنشاء المسير"]
      : p.run.status === "draft" ? ["مسودة بانتظار الاعتماد", "amber", "مراجعة واعتماد"]
      : p.run.status === "approved" ? ["معتمد، بانتظار الصرف", "amber", "صرف الرواتب"] : ["مصروف", "", "عرض المسير"];
    mount(box,
      stats([
        ["الرصيد الحالي", money(d.balance), "مجموع الحسابات"],
        ["المداخيل", money(d.income), "في الفترة"],
        ["المصروفات", money(d.expense), "في الفترة"],
        ["الصافي", money(d.net)],
      ]),
      d.pending ? notice(`${d.pending} حركة بانتظار الاعتماد في «سجل الحركات».`, "warn") : null,
      low.length ? notice(`رصيد منخفض: ${low.map((a) => `${a.name} (${money(a.balance)})`).join("، ")}`, "err") : null,

      h("div", { class: "fin-cards" },
        finCard("الرسوم", [["المحصّل في الفترة", money(d.fees)], ["غير المسدد", money(d.unpaid_fees)]],
          d.overdue_invoices ? `${d.overdue_invoices} فاتورة متأخرة` : "لا فواتير متأخرة", "go", () => go("fees")),
        d.staff ? finCard("الموظفون والرواتب", [["الموظفون", String(d.staff.count)], ["الرواتب الشهرية", money(d.staff.monthly)]],
          d.staff.no_salary ? `${d.staff.no_salary} بلا راتب محدد` : d.staff.types.map((x) => `${x.name} ${x.count}`).join(" · "), "go", () => go("staff")) : null,
        p ? finCard(`رواتب ${monthLabel}`, [["الإجمالي", money(p.run ? p.run.total : p.total)], ["الحالة", payState[0]]],
          p.run?.paid_at ? `صُرفت في ${fmtDate(p.run.paid_at)}` : null, payState[2], () => go("payroll"), payState[1]) : null,
        finCard("المصروفات", [["الرواتب في الفترة", money(d.salaries)], ["التشغيلية", money(d.operating + d.withdrawals)]],
          null, "تسجيل مصروف", () => go("money"))),

      panel("أرصدة الحسابات", null,
        d.accounts.filter((a) => a.is_active).map((a) => line(
          h("div", {}, h("b", {}, a.name), " ", a.currency !== d.currency ? badge(CURRENCIES[a.currency].name, "gray") : null,
            sub(`${KINDS[a.kind]}${a.methods.length ? ` — ${a.methods.map((m) => METHODS[m]).join("، ")}` : ""}`)),
          h("b", { class: Number(a.balance) < 0 ? "danger-text" : "" }, money(a.balance, a.currency))))),

      panel("الحركة الشهرية", null,
        barChart(d.by_month.map((m) => ({ label: monthName(m.month), value: Math.round(m.income), color: "var(--teal)" }))),
        sub("المداخيل"),
        barChart(d.by_month.map((m) => ({ label: monthName(m.month), value: Math.round(m.expense), color: "var(--red)" }))),
        sub("المصروفات")),

      printReport(d),

      panel("التوزيع حسب التصنيف", btn("تصدير", () => exportRows("التصنيفات", d.by_category,
        [["التصنيف", "name"], ["النوع", (r) => (r.direction === "income" ? "إيراد" : "مصروف")], ["المبلغ", "total"]]), "ghost sm"),
        d.by_category.length ? d.by_category.map((c) => line(
          h("div", {}, h("b", {}, c.name), sub(c.direction === "income" ? "إيراد" : "مصروف")),
          h("b", { class: c.direction === "income" ? "" : "danger-text" }, money(c.total)))) : empty("لا توجد حركات في هذه الفترة.")));
  };

  const applyRange = () => {
    if (range.value === "custom") return;
    const r = periodRange(range.value);
    from.value = r.from; to.value = r.to;
    load();
  };
  range.addEventListener("change", applyRange);
  from.addEventListener("change", load);
  to.addEventListener("change", load);
  await load();
  return [h("div", { class: "row fin-range" }, field("الفترة", range), field("من", from), field("إلى", to)), box];
}

// بطاقة مختصرة في النظرة العامة: رقمان وسطر وزر ينقل للقسم
function finCard(title, rows, note, action, onClick, tone = "") {
  return h("section", { class: `panel fin-card${tone ? ` ${tone}` : ""}` },
    h("h3", {}, title),
    rows.map(([k, v]) => h("div", { class: "fin-row" }, h("span", { class: "sub" }, k), h("b", {}, v))),
    note ? sub(note) : null,
    btn(action === "go" ? "فتح" : action, onClick, "soft sm"));
}

// تقرير مالي مختصر جاهز للطباعة أو الحفظ PDF
function printReport(d) {
  const row = (label, value, cls = "") => line(h("span", {}, label), h("b", { class: cls }, value));
  return panel("تقرير الفترة", btn("طباعة / حفظ PDF", () => window.print(), "ghost sm"),
    h("div", { class: "report" },
      h("header", {}, h("div", {}, h("h2", {}, "التقرير المالي"),
        sub(`من ${fmtDate(d.period.from)} إلى ${fmtDate(d.period.to)}`)), docLogo("print-logo")),
      row("إجمالي المداخيل", money(d.income)),
      row("إجمالي المصروفات", money(d.expense), "danger-text"),
      row("صافي الحركة", money(d.net)),
      row("الرسوم المسددة", money(d.fees)),
      row("الرسوم غير المسددة", money(d.unpaid_fees)),
      row("التبرعات", money(d.donations)),
      row("الرواتب", money(d.salaries)),
      row("المصروفات التشغيلية", money(d.operating)),
      row("السحوبات", money(d.withdrawals)),
      row("الرصيد الحالي", money(d.balance)),
      h("div", { class: "sign" }, h("span", {}, "المحاسب: ......................"), h("span", {}, "مدير المدرسة: ......................"))));
}

/* ---------------- سجل الحركات ---------------- */
async function entries({ show }) {
  const [accounts, categories] = await Promise.all([api(`${A}/ledger/accounts`), api(`${A}/ledger/categories`)]);
  const from = input({ type: "date", value: monthStart() });
  const to = input({ type: "date", value: today() });
  const direction = select([["", "الكل"], ["income", "إيرادات"], ["expense", "مصروفات"]]);
  const status = select([["", "كل الحالات"], ["pending", "بانتظار الاعتماد"], ["approved", "معتمدة"], ["void", "ملغاة"], ["rejected", "مرفوضة"]]);
  const account = select([["", "كل الحسابات"], ...accounts.map((a) => [a.id, a.name])]);
  const box = h("div");

  const load = async () => {
    mount(box, empty("جارٍ التحميل…"));
    const qs = new URLSearchParams({ from: from.value, to: to.value });
    if (direction.value) qs.set("direction", direction.value);
    if (status.value) qs.set("status", status.value);
    if (account.value) qs.set("account_id", account.value);
    const rows = await api(`${A}/ledger/entries?${qs}`);
    mount(box,
      h("div", { class: "toolbar" },
        btn("تصدير Excel", () => exportRows("الحركات_المالية", rows,
          [["رقم العملية", "entry_no"], ["التاريخ", "occurred_on"], ["النوع", (r) => (r.direction === "income" ? "إيراد" : "مصروف")],
           ["المبلغ", "amount"], ["الحساب", "account_name"], ["التصنيف", "category_name"], ["السبب", "reason"],
           ["المستفيد", "beneficiary"], ["طريقة الدفع", (r) => METHODS[r.method]], ["المرجع", "reference"],
           ["المصدر", (r) => SOURCES[r.source_type]], ["الحالة", (r) => STATUS[r.status][0]],
           ["أنشأها", "created_by"], ["اعتمدها", "approved_by"]]), "ghost sm"),
        sub(`${rows.length} حركة`)),
      rows.length ? rows.map((e) => entryRow(e, load)) : empty("لا توجد حركات في هذه الفترة."));
  };
  for (const el of [from, to, direction, status, account]) el.addEventListener("change", load);
  await load();

  return [
    panel("تصفية السجل", null,
      h("div", { class: "row" }, field("من", from), field("إلى", to), field("النوع", direction)),
      h("div", { class: "row" }, field("الحالة", status), field("الحساب", account))),
    box,
  ];
}

function entryRow(e, reload) {
  const income = e.direction === "income";
  return line(
    h("div", { class: e.status === "approved" ? "" : "muted-row" },
      h("b", { class: income ? "" : "danger-text" }, `${income ? "+" : "−"}${money(e.amount, e.currency)}`), " ",
      e.currency !== getCurrency() ? badge(`${CURRENCIES[e.currency].name} — يعادل ${money(e.amount_base)}`, "gray") : null, " ",
      badge(...STATUS[e.status]), " ", badge(SOURCES[e.source_type] || e.source_type, "gray"),
      sub(`${e.entry_no} — ${fmtDate(e.occurred_on)} — ${e.category_name} — ${e.account_name}`),
      sub(e.reason),
      e.beneficiary ? sub(`المستفيد: ${e.beneficiary}`) : null,
      sub(`أنشأها ${e.created_by}${e.approved_by ? ` — اعتمدها ${e.approved_by}` : ""}${e.reference ? ` — مرجع ${e.reference}` : ""}`),
      e.void_reason ? sub(`سبب الإلغاء: ${e.void_reason}`) : null,
      e.attachments?.length ? h("div", { class: "sub pill" }, "المرفقات: ",
        ...e.attachments.map((f) => h("a", { class: "btn ghost sm", href: `${A}/ledger/attachments/${f.id}`, target: "_blank", rel: "noopener" }, f.filename))) : null),
    h("div", { class: "row", style: "flex:none" },
      e.status === "pending" ? btn("اعتماد", async () => {
        await api(`${A}/ledger/entries/${e.id}/review`, { decision: "approve" }); toast("اعتُمدت الحركة"); reload();
      }, "sm") : null,
      e.status === "pending" ? btn("رفض", async () => {
        await api(`${A}/ledger/entries/${e.id}/review`, { decision: "reject" }); toast("رُفضت الحركة"); reload();
      }, "danger sm") : null,
      e.status === "approved" && !["fee", "refund"].includes(e.source_type) ? btn("إلغاء", () => {
        const reason = input({ placeholder: "سبب الإلغاء" });
        const d = dialog(`إلغاء الحركة ${e.entry_no}`, h("div", {},
          sub("الحركة الملغاة تبقى في السجل ولا تُحتسب في الأرصدة."), field("السبب", reason)),
        [btn("إلغاء الحركة", async () => {
          await api(`${A}/ledger/entries/${e.id}/void`, { reason: reason.value });
          d.close(); toast("أُلغيت الحركة"); reload();
        }, "danger")]);
      }, "ghost sm") : null));
}

/* ---------------- مصروف أو سحب ---------------- */
async function expenses({ show }) {
  const [accounts, categories] = await Promise.all([api(`${A}/ledger/accounts`), api(`${A}/ledger/categories`)]);
  const expenseCats = categories.filter((c) => c.direction === "expense");
  const incomeCats = categories.filter((c) => c.direction === "income");

  const form = (direction) => {
    const cats = direction === "expense" ? expenseCats : incomeCats;
    const f = {
      amount: input({ type: "number", min: 0.01, step: "0.01" }),
      account: select(accounts.filter((a) => a.is_active).map((a) => [a.id, `${a.name} — ${money(a.balance, a.currency)}`])),
      rate: input({ type: "number", min: 0.000001, step: "0.000001", placeholder: "سعر التحويل" }),
      category: select(cats.map((c) => [c.id, c.name])),
      date: input({ type: "date", value: today() }),
      method: select(Object.entries(METHODS)),
      reason: input(),
      beneficiary: input(),
      reference: input({ class: "ltr" }),
      attachment: input({ placeholder: "رقم الفاتورة (اختياري)" }),
      file: input({ type: "file", accept: "image/jpeg,image/png,image/webp,application/pdf" }),
      note: textarea({ rows: 2 }),
      approval: input({ type: "checkbox", checked: direction === "expense" }),
    };
    return panel(direction === "expense" ? "تسجيل مصروف أو سحب" : "تسجيل إيراد", null,
      h("div", { class: "row" }, field("المبلغ", f.amount), field("التاريخ", f.date), field("طريقة الدفع", f.method)),
      h("div", { class: "row" }, field("الحساب", f.account), field("التصنيف", f.category)),
      rateRow(f, accounts),
      field("سبب الحركة", f.reason),
      h("div", { class: "row" }, field(direction === "expense" ? "الجهة المستفيدة" : "المصدر", f.beneficiary), field("رقم العملية / المرجع", f.reference)),
      h("div", { class: "row" }, field("رقم الفاتورة", f.attachment), field("إرفاق صورة الفاتورة أو PDF", f.file)),
      sub("الحد 2 ميجابايت للملف. يُحفظ داخل النظام ويظهر مع الحركة."),
      field("ملاحظات", f.note),
      direction === "expense" ? h("label", { class: "f pill" }, f.approval, "تحتاج اعتمادًا قبل احتسابها") : null,
      btn(direction === "expense" ? "تسجيل المصروف" : "تسجيل الإيراد", async () => {
        const r = await api(`${A}/ledger/entries`, {
          direction, amount: f.amount.value, account_id: f.account.value, category_id: f.category.value,
          occurred_on: f.date.value, reason: f.reason.value, beneficiary: f.beneficiary.value || null,
          method: f.method.value, reference: f.reference.value || null, attachment: f.attachment.value || null,
          note: f.note.value || null, rate: f.rate.value || undefined,
          needs_approval: direction === "expense" ? f.approval.checked : false,
        });
        await uploadFile(f.file, r.id);
        toast(r.status === "pending" ? `سُجلت برقم ${r.entry_no} بانتظار الاعتماد` : `سُجلت برقم ${r.entry_no}`);
        for (const el of [f.amount, f.reason, f.beneficiary, f.reference, f.attachment, f.note, f.file]) el.value = "";
      }));
  };

  return [
    form("expense"),
    form("income"),
  ];
}

// إظهار سعر التحويل فقط إذا اختلفت عملة الحساب عن عملة المدرسة
function rateRow(f, accounts) {
  const wrap = h("div", { class: "hidden" });
  const sync = () => {
    const acc = accounts.find((a) => String(a.id) === String(f.account.value));
    const base = getCurrency();
    const foreign = acc && acc.currency !== base;
    wrap.classList.toggle("hidden", !foreign);
    if (foreign) {
      mount(wrap,
        field(`سعر تحويل ${CURRENCIES[acc.currency].name} إلى ${CURRENCIES[base].name}`, f.rate),
        sub(`مثال: إذا كان 1 ${CURRENCIES[acc.currency].symbol} يساوي 3 ${CURRENCIES[base].symbol} فاكتب 3`));
    }
  };
  f.account.addEventListener("change", sync);
  sync();
  return wrap;
}

// رفع المرفق بعد إنشاء الحركة
async function uploadFile(fileInput, entryId) {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast("حجم الملف أكبر من 2 ميجابايت", true);
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("تعذر قراءة الملف"));
    reader.readAsDataURL(file);
  });
  await api(`${A}/ledger/entries/${entryId}/attachments`, { filename: file.name, mime: file.type, data });
}

/* ---------------- تحويل بين الحسابات ---------------- */
async function transfer({ show }) {
  const list = (await api(`${A}/ledger/accounts`)).filter((a) => a.is_active);
  if (list.length < 2) return panel("تحويل بين الحسابات", null, empty("تحتاج حسابين نشطين على الأقل."));
  const label = (a) => `${a.name} — ${money(a.balance, a.currency)}`;
  const from = select(list.map((a) => [a.id, label(a)]));
  const to = select(list.map((a) => [a.id, label(a)]), { value: list[1].id });
  const amount = input({ type: "number", min: 0.01, step: "0.01" });
  const date = input({ type: "date", value: today() });
  const reason = input({ placeholder: "سبب التحويل" });
  const reference = input({ class: "ltr" });
  const rate = input({ type: "number", min: 0.000001, step: "0.000001" });
  const rateWrap = h("div", { class: "hidden" });
  const msg = h("div");

  const sync = () => {
    const a = list.find((x) => String(x.id) === from.value);
    const b = list.find((x) => String(x.id) === to.value);
    const cross = a && b && a.currency !== b.currency;
    rateWrap.classList.toggle("hidden", !cross);
    if (cross) mount(rateWrap, field(`سعر تحويل ${CURRENCIES[a.currency].name} إلى ${CURRENCIES[b.currency].name}`, rate));
  };
  from.addEventListener("change", sync);
  to.addEventListener("change", sync);
  sync();

  return panel("تحويل بين الحسابات", null,
    sub("إيداع نقدية في البنك أو نقل مبلغ بين صندوقين. يُسجَّل حركتين مرتبطتين، ولا يُحتسب إيرادًا ولا مصروفًا."),
    h("div", { class: "row" }, field("من حساب", from), field("إلى حساب", to)),
    h("div", { class: "row" }, field("المبلغ", amount), field("التاريخ", date)),
    rateWrap,
    h("div", { class: "row" }, field("السبب", reason), field("المرجع", reference)),
    msg,
    btn("تنفيذ التحويل", async () => {
      mount(msg);
      try {
        const r = await api(`${A}/ledger/transfers`, { from_account_id: from.value, to_account_id: to.value,
          amount: amount.value, occurred_on: date.value, reason: reason.value,
          reference: reference.value || null, rate: rate.value || undefined });
        toast(`تم التحويل: ${money(r.sent.amount, r.sent.currency)} ← ${money(r.received.amount, r.received.currency)}`);
        show();
      } catch (e) { mount(msg, notice(e.message, "err")); }
    }));
}

/* ---------------- التبرعات ---------------- */
async function donationsView({ show }) {
  const list = await api(`${A}/ledger/donations`);
  const f = {
    donor: input(), anonymous: input({ type: "checkbox" }), phone: input({ class: "ltr", inputMode: "tel" }),
    amount: input({ type: "number", min: 0.01, step: "0.01" }), purpose: input(),
    method: select(Object.entries(METHODS)), reference: input({ class: "ltr" }),
    date: input({ type: "date", value: today() }), note: textarea({ rows: 2 }),
  };
  const total = list.reduce((s, d) => s + Number(d.amount), 0);

  return [
    stats([["إجمالي التبرعات", money(total)], ["عدد التبرعات", list.length]]),
    panel("تسجيل تبرع", null,
      h("div", { class: "row" }, field("اسم المتبرع", f.donor), field("الجوال", f.phone)),
      h("label", { class: "f pill" }, f.anonymous, "تسجيله باسم مجهول"),
      h("div", { class: "row" }, field("المبلغ", f.amount), field("التاريخ", f.date), field("طريقة الدفع", f.method)),
      h("div", { class: "row" }, field("الغرض من التبرع", f.purpose), field("رقم العملية", f.reference)),
      field("ملاحظات", f.note),
      btn("تسجيل التبرع", async () => {
        const r = await api(`${A}/ledger/donations`, {
          donor_name: f.donor.value || null, anonymous: f.anonymous.checked, phone: f.phone.value || null,
          amount: f.amount.value, purpose: f.purpose.value || null, method: f.method.value,
          reference: f.reference.value || null, received_on: f.date.value, note: f.note.value || null,
        });
        toast(r.entry_no ? `سُجل التبرع — حركة ${r.entry_no}` : "سُجل التبرع");
        show();
      })),
    panel("سجل التبرعات", btn("تصدير Excel", () => exportRows("التبرعات", list,
      [["المتبرع", (d) => (d.anonymous ? "مجهول" : d.donor_name)], ["المبلغ", "amount"], ["التاريخ", "received_on"],
       ["الغرض", "purpose"], ["طريقة الدفع", (d) => METHODS[d.method]], ["المرجع", "reference"], ["الحركة", "entry_no"]]), "ghost sm"),
      list.length ? list.map((d) => line(
        h("div", {}, h("b", {}, d.anonymous ? "متبرع مجهول" : d.donor_name), " ", d.entry_no ? badge(d.entry_no, "gray") : null,
          sub(`${fmtDate(d.received_on)} — ${METHODS[d.method]}${d.purpose ? ` — ${d.purpose}` : ""}`),
          d.note ? sub(d.note) : null),
        h("b", {}, money(d.amount)))) : empty("لا توجد تبرعات مسجلة.")),
  ];
}

/* ---------------- الرواتب ---------------- */
/* ---------------- الموظفون ---------------- */
// كل من يعمل في المدرسة: المعلمون تلقائيًا من قائمة المعلمين، وبقية الأنواع تُضاف هنا. الراتب يُعدَّل من السطر مباشرة.
let staffFilter = "all";
async function staffView({ show }) {
  const { staff, summary, categories } = await api(`${A}/ledger/staff`);
  const CAT = Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v[0]]));
  const counts = Object.fromEntries(summary.types.map((x) => [x.key, x.count]));
  const shown = staff.filter((s) => (staffFilter === "all" ? s.is_active : staffFilter === "off" ? !s.is_active : s.is_active && s.category === staffFilter));
  const filters = [["all", `الكل (${summary.count})`], ...summary.types.map((x) => [x.key, `${x.name} (${x.count})`]),
    ...(staff.some((s) => !s.is_active) ? [["off", "الموقوفون"]] : [])];

  const row = (s) => {
    const base = input({ class: "ltr num", value: Number(s.base_salary), "aria-label": "الراتب الأساسي", inputMode: "decimal" });
    const allow = input({ class: "ltr num", value: Number(s.allowance), "aria-label": "البدل", inputMode: "decimal" });
    const save = btn("حفظ", async () => {
      await api(`${A}/ledger/staff/${s.id}/salary`, { base_salary: base.value || 0, allowance: allow.value || 0 }, "PATCH");
      toast(`حُفظ راتب ${s.full_name}`); show();
    }, "soft sm");
    save.hidden = true;
    for (const el of [base, allow]) el.addEventListener("input", () => { save.hidden = false; });
    return h("div", { class: `st-row${s.is_active ? "" : " muted-row"}` },
      h("div", { class: "st-who" },
        h("b", {}, s.full_name), " ", badge(CAT[s.category] || s.category, s.category === "teacher" ? "" : "gray"),
        s.base_salary > 0 ? null : badge("بلا راتب", "amber"),
        sub([s.job_title, s.subjects, s.phone].filter(Boolean).join(" · ") || "—"),
        s.teacher_id ? sub("من قائمة المعلمين — الاسم والجوال يُعدَّلان من ملف المعلم") : null),
      h("div", { class: "st-pay" },
        field("الأساسي", base), field("البدل", allow),
        h("div", { class: "st-total" }, h("span", { class: "sub" }, "الشهري"), h("b", {}, money(Number(s.base_salary) + Number(s.allowance))))),
      h("div", { class: "st-acts" }, save,
        btn("تعديل", () => staffDialog(categories, show, s), "ghost sm"),
        btn(s.is_active ? "إيقاف" : "تفعيل", async () => {
          if (s.is_active && !confirmAction(`إيقاف ${s.full_name}؟ لن يدخل في مسيرات الرواتب القادمة.`)) return;
          await api(`${A}/ledger/staff/${s.id}/active`, { active: !s.is_active }, "PATCH"); show();
        }, "ghost sm")));
  };

  return [
    stats([["الموظفون", summary.count], ["الرواتب الشهرية", money(summary.monthly)],
      ...summary.types.slice(0, 2).map((x) => [x.name, x.count, money(x.monthly)])]),
    summary.no_salary ? notice(`${summary.no_salary} موظفًا بلا راتب محدد. اكتب الراتب في السطر واضغط «حفظ» ليدخلوا في مسير الرواتب بمبلغهم.`, "warn") : null,
    panel("الموظفون", btn("إضافة موظف", () => staffDialog(categories, show), "sm"),
      h("div", { class: "xb-chips" }, filters.map(([k, label]) => h("button", { type: "button", class: `xb-chip${k === staffFilter ? " on" : ""}`,
        onclick: () => { staffFilter = k; show(); } }, label))),
      shown.length ? shown.map(row) : empty(staffFilter === "all" ? "لا يوجد موظفون بعد. المعلمون يظهرون هنا تلقائيًا، وأضف البقية بزر «إضافة موظف»." : "لا يوجد في هذا النوع."),
      sub("المعلمون يُضافون هنا تلقائيًا عند إضافتهم في «المعلمون». الإداريون والحراس والسائقون وغيرهم يُضافون من «إضافة موظف».")),
  ];
}

function staffDialog(categories, show, s = null) {
  const linked = Boolean(s?.teacher_id);
  const f = {
    name: input({ value: s?.full_name || "", disabled: linked }),
    category: select(Object.entries(categories).filter(([k]) => linked || k !== "teacher").map(([k, v]) => [k, v[0]]), { value: s?.category || "admin", disabled: linked }),
    title: input({ value: s?.job_title || "", placeholder: "مثال: حارس المبنى، سائق الباص 2" }),
    phone: input({ class: "ltr", inputMode: "tel", value: s?.phone || "", disabled: linked }),
    base: input({ class: "ltr num", inputMode: "decimal", value: s ? Number(s.base_salary) : 0 }),
    allow: input({ class: "ltr num", inputMode: "decimal", value: s ? Number(s.allowance) : 0 }),
    method: select([["cash", "نقدًا"], ["transfer", "تحويل (بنك أو محفظة)"]], { value: s?.pay_method || "cash" }),
    account: input({ class: "ltr", inputMode: "numeric", value: s?.account_number || "", placeholder: "رقم الحساب أو المحفظة" }),
    hire: input({ type: "date", value: s?.hire_date || "" }),
    notes: input({ value: s?.notes || "" }),
  };
  const d = dialog(s ? `تعديل: ${s.full_name}` : "إضافة موظف", h("div", {},
    linked ? notice("هذا معلم: اسمه وجواله من ملفه في «المعلمون». الراتب وطريقة الصرف من هنا.", "") : null,
    h("div", { class: "row" }, field("الاسم", f.name), field("النوع", f.category)),
    h("div", { class: "row" }, field("المسمى الوظيفي", f.title), field("الجوال", f.phone)),
    h("div", { class: "row" }, field("الراتب الأساسي الشهري", f.base), field("بدل ثابت شهري", f.allow, "مواصلات أو سكن…")),
    h("div", { class: "row" }, field("طريقة الصرف", f.method), field("رقم الحساب أو المحفظة", f.account)),
    h("div", { class: "row" }, field("تاريخ التعيين", f.hire), field("ملاحظات", f.notes))),
  [btn(s ? "حفظ" : "إضافة", async () => {
    const body = { full_name: s?.full_name || f.name.value, category: linked ? "teacher" : f.category.value, job_title: f.title.value || null,
      phone: linked ? s.phone : f.phone.value || null, base_salary: f.base.value || 0, allowance: f.allow.value || 0,
      pay_method: f.method.value, account_number: f.account.value || null, hire_date: f.hire.value || null, notes: f.notes.value || null };
    if (s) await api(`${A}/ledger/staff/${s.id}`, body, "PATCH"); else await api(`${A}/ledger/staff`, body);
    d.close(); toast(s ? "حُفظت بيانات الموظف" : "أُضيف الموظف"); show();
  })]);
}

/* ---------------- الرواتب: مسير لكل شهر ---------------- */
let payMonth = null;
async function payrollView({ show, go }) {
  payMonth ??= today().slice(0, 7);
  const [m, runs] = await Promise.all([api(`${A}/ledger/payroll/month?period=${payMonth}-01`), api(`${A}/ledger/payroll`)]);
  const monthIn = input({ type: "month", value: payMonth });
  monthIn.addEventListener("change", () => { if (monthIn.value) { payMonth = monthIn.value; show(); } });
  const label = new Date(`${m.period}T12:00:00`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric" });
  const CAT = { teacher: "معلم", admin: "إداري", accountant: "محاسب", supervisor: "مشرف", guard: "حارس", driver: "سائق", cleaner: "عامل نظافة", worker: "عامل", other: "أخرى" };
  const STATUS_R = { draft: ["مسودة", "gray"], approved: ["معتمد", "amber"], paid: ["مصروف", ""] };
  const head = h("div", { class: "row fin-range" }, field("الشهر", monthIn));

  if (!m.run) {
    const zero = m.preview.filter((x) => Number(x.net) === 0).length;
    return [head,
      panel(`رواتب ${label}`, null,
        m.preview.length ? [
          stats([["الموظفون", m.preview.length], ["الإجمالي المتوقع", money(m.total)]]),
          zero ? notice(`${zero} موظفًا راتبهم صفر. حدّد رواتبهم من «الموظفون» قبل إنشاء المسير.`, "warn") : null,
          h("div", { class: "pay-list" }, m.preview.map((x) => h("div", { class: "pay-line" },
            h("div", {}, h("b", {}, x.full_name), sub(x.job_title || CAT[x.category] || "")), h("b", {}, money(x.net))))),
          h("div", { class: "row spaced" }, btn("الموظفون ورواتبهم", () => go("staff"), "ghost"),
            btn(`إنشاء مسير ${label}`, async () => {
              const r = await api(`${A}/ledger/payroll`, { period: m.period });
              toast(`أُنشئ المسير لـ ${r.employees} موظفًا`); show();
            })),
        ] : empty("لا يوجد موظفون نشطون. أضفهم من «الموظفون».")),
      historyPanel(runs, show)];
  }

  const run = m.run, editable = run.status === "draft";
  const item = (i) => {
    const num = (v) => input({ class: "ltr num", inputMode: "decimal", value: Number(v), disabled: !editable });
    const f = { allowances: num(i.allowances), bonus: num(i.bonus), deductions: num(i.deductions), advances: num(i.advances) };
    const net = h("b", {}, money(i.net));
    const save = btn("حفظ", async () => {
      const r = await api(`${A}/ledger/payroll/${run.id}/items/${i.id}`, Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value || 0])), "PATCH");
      mount(net, money(r.net)); save.hidden = true; toast(`صافي ${i.full_name}: ${money(r.net)}`);
    }, "soft sm");
    save.hidden = true;
    for (const el of Object.values(f)) el.addEventListener("input", () => { save.hidden = false; });
    return h("div", { class: "pay-item" },
      h("div", { class: "pay-who" }, h("b", {}, i.full_name), sub(`${i.job_title || CAT[i.category] || ""} — الأساسي ${money(i.base)}`),
        i.entry_no ? sub(`صُرف — حركة ${i.entry_no}`) : null),
      h("div", { class: "pay-fields" }, field("بدلات", f.allowances), field("مكافأة", f.bonus), field("خصم", f.deductions), field("سلفة", f.advances)),
      h("div", { class: "pay-net" }, h("span", { class: "sub" }, "الصافي"), net, editable ? save : null));
  };
  return [head,
    panel(h("span", {}, `مسير ${label} `, badge(...STATUS_R[run.status])), null,
      stats([["الموظفون", run.employees], ["إجمالي الصافي", money(run.total)],
        ...(run.approved_by ? [["اعتمده", run.approved_by]] : []), ...(run.paid_at ? [["صُرف في", fmtDate(run.paid_at)]] : [])]),
      editable ? sub("عدّل البدلات والمكافآت والخصومات والسلف لكل موظف ثم اعتمد المسير. بعد الاعتماد لا يُعدَّل.") : null,
      m.items.map(item),
      h("div", { class: "row spaced" },
        editable ? btn("حذف المسودة", async () => {
          if (!confirmAction("حذف مسودة هذا الشهر؟ يمكنك إنشاؤها من جديد.")) return;
          await api(`${A}/ledger/payroll/${run.id}`, undefined, "DELETE"); toast("حُذفت المسودة"); show();
        }, "ghost") : h("span"),
        editable ? btn("اعتماد المسير", async () => {
          if (!confirmAction(`اعتماد مسير ${label} بإجمالي ${money(run.total)}؟ لن يمكن تعديله بعدها.`)) return;
          await api(`${A}/ledger/payroll/${run.id}/approve`, {}); toast("اعتُمد المسير"); show();
        }) : null,
        run.status === "approved" ? btn("صرف الرواتب", () => {
          const method = select(Object.entries(METHODS), { value: "cash" });
          const on = input({ type: "date", value: today(), max: today() });
          const d = dialog(`صرف رواتب ${label}`, h("div", {},
            sub(`يُسجَّل مصروف لكل موظف في سجل الحركات بإجمالي ${money(run.total)}.`),
            h("div", { class: "row" }, field("طريقة الصرف", method), field("تاريخ الصرف", on))),
          [btn("تأكيد الصرف", async () => {
            const r = await api(`${A}/ledger/payroll/${run.id}/pay`, { method: method.value, paid_on: on.value || null });
            d.close(); toast(`صُرفت رواتب ${r.paid} موظفًا`); show();
          })]);
        }) : null)),
    historyPanel(runs, show)];
}

function historyPanel(runs, show) {
  const STATUS_R = { draft: ["مسودة", "gray"], approved: ["معتمد", "amber"], paid: ["مصروف", ""] };
  if (!runs.length) return null;
  return panel("المسيرات السابقة", null, runs.map((r) => line(
    h("div", {}, h("b", {}, new Date(`${r.period}T12:00:00`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric" })), " ",
      badge(...STATUS_R[r.status]), sub(`${r.employees} موظف`)),
    h("div", { class: "row", style: "flex:none;align-items:center" }, h("b", {}, money(r.total)),
      btn("فتح", () => { payMonth = r.period.slice(0, 7); show(); }, "ghost sm")))));
}

/* ---------------- الحسابات والتصنيفات ---------------- */
async function accounts({ show }) {
  const [list, categories] = await Promise.all([api(`${A}/ledger/accounts`), api(`${A}/ledger/categories`)]);
  const f = { name: input(), kind: select(Object.entries(KINDS)),
    currency: select(Object.entries(CURRENCIES).map(([k, v]) => [k, v.name]), { value: getCurrency() }),
    opening: input({ type: "number", step: "0.01", value: 0 }),
    low: input({ type: "number", min: 0, step: "0.01" }), note: input() };
  const methodBoxes = Object.entries(METHODS).map(([k, label]) => {
    const cb = input({ type: "checkbox" });
    return { k, cb, el: h("label", { class: "small", style: "margin-inline-end:12px" }, cb, " ", label) };
  });
  const cat = { direction: select([["expense", "مصروف"], ["income", "إيراد"]]), name: input() };

  return [
    panel("إضافة حساب أو صندوق", null,
      h("div", { class: "row" }, field("الاسم", f.name), field("النوع", f.kind), field("العملة", f.currency)),
      h("div", { class: "row" }, field("الرصيد الافتتاحي", f.opening), field("تنبيه عند نزول الرصيد عن", f.low)),
      field("ملاحظة", f.note),
      sub("طرق الدفع التي تدخل لهذا الحساب تلقائيًا"),
      h("div", { class: "spaced" }, methodBoxes.map((m) => m.el)),
      btn("إضافة الحساب", async () => {
        await api(`${A}/ledger/accounts`, { name: f.name.value, kind: f.kind.value, currency: f.currency.value,
          opening_balance: f.opening.value || 0,
          low_balance: f.low.value || "", note: f.note.value || null,
          methods: methodBoxes.filter((m) => m.cb.checked).map((m) => m.k) });
        toast("أُضيف الحساب"); show();
      })),

    panel("الحسابات والصناديق", null, list.map((a) => line(
      h("div", { class: a.is_active ? "" : "muted-row" }, h("b", {}, a.name), " ", badge(KINDS[a.kind], "gray"),
        " ", badge(CURRENCIES[a.currency].name, a.currency === getCurrency() ? "" : "amber"),
        a.is_active ? null : badge("موقوف", "gray"),
        sub(`الرصيد الافتتاحي ${money(a.opening_balance)}${a.methods.length ? ` — يستقبل: ${a.methods.map((m) => METHODS[m]).join("، ")}` : ""}`),
        a.low_balance !== null ? sub(`تنبيه عند أقل من ${money(a.low_balance)}`) : null),
      h("div", { class: "row", style: "flex:none;align-items:center" },
        h("b", { class: Number(a.balance) < 0 ? "danger-text" : "" }, money(a.balance, a.currency)),
        btn(a.is_active ? "إيقاف" : "تفعيل", async () => {
          await api(`${A}/ledger/accounts/${a.id}/active`, { active: !a.is_active }, "PATCH"); show();
        }, "ghost sm"))))),

    panel("التصنيفات", null,
      h("div", { class: "row" }, field("النوع", cat.direction), field("اسم التصنيف", cat.name),
        btn("إضافة", async () => {
          await api(`${A}/ledger/categories`, { direction: cat.direction.value, name: cat.name.value });
          toast("أُضيف التصنيف"); show();
        }, "soft")),
      h("div", { class: "cols-2" },
        h("div", {}, h("h3", { class: "sec-title" }, "الإيرادات"),
          categories.filter((c) => c.direction === "income").map((c) => line(h("span", {}, c.name), c.code ? badge("أساسي", "gray") : null))),
        h("div", {}, h("h3", { class: "sec-title" }, "المصروفات"),
          categories.filter((c) => c.direction === "expense").map((c) => line(h("span", {}, c.name), c.code ? badge("أساسي", "gray") : null))))),
  ];
}

/* ---------------- تصدير ---------------- */
function exportRows(name, rows, columns) {
  const header = columns.map((c) => c[0]);
  const data = rows.map((r) => columns.map(([, key]) => (typeof key === "function" ? key(r) : r[key] ?? "")));
  const csvData = "\uFEFF" + [header, ...data].map((line) => line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csvData], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
