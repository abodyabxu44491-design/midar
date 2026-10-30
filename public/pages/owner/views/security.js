/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The owner's security page: two-step verification state, the owner's sessions and devices (end every other
// session in one step), and the security alerts raised across the platform.
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, btn, empty, badge, sub, toast, notice, confirmAction, dialog, field, input, copyRow } from "/shared/js/ui.js";
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
      d.push.devices ? btn("إرسال إشعار تجريبي", async () => {
        try {
          const r = await api(`${API}/push/test`, {});
          toast(r.sent ? `أُرسل إلى ${r.sent} ${r.sent === 1 ? "جهاز" : "أجهزة"}. إن لم يظهر خلال دقيقة فأعد تفعيل الإشعارات على الجهاز.` : "لم يصل لأي جهاز. فعّل الإشعارات من جديد على جوالك.", !r.sent);
          refresh();
        } catch (e) { toast(e.message, true); }
      }, "ghost sm") : null,
      needsInstallFirst() ? notice("على الآيفون: ثبّت لوحة المالك على الشاشة الرئيسية من زر المشاركة، ثم افتحها من الأيقونة وفعّل الإشعارات.", "") : null),
    usagePanel(d.db_usage, refresh),
    panel("مفتاح التشفير", null,
      d.key_source === "CREDENTIAL_KEY"
        ? notice("المفتاح مثبّت في إعدادات الخادم (CREDENTIAL_KEY). إشعارات الجوال وبيانات الدخول المحفوظة لا تتأثر بتغيير رابط قاعدة البيانات.")
        : d.key_source === "derived"
          ? [notice("المفتاح الحالي مشتق من رابط قاعدة البيانات. إن تغيّر الرابط (مثل تغيير كلمة مرور القاعدة) تتوقف إشعارات الجوال حتى يفتح كل مستخدم التطبيق، ولا تُقرأ بيانات الدخول المحفوظة. ثبّته مرة واحدة الآن.", "warn"),
            btn("إظهار المفتاح لتثبيته", () => showKey(), "sm")]
          : notice("لا يوجد مفتاح تشفير: إشعارات الجوال متوقفة. أضف CREDENTIAL_KEY في إعدادات الخادم.", "err")),
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
// This month's database usage against the plan's limits (from Neon), with the pace toward the end of the month.
function usagePanel(u, refresh) {
  if (!u?.configured) {
    return panel("استهلاك قاعدة البيانات", null,
      notice("المراقبة غير مفعّلة. فعّلها لتعرف استهلاك الشهر ويصلك تنبيه على جوالك قبل بلوغ حد الخطة (70% ثم 85% ثم 95%)، فلا تتوقف المنصة فجأة.", "warn"),
      h("ol", { class: "sec-steps" },
        h("li", {}, "في Neon: Account settings ← API keys ← Create new API key، وانسخ المفتاح."),
        h("li", {}, "في Neon: افتح مشروعك ← Settings، وانسخ Project ID."),
        h("li", {}, "في Render: خدمة midar ← Environment ← أضف NEON_API_KEY و NEON_PROJECT_ID، ثم احفظ.")));
  }
  if (!u.ok) return panel("استهلاك قاعدة البيانات", btn("تحديث", async () => { await api(`${API}/db-usage`, {}).catch(() => {}); refresh(); }, "ghost sm"), notice(u.error, "err"));
  const tone = (x) => (Math.max(x.pct, x.projected) >= 95 ? "red" : Math.max(x.pct, x.projected) >= 70 ? "amber" : "green");
  return panel("استهلاك قاعدة البيانات", btn("تحديث", async () => { await api(`${API}/db-usage`, {}).catch(() => {}); refresh(); }, "ghost sm"),
    sub(`الشهر الحالي${u.period_start ? ` من ${fmtDateTime(u.period_start)}` : ""}${u.period_end ? ` إلى ${fmtDateTime(u.period_end)}` : ""} · آخر تحديث ${fmtDateTime(u.checked_at)}`),
    h("div", { class: "sec-rows" }, u.items.map((x) => h("div", { class: "sec-row" },
      h("div", { style: "flex:1" },
        h("b", {}, x.label), " ", badge(`${x.pct}%`, tone(x)),
        h("div", { class: "bar", style: "height:8px;border-radius:6px;background:var(--line, #e5e7eb);margin:8px 0;overflow:hidden" },
          h("span", { style: `display:block;height:100%;width:${Math.min(100, x.pct)}%;background:${tone(x) === "red" ? "#C0392B" : tone(x) === "amber" ? "#E6A23C" : "#12A39B"}` })),
        h("small", {}, `${x.used} من ${x.limit} ${x.unit}${x.key !== "storage" ? ` · المتوقع آخر الشهر بهذه الوتيرة ${x.projected}%` : ""}`))))),
    u.items.some((x) => Math.max(x.pct, x.projected) >= 85)
      ? notice("الاستهلاك قريب من حد الخطة. عند بلوغه تتوقف قاعدة البيانات وتدخل المنصة في الصيانة حتى بداية الشهر التالي أو ترقية الخطة في Neon.", "err") : null);
}

function showKey() {
  const code = input({ class: "ltr", inputMode: "numeric", autocomplete: "one-time-code", maxLength: 9, placeholder: "000000" });
  const d = dialog("تثبيت مفتاح التشفير", h("div", {},
    sub("للتأكيد اكتب الأرقام الستة الظاهرة الآن في تطبيق المصادقة."), field("الرمز من التطبيق", code)), [
    btn("إظهار", async () => {
      try {
        const r = await api(`${API}/credential-key`, { code: code.value.trim() });
        d.close();
        dialog("انسخه إلى إعدادات الخادم", h("div", {},
          notice("هذا المفتاح سري كأي كلمة مرور. لا ترسله لأحد ولا تحفظه مع نسخ قاعدة البيانات.", "warn"),
          copyRow("CREDENTIAL_KEY", r.key, { secret: true }),
          h("ol", { class: "sec-steps" },
            h("li", {}, "افتح Render ← خدمة midar ← Environment."),
            h("li", {}, "أضف متغيرًا جديدًا اسمه CREDENTIAL_KEY وقيمته المفتاح أعلاه، ثم احفظ."),
            h("li", {}, "بعد إعادة التشغيل يظهر هنا «المفتاح مثبّت». لا يتغير شيء على المستخدمين.")),
          sub("احفظ نسخة منه في مدير كلمات المرور كذلك.")));
      } catch (e) { toast(e.message, true); }
    })]);
  code.focus();
}

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
