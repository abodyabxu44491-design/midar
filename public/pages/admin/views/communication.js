// التواصل: الإشعارات (لكل حدث: إشعار فوري و/أو رسالة نصية و/أو واتساب)، والرسائل النصية (بوابة المدرسة المجانية
// أو رصيد المنصة)، وقائمة واتساب للإرسال المتتابع، والاستبيانات ومواعيد أولياء الأمور.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, textarea, btn, empty, badge, line, sub, stats, toast, notice, switchBtn, confirmAction, input, passwordInput } from "../../shared/js/ui.js";
import { fmtDateTime } from "../../shared/js/format.js";
import { partsView } from "../../shared/js/parts.js";
import { pushToggle } from "../../shared/js/inbox.js";
import { A } from "./common.js";

const AUD = { parent: "أولياء الأمور", staff: "المنسوبون", both: "الجميع" };
const SMS_STATUS = { queued: ["قيد الإرسال", "amber"], sent: ["أُرسلت", ""], failed: ["فشلت (أُعيد الرصيد)", "red"], no_credit: ["لم تُرسل: لا رصيد", "gray"], disabled: ["المزوّد غير مهيأ", "gray"] };

export default async function communication({ me }) {
  const mods = me.modules || {};
  const parts = [];
  if (mods.notifications || mods.sms) parts.push(["notify", "الإشعارات"]);
  if (mods.messaging) parts.push(["wa", "واتساب"]);
  if (mods.sms) parts.push(["sms", "الرسائل النصية"]);
  if (mods.surveys) parts.push(["surveys", "الاستبيانات"]);
  if (mods.meetings) parts.push(["meetings", "مواعيد أولياء الأمور"]);
  if (!parts.length) return notice("أقسام التواصل موقوفة. شغّلها من «الإعدادات ← أقسام المنصة».", "warn");
  return partsView(parts, async (part, nav) => {
    if (part === "notify") return notifyRules(me);
    if (part === "sms") return smsView(nav);
    if (part === "wa") return (await import("./whatsapp-queue.js")).default({ nav });
    if (part === "surveys") return (await import("./surveys.js")).default({ me, nav });
    if (part === "meetings") return (await import("./meetings.js")).default({ me, nav });
  });
}

async function notifyRules(me) {
  const d = await api(`${A}/communication/notify`);
  const msg = h("div");
  const save = async (key, kind, value) => {
    try { Object.assign(d.rules, await api(`${A}/communication/notify`, { [key]: { [kind]: value } }, "PUT")); toast("تم الحفظ"); return true; }
    catch (e) { toast(e.message, true); return false; }
  };
  const showSms = d.modules.sms;
  const showPush = d.modules.notifications;
  const showWa = d.modules.whatsapp;
  return [
    panel("كيف تصل الإشعارات", null,
      stats([["أجهزة أولياء الأمور", d.devices.parents], ["أجهزة المنسوبين", d.devices.staff],
        showSms ? ["الرسائل النصية", d.sms_ready ? "جاهزة" : "غير مهيأة"] : null]),
      sub("ولي الأمر يفعّل الإشعارات من ملف ابنه بعد تثبيت التطبيق، وتصله فورًا حتى والتطبيق مغلق. كل إشعار يبقى أيضًا في صندوق الإشعارات داخل ملف الطالب."),
      !d.push_ready && showPush ? notice("الإشعارات الفورية غير مهيأة على الخادم بعد. تبقى الإشعارات داخل المنصة.", "warn") : null,
      showPush ? pushToggle({ key: d.push_ready ? (await api(`${A}/notifications`)).push.key : null,
        save: (s) => api(`${A}/notifications/push`, s), remove: (e) => api(`${A}/notifications/push/remove`, { endpoint: e }), label: "إشعارات الإدارة على هذا الجهاز" }) : null,
      showPush ? h("div", { class: "spaced" }, btn("إرسال إشعار تجريبي لي", async () => { await api(`${A}/communication/notify/test`, {}); toast("أُرسل. إن لم يصل، تأكد أن الإشعارات مفعّلة على هذا الجهاز."); }, "ghost sm")) : null),
    panel("متى يُرسل الإشعار", null,
      sub(["اختر لكل حدث كيف يصل:", showPush ? "إشعار فوري (مجاني)" : null, showWa ? "واتساب (مجاني: يُضاف لقائمة الإرسال وترسله من جوالك)" : null,
        showSms ? "رسالة نصية (مجانية عبر جوال المدرسة، أو من رصيد المنصة)" : null].filter(Boolean).join(" ")),
      h("div", { style: "overflow-x:auto" }, h("table", { class: "rules-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "الحدث"), h("th", {}, "يصل إلى"), showPush ? h("th", { class: "c" }, "إشعار فوري") : null, showWa ? h("th", { class: "c" }, "واتساب") : null, showSms ? h("th", { class: "c" }, "رسالة نصية") : null)),
        h("tbody", {}, d.events.map((e) => h("tr", {},
          h("td", {}, e.name), h("td", {}, h("small", { class: "muted" }, AUD[e.audience])),
          showPush ? h("td", { class: "c" }, switchBtn(d.rules[e.key].push, `${e.name}: إشعار فوري`, (v) => save(e.key, "push", v))) : null,
          showWa ? h("td", { class: "c" }, e.audience === "staff" ? h("small", { class: "muted" }, "—")
            : switchBtn(d.rules[e.key].wa, `${e.name}: واتساب`, (v) => save(e.key, "wa", v))) : null,
          showSms ? h("td", { class: "c" }, e.audience === "staff" ? h("small", { class: "muted" }, "—")
            : switchBtn(d.rules[e.key].sms, `${e.name}: رسالة نصية`, (v) => save(e.key, "sms", v))) : null))))),
      msg),
  ];
}

async function smsView(nav) {
  const d = await api(`${A}/communication/sms`);
  const [structure] = await Promise.all([api(`${A}/structure/classes`).catch(() => [])]);
  const target = select([["all", "كل أولياء الأمور"], ["class", "شعبة محددة"]]);
  const cls = select(structure.map((c) => [c.id, c.name]));
  const clsField = field("الشعبة", cls);
  clsField.hidden = true;
  target.addEventListener("change", () => { clsField.hidden = target.value !== "class"; preview(); });
  cls.addEventListener("change", () => preview());
  const text = textarea({ rows: 3, maxLength: 600, placeholder: "نص الرسالة" });
  const est = h("div", { class: "sub" });
  let timer;
  const body = () => ({ target: target.value, class_id: target.value === "class" ? Number(cls.value) : undefined, message: text.value.trim() });
  const preview = async () => {
    if (text.value.trim().length < 2) return mount(est);
    try {
      const p = await api(`${A}/communication/sms/send`, { ...body(), dry_run: true });
      mount(est, `${p.recipients} ولي أمر — ${p.segments === 1 ? "رسالة واحدة" : `${p.segments} أجزاء`} لكل واحد — ${p.own ? "مجانًا عبر جوال المدرسة" : `التكلفة ${p.cost} من رصيدك (${p.balance})`}`);
    } catch (e) { mount(est, e.message); }
  };
  text.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(preview, 400); });
  return [
    await schoolGateway(nav, d.own),
    d.own ? null : panel("رصيد رسائل المنصة", null,
      stats([["الرصيد المتبقي", d.balance], ["المرسلة (آخر 200)", d.messages.filter((m) => m.status === "sent").length]]),
      !d.ready ? notice("لا توجد بوابة رسائل بعد. اربط جوال المدرسة أعلاه لترسل مجانًا من شريحتها.", "warn") : null,
      sub("الرصيد يخص بوابة المنصة فقط. الرسالة العربية حتى 70 حرفًا = رسالة واحدة.")),
    panel("إرسال رسالة نصية", null,
      h("div", { class: "row" }, field("إلى", target), clsField),
      field("الرسالة", text), est,
      btn("إرسال", async () => {
        const b = body();
        if (b.message.length < 2) return toast("اكتب نص الرسالة", true);
        if (!(await confirmAction(d.own ? "إرسال الرسالة الآن من جوال المدرسة؟" : "إرسال الرسالة الآن؟ تُخصم من رصيد الرسائل."))) return;
        const r = await api(`${A}/communication/sms/send`, b);
        toast(`جارٍ إرسال ${r.queued} رسالة`);
        text.value = ""; mount(est); nav.show();
      })),
    panel("سجل الرسائل", null,
      d.messages.length ? d.messages.map((m) => line(
        h("div", {}, h("b", {}, m.student || h("span", { class: "ltr" }, m.to_phone)), " ", badge(...(SMS_STATUS[m.status] || [m.status, "gray"])),
          sub(m.body), sub(`${fmtDateTime(m.created_at)} — ${m.segments} جزء — ${m.via === "school" ? "جوال المدرسة" : "بوابة المنصة"}${m.error ? ` — ${m.error}` : ""}`)))) : empty("لم تُرسل رسائل بعد.")),
  ];
}

/* بوابة المدرسة: جوال أندرويد بشريحة المدرسة يرسل الرسائل (تكلفتها على باقة الشريحة فقط) */
async function schoolGateway(nav, active) {
  const d = await api(`${A}/communication/sms/gateway`);
  const g = d.gateway;
  const preset = select([["android", "جوال أندرويد بشريحة المدرسة"], ["custom", "مزوّد رسائل خاص بالمدرسة"]], { value: g.preset || "android" });
  const user = input({ placeholder: "Username", autocomplete: "off", dir: "ltr" });
  const pass = passwordInput({ placeholder: g.has_auth ? "محفوظة — اكتب للتغيير" : "Password", autocomplete: "new-password" });
  const custom = {
    url: input({ value: g.preset === "custom" ? g.url || "" : "", placeholder: "https://…", dir: "ltr" }),
    method: select([["POST", "POST"], ["GET", "GET"]], { value: g.method || "POST" }),
    content_type: select([["json", "JSON"], ["form", "Form"]], { value: g.content_type || "json" }),
    body_template: textarea({ rows: 3, dir: "ltr", value: g.preset === "custom" ? g.body_template || "" : "", placeholder: '{"to":"{to}","text":"{message}"}' }),
    headers: textarea({ rows: 2, dir: "ltr", placeholder: g.has_auth ? "محفوظة — اكتب JSON جديدًا للتغيير، أو - للحذف" : '{"Authorization":"Bearer …"}' }),
    sender: input({ value: g.sender || "", maxLength: 20 }),
    success_match: input({ value: g.success_match || "", maxLength: 100, dir: "ltr" }),
  };
  let enabled = Boolean(g.enabled);
  const androidBox = h("div", {},
    h("ol", { class: "gw-steps" },
      h("li", {}, "على جوال أندرويد فيه شريحة المدرسة، ثبّت تطبيق «SMS Gateway for Android» المجاني مفتوح المصدر."),
      h("li", {}, "افتح التطبيق وشغّل «Cloud server» واضغط «Online»، وأبقِ الجوال متصلًا بالإنترنت وبالشاحن."),
      h("li", {}, "انسخ اسم المستخدم وكلمة المرور الظاهرين في التطبيق إلى الحقلين هنا، ثم احفظ وجرّب.")),
    h("div", { class: "row" }, field("اسم المستخدم", user), field("كلمة المرور", pass)),
    sub("الرسائل تُرسل من شريحة المدرسة، وتكلفتها على باقة الشريحة فقط. لا رصيد ولا رسوم من المنصة."));
  const customBox = h("div", {},
    field("رابط الإرسال", custom.url),
    h("div", { class: "row" }, field("الطريقة", custom.method), field("الصيغة", custom.content_type), field("اسم المرسل", custom.sender)),
    field("قالب الطلب", custom.body_template, "استخدم {to} للرقم و{message} للنص و{sender} لاسم المرسل"),
    field("الترويسات (المفتاح السري)", custom.headers, "تُحفظ مشفّرة ولا تظهر بعد الحفظ"),
    field("علامة النجاح في الرد (اختياري)", custom.success_match));
  const swap = () => { androidBox.hidden = preset.value !== "android"; customBox.hidden = preset.value !== "custom"; };
  preset.addEventListener("change", swap); swap();
  const testTo = input({ placeholder: "967771234567", dir: "ltr", inputmode: "numeric" });
  const save = async () => {
    const b = { enabled, preset: preset.value };
    if (preset.value === "android") { if (user.value.trim() || pass.value) Object.assign(b, { username: user.value.trim(), password: pass.value }); }
    else Object.assign(b, { url: custom.url.value.trim(), method: custom.method.value, content_type: custom.content_type.value,
      body_template: custom.body_template.value, sender: custom.sender.value.trim(), success_match: custom.success_match.value, headers: custom.headers.value.trim() || undefined });
    try { await api(`${A}/communication/sms/gateway`, b, "PUT"); toast("تم حفظ البوابة"); nav.show(); } catch (e) { toast(e.message, true); }
  };
  return panel("بوابة المدرسة — رسائل مجانية من شريحتها", active ? badge("مفعّلة", "ok") : badge("غير مفعّلة", "gray"),
    sub("حوّل أي جوال أندرويد إلى بوابة رسائل: كل الرسائل التلقائية واليدوية تُرسل من شريحة المدرسة بلا رصيد ولا تكلفة من المنصة."),
    !d.can_store ? notice("حفظ بيانات الدخول غير متاح على الخادم بعد (مفتاح التشفير غير مضبوط).", "warn") : null,
    field("نوع البوابة", preset), androidBox, customBox,
    h("div", { class: "row spaced" }, h("div", { class: "sw-line" }, switchBtn(enabled, "تفعيل البوابة", (v) => { enabled = v; return true; }), h("span", {}, "تفعيل البوابة")), btn("حفظ", save, "primary")),
    active ? h("div", { class: "row" }, field("رسالة تجريبية إلى", testTo),
      btn("إرسال تجربة", async () => {
        try { await api(`${A}/communication/sms/gateway/test`, { to: testTo.value.trim(), message: "رسالة تجريبية من مدار: بوابة المدرسة تعمل." }); toast("أُرسلت التجربة"); }
        catch (e) { toast(e.message, true); }
      }, "ghost")) : null);
}
