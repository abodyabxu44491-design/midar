// طلبات التجربة الواردة من الصفحة التسويقية
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, empty, badge, line, sub, btn, input, dialog, toast, notice } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";
import { waLink } from "/shared/js/whatsapp.js";

const STATUS = { new: ["جديد", "amber"], contacted: ["تم التواصل", ""], converted: ["اشترك", ""], rejected: ["مرفوض", "gray"] };

export default async function leads({ refresh }) {
  const list = await api("/api/owner/leads");
  const pending = list.filter((l) => l.status === "new").length;
  return panel(`طلبات التجربة${pending ? ` (${pending} جديد)` : ""}`, null,
    list.length ? list.map((l) => row(l, refresh)) : empty("لا توجد طلبات بعد. فعّل الصفحة التسويقية من تبويب «إعدادات المنصة»."));
}

function row(l, refresh) {
  const set = (patch) => async () => { await api(`/api/owner/leads/${l.id}`, patch, "PATCH"); toast("تم التحديث"); refresh(); };
  const wa = waLink(l.phone, `السلام عليكم ${l.contact_name}، بخصوص طلبكم تجربة منصة مدار لمدرسة ${l.school_name}.`);
  return line(
    h("div", { class: l.status === "new" ? "" : "muted-row" },
      h("b", {}, l.school_name), " ", badge(...STATUS[l.status]),
      sub(`${l.contact_name} — ${l.phone}${l.email ? ` — ${l.email}` : ""}`),
      sub(`${l.city || "—"} — ${l.students_count ? `${l.students_count} طالب` : "عدد غير محدد"} — ${fmtDateTime(l.created_at)}`),
      l.note ? sub(l.note) : null,
      l.owner_note ? sub(`ملاحظتك: ${l.owner_note}`) : null,
      l.tenant_id ? sub(`المدرسة: ${l.tenant_id}`) : null),
    h("div", { class: "row", style: "flex:none" },
      wa ? h("a", { class: "btn ghost sm", href: wa, target: "_blank", rel: "noopener" }, "واتساب") : null,
      l.status === "new" ? btn("تم التواصل", set({ status: "contacted" }), "soft sm") : null,
      l.status !== "converted" ? btn("اشترك", () => convert(l, refresh), "sm") : null,
      l.status !== "rejected" ? btn("رفض", () => reject(l, refresh), "danger sm") : null,
      btn("ملاحظة", () => noteDialog(l, refresh), "ghost sm"),
      btn("حذف", async () => {
        if (!confirm("حذف الطلب نهائيًا؟")) return;
        await api(`/api/owner/leads/${l.id}`, undefined, "DELETE");
        toast("حُذف الطلب"); refresh();
      }, "danger sm")));
}

function convert(l, refresh) {
  const code = input({ class: "ltr", placeholder: "حروف إنجليزية صغيرة" });
  const msg = h("div");
  const d = dialog(`تحويل ${l.school_name} إلى مدرسة مشتركة`, h("div", {},
    sub("يُنشأ الاشتراك وتظهر بطاقة التسليم."), h("div", {}, code), msg), [
    btn("إنشاء المدرسة", async () => {
      mount(msg);
      try {
        const r = await api("/api/owner/tenants", { id: code.value, name: l.school_name, admin_name: l.contact_name,
          max_students: l.students_count || 200 });
        await api(`/api/owner/leads/${l.id}`, { status: "converted", tenant_id: code.value.trim().toLowerCase() }, "PATCH");
        d.close();
        const { handoverCard } = await import("./create.js");
        handoverCard(r);
        refresh();
      } catch (e) { mount(msg, notice(e.message, "err")); }
    })]);
  code.focus();
}

function reject(l, refresh) {
  const note = input({ placeholder: "السبب (اختياري)" });
  const d = dialog("رفض الطلب", h("div", {}, note), [btn("رفض", async () => {
    await api(`/api/owner/leads/${l.id}`, { status: "rejected", owner_note: note.value || null }, "PATCH");
    d.close(); refresh();
  }, "danger")]);
}

function noteDialog(l, refresh) {
  const note = input({ value: l.owner_note || "" });
  const d = dialog("ملاحظة داخلية", h("div", {}, note), [btn("حفظ", async () => {
    await api(`/api/owner/leads/${l.id}`, { owner_note: note.value || null }, "PATCH");
    d.close(); refresh();
  })]);
}
