// بوابة المحاسب: المالية والرسوم فقط.
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { topbar, footer, tabs, panel, field, input, btn, toast, sub } from "/shared/js/ui.js";
import { setApiBase } from "/admin/views/common.js";
import ledger from "/admin/views/ledger.js";
import fees from "/admin/views/finance.js";

const app = $("#app");

export async function startAccountant() {
  setApiBase("accountant");
  const me = await api("/api/accountant/me");
  const t = tabs([["ledger", "المالية"], ["fees", "الرسوم"], ["account", "حسابي"]],
    { ledger, fees, account }, { me });
  mount(app,
    topbar({ school: me.school.name, subtitle: `المحاسب — ${me.name}`,
      onLogout: async () => { await api("/api/accountant/logout", {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.show("ledger");
}

function account({ me }) {
  const cur = input({ type: "password", class: "ltr", autocomplete: "current-password" });
  const nxt = input({ type: "password", class: "ltr", autocomplete: "new-password" });
  return [
    panel("صلاحياتي", null,
      sub(`اعتماد الحركات المالية: ${me.permissions.approve ? "نعم" : "لا"}`),
      sub(`إدارة الرواتب: ${me.permissions.payroll ? "نعم" : "لا"}`),
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
