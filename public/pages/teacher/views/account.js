import { api } from "/shared/js/api.js";
import { panel, field, input, btn, toast } from "/shared/js/ui.js";

export default function account() {
  const cur = input({ type: "password", class: "ltr", autocomplete: "current-password" });
  const nxt = input({ type: "password", class: "ltr", autocomplete: "new-password" });
  return panel("تغيير كلمة المرور", null,
    field("كلمة المرور الحالية", cur),
    field("الجديدة", nxt, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
    btn("حفظ", async () => {
      await api("/api/teacher/password", { current: cur.value, next: nxt.value });
      cur.value = nxt.value = ""; toast("تم تغيير كلمة المرور");
    }));
}
