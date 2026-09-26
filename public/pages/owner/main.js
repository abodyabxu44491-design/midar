// لوحة مالك المنصة — نقطة البداية
import { $, mount, h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { topbar, footer, tabs, loginScreen, toast, showInstallBar } from "/shared/js/ui.js";
import overview from "./views/overview.js";
import schools from "./views/schools.js";
import create from "./views/create.js";
import audit from "./views/audit.js";
import plans from "./views/plans.js";
import subscriptions from "./views/subscriptions.js";
import requests from "./views/requests.js";
import passwordRequests from "./views/password-requests.js";
import settings from "./views/settings.js";
import billing from "./views/billing.js";

const app = $("#app");
export const API = "/api/owner";

async function start() {
  try {
    await api(`${API}/me`);
  } catch {
    const { totp } = await api(`${API}/config`).catch(() => ({ totp: false }));
    return mount(app, loginScreen({
      role: "لوحة مالك المنصة", endpoint: `${API}/login`, withSchool: false, withCode: totp, onSuccess: start,
      title: "بوابة مالك المنصة",
      subtitle: "إدارة المدارس والاشتراكات من مكان واحد",
      points: ["إنشاء المدارس والاشتراكات", "إدارة الباقات والفوترة", "المؤشرات العامة وسجل العمليات"],
    }));
  }
  const t = tabs([["overview", "المؤشرات"], ["requests", "الطلبات"], ["subscriptions", "الاشتراكات"], ["plans", "الباقات"],
    ["schools", "المدارس"], ["create", "إضافة مدرسة"], ["billing", "الفواتير"], ["passwords", "طلبات كلمات المرور"],
    ["settings", "إعدادات المنصة والتجربة"], ["audit", "سجل العمليات"]],
    { overview, requests, subscriptions, plans, schools, create, billing, passwords: passwordRequests, settings, audit }, {});
  // عدّاد «طلب جديد» على تبويب الطلبات، مع تنبيه عند وصول طلب جديد
  let lastUnseen = null;
  const badgeTick = async () => {
    try {
      const b = await api(`${API}/requests/badge`);
      const tab = t.el.querySelector('[data-k="requests"]');
      if (tab) tab.textContent = b.unseen ? `الطلبات (${b.unseen} جديد)` : "الطلبات";
      if (lastUnseen !== null && b.unseen > lastUnseen && b.latest) {
        const kinds = { trial: "طلبت تجربة مجانية", subscription: "طلبت اشتراكًا", feature: "طلبت ميزة", contact: "أرسلت رسالة تواصل", upgrade: "طلبت ترقية", renewal: "طلبت تجديدًا" };
        toast(`طلب جديد: ${b.latest.school} ${kinds[b.latest.kind] || ""}`);
      }
      lastUnseen = b.unseen;
    } catch { /* خارج الجلسة */ }
  };
  badgeTick();
  setInterval(badgeTick, 60000);
  document.addEventListener("owner-badge", badgeTick);
  mount(app,
    topbar({ subtitle: "لوحة مالك المنصة", onLogout: async () => { await api(`${API}/logout`, {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.show("overview");
}
start();
showInstallBar();
