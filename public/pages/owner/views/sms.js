/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, line, sub, toast, notice, switchBtn, passwordInput } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";

const API = "/api/owner/sms";
// Free option: an Android phone with a SIM runs the open-source "SMS Gateway for Android" app and sends the messages.
const ANDROID = { provider_name: "جوال أندرويد (SMS Gateway)", url: "https://api.sms-gate.app/3rdparty/v1/message", method: "POST", content_type: "json",
  body_template: '{"textMessage":{"text":"{message}"},"phoneNumbers":["+{to}"]}', sender: "", success_match: "" };
const basic = (u, p) => `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${u}:${p}`)))}`;
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
  const aUser = input({ class: "ltr", placeholder: "Username", autocomplete: "off" });
  const aPass = passwordInput({ placeholder: "Password", autocomplete: "new-password" });
  const isAndroid = g.url === ANDROID.url;
  return [
    panel("الطريقة الأسهل: جوال أندرويد", g.enabled && isAndroid ? badge("مفعّلة") : null,
      h("ol", { class: "gw-steps" },
        h("li", {}, "جهّز جوال أندرويد فيه شريحة برصيد رسائل، وثبّت عليه تطبيق «SMS Gateway for Android» من متجر Google Play."),
        h("li", {}, "افتح التطبيق، فعّل «Cloud server» ثم اضغط «Online». يظهر لك اسم مستخدم وكلمة مرور."),
        h("li", {}, "اكتبهما هنا واضغط «حفظ وتفعيل»، ثم جرّب من «رسالة تجريبية» بالأسفل."),
        h("li", {}, "اترك الجوال متصلًا بالإنترنت وعلى الشاحن.")),
      h("div", { class: "row" }, field("اسم المستخدم", aUser), field("كلمة المرور", aPass)),
      btn("حفظ وتفعيل", async () => {
        if (!aUser.value.trim() || !aPass.value) return toast("اكتب اسم المستخدم وكلمة المرور من التطبيق", true);
        try {
          await api(`${API}/gateway`, { ...ANDROID, enabled: true, headers: JSON.stringify({ Authorization: basic(aUser.value.trim(), aPass.value) }) }, "PUT");
          toast("فُعّلت الرسائل"); refresh();
        } catch (e) { toast(e.message, true); }
      })),
    panel("مزوّد رسائل آخر", null,
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
