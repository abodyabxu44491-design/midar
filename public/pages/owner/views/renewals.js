// طلبات التجديد والترقية الواردة من المدارس
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, empty, badge, line, sub, btn, input, dialog, toast, notice } from "/shared/js/ui.js";
import { fmtDate, fmtDateTime, money } from "/shared/js/format.js";
import { waLink } from "/shared/js/whatsapp.js";

const KINDS = { renew: "تجديد اشتراك", upgrade: "ترقية باقة", support: "طلب دعم" };
const STATUS = { new: ["جديد", "amber"], contacted: ["تم التواصل", ""], done: ["منفّذ", ""], rejected: ["مرفوض", "gray"] };

export default async function renewals({ refresh }) {
  const list = await api("/api/owner/renewals");
  const waiting = list.filter((r) => r.status === "new").length;
  return panel(`طلبات التجديد${waiting ? ` (${waiting} جديد)` : ""}`, null,
    list.length ? list.map((r) => row(r, refresh)) : empty("لا توجد طلبات."));
}

function row(r, refresh) {
  const wa = waLink(r.contact_phone, `السلام عليكم، بخصوص طلب ${KINDS[r.kind]} لمدرسة ${r.school_name}.`);
  const set = (patch) => async () => { await api(`/api/owner/renewals/${r.id}`, patch, "PATCH"); toast("تم التحديث"); refresh(); };
  return line(
    h("div", { class: r.status === "new" ? "" : "muted-row" },
      h("b", {}, `${r.school_name} — ${KINDS[r.kind]}`), " ", badge(...STATUS[r.status]),
      r.school_status !== "active" ? badge("المدرسة موقوفة", "red") : null,
      sub(`${r.months ? `المدة: ${r.months} شهرًا — ` : ""}${r.students_wanted ? `طلاب مطلوبون: ${r.students_wanted} — ` : ""}الحد الحالي ${r.max_students}`),
      sub(`ينتهي اشتراكها: ${r.subscription_end ? fmtDate(r.subscription_end) : "—"} — القيمة الحالية ${money(r.subscription_price)}`),
      sub(`مقدّم الطلب: ${r.requested_by}${r.contact_name ? ` — ${r.contact_name}` : ""}${r.contact_phone ? ` — ${r.contact_phone}` : ""} — ${fmtDateTime(r.created_at)}`),
      r.note ? sub(r.note) : null,
      r.owner_note ? sub(`ملاحظتك: ${r.owner_note}`) : null),
    h("div", { class: "row", style: "flex:none" },
      wa ? h("a", { class: "btn ghost sm", href: wa, target: "_blank", rel: "noopener" }, "واتساب") : null,
      r.status === "new" ? btn("تم التواصل", set({ status: "contacted" }), "soft sm") : null,
      r.status !== "done" ? btn("تم التنفيذ", () => noteDialog(r, "done", refresh), "sm") : null,
      r.status !== "rejected" ? btn("رفض", () => noteDialog(r, "rejected", refresh), "danger sm") : null));
}

function noteDialog(r, status, refresh) {
  const note = input({ placeholder: status === "done" ? "ما تم تنفيذه (اختياري)" : "سبب الرفض" });
  const msg = h("div");
  const d = dialog(status === "done" ? "تنفيذ الطلب" : "رفض الطلب", h("div", {},
    sub(status === "done" ? "بعد تجديد الاشتراك من تبويب «المدارس» أو «الاشتراكات»." : "السبب يظهر للمدرسة في إعداداتها."),
    note, msg),
  [btn("حفظ", async () => {
    try {
      await api(`/api/owner/renewals/${r.id}`, { status, owner_note: note.value || null }, "PATCH");
      d.close(); toast("تم"); refresh();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, status === "rejected" ? "danger" : "primary")]);
}
