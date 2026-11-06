/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The site's message form (contact, support, sales, complaint). The message is saved and appears in the platform
// owner's inbox; the visitor gets its number. A hidden field and a signed time stamp keep bots out.
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { field, input, textarea, select, notice } from "./ui.js";

const KINDS = [["general", "استفسار عام"], ["support", "دعم فني"], ["sales", "اشتراك ومبيعات"], ["complaint", "شكوى"], ["other", "أخرى"]];

export function inquiryForm({ kind = "general", prefill = "", onDone } = {}) {
  let token = null;
  fetch("/api/public/inquiries/form", { cache: "no-store" }).then((r) => r.json()).then((x) => { token = x.token; }).catch(() => {});
  const f = {
    kind: select(KINDS, { value: kind }),
    name: input({ autocomplete: "name", maxLength: 120 }),
    email: input({ type: "email", class: "ltr", autocomplete: "email", maxLength: 200 }),
    phone: input({ class: "ltr", inputMode: "tel", autocomplete: "tel", maxLength: 20 }),
    organization: input({ autocomplete: "organization", maxLength: 150 }),
    subject: input({ maxLength: 200 }),
    body: textarea({ rows: 4, maxLength: 5000, value: prefill }),
  };
  // People never see this field; a bot that fills every field fills it too.
  const trap = h("input", { name: "website", tabIndex: -1, autocomplete: "off", "aria-hidden": "true" });
  const msg = h("div");
  const send = h("button", { class: "st-btn pri wide", type: "button" }, "إرسال");
  send.addEventListener("click", async () => {
    mount(msg); send.disabled = true;
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
      const r = await api("/api/public/inquiries", { ...body, website: trap.value, token });
      const ok = h("div", { class: "st-ok" }, h("h3", {}, "وصلتنا رسالتك"), h("p", {}, r.message),
        h("p", { class: "lg-meta" }, "احتفظ برقم الرسالة، واذكره إن تواصلت معنا بشأنها."));
      if (onDone) onDone(ok); else { mount(msg, ok); send.remove(); }
    } catch (e) { mount(msg, notice(e.message, "err")); send.disabled = false; }
  });
  return h("div", { class: "inq-form" },
    field("نوع الطلب", f.kind),
    h("div", { class: "row" }, field("اسمك", f.name), field("المدرسة أو المؤسسة (اختياري)", f.organization)),
    h("div", { class: "row" }, field("البريد الإلكتروني", f.email), field("رقم الجوال", f.phone, "اكتب أحدهما على الأقل لنرد عليك")),
    field("عنوان الرسالة", f.subject), field("رسالتك", f.body),
    h("div", { class: "inq-trap", "aria-hidden": "true" }, h("label", {}, "اترك هذا الحقل فارغًا", trap)),
    msg, send);
}
