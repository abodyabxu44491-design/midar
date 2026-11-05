/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Messages from the site's forms and the platform's email addresses. Each has a status (new, in progress, replied,
// closed) and a log of what was done; a reply goes out from here only when an outgoing mail service is set up.
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, btn, empty, badge, sub, field, textarea, select, dialog, toast, notice, confirmAction } from "/shared/js/ui.js";

const B = "/api/owner/inbox";
const TONE = { new: "red", in_progress: "amber", replied: "", closed: "gray" };
const EVENT = { received: "استلام", status: "تغيير الحالة", note: "ملاحظة", reply: "رد", notify: "إشعار" };
let filter = "open";

export default async function inbox({ refresh }) {
  const t = await api(`${B}?status=${filter}`);
  const tabs = [["open", "المفتوحة"], ["new", "الجديدة"], ["in_progress", "قيد المعالجة"], ["replied", "تم الرد"], ["closed", "المغلقة"], ["all", "الكل"]];
  return [
    t.can_reply ? null : notice("لا توجد خدمة إرسال بريد مهيأة، فالرد يكون من صندوق بريدك (Gmail) ثم تسجّله هنا كملاحظة وتغيّر الحالة. الرسائل الواردة إلى عناوين المنصة تصل إلى Gmail وتظهر هنا معًا.", ""),
    panel(`صندوق الرسائل (${(t.counts.new || 0) + (t.counts.in_progress || 0)} مفتوحة)`, h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" },
      tabs.map(([k, l]) => btn(`${l}${t.counts[k] ? ` (${t.counts[k]})` : ""}`, () => { filter = k; refresh(); }, k === filter ? "sm" : "ghost sm"))),
      t.items.length ? h("div", { class: "xb-list" }, t.items.map((x) => h("div", { class: "xb-list-row" },
        h("div", {},
          h("b", {}, `#${x.id} ${x.subject}`), " ", badge(t.statuses[x.status], TONE[x.status]), " ", badge(t.kinds[x.kind], "gray"),
          x.channel === "email" ? [" ", badge(`بريد إلى ${x.to_address || ""}`, "gray")] : null,
          sub([x.name, x.organization, x.email, x.phone].filter(Boolean).join(" — ")),
          sub(new Date(x.created_at).toLocaleString("ar-SA-u-ca-gregory-nu-latn")),
          sub(x.preview)),
        h("div", { class: "row", style: "flex:none" }, btn("فتح", () => open(x.id, t, refresh), "sm")))))
        : empty("لا رسائل هنا.")),
  ];
}

async function open(id, t, refresh) {
  const x = await api(`${B}/${id}`);
  const status = select(Object.entries(t.statuses), { value: x.status });
  const note = textarea({ rows: 2, maxLength: 2000, placeholder: "ملاحظة داخلية: ما الذي تم، ومن تواصل" });
  const reply = textarea({ rows: 5, maxLength: 8000, placeholder: "نص الرد. يُرسل مع توقيع المنصة الرسمي" });
  const d = dialog(`#${x.id} ${x.subject}`, h("div", {},
    sub(`${t.kinds[x.kind]} — ${x.channel === "email" ? `بريد إلى ${x.to_address || ""}` : "نموذج الموقع"} — ${new Date(x.created_at).toLocaleString("ar-SA-u-ca-gregory-nu-latn")}`),
    sub([x.name, x.organization].filter(Boolean).join(" — ")),
    x.email ? sub("البريد: ", h("a", { href: `mailto:${x.email}?subject=${encodeURIComponent(`رد: ${x.subject} [#${x.id}]`)}`, class: "ltr" }, x.email)) : null,
    x.phone ? sub("الجوال: ", h("a", { href: `https://wa.me/${x.phone.replace(/\D/g, "")}`, target: "_blank", rel: "noopener", class: "ltr" }, x.phone)) : null,
    h("div", { style: "white-space:pre-wrap;background:var(--soft,#F4F7FA);border-radius:12px;padding:12px;margin:10px 0;max-height:300px;overflow:auto" }, x.body),
    h("div", { class: "row" }, field("الحالة", status)), field("ملاحظة", note),
    btn("حفظ الحالة والملاحظة", async () => {
      try { await api(`${B}/${id}`, { status: status.value, note: note.value || undefined }, "PATCH"); toast("حُفظ"); d.close(); refresh(); } catch (e) { toast(e.message, true); }
    }, "sm"),
    t.can_reply && x.email ? [field("الرد بالبريد", reply), btn("إرسال الرد", async () => {
      try { await api(`${B}/${id}/reply`, { body: reply.value }); toast("أُرسل الرد"); d.close(); refresh(); } catch (e) { toast(e.message, true); }
    }, "sm")] : null,
    h("h3", { style: "margin-top:16px" }, "السجل"),
    h("div", { class: "xb-list" }, x.events.map((e) => h("div", { class: "xb-list-row" },
      h("div", {}, h("b", {}, EVENT[e.kind] || e.kind), " ", sub(`${e.actor} — ${new Date(e.created_at).toLocaleString("ar-SA-u-ca-gregory-nu-latn")}`),
        e.body ? h("div", { style: "white-space:pre-wrap" }, e.body) : null))))), [
    btn("حذف (رسالة مزعجة)", async () => {
      if (!(await confirmAction("حذف هذه الرسالة نهائيًا؟ استخدمه للرسائل المزعجة فقط."))) return;
      await api(`${B}/${id}`, undefined, "DELETE"); toast("حُذفت"); d.close(); refresh();
    }, "danger")]);
}
