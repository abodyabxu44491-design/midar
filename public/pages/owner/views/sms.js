// الرسائل النصية: مزوّد الرسائل (يناسب أي مزوّد عبر طلب HTTP)، ورصيد كل مدرسة، وسجل الإرسال
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, line, sub, toast, notice, switchBtn } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";

const API = "/api/owner/sms";
const STATUS = { queued: ["قيد الإرسال", "amber"], sent: ["أُرسلت", ""], failed: ["فشلت", "red"], no_credit: ["لا رصيد", "gray"], disabled: ["المزوّد موقوف", "gray"] };

export default async function sms({ refresh }) {
  const d = await api(API);
  const g = d.gateway;
  const f = {
    provider_name: input({ value: g.provider_name, placeholder: "مثال: مزوّد الرسائل" }),
    url: input({ class: "ltr", value: g.url, placeholder: "https://api.provider.com/send" }),
    method: select([["POST", "POST"], ["GET", "GET"]], { value: g.method }),
    content_type: select([["json", "JSON"], ["form", "نموذج (form)"]], { value: g.content_type }),
    body_template: textarea({ class: "ltr", rows: 3, value: g.body_template, placeholder: '{"to":"{to}","text":"{message}","sender":"{sender}"}' }),
    sender: input({ class: "ltr", value: g.sender, placeholder: "اسم المرسل" }),
    success_match: input({ class: "ltr", value: g.success_match, placeholder: "نص يدل على النجاح في رد المزوّد (اختياري)" }),
    headers: textarea({ class: "ltr", rows: 2, placeholder: g.has_headers ? "محفوظة ومشفّرة. اكتب جديدة لاستبدالها، أو - لحذفها" : '{"Authorization":"Bearer ..."}' }),
  };
  let enabled = g.enabled;
  const testTo = input({ class: "ltr", placeholder: "967771234567" });
  const testMsg = input({ value: "رسالة تجريبية من مدار" });
  return [
    panel("مزوّد الرسائل النصية", null,
      line(h("div", {}, h("b", {}, "تفعيل الإرسال"), sub("بدون تفعيل لا تُرسل أي رسالة، ويعود رصيد أي رسالة محجوزة.")),
        switchBtn(g.enabled, "تفعيل الإرسال", (v) => { enabled = v; return true; })),
      !d.can_store_secret ? notice("مفتاح التشفير غير مضبوط على الخادم: لا يمكن حفظ مفتاح المزوّد السري.", "warn") : null,
      h("div", { class: "row" }, field("اسم المزوّد", f.provider_name), field("اسم المرسل", f.sender)),
      field("رابط الإرسال", f.url, "يمكن استخدام {to} و{message} و{sender} داخل الرابط عند GET"),
      h("div", { class: "row" }, field("الطريقة", f.method), field("صيغة البيانات", f.content_type)),
      field("قالب البيانات", f.body_template, "{to} الرقم دوليًا بلا + (مثل 967771234567)، {message} نص الرسالة"),
      field("الترويسات (المفتاح السري)", f.headers, "تُحفظ مشفّرة ولا تظهر مرة أخرى"),
      field("علامة النجاح", f.success_match),
      btn("حفظ إعدادات المزوّد", async () => {
        const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
        if (!body.headers.trim()) delete body.headers;
        await api(`${API}/gateway`, { ...body, enabled }, "PUT");
        toast("تم الحفظ"); refresh();
      })),
    panel("رسالة تجريبية", null,
      h("div", { class: "row" }, field("إلى", testTo), field("النص", testMsg)),
      btn("إرسال", async () => { await api(`${API}/test`, { to: testTo.value.trim(), message: testMsg.value }); toast("أُرسلت"); }, "ghost")),
    panel("رصيد المدارس", null,
      sub("الرصيد بعدد الرسائل. الرسالة العربية حتى 70 حرفًا = رسالة واحدة. الرسائل التي تفشل يعود رصيدها تلقائيًا."),
      d.balances.length ? d.balances.map((s) => {
        const n = input({ type: "number", class: "ltr", placeholder: "العدد", style: "max-width:110px" });
        return line(h("div", {}, h("b", {}, s.name), sub(`${s.id} — الرصيد ${s.balance} — أُرسل آخر 30 يومًا: ${s.sent_30d}`)),
          h("div", { class: "row", style: "flex:none;gap:6px;align-items:center" }, n,
            btn("إضافة", async () => {
              const v = Number(n.value);
              if (!v) return toast("أدخل عددًا", true);
              const r = await api(`${API}/credits`, { tenant_id: s.id, delta: v, reason: v > 0 ? "إضافة رصيد" : "خصم رصيد" });
              toast(`الرصيد الآن ${r.balance}`); refresh();
            }, "sm")));
      }) : empty("لا توجد مدارس.")),
    panel("آخر الرسائل", null,
      d.recent.length ? d.recent.map((m) => line(
        h("div", {}, h("b", { class: "ltr" }, m.to_phone), " ", badge(...(STATUS[m.status] || [m.status, "gray"])),
          sub(`${m.tenant_id} — ${fmtDateTime(m.created_at)} — ${m.segments} جزء${m.error ? ` — ${m.error}` : ""}`)))) : empty("لا توجد رسائل بعد.")),
  ];
}
