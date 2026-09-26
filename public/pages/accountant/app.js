// بوابة المحاسب: المالية والرسوم فقط.
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { setCurrency } from "../shared/js/format.js";
import { topbar, footer, tabs, lazy, panel, field, input, btn, toast, sub, notice, passwordChangeScreen, passwordInput } from "../shared/js/ui.js";
import { setApiBase } from "../admin/views/common.js";
const ledger = lazy(() => import("../admin/views/ledger.js"), new URL("../admin/views/ledger.js", import.meta.url).pathname);
const fees = lazy(() => import("../admin/views/finance.js"), new URL("../admin/views/finance.js", import.meta.url).pathname);

const app = $("#app");

export async function startAccountant() {
  setApiBase("accountant");
  const me = await api("/api/accountant/me");
  if (me.access?.locked) {
    return mount(app, topbar({ school: me.school.name, subtitle: me.name, onLogout: async () => { await api("/api/accountant/logout", {}); location.reload(); } }),
      h("main", {}, panel("اشتراك المدرسة غير فعّال حاليًا", null, notice("لا يمكن استخدام المنصة الآن لأن اشتراك المدرسة متوقف. كل البيانات محفوظة، وتعود للعمل فور تجديد الإدارة للاشتراك.", "warn"))), footer());
  }
  if (me.must_change_password) {
    return passwordChangeScreen({ endpoint: "/api/accountant/password", logoutEndpoint: "/api/accountant/logout", school: me.school.name, name: me.name });
  }
  setCurrency(me.currency);
  const full = me.permissions.approve && me.permissions.payroll && me.permissions.accounts;
  const list = [
    ...(me.modules?.finance ? [["ledger", "المالية"]] : []),
    ...(me.modules?.fees ? [["fees", "الرسوم"]] : []),
    ["account", "حسابي"],
  ];
  const t = tabs(list, { ledger, fees, account }, { me });
  mount(app,
    topbar({ school: me.school.name, subtitle: `المحاسب — ${me.name}`,
      onLogout: async () => { await api("/api/accountant/logout", {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.show("ledger");
}

function account({ me }) {
  const cur = passwordInput({ autocomplete: "current-password" });
  const nxt = passwordInput({ autocomplete: "new-password" });
  return [
    panel("صلاحياتي", null,
      sub(`اعتماد الحركات المالية: ${me.permissions.approve ? "نعم" : "لا"}`),
      sub(`إدارة الرواتب: ${me.permissions.payroll ? "نعم" : "لا"}`),
      sub(`إدارة الحسابات والتصنيفات: ${me.permissions.accounts ? "نعم" : "لا"}`),
      sub("الصلاحيات يحددها مدير المدرسة.")),
    panel("تغيير كلمة المرور", null,
      field("كلمة المرور الحالية", cur),
      field("الجديدة", nxt, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
      btn("حفظ", async () => {
        await api("/api/accountant/password", { current: cur.value, next: nxt.value });
        cur.value = nxt.value = ""; toast("تم تغيير كلمة المرور");
      })),
  ];
}
