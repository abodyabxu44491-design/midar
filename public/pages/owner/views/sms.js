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
// Ready setups: the owner types two or three values from the provider's dashboard; the request format is filled in here.
const enc = encodeURIComponent;
const PROVIDERS = {
  twilio: { key: "twilio", name: "Twilio", tag: "عالمي · الأسرع إعدادًا", urlPrefix: "https://api.twilio.com/",
    steps: ["أنشئ حسابًا في twilio.com وفعّله بإضافة رصيد (الدفع بالبطاقة).", "من Console انسخ «Account SID» و«Auth Token».",
      "من Messaging أنشئ «Messaging Service» وانسخ رقمها (يبدأ بـ MG)، أو اشترِ رقمًا واكتبه بالصيغة الدولية.",
      "الصق القيم هنا واضغط «حفظ وتفعيل»، ثم جرّب برقمك."],
    fields: [["sid", "Account SID", "AC…"], ["token", "Auth Token", "••••", true], ["from", "Messaging Service SID أو رقم المرسل", "MG… أو +1…"]],
    build: (v) => ({ provider_name: "Twilio", url: `https://api.twilio.com/2010-04-01/Accounts/${enc(v.sid)}/Messages.json`, method: "POST", content_type: "form",
      body_template: `To=%2B{to}&${v.from.startsWith("MG") ? "MessagingServiceSid" : "From"}=${enc(v.from)}&Body={message}`, sender: "", success_match: "",
      headers: JSON.stringify({ Authorization: basic(v.sid, v.token) }) }) },
  unifonic: { key: "unifonic", name: "Unifonic", tag: "الشرق الأوسط · اسم مرسل عربي", urlPrefix: "https://el.cloud.unifonic.com/",
    steps: ["أنشئ حسابًا في unifonic.com واشحن الرصيد.", "سجّل اسم المرسل (Sender ID) واعتمده من حسابك.",
      "من لوحة المطورين أنشئ تطبيق SMS وانسخ «AppSid».", "الصق القيم هنا واضغط «حفظ وتفعيل»، ثم جرّب برقمك."],
    fields: [["appsid", "AppSid", "", true], ["sender", "اسم المرسل المعتمد", "MIDAR"]],
    build: (v) => ({ provider_name: "Unifonic", url: "https://el.cloud.unifonic.com/rest/SMS/messages", method: "POST", content_type: "form",
      body_template: `AppSid=${enc(v.appsid)}&SenderID=${enc(v.sender)}&Recipient={to}&Body={message}`, sender: "", success_match: '"success":true', headers: "-" }) },
  android: { key: "android", name: "جوال أندرويد", tag: "مجاني من شريحتك", urlPrefix: "https://api.sms-gate.app/",
    steps: ["ثبّت «SMS Gateway for Android» على جوال فيه شريحة برصيد رسائل.", "فعّل «Cloud server» واضغط «Online» وانسخ اسم المستخدم وكلمة المرور.",
      "اتركه متصلًا وعلى الشاحن؛ سرعة الوصول تعتمد على الجوال."],
    fields: [["user", "اسم المستخدم", ""], ["pass", "كلمة المرور", "", true]],
    build: (v) => ({ ...ANDROID, headers: JSON.stringify({ Authorization: basic(v.user, v.pass) }) }) },
};
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
  const providerBox = h("div");
  const current = Object.values(PROVIDERS).find((x) => g.url && g.url.startsWith(x.urlPrefix));
  let pick = current?.key || "twilio";
  const drawProvider = () => {
    const P = PROVIDERS[pick];
    const inputs = Object.fromEntries(P.fields.map(([k, label, ph, secret]) => [k, secret ? passwordInput({ placeholder: ph, autocomplete: "new-password" })
      : input({ class: "ltr", placeholder: ph, autocomplete: "off" })]));
    mount(providerBox,
      h("div", { class: "sms-pick", role: "radiogroup" }, Object.values(PROVIDERS).map((x) => h("button", { type: "button", role: "radio", "aria-checked": String(x.key === pick),
        class: `sms-opt${x.key === pick ? " on" : ""}`, onclick: () => { pick = x.key; drawProvider(); } },
        h("b", {}, x.name), h("small", {}, x.tag), current?.key === x.key && g.enabled ? badge("مفعّل") : null))),
      h("ol", { class: "gw-steps" }, P.steps.map((t) => h("li", {}, t))),
      h("div", { class: "row" }, P.fields.map(([k, label]) => field(label, inputs[k]))),
      btn("حفظ وتفعيل", async () => {
        const v = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
        const missing = P.fields.find(([k]) => !v[k]);
        if (missing) return toast(`اكتب: ${missing[1]}`, true);
        try { await api(`${API}/gateway`, { ...P.build(v), enabled: true }, "PUT"); toast("فُعّلت الرسائل. جرّب بالإرسال لرقمك من الأسفل."); refresh(); }
        catch (e) { toast(e.message, true); }
      }));
  };
  drawProvider();
  return [
    panel("مزوّد الرسائل النصية", g.enabled ? badge(current ? `مفعّل: ${current.name}` : "مفعّل") : badge("غير مفعّل", "gray"),
      sub("منه تصل رموز التحقق لمدراء المدارس والمعاهد، وكل رسائل المنصة النصية."),
      !d.can_store_secret ? notice("مفتاح التشفير غير مضبوط على الخادم: لا يمكن حفظ مفاتيح المزوّد.", "warn") : null,
      providerBox),
    panel("رسالة تجريبية", null,
      h("div", { class: "row" }, field("إلى (الرقم دوليًا بدون +)", testTo), field("النص", testMsg)),
      btn("إرسال", async () => { try { await api(`${API}/test`, { to: testTo.value.trim(), message: testMsg.value }); toast("أُرسلت"); } catch (e) { toast(e.message, true); } }, "ghost")),
    h("details", { class: "sms-adv" }, h("summary", {}, "إعدادات متقدمة (مزوّد آخر يدويًا)"),
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
      }))),
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
