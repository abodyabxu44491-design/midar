// اشتراكات المدارس: الفواتير، التجديدات، والتحصيل
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, stats, field, input, select, btn, empty, badge, line, sub, toast, dialog, notice, confirmAction } from "/shared/js/ui.js";
import { money, fmtDate, fmtDateTime, METHODS } from "/shared/js/format.js";

const STATUS = { open: ["غير مسددة", "red"], paid: ["مسددة", ""], void: ["ملغاة", "gray"] };
const addYear = (d) => { const x = new Date(d); x.setFullYear(x.getFullYear() + 1); return x.toISOString().slice(0, 10); };

export default async function billing({ refresh }) {
  const [data, tenants] = await Promise.all([api("/api/owner/billing"), api("/api/owner/tenants")]);
  const { invoices, summary, renewals } = data;

  const tenantPicker = select([["", "اختر المدرسة"], ...tenants.map((t) => [t.id, t.name])]);
  const start = input({ type: "date", value: new Date().toISOString().slice(0, 10) });
  const end = input({ type: "date", value: addYear(new Date()) });
  const amount = input({ type: "number", min: 0, step: "0.01", value: 0 });
  tenantPicker.addEventListener("change", () => {
    const t = tenants.find((x) => x.id === tenantPicker.value);
    if (!t) return;
    amount.value = t.subscription_price || 0;
    if (t.subscription_end) { start.value = t.subscription_end; end.value = addYear(t.subscription_end); }
  });

  return [
    stats([
      ["محصّل هذه السنة", money(summary.year_revenue)],
      ["إجمالي المحصّل", money(summary.collected)],
      ["مستحق غير محصّل", money(summary.due)],
      ["تجديدات قريبة", renewals.length],
    ]),

    panel("التجديدات القادمة والمتأخرة",
      h("div", { class: "row", style: "flex:none" },
        btn("إصدار فواتير التجديد", async () => {
          const r = await api("/api/owner/billing/run-renewals", {});
          toast(r.created ? `صدرت ${r.created} فاتورة تجديد` : "لا توجد تجديدات مستحقة");
          refresh();
        }, "sm"),
        btn("إيقاف المنتهية", async () => {
          if (!confirmAction("إيقاف المدارس التي انتهى اشتراكها ومدة سماحها؟")) return;
          const r = await api("/api/owner/billing/suspend-expired", {});
          toast(r.suspended.length ? `أُوقفت ${r.suspended.length} مدرسة` : "لا توجد مدارس مستحقة للإيقاف");
          refresh();
        }, "danger sm")),
      renewals.length ? renewals.map((t) => line(
        h("div", {}, h("b", {}, t.name), " ",
          t.days_left < 0 ? badge(`انتهى منذ ${-t.days_left} يومًا`, "red")
            : t.days_left <= 7 ? badge(`يتبقى ${t.days_left} يوم`, "amber") : badge(`يتبقى ${t.days_left} يومًا`),
          t.invoiced ? badge("صدرت فاتورة", "gray") : null,
          sub(`ينتهي ${fmtDate(t.subscription_end)} — السعر ${money(t.subscription_price)} — سماح ${t.grace_days} يومًا — ${t.status === "active" ? "مفعّلة" : "موقوفة"}`)),
      )) : empty("لا توجد اشتراكات تنتهي قريبًا.")),

    panel("إصدار فاتورة اشتراك", null,
      h("div", { class: "row" }, field("المدرسة", tenantPicker), field("المبلغ", amount)),
      h("div", { class: "row" }, field("بداية المدة", start), field("نهاية المدة", end)),
      btn("إصدار الفاتورة", async () => {
        if (!tenantPicker.value) return toast("اختر المدرسة", true);
        await api("/api/owner/billing/invoices", {
          tenant_id: tenantPicker.value, period_start: start.value, period_end: end.value, amount: amount.value });
        toast("صدرت الفاتورة");
        refresh();
      })),

    panel("فواتير الاشتراكات", null,
      invoices.length ? invoices.map((i) => line(
        h("div", { class: i.status === "open" ? "" : "muted-row" },
          h("b", {}, `${i.school_name} — ${money(i.amount)}`), " ", badge(...STATUS[i.status]),
          sub(`المدة: ${fmtDate(i.period_start)} إلى ${fmtDate(i.period_end)}${i.note ? ` — ${i.note}` : ""}`),
          i.paid_at ? sub(`سُددت ${fmtDateTime(i.paid_at)} — ${METHODS[i.method] || ""}`) : null),
        i.status === "open" ? h("div", { class: "row", style: "flex:none" },
          btn("تسجيل السداد", () => payDialog(i, refresh), "sm"),
          btn("إلغاء", async () => {
            if (!confirmAction("إلغاء الفاتورة؟")) return;
            await api(`/api/owner/billing/invoices/${i.id}/void`, {});
            refresh();
          }, "danger sm")) : null))
        : empty("لا توجد فواتير اشتراك بعد.")),
  ];
}

function payDialog(i, refresh) {
  const method = select(Object.entries(METHODS));
  const note = input({ placeholder: "اختياري" });
  const msg = h("div");
  const d = dialog(`سداد اشتراك ${i.school_name}`, h("div", {},
    sub(`${money(i.amount)} — للمدة ${fmtDate(i.period_start)} إلى ${fmtDate(i.period_end)}`),
    field("طريقة السداد", method), field("ملاحظة", note), msg),
  [btn("تأكيد السداد", async () => {
    try {
      await api(`/api/owner/billing/invoices/${i.id}/pay`, { method: method.value, note: note.value || null });
      d.close(); toast("تم تسجيل السداد"); refresh();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  })]);
}
