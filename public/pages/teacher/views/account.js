import { api } from "../../shared/js/api.js";
import { panel, field, input, btn, toast , passwordInput} from "../../shared/js/ui.js";

export default function account() {
  const cur = passwordInput({ autocomplete: "current-password" });
  const nxt = passwordInput({ autocomplete: "new-password" });
  return panel("تغيير كلمة المرور", null,
    field("كلمة المرور الحالية", cur),
    field("الجديدة", nxt, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
    btn("حفظ", async () => {
      await api("/api/teacher/password", { current: cur.value, next: nxt.value });
      cur.value = nxt.value = ""; toast("تم تغيير كلمة المرور");
    }));
}
