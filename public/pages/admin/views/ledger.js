// المالية: لوحة التحكم، الحركات، الحسابات، التبرعات، الرواتب، التقارير
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, line, sub, stats, toast,
  dialog, notice, confirmAction } from "/shared/js/ui.js";
import { barChart } from "/shared/js/charts.js";
import { money, fmtDate, fmtDateTime, today } from "/shared/js/format.js";
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

export default async function ledgerView({ refresh }) {
  const section = select([["dashboard", "لوحة التحكم"], ["entries", "سجل الحركات"], ["expenses", "مصروف أو سحب"],
    ["donations", "التبرعات"], ["payroll", "الرواتب"], ["accounts", "الحسابات والتصنيفات"]]);
  const body = h("div");
  const views = { dashboard, entries, expenses, donationsView, payroll, accounts };
  const show = async () => {
    mount(body, empty("جارٍ التحميل…"));
    try { mount(body, await views[section.value === "donations" ? "donationsView" : section.value]({ refresh, show })); }
    catch (e) { mount(body, notice(e.message, "err")); }
  };
  section.addEventListener("change", show);
  await show();
  return [panel("القسم المالي", null, field("اختر القسم", section)), body];
}

/* ---------------- لوحة التحكم المالية ---------------- */
async function dashboard({ show }) {
  const range = select([["today", "اليوم"], ["week", "هذا الأسبوع"], ["month", "هذا الشهر"], ["year", "هذا العام"], ["custom", "فترة مخصصة"]], { value: "month" });
  const from = input({ type: "date", value: monthStart() });
  const to = input({ type: "date", value: today() });
  const box = h("div");

  const load = async () => {
    mount(box, empty("جارٍ الحساب…"));
    const d = await api(`${A}/ledger/summary?from=${from.value}&to=${to.value}`);
    const low = d.accounts.filter((a) => a.is_active && a.low_balance !== null && Number(a.balance) < Number(a.low_balance));
    mount(box,
      stats([
        ["الرصيد الحالي", money(d.balance), "مجموع الحسابات"],
        ["إجمالي المداخيل", money(d.income)],
        ["إجمالي المصروفات", money(d.expense)],
        ["صافي الحركة", money(d.net)],
      ]),
      stats([
        ["الرسوم المسددة", money(d.fees)],
        ["الرسوم غير المسددة", money(d.unpaid_fees), d.overdue_invoices ? `${d.overdue_invoices} فاتورة متأخرة` : ""],
        ["التبرعات", money(d.donations)],
        ["الرواتب", money(d.salaries)],
        ["المصروفات التشغيلية", money(d.operating)],
        ["السحوبات", money(d.withdrawals)],
      ]),
      d.pending ? notice(`${d.pending} حركة بانتظار الاعتماد في «سجل الحركات».`, "warn") : null,
      low.length ? notice(`رصيد منخفض: ${low.map((a) => `${a.name} (${money(a.balance)})`).join("، ")}`, "err") : null,

      panel("أرصدة الحسابات", null, d.accounts.filter((a) => a.is_active).map((a) => line(
        h("div", {}, h("b", {}, a.name), sub(`${KINDS[a.kind]}${a.methods.length ? ` — ${a.methods.map((m) => METHODS[m]).join("، ")}` : ""}`)),
        h("b", { class: Number(a.balance) < 0 ? "danger-text" : "" }, money(a.balance))))),

      panel("الحركة الشهرية", null,
        barChart(d.by_month.map((m) => ({ label: monthName(m.month), value: Math.round(m.income), color: "var(--teal)" }))),
        sub("المداخيل"),
        barChart(d.by_month.map((m) => ({ label: monthName(m.month), value: Math.round(m.expense), color: "var(--red)" }))),
        sub("المصروفات")),

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

  return [panel("الفترة", null, h("div", { class: "row" }, field("المدة", range), field("من", from), field("إلى", to))), box];
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
      h("b", { class: income ? "" : "danger-text" }, `${income ? "+" : "−"}${money(e.amount)}`), " ",
      badge(...STATUS[e.status]), " ", badge(SOURCES[e.source_type] || e.source_type, "gray"),
      sub(`${e.entry_no} — ${fmtDate(e.occurred_on)} — ${e.category_name} — ${e.account_name}`),
      sub(e.reason),
      e.beneficiary ? sub(`المستفيد: ${e.beneficiary}`) : null,
      sub(`أنشأها ${e.created_by}${e.approved_by ? ` — اعتمدها ${e.approved_by}` : ""}${e.reference ? ` — مرجع ${e.reference}` : ""}`),
      e.void_reason ? sub(`سبب الإلغاء: ${e.void_reason}`) : null),
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
      account: select(accounts.filter((a) => a.is_active).map((a) => [a.id, `${a.name} — ${money(a.balance)}`])),
      category: select(cats.map((c) => [c.id, c.name])),
      date: input({ type: "date", value: today() }),
      method: select(Object.entries(METHODS)),
      reason: input(),
      beneficiary: input(),
      reference: input({ class: "ltr" }),
      attachment: input({ placeholder: "رقم الفاتورة أو رابطها" }),
      note: textarea({ rows: 2 }),
      approval: input({ type: "checkbox", checked: direction === "expense" }),
    };
    return panel(direction === "expense" ? "تسجيل مصروف أو سحب" : "تسجيل إيراد", null,
      h("div", { class: "row" }, field("المبلغ", f.amount), field("التاريخ", f.date), field("طريقة الدفع", f.method)),
      h("div", { class: "row" }, field("الحساب", f.account), field("التصنيف", f.category)),
      field("سبب الحركة", f.reason),
      h("div", { class: "row" }, field(direction === "expense" ? "الجهة المستفيدة" : "المصدر", f.beneficiary), field("رقم العملية / المرجع", f.reference)),
      field("المرفق أو الفاتورة", f.attachment),
      field("ملاحظات", f.note),
      direction === "expense" ? h("label", { class: "f pill" }, f.approval, "تحتاج اعتمادًا قبل احتسابها") : null,
      btn(direction === "expense" ? "تسجيل المصروف" : "تسجيل الإيراد", async () => {
        const r = await api(`${A}/ledger/entries`, {
          direction, amount: f.amount.value, account_id: f.account.value, category_id: f.category.value,
          occurred_on: f.date.value, reason: f.reason.value, beneficiary: f.beneficiary.value || null,
          method: f.method.value, reference: f.reference.value || null, attachment: f.attachment.value || null,
          note: f.note.value || null, needs_approval: direction === "expense" ? f.approval.checked : false,
        });
        toast(r.status === "pending" ? `سُجلت برقم ${r.entry_no} بانتظار الاعتماد` : `سُجلت برقم ${r.entry_no}`);
        for (const el of [f.amount, f.reason, f.beneficiary, f.reference, f.attachment, f.note]) el.value = "";
      }));
  };

  return [
    notice("كل حركة تُسجَّل باسمك مع سببها والجهة المستفيدة، وتظهر في سجل الحركات ولا تُحذف.", ""),
    form("expense"),
    form("income"),
  ];
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
async function payroll({ show }) {
  const [staff, runs] = await Promise.all([api(`${A}/ledger/staff`), api(`${A}/ledger/payroll`)]);
  const f = { name: input(), title: input(), category: select([["teacher", "معلم"], ["admin", "إداري"], ["worker", "عامل"], ["other", "أخرى"]]),
    phone: input({ class: "ltr" }), iban: input({ class: "ltr" }), salary: input({ type: "number", min: 0, step: "0.01", value: 0 }) };
  const period = input({ type: "month", value: today().slice(0, 7) });
  const totalSalaries = staff.filter((s) => s.is_active).reduce((sum, s) => sum + Number(s.base_salary), 0);

  return [
    stats([["موظف نشط", staff.filter((s) => s.is_active).length], ["إجمالي الرواتب الأساسية", money(totalSalaries)],
      ["مسيرات هذا العام", runs.length]]),

    panel("إضافة موظف", btn("استيراد المعلمين", async () => {
      const r = await api(`${A}/ledger/staff/import-teachers`, {});
      toast(r.added ? `أُضيف ${r.added} معلمًا` : "كل المعلمين مضافون"); show();
    }, "ghost sm"),
      h("div", { class: "row" }, field("الاسم", f.name), field("المسمى الوظيفي", f.title), field("النوع", f.category)),
      h("div", { class: "row" }, field("الجوال", f.phone), field("الآيبان", f.iban), field("الراتب الأساسي", f.salary)),
      btn("إضافة", async () => {
        await api(`${A}/ledger/staff`, { full_name: f.name.value, job_title: f.title.value || null, category: f.category.value,
          phone: f.phone.value || null, iban: f.iban.value || "", base_salary: f.salary.value });
        toast("أُضيف الموظف"); show();
      })),

    panel("الموظفون", null, staff.length ? staff.map((s) => line(
      h("div", { class: s.is_active ? "" : "muted-row" }, h("b", {}, s.full_name), " ",
        s.is_active ? null : badge("موقوف", "gray"),
        sub(`${s.job_title || ""}${s.phone ? ` — ${s.phone}` : ""}`)),
      h("div", { class: "row", style: "flex:none" }, h("b", {}, money(s.base_salary)),
        btn(s.is_active ? "إيقاف" : "تفعيل", async () => {
          await api(`${A}/ledger/staff/${s.id}/active`, { active: !s.is_active }, "PATCH"); show();
        }, "ghost sm")))) : empty("لا يوجد موظفون. أضفهم أو استورد المعلمين.")),

    panel("مسير الرواتب", null,
      h("div", { class: "row" }, field("الشهر", period),
        btn("إنشاء مسير الشهر", async () => {
          const r = await api(`${A}/ledger/payroll`, { period: `${period.value}-01` });
          toast(`أُنشئ المسير لـ ${r.employees} موظفًا`); show();
        }, "soft")),
      runs.length ? runs.map((r) => runRow(r, show)) : empty("لا توجد مسيرات بعد.")),
  ];
}

function runRow(run, show) {
  const STATUS_R = { draft: ["مسودة", "gray"], approved: ["معتمد", "amber"], paid: ["مصروف", ""], void: ["ملغي", "gray"] };
  const box = h("div", { class: "hidden", style: "width:100%;background:var(--bg);border-radius:8px;padding:10px;margin-top:8px" });
  return line(
    h("div", {}, h("b", {}, `مسير ${String(run.period).slice(0, 7)}`), " ", badge(...STATUS_R[run.status]),
      sub(`${run.employees} موظف — إجمالي ${money(run.total)}${run.approved_by ? ` — اعتمده ${run.approved_by}` : ""}`)),
    h("div", { class: "row", style: "flex:none" },
      btn("التفاصيل", async () => {
        if (!box.classList.contains("hidden")) return box.classList.add("hidden");
        const items = await api(`${A}/ledger/payroll/${run.id}/items`);
        mount(box, items.map((i) => itemRow(run, i, show)));
        box.classList.remove("hidden");
      }, "ghost sm"),
      run.status === "draft" ? btn("اعتماد", async () => {
        if (!confirmAction("اعتماد المسير؟ لن يمكن تعديله بعدها.")) return;
        await api(`${A}/ledger/payroll/${run.id}/approve`, {}); toast("اعتُمد المسير"); show();
      }, "sm") : null,
      run.status === "approved" ? btn("صرف الرواتب", () => {
        const method = select(Object.entries(METHODS), { value: "transfer" });
        const d = dialog("صرف الرواتب", h("div", {},
          sub(`سيُسجَّل مصروف لكل موظف بإجمالي ${money(run.total)}.`), field("طريقة الصرف", method)),
        [btn("تأكيد الصرف", async () => {
          const r = await api(`${A}/ledger/payroll/${run.id}/pay`, { method: method.value });
          d.close(); toast(`صُرفت رواتب ${r.paid} موظفًا`); show();
        })]);
      }, "sm") : null),
    box);
}

function itemRow(run, i, show) {
  const editable = run.status === "draft";
  const f = {
    allowances: input({ type: "number", min: 0, step: "0.01", value: i.allowances, disabled: !editable, style: "width:90px" }),
    bonus: input({ type: "number", min: 0, step: "0.01", value: i.bonus, disabled: !editable, style: "width:90px" }),
    deductions: input({ type: "number", min: 0, step: "0.01", value: i.deductions, disabled: !editable, style: "width:90px" }),
    advances: input({ type: "number", min: 0, step: "0.01", value: i.advances, disabled: !editable, style: "width:90px" }),
  };
  return line(
    h("div", {}, h("b", {}, i.full_name), sub(`${i.job_title || ""} — الأساسي ${money(i.base)}`),
      i.entry_no ? sub(`حركة ${i.entry_no}`) : null),
    h("div", { class: "row", style: "flex:none;align-items:center" },
      h("span", { class: "sub" }, "بدلات"), f.allowances,
      h("span", { class: "sub" }, "مكافأة"), f.bonus,
      h("span", { class: "sub" }, "خصومات"), f.deductions,
      h("span", { class: "sub" }, "سلف"), f.advances,
      h("b", {}, money(i.net)),
      editable ? btn("حفظ", async () => {
        const r = await api(`${A}/ledger/payroll/${run.id}/items/${i.id}`, {
          allowances: f.allowances.value, bonus: f.bonus.value, deductions: f.deductions.value, advances: f.advances.value,
        }, "PATCH");
        toast(`الصافي ${money(r.net)}`); show();
      }, "soft sm") : null));
}

/* ---------------- الحسابات والتصنيفات ---------------- */
async function accounts({ show }) {
  const [list, categories] = await Promise.all([api(`${A}/ledger/accounts`), api(`${A}/ledger/categories`)]);
  const f = { name: input(), kind: select(Object.entries(KINDS)), opening: input({ type: "number", step: "0.01", value: 0 }),
    low: input({ type: "number", min: 0, step: "0.01" }), note: input() };
  const methodBoxes = Object.entries(METHODS).map(([k, label]) => {
    const cb = input({ type: "checkbox" });
    return { k, cb, el: h("label", { class: "small", style: "margin-inline-end:12px" }, cb, " ", label) };
  });
  const cat = { direction: select([["expense", "مصروف"], ["income", "إيراد"]]), name: input() };

  return [
    panel("إضافة حساب أو صندوق", null,
      h("div", { class: "row" }, field("الاسم", f.name), field("النوع", f.kind)),
      h("div", { class: "row" }, field("الرصيد الافتتاحي", f.opening), field("تنبيه عند نزول الرصيد عن", f.low)),
      field("ملاحظة", f.note),
      sub("طرق الدفع التي تدخل لهذا الحساب تلقائيًا"),
      h("div", { class: "spaced" }, methodBoxes.map((m) => m.el)),
      btn("إضافة الحساب", async () => {
        await api(`${A}/ledger/accounts`, { name: f.name.value, kind: f.kind.value, opening_balance: f.opening.value || 0,
          low_balance: f.low.value || "", note: f.note.value || null,
          methods: methodBoxes.filter((m) => m.cb.checked).map((m) => m.k) });
        toast("أُضيف الحساب"); show();
      })),

    panel("الحسابات والصناديق", null, list.map((a) => line(
      h("div", { class: a.is_active ? "" : "muted-row" }, h("b", {}, a.name), " ", badge(KINDS[a.kind], "gray"),
        a.is_active ? null : badge("موقوف", "gray"),
        sub(`الرصيد الافتتاحي ${money(a.opening_balance)}${a.methods.length ? ` — يستقبل: ${a.methods.map((m) => METHODS[m]).join("، ")}` : ""}`),
        a.low_balance !== null ? sub(`تنبيه عند أقل من ${money(a.low_balance)}`) : null),
      h("div", { class: "row", style: "flex:none;align-items:center" },
        h("b", { class: Number(a.balance) < 0 ? "danger-text" : "" }, money(a.balance)),
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
