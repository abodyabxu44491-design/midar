// التواصل: الإشعارات (لكل حدث: إشعار فوري و/أو رسالة نصية)، والرسائل النصية (الرصيد والإرسال والسجل)،
// والاستبيانات ومواعيد أولياء الأمور.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, textarea, btn, empty, badge, line, sub, stats, toast, notice, switchBtn, confirmAction } from "../../shared/js/ui.js";
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
  if (mods.sms) parts.push(["sms", "الرسائل النصية"]);
  if (mods.surveys) parts.push(["surveys", "الاستبيانات"]);
  if (mods.meetings) parts.push(["meetings", "مواعيد أولياء الأمور"]);
  if (!parts.length) return notice("أقسام التواصل موقوفة. شغّلها من «الإعدادات ← أقسام المنصة».", "warn");
  return partsView(parts, async (part, nav) => {
    if (part === "notify") return notifyRules(me);
    if (part === "sms") return smsView(nav);
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
      sub(showSms ? "اختر لكل حدث: إشعار فوري (مجاني)، ورسالة نصية (تخصم من رصيد الرسائل)." : "اختر الأحداث التي يصل عنها إشعار فوري."),
      h("div", { style: "overflow-x:auto" }, h("table", { class: "rules-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "الحدث"), h("th", {}, "يصل إلى"), showPush ? h("th", { class: "c" }, "إشعار فوري") : null, showSms ? h("th", { class: "c" }, "رسالة نصية") : null)),
        h("tbody", {}, d.events.map((e) => h("tr", {},
          h("td", {}, e.name), h("td", {}, h("small", { class: "muted" }, AUD[e.audience])),
          showPush ? h("td", { class: "c" }, switchBtn(d.rules[e.key].push, `${e.name}: إشعار فوري`, (v) => save(e.key, "push", v))) : null,
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
      mount(est, `${p.recipients} ولي أمر — ${p.segments === 1 ? "رسالة واحدة" : `${p.segments} أجزاء`} لكل واحد — التكلفة ${p.cost} من رصيدك (${p.balance})`);
    } catch (e) { mount(est, e.message); }
  };
  text.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(preview, 400); });
  return [
    panel("رصيد الرسائل", null,
      stats([["الرصيد المتبقي", d.balance], ["المرسلة (آخر 200)", d.messages.filter((m) => m.status === "sent").length]]),
      !d.ready ? notice("مزوّد الرسائل لم يُضبط بعد من إدارة المنصة. يمكنك ضبط الأحداث الآن، وتبدأ الرسائل بعد تفعيله.", "warn") : null,
      sub("لزيادة الرصيد تواصل مع إدارة المنصة من «اشتراكي». الرسالة العربية حتى 70 حرفًا = رسالة واحدة.")),
    panel("إرسال رسالة نصية", null,
      h("div", { class: "row" }, field("إلى", target), clsField),
      field("الرسالة", text), est,
      btn("إرسال", async () => {
        const b = body();
        if (b.message.length < 2) return toast("اكتب نص الرسالة", true);
        if (!confirmAction("إرسال الرسالة الآن؟ تُخصم من رصيد الرسائل.")) return;
        const r = await api(`${A}/communication/sms/send`, b);
        toast(`جارٍ إرسال ${r.queued} رسالة`);
        text.value = ""; mount(est); nav.show();
      })),
    panel("سجل الرسائل", null,
      d.messages.length ? d.messages.map((m) => line(
        h("div", {}, h("b", {}, m.student || h("span", { class: "ltr" }, m.to_phone)), " ", badge(...(SMS_STATUS[m.status] || [m.status, "gray"])),
          sub(m.body), sub(`${fmtDateTime(m.created_at)} — ${m.segments} جزء${m.error ? ` — ${m.error}` : ""}`)))) : empty("لم تُرسل رسائل بعد.")),
  ];
}
