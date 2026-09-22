// لوحة مالك المنصة — نقطة البداية
import { $, mount, h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { topbar, footer, tabs, loginScreen , showInstallBar} from "/shared/js/ui.js";
import overview from "./views/overview.js";
import schools from "./views/schools.js";
import create from "./views/create.js";
import audit from "./views/audit.js";
import leads from "./views/leads.js";
import renewals from "./views/renewals.js";
import settings from "./views/settings.js";
import billing from "./views/billing.js";

const app = $("#app");
export const API = "/api/owner";

async function start() {
  try {
    await api(`${API}/me`);
  } catch {
    const { totp } = await api(`${API}/config`).catch(() => ({ totp: false }));
    return mount(app, loginScreen({ role: "لوحة مالك المنصة", endpoint: `${API}/login`, withSchool: false, withCode: totp, onSuccess: start }));
  }
  const t = tabs([["overview", "المؤشرات"], ["schools", "المدارس والاشتراكات"], ["create", "إضافة مدرسة"],
    ["billing", "الاشتراكات والفواتير"], ["renewals", "طلبات التجديد"], ["leads", "طلبات التجربة"], ["settings", "إعدادات المنصة"], ["audit", "سجل العمليات"]],
    { overview, schools, create, billing, renewals, leads, settings, audit }, {});
  mount(app,
    topbar({ subtitle: "لوحة مالك المنصة", onLogout: async () => { await api(`${API}/logout`, {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.show("overview");
}
start();
showInstallBar();
