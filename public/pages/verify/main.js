// صفحة التحقق من الشهادة: يفتحها من يمسح رمز QR على الشهادة المطبوعة
import { h, $, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { brandLogo, footer, notice } from "../shared/js/ui.js";
import { fmtDate } from "../shared/js/format.js";
import { icons } from "../shared/js/icons.js";

const code = decodeURIComponent(location.pathname.split("/")[2] || "").toUpperCase();
const row = (label, value) => h("div", { class: "line" }, h("span", { class: "sub" }, label), h("b", {}, value || "—"));

async function start() {
  let body;
  try {
    const c = await api(`/api/public/verify/${encodeURIComponent(code)}`);
    body = h("section", { class: `panel verify-card ${c.revoked ? "revoked" : "valid"}` },
      h("div", { class: "verify-head" }, (c.revoked ? icons.close : icons.shield)({ size: 34 }),
        h("div", {}, h("h1", {}, c.revoked ? "شهادة ملغاة" : "شهادة صحيحة"),
          h("p", {}, c.revoked ? "هذه الشهادة صدرت من المدرسة ثم أُلغيت، ولا يُعتد بها." : "هذه الشهادة صادرة فعلًا من المدرسة عبر منصة مدار."))),
      row("المدرسة", c.school), row("الطالب", c.student), row("الفصل", c.class_name), row("الشهادة", c.title),
      c.result ? row("النتيجة", c.result) : null, c.percent !== null ? row("النسبة", `${c.percent}%`) : null,
      row("تاريخ الإصدار", fmtDate(c.issued_at)), row("رمز الشهادة", code));
  } catch (e) {
    body = notice(e.status === 404 ? "لا توجد شهادة بهذا الرمز. تأكد من الرمز أو تواصل مع المدرسة." : e.message, "err");
  }
  mount($("#app"),
    h("div", { class: "auth-hero" }, h("div", { class: "in" }, brandLogo("hero-logo", true, "stacked"), h("p", { class: "role" }, "التحقق من الشهادات"))),
    h("main", {}, body), footer());
}
start();
