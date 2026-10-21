/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The owner's security page: two-step verification state, the owner's sessions and devices (end every other
// session in one step), and the security alerts raised across the platform.
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, btn, empty, badge, sub, toast, notice, confirmAction, dialog, field, input } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";
import { pushToggle } from "/shared/js/inbox.js";
import { needsInstallFirst } from "/shared/js/push.js";

const API = "/api/owner/security";
const SEV = { high: ["مهم", "red"], medium: ["متوسط", "amber"], info: ["للعلم", "gray"] };
const device = (ua = "") => {
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "جهاز";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "متصفح";
  return `${br} على ${os}`;
};

export default async function security({ refresh }) {
  const d = await api(API);
  const others = d.sessions.filter((s) => !s.current).length;
  const unseen = d.alerts.filter((a) => !a.seen_at && a.severity !== "info");
  return [
    panel("حماية حساب المالك", null,
      d.mfa
        ? notice(`التحقق الثنائي مفعّل${d.mfa.source === "env" ? " (من إعدادات الخادم)" : d.mfa.enrolled_at ? ` منذ ${fmtDateTime(d.mfa.enrolled_at)}` : ""}. لا يُفتح الحساب إلا بكلمة المرور والرمز من تطبيق المصادقة.`, "")
        : notice("التحقق الثنائي غير مفعّل.", "err"),
      h("ul", { class: "sec-list" },
        h("li", {}, d.ip_allowlist ? "الدخول مقصور على عناوين محددة (OWNER_ALLOWED_IPS)." : "الدخول متاح من أي عنوان. لتقييده أضف OWNER_ALLOWED_IPS في إعدادات الخادم."),
        h("li", {}, d.alert_email ? "التنبيهات المهمة تُرسل إلى بريدك أيضًا." : "لإرسال التنبيهات المهمة إلى بريدك أضف OWNER_ALERT_EMAIL في إعدادات الخادم."),
        h("li", {}, "أي دخول من جهاز جديد يظهر هنا كتنبيه مهم."))),
    panel("الإشعارات على الجوال", null,
      sub("تصلك التنبيهات الأمنية المهمة والطلبات الجديدة على هذا الجهاز فورًا، حتى ولوحة المالك مغلقة."),
      d.push.devices ? sub(`مفعّلة على ${d.push.devices === 1 ? "جهاز واحد" : `${d.push.devices} أجهزة`}.`) : null,
      pushToggle({ key: d.push.key, save: (s) => api(`${API}/push`, s), remove: (endpoint) => api(`${API}/push/remove`, { endpoint }) }),
      needsInstallFirst() ? notice("على الآيفون: ثبّت لوحة المالك على الشاشة الرئيسية من زر المشاركة، ثم افتحها من الأيقونة وفعّل الإشعارات.", "") : null),
    panel("الرموز الاحتياطية", null,
      sub("للدخول عندما لا يكون جوال تطبيق المصادقة معك: اكتب رمزًا منها بدل الأرقام الستة. كل رمز يعمل مرة واحدة."),
      d.recovery_left
        ? notice(`باقي ${d.recovery_left} من 10 رموز.${d.recovery_left <= 3 ? " أنشئ رموزًا جديدة قريبًا." : ""}`, d.recovery_left <= 3 ? "warn" : "")
        : notice("لا توجد رموز احتياطية. أنشئها الآن واحفظها في مكان آمن.", "warn"),
      btn("إنشاء رموز احتياطية جديدة", () => newCodes(refresh), "sm")),
    panel(`الجلسات المفتوحة (${d.sessions.length})`,
      others ? btn("إنهاء كل الجلسات الأخرى", async () => {
        if (!(await confirmAction(`إنهاء ${others} جلسة أخرى للوحة المالك؟ تبقى هذه الجلسة فقط.`))) return;
        try { const r = await api(`${API}/sessions/end-others`, {}); toast(`أُنهيت ${r.ended} جلسة`); refresh(); } catch (e) { toast(e.message, true); }
      }, "danger sm") : null,
      h("div", { class: "sec-rows" }, d.sessions.map((s) => h("div", { class: "sec-row" },
        h("div", {}, h("b", {}, device(s.user_agent)), s.current ? [" ", badge("هذا الجهاز", "green")] : null,
          h("small", {}, `العنوان ${s.ip || "—"} · بدأت ${fmtDateTime(s.created_at)} · آخر نشاط ${fmtDateTime(s.last_seen_at)}`))))),
      d.devices.length ? [h("h3", {}, "الأجهزة المعروفة"), h("div", { class: "sec-rows" }, d.devices.map((v) => h("div", { class: "sec-row" },
        h("div", {}, h("b", {}, v.label || "جهاز"), h("small", {}, `أول دخول ${fmtDateTime(v.first_seen_at)} · آخر دخول ${fmtDateTime(v.last_seen_at)}`)))))] : null),
    panel(`التنبيهات الأمنية${unseen.length ? ` (${unseen.length} جديدة)` : ""}`,
      unseen.length ? btn("تعليم الكل كمقروء", async () => {
        await api(`${API}/alerts/seen`, {}); document.dispatchEvent(new Event("owner-security")); refresh();
      }, "ghost sm") : null,
      sub("محاولات الدخول الفاشلة المتكررة، الطلبات المرفوضة المتكررة، الحذف الكبير، تصدير بيانات مدرسة كاملة، والدخول من جهاز جديد."),
      d.alerts.length ? h("div", { class: "sec-rows" }, d.alerts.map((a) => h("div", { class: `sec-row${a.seen_at ? "" : " unseen"}` },
        h("div", {}, badge(...(SEV[a.severity] || SEV.info)), " ", h("b", {}, a.title),
          a.detail ? h("p", {}, a.detail) : null,
          h("small", {}, [fmtDateTime(a.created_at), a.school || a.tenant_id ? `المدرسة: ${a.school || a.tenant_id}` : null].filter(Boolean).join(" · "))))))
        : empty("لا توجد تنبيهات أمنية.")),
  ];
}

// A new set replaces the old one; confirmed with the current code from the authenticator app.
function newCodes(refresh) {
  const code = input({ class: "ltr", inputMode: "numeric", autocomplete: "one-time-code", maxLength: 9, placeholder: "000000" });
  const d = dialog("رموز احتياطية جديدة", h("div", {},
    sub("الرموز القديمة تتوقف عن العمل. للتأكيد اكتب الأرقام الستة الظاهرة الآن في تطبيق المصادقة."), field("الرمز من التطبيق", code)), [
    btn("إنشاء", async () => {
      try {
        const r = await api(`${API}/recovery-codes`, { code: code.value.trim() });
        d.close(); refresh();
        const text = ["رموز الدخول الاحتياطية — لوحة مالك مدار", ...r.recovery_codes].join("\n");
        dialog("رموزك الاحتياطية", h("div", {},
          notice("احفظها الآن في مكان آمن (اطبعها أو احفظها في ملاحظات محمية). لن تظهر مرة أخرى.", "warn"),
          h("ol", { class: "mfa-codes ltr" }, r.recovery_codes.map((c) => h("li", {}, h("code", {}, c))))), [
          btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("نُسخت الرموز"); }, "ghost"),
          btn("طباعة", () => window.print(), "ghost")]);
      } catch (e) { toast(e.message, true); }
    })]);
}
