/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { $, mount, h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { topbar, footer, tabs, loginScreen, toast, chime, panel, sub, field, input, btn, notice, keyText } from "/shared/js/ui.js";
import overview from "./views/overview.js";
import schools from "./views/schools.js";
import create from "./views/create.js";
import audit from "./views/audit.js";
import plans from "./views/plans.js";
import subscriptions from "./views/subscriptions.js";
import requests from "./views/requests.js";
import passwordRequests from "./views/password-requests.js";
import settings from "./views/settings.js";
import testimonials from "./views/testimonials.js";
import groups from "./views/groups.js";
import billing from "./views/billing.js";
import danger from "./views/danger.js";
import sms from "./views/sms.js";
import signin from "./views/signin.js";
import security from "./views/security.js";

const app = $("#app");
export const API = "/api/owner";

// Two-step verification is required for the owner panel. Until it is set up, a correct password leads here: scan the
// code in an authenticator app (Google Authenticator, Microsoft Authenticator...) and enter the six digits it shows.
function enrollMfa(r, { remember } = {}) {
  const code = input({ class: "ltr", inputMode: "numeric", autocomplete: "one-time-code", maxLength: 6, placeholder: "000000" });
  const msg = h("div");
  const go = btn("تفعيل والدخول", async () => {
    mount(msg);
    try { await api(`${API}/enroll`, { ticket: r.ticket, code: code.value.trim(), remember: Boolean(remember) }); start(); }
    catch (e) { mount(msg, notice(e.message, "err")); }
  }, "wide");
  code.addEventListener("keydown", (e) => e.key === "Enter" && go.click());
  mount(app, h("main", { class: "mfa-enroll" }, panel("تفعيل التحقق الثنائي للوحة المالك", null,
    notice("لحماية المنصة، لا يُفتح حساب المالك بكلمة المرور وحدها. فعّل التحقق الثنائي مرة واحدة الآن، وبعدها يُطلب الرمز مع كل دخول.", "warn"),
    h("ol", { class: "mfa-steps" },
      h("li", {}, "ثبّت تطبيق Google Authenticator أو Microsoft Authenticator على جوالك."),
      h("li", {}, "اضغط «+» في التطبيق وامسح هذا الرمز."),
      h("li", {}, "اكتب الرقم المكوّن من 6 أرقام الظاهر في التطبيق.")),
    h("div", { class: "mfa-qr" }, h("img", { src: r.qr, alt: "رمز التفعيل" })),
    sub("لا تستطيع المسح؟ أدخل هذا المفتاح يدويًا في التطبيق:"), keyText(r.secret),
    field("الرمز من التطبيق", code), msg, go,
    sub(`المهلة ${r.minutes} دقائق. احتفظ بالجوال في مكان آمن؛ فقدانه يتطلب إعادة ضبط التحقق من الخادم.`))));
  code.focus();
}

async function start() {
  try {
    await api(`${API}/me`);
  } catch {
    const { totp } = await api(`${API}/config`).catch(() => ({ totp: false }));
    return mount(app, loginScreen({
      role: "لوحة مالك المنصة", endpoint: `${API}/login`, withSchool: false, withCode: totp,
      onSuccess: (r, o) => (r?.enroll ? enrollMfa(r, o) : start()),
      title: "بوابة مالك المنصة",
      subtitle: "إدارة المدارس والاشتراكات من مكان واحد",
      points: ["إنشاء المدارس والاشتراكات", "إدارة الباقات والفوترة", "المؤشرات العامة وسجل العمليات"],
    }));
  }
  const ownerCtx = {};
  const t = tabs([["overview", "المؤشرات"], ["requests", "الطلبات"],
    [null, "المدارس والاشتراكات"], ["schools", "ملفات المدارس"], ["create", "إضافة مدرسة"], ["groups", "مجموعات المدارس"], ["subscriptions", "الاشتراكات"], ["plans", "الباقات"], ["billing", "الفواتير"],
    [null, "الدعم والتواصل"], ["passwords", "طلبات كلمات المرور"], ["sms", "الرسائل النصية"],
    [null, "المنصة"], ["security", "الأمان"], ["signin", "الدخول والبريد"], ["settings", "إعدادات المنصة والتجربة"], ["testimonials", "آراء العملاء"], ["audit", "سجل العمليات"], ["danger", "منطقة الحذر"]],
    { overview, requests, subscriptions, plans, schools, create, groups, billing, passwords: passwordRequests, sms, security, signin, settings, testimonials, audit, danger }, ownerCtx,
    { primary: ["overview", "requests", "schools", "subscriptions"] });
  ownerCtx.go = (k) => t.show(k);
  let lastUnseen = null;
  const badgeTick = async () => {
    try {
      const b = await api(`${API}/requests/badge`);
      t.setBadge("requests", b.unseen);
      if (lastUnseen !== null && b.unseen > lastUnseen && b.latest) {
        const kinds = { trial: "طلبت تجربة مجانية", subscription: "طلبت اشتراكًا", feature: "طلبت ميزة", contact: "أرسلت رسالة تواصل", upgrade: "طلبت ترقية", renewal: "طلبت تجديدًا" };
        toast(`طلب جديد: ${b.latest.school} ${kinds[b.latest.kind] || ""}`);
        chime();
      }
      lastUnseen = b.unseen;
    } catch { /* ignore */ }
  };
  let lastHigh = null;
  const securityTick = async () => {
    try {
      const b = await api(`${API}/security/badge`);
      t.setBadge("security", b.unseen);
      if (lastHigh !== null && b.latest_high && b.latest_high !== lastHigh) { toast("تنبيه أمني جديد — راجع «الأمان»", true); chime(); }
      lastHigh = b.latest_high || lastHigh || 0;
    } catch { /* ignore */ }
  };
  document.addEventListener("owner-security", securityTick);
  badgeTick(); securityTick();
  setInterval(() => { badgeTick(); securityTick(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) badgeTick(); });
  document.addEventListener("owner-badge", badgeTick);
  mount(app,
    topbar({ subtitle: "لوحة مالك المنصة", onLogout: async () => { await api(`${API}/logout`, {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.start("overview");
}
start();
document.documentElement.dataset.app = "لوحة المالك";
