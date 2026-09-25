// تبويب الرسوم: الفواتير، الدفعات، الاسترداد، الإلغاء
import { h, mount } from "../../shared/js/dom.js";
import { api, idempotencyKey } from "../../shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, dialog, stats, notice, confirmAction, skeleton } from "../../shared/js/ui.js";
import { money, csv, fmtDate, fmtDateTime, today, METHODS, CURRENCIES, getCurrency } from "../../shared/js/format.js";
import { waButton, messageVars } from "../../shared/js/whatsapp.js";
import { receiptDialog, statementDialog } from "../../shared/js/receipt.js";
import { A, loadClasses, optional } from "./common.js";

export default async function finance({ refresh }) {
  // الفواتير 50 في كل مرة (بحث وتصفية في الخادم)، ولا تنزيل لقائمة كل الطلاب
  const PAGE = 50;
  const [first, classes, claims, templates, me2] = await Promise.all([
    api(`${A}/finance/invoices?limit=${PAGE}`), loadClasses(), optional(api(`${A}/finance/claims`), []),
    optional(api(`${A}/messaging/templates`), null), api(`${A}/me`)]);
  const { totals } = first;
  const pending = claims.filter((c) => c.status === "pending");
  // لمن الفاتورة: فصل كامل، أو طالب يُختار من فصله
  const targetClass = select([["", "اختر الفصل"], ...classes.map((c) => [c.id, c.name])]);
  const targetStudent = select([["", "كل طلاب الفصل"]]);
  targetClass.addEventListener("change", async () => {
    mount(targetStudent, h("option", { value: "" }, "كل طلاب الفصل"));
    if (!targetClass.value) return;
    const list = await api(`${A}/students?class_id=${targetClass.value}&fields=basic&limit=500`);
    targetStudent.append(...list.map((x) => h("option", { value: x.id }, x.name)));
  });
  const target = { get value() { return targetStudent.value ? `student:${targetStudent.value}` : targetClass.value ? `class:${targetClass.value}` : ""; } };
  const title = input({ placeholder: "بند الرسوم" });
  const amount = input({ type: "number", min: 0.01, step: "0.01" });
  const due = input({ type: "date" });

  const plansPanel = await feePlansPanel(refresh, me2);

  return [
    plansPanel,
    stats([["إجمالي الفواتير", money(totals.fees_total)], ["المحصّل", money(totals.fees_paid)], ["المتبقي", money(totals.fees_remaining)],
      ["تحويلات بانتظار التأكيد", pending.length]]),
    panel(`إشعارات التحويل البنكي (${pending.length} بانتظار المراجعة)`, null,
      sub("تأكد من وصول المبلغ قبل التأكيد. التأكيد يصدر إيصالًا."),
      claims.length ? claims.slice(0, 50).map((c) => claimRow(c, refresh)) : empty("لا توجد إشعارات تحويل.")),
    panel("إصدار فاتورة", null,
      h("div", { class: "row" }, field("الفصل", targetClass), field("الطالب", targetStudent), field("البند", title)),
      h("div", { class: "row" }, field(`المبلغ (${CURRENCIES[getCurrency()].symbol})`, amount), field("تاريخ الاستحقاق", due)),
      sub("إصدار الفاتورة يفعّل الرسوم للطالب."),
      btn("إصدار الفاتورة", async () => {
        const [kind, id] = target.value.split(":");
        if (!id) return toast("اختر الطالب أو الفصل", true);
        if (!confirmAction(`إصدار فاتورة «${title.value}» بمبلغ ${money(amount.value)}${kind === "class" ? " لكل طلاب الفصل" : ""}؟`)) return;
        const r = await api(`${A}/finance/invoices`, { target: kind, target_id: id, title: title.value, amount: amount.value, due_date: due.value || null });
        toast(`تم إصدار ${r.created} فاتورة`); refresh();
      })),
    invoicesPanel(first, { classes, templates, me: me2, refresh, PAGE }),
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
        const note = input({ placeholder: "سبب الرفض" });
        const d = dialog("رفض الإشعار", h("div", {}, sub("السبب يظهر لولي الأمر."), field("سبب الرفض", note)),
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
      rem > 0 && ctx.student && ctx.templates ? waButton({ phone: ctx.student.guardian_phone, template: ctx.templates.fees, countryCode: ctx.templates.country_code,
        vars: messageVars({ student: ctx.student, school: ctx.me.school.name, fees: { remaining: rem },
          link: `${location.origin}/${ctx.me.school.id}` }), label: "تذكير واتساب" }) : null,
      i.paid > 0 && btn("استرداد", () => refundDialog(i, refresh), "ghost sm"),
      btn("السجل والإيصالات", () => history(i, ctx), "ghost sm"),
      ctx.student ? btn("كشف حساب", () => statement(i.student_id, ctx), "ghost sm") : null,
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
    sub(`المدفوع ${money(i.paid)}. التصحيح يكون بقيد استرداد.`), field("المبلغ", amount), field("السبب", note)),
  [btn("تسجيل الاسترداد", async () => {
    const r = await api(`${A}/finance/invoices/${i.id}/refunds`, { amount: amount.value, note: note.value, idempotency_key: key });
    d.close(); toast(`تم. رقم القيد ${r.receipt}`); refresh();
  }, "danger")]);
}

function voidDialog(i, refresh) {
  const reason = input({ placeholder: "سبب الإلغاء (مطلوب)" });
  const d = dialog(`إلغاء الفاتورة #${i.id}`, h("div", {}, sub("الإلغاء نهائي، والفاتورة تبقى في السجل."), field("السبب", reason)),
    [btn("إلغاء الفاتورة", async () => {
      await api(`${A}/finance/invoices/${i.id}/void`, { reason: reason.value }); d.close(); toast("تم الإلغاء"); refresh();
    }, "danger")]);
}

async function history(i, ctx = {}) {
  const rows = (await api(`${A}/finance/students/${i.student_id}/payments`)).filter((p) => p.invoice_id === i.id);
  dialog(`سجل مدفوعات ${i.student_name}`, h("div", {}, rows.length ? rows.map((p) => line(
    h("div", {}, h("b", {}, p.kind === "refund" ? "استرداد" : "دفعة"),
      sub(`${METHODS[p.method]} — ${fmtDateTime(p.created_at)}${p.note ? ` — ${p.note}` : ""}`)),
    h("div", { class: "row", style: "flex:none;align-items:center" },
      h("b", { class: p.kind === "refund" ? "danger-text" : "" }, `${p.kind === "refund" ? "−" : ""}${money(p.amount)}`),
      h("span", { class: "key" }, p.receipt_no),
      btn("إيصال", () => receiptDialog({
        school: ctx.me?.school?.name || "", student: i.student_name, class_name: i.class_name,
        receipt_no: p.receipt_no, amount: p.amount, method: p.method, created_at: p.created_at,
        title: i.title, kind: p.kind, remaining: Number(i.amount) - Number(i.paid),
      }), "ghost sm"))))
    : empty("لا توجد دفعات.")));
}

// كشف حساب الطالب: كل فواتيره ودفعاته
async function statement(studentId, ctx = {}) {
  const [{ invoices }, payments] = await Promise.all([
    api(`${A}/finance/invoices?student_id=${studentId}&totals=0`), api(`${A}/finance/students/${studentId}/payments`)]);
  const mine = invoices;   // فواتير هذا الطالب فقط (من الخادم، بلا حد 1000)
  statementDialog({
    school: ctx.me?.school?.name || "",
    student: mine[0]?.student_name || "", class_name: mine[0]?.class_name,
    invoices: mine, payments,
  });
}


/* ---------------- قوالب الرسوم والتقسيط ---------------- */
async function feePlansPanel(refresh, me) {
  const [plans, setup] = await Promise.all([api(`${A}/finance/plans`), api(`${A}/setup`)]);
  const grades = setup.structure.stages.flatMap((st) => st.grades.map((g) => ({ ...g, stage: st.name })));

  const f = {
    name: input({ placeholder: "اسم القالب" }),
    grade: select([["", "كل الصفوف"], ...grades.map((g) => [g.id, `${g.stage} — ${g.name}`])]),
    amount: input({ type: "number", min: 0, step: "0.01" }),
    installments: select([[1, "دفعة واحدة"], [2, "دفعتان"], [3, "3 دفعات"], [4, "4 دفعات"], [6, "6 دفعات"], [10, "10 دفعات"], [12, "12 دفعة"]]),
    first: input({ type: "date", value: today() }),
    every: select([[1, "كل شهر"], [2, "كل شهرين"], [3, "كل 3 أشهر"]]),
  };

  const row = (p) => line(
    h("div", { class: p.is_active ? "" : "muted-row" },
      h("b", {}, p.name), " ", p.is_active ? null : badge("موقوف", "gray"),
      sub(`${money(p.amount)} — ${p.installments === 1 ? "دفعة واحدة" : `${p.installments} دفعات كل ${p.interval_months} شهر`}`),
      sub(`${p.grade_name ? `الصف: ${p.grade_name}` : "كل الصفوف"}${p.students ? ` — طُبق على ${p.students} طالب` : ""}`)),
    h("div", { class: "row", style: "flex:none" },
      btn("تطبيق", () => applyDialog(p, grades, refresh), "sm"),
      btn("نسخ", () => copyPlanDialog(p, grades, refresh), "ghost sm"),
      btn(p.is_active ? "إيقاف" : "تفعيل", async () => {
        await api(`${A}/finance/plans/${p.id}`, { is_active: !p.is_active }, "PATCH"); refresh();
      }, "ghost sm")));

  return panel("قوالب الرسوم", null,
    plans.length ? plans.map(row) : empty("لا توجد قوالب. أنشئ قالبًا وطبّقه على صف كامل."),
    h("h3", { class: "sec-title" }, "قالب جديد"),
    h("div", { class: "row" }, field("الاسم", f.name), field("الصف", f.grade), field("المبلغ", f.amount)),
    h("div", { class: "row" }, field("التقسيط", f.installments), field("أول استحقاق", f.first), field("الفاصل", f.every)),
    btn("حفظ القالب", async () => {
      await api(`${A}/finance/plans`, {
        name: f.name.value, grade_id: f.grade.value || null, amount: f.amount.value,
        installments: Number(f.installments.value), first_due: f.first.value,
        interval_months: Number(f.every.value),
      });
      toast("حُفظ القالب"); refresh();
    }));
}

function copyPlanDialog(plan, grades, refresh) {
  const name = input({ value: `${plan.name} (نسخة)` });
  const grade = select([["", "نفس صف الأصل"], ...grades.map((g) => [g.id, `${g.stage} — ${g.name}`])]);
  const d = dialog(`نسخ ${plan.name}`, h("div", {},
    sub("تُنسخ القيمة والتقسيط والتواريخ، ثم عدّل ما تريد."),
    field("اسم القالب الجديد", name), field("الصف", grade)),
  [btn("نسخ", async () => {
    await api(`${A}/finance/plans/${plan.id}/copy`, { name: name.value, grade_id: grade.value || null });
    d.close(); toast("نُسخ القالب"); refresh();
  })]);
}

function applyDialog(plan, grades, refresh) {
  const scope = select([["plan", plan.grade_name ? `صف القالب (${plan.grade_name})` : "كل الطلاب"],
    ...grades.map((g) => [String(g.id), `${g.stage} — ${g.name}`])]);
  const out = h("div");
  const msg = h("div");

  const preview = async () => {
    mount(out, empty("جارٍ الحساب…"));
    try {
      const body = scope.value === "plan" ? { dry_run: true } : { grade_id: Number(scope.value), dry_run: true };
      const r = await api(`${A}/finance/plans/${plan.id}/apply`, body);
      mount(out,
        sub(`${r.students} طالبًا — ${r.preview.filter((x) => x.exempt).length} معفى`),
        h("div", { class: "scroll" }, h("table", { class: "grid" },
          h("thead", {}, h("tr", {}, h("th", {}, "الطالب"), h("th", {}, "الإجمالي"), h("th", {}, "كل دفعة"))),
          h("tbody", {}, r.preview.slice(0, 12).map((x) => h("tr", {},
            h("td", {}, x.name), h("td", {}, x.exempt ? "معفى" : money(x.total)),
            h("td", {}, x.exempt ? "—" : money(x.per_installment))))))));
    } catch (e) { mount(out, notice(e.message, "err")); }
  };
  scope.addEventListener("change", preview);

  const d = dialog(`تطبيق: ${plan.name}`, h("div", {},
    field("التطبيق على", scope),
    sub("الخصومات والإعفاءات تُحتسب لكل طالب تلقائيًا، وإعادة التطبيق لا تكرر الفواتير."),
    out, msg),
  [btn("تطبيق وإنشاء الفواتير", async () => {
    mount(msg);
    try {
      const body = scope.value === "plan" ? {} : { grade_id: Number(scope.value) };
      const r = await api(`${A}/finance/plans/${plan.id}/apply`, body);
      d.close();
      toast(`أُنشئت ${r.invoices} فاتورة لـ ${r.students} طالبًا`);
      refresh();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  })]);
  preview();
}


// قائمة الفواتير: بحث وتصفية في الخادم، و«عرض المزيد» بدل عرض آلاف الصفوف مرة واحدة
function invoicesPanel(first, { classes, templates, me, refresh, PAGE }) {
  const q = input({ type: "search", placeholder: "بحث باسم الطالب أو البند أو رقم الفاتورة" });
  const cls = select([["", "كل الفصول"], ...classes.map((c) => [c.id, c.name])]);
  const st = select([["all", "كل الفواتير"], ["unpaid", "غير مسددة"], ["open", "سارية"], ["void", "ملغاة"]]);
  const list = h("div");
  const count = h("span", { class: "sub" });
  const more = h("div", { class: "spaced" });
  let items = [];
  let total = 0;
  let seq = 0;
  const qs = (offset) => `${A}/finance/invoices?limit=${PAGE}&offset=${offset}&totals=0&status=${st.value}${cls.value ? `&class_id=${cls.value}` : ""}${q.value.trim() ? `&q=${encodeURIComponent(q.value.trim())}` : ""}`;
  const rowOf = (i) => invoiceRow(i, refresh, { templates, me,
    student: { id: i.student_id, name: i.student_name, class_name: i.class_name, guardian_phone: i.guardian_phone, access_key: i.access_key } });
  const drawMore = () => mount(more, items.length < total ? btn(`عرض المزيد (${total - items.length} متبقية)`, async (e) => {
    e.currentTarget.disabled = true;
    const r = await api(qs(items.length));
    items = items.concat(r.invoices);
    list.append(...r.invoices.map(rowOf));
    count.textContent = `${items.length} من ${total}`;
    drawMore();
  }, "ghost") : null);
  const load = async () => {
    const my = ++seq;
    mount(list, skeleton(4));
    const r = await api(qs(0));
    if (my !== seq) return;   // نتيجة بحث أقدم وصلت متأخرة
    items = r.invoices; total = r.total;
    count.textContent = `${items.length} من ${total}`;
    mount(list, items.length ? items.map(rowOf) : empty("لا توجد فواتير مطابقة."));
    drawMore();
  };
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 300); });
  cls.addEventListener("change", load);
  st.addEventListener("change", load);
  items = first.invoices; total = first.total;
  count.textContent = `${items.length} من ${total}`;
  mount(list, items.length ? items.map(rowOf) : empty("لم تُصدر فواتير بعد."));
  drawMore();
  return panel("الفواتير", btn("تصدير", async () => {
    const all = await api(`${A}/finance/invoices?totals=0&status=${st.value}${cls.value ? `&class_id=${cls.value}` : ""}`);
    csv("الفواتير.csv", [["رقم", "الطالب", "الفصل", "البند", "المبلغ", "المدفوع", "المتبقي", "الحالة", "الاستحقاق"],
      ...all.invoices.map((i) => [i.id, i.student_name, i.class_name, i.title, i.amount, i.paid, i.amount - i.paid, i.status === "void" ? "ملغاة" : "", i.due_date])]);
  }, "ghost sm"),
    h("div", { class: "row" }, q, cls, st), h("div", { class: "toolbar" }, count), list, more);
}
