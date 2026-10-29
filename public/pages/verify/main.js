/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
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
    const inst = c.org_type === "institute", org = inst ? c.org_word || "المعهد" : "المدرسة";
    const st = c.status || (c.revoked ? "revoked" : "issued");
    const tr = String(c.title || "").startsWith("كشف درجات");
    const head = tr
      ? { issued: ["كشف درجات صحيح", `هذا الكشف صادر فعلًا من ${org} عبر منصة مدار، وهو النسخة السارية.`],
        revoked: ["كشف درجات ملغى", `هذا الكشف صدر من ${org} ثم أُلغي، ولا يُعتد به.`],
        replaced: ["نسخة قديمة من كشف الدرجات", `صدرت نسخة أحدث من هذا الكشف من ${org} بعد تصحيح النتائج، ولا يُعتد بهذه النسخة.`] }[st]
      : { issued: ["شهادة صحيحة", `هذه الشهادة صادرة فعلًا من ${org} عبر منصة مدار، وهي سارية.`],
        revoked: ["شهادة ملغاة", `هذه الشهادة صدرت من ${org} ثم أُلغيت، ولا يُعتد بها.`],
        replaced: ["شهادة مستبدلة", `استُبدلت هذه الشهادة بشهادة أحدث من ${org}، ولا يُعتد بهذه النسخة.`] }[st];
    body = h("section", { class: `panel verify-card ${st === "issued" ? "valid" : "revoked"}` },
      h("div", { class: "verify-head" }, (st === "issued" ? icons.shield : icons.close)({ size: 34 }),
        h("div", {}, h("h1", {}, head[0]), h("p", {}, head[1]))),
      ...(inst ? [row(org, c.school), row("الاسم", c.student), row("الدورة", c.course), c.program ? row("البرنامج", c.program) : null,
        c.hours != null ? row(c.kind === "attendance" ? "الساعات المحضورة" : "عدد الساعات", String(Number(c.hours))) : null,
        c.completed_on ? row("تاريخ الإكمال", fmtDate(c.completed_on)) : null]
        : [row("المدرسة", c.school), row("الطالب", c.student), row("الفصل", c.class_name)]),
      row(tr ? "المستند" : "الشهادة", c.title), c.result ? row("النتيجة", c.result) : null, c.percent !== null && !inst ? row("النسبة", `${c.percent}%`) : null,
      c.serial ? row(tr ? "رقم الكشف" : "رقم الشهادة", h("bdi", { dir: "ltr" }, c.serial)) : null,
      row("تاريخ الإصدار", fmtDate(c.issued_at)),
      c.replaced_on ? row(st === "replaced" ? (tr ? "تاريخ صدور النسخة الأحدث" : "تاريخ الاستبدال") : "تاريخ الإلغاء", fmtDate(c.replaced_on)) : null,
      row("رمز التحقق", h("bdi", { dir: "ltr" }, code)),
      h("p", { class: "verify-note" }, `يؤكد هذا التحقق وجود ${tr ? "الكشف" : "الشهادة"} وحالته في سجلات ${org} على منصة مدار. الاعتماد داخلي من ${org}، ولا يعني اعتمادًا من جهة حكومية.`));
  } catch (e) {
    body = notice(e.status === 404 ? "لا توجد شهادة بهذا الرمز. تأكد من الرمز أو تواصل مع المدرسة." : e.message, "err");
  }
  mount($("#app"),
    h("div", { class: "auth-hero" }, h("div", { class: "in" }, brandLogo("hero-logo", true, "stacked"), h("p", { class: "role" }, "التحقق من الشهادات"))),
    h("main", {}, body), footer());
}
start();
