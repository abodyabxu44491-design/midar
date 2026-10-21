/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The owner's security page: two-step verification state, the owner's sessions and devices (end every other
// session in one step), and the security alerts raised across the platform.
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, btn, empty, badge, sub, toast, notice, confirmAction } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";

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
