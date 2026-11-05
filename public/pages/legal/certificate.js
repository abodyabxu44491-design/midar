/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// One internal certificate, read from the platform by its number, so what is shown is always the current record:
// valid, expired or revoked. The page prints as the certificate itself (the browser can save it as PDF).
import { h, mount } from "../shared/js/dom.js";
import { fmtDate } from "../shared/js/format.js";

const box = document.querySelector("[data-cert]");
const printBtn = document.querySelector("[data-print]");
const ref = decodeURIComponent(location.pathname.split("/").pop() || "").toUpperCase();
const STATUS = {
  valid: ["سارية", "الشهادة سارية، وتطابق السجل المحفوظ في المنصة."],
  expired: ["منتهية", "انتهت صلاحية هذه الشهادة. قد تكون صدرت شهادة أحدث بعد فحص جديد."],
  revoked: ["ملغاة", "ألغيت هذه الشهادة، ولا يُعتد بها."],
};

async function load() {
  let res, c;
  try { res = await fetch(`/api/public/trust/verify/${encodeURIComponent(ref)}`); c = await res.json(); } catch { res = null; }
  if (!res?.ok) {
    document.title = "شهادة غير موجودة — مدار";
    mount(box, h("h1", {}, "لا توجد شهادة بهذا الرقم"),
      h("p", {}, "تأكد من الرقم المكتوب على الشهادة (مثل ", h("span", { class: "ltr" }, "MS-2026-0001"), "). الشهادة التي لا تظهر هنا ليست صادرة عن منصة مدار."),
      h("p", {}, h("a", { href: "/trust" }, "مركز الثقة والتوثيق")));
    return;
  }
  const [label, text] = STATUS[c.status];
  document.title = `${c.title} ${c.ref} — مدار`;
  mount(box,
    h("div", { class: `status-box no-print ${c.status === "valid" ? "ok" : "down"}` }, `${label}: ${text}`),
    h("article", { class: `cert-doc ${c.status}` },
      h("header", {}, h("img", { src: "/brand/logo.svg", alt: "مدار", class: "cert-logo" }),
        h("div", {}, h("p", { class: "cert-eyebrow" }, "شهادة داخلية"), h("p", { class: "cert-issuer" }, c.issuer))),
      h("h1", {}, c.title),
      h("p", { class: "cert-scope" }, c.scope),
      h("dl", { class: "cert-facts" },
        h("dt", {}, "الرقم المرجعي"), h("dd", { class: "ltr" }, c.ref),
        h("dt", {}, "تاريخ الإصدار"), h("dd", {}, fmtDate(c.issued_at)),
        h("dt", {}, "صالحة حتى"), h("dd", {}, fmtDate(c.valid_until)),
        h("dt", {}, "الجهة المصدرة"), h("dd", {}, `${c.issuer} — منصة مدار التعليمية`),
        h("dt", {}, "يستند إلى"), h("dd", {}, `${c.check_method === "automatic" ? "فحص آلي" : "إجراء موثّق"} بتاريخ ${fmtDate(c.checked_at)}: ${c.check_summary}`),
        h("dt", {}, "الحالة"), h("dd", {}, label, c.revoked_at ? ` منذ ${fmtDate(c.revoked_at)} (${c.revoke_reason})` : "")),
      h("footer", {},
        h("div", {}, h("p", {}, "للتحقق من هذه الشهادة افتح:"), h("p", { class: "ltr cert-url" }, `${location.origin}/trust/verify/${c.ref}`),
          h("p", { class: "cert-note" }, c.note)),
        h("img", { src: c.qr, alt: "رمز التحقق", class: "cert-qr" }))));
  printBtn.hidden = false;
}
printBtn.addEventListener("click", () => window.print());
load();
