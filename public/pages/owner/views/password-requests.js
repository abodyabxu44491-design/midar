// طلبات تغيير كلمات المرور — اعتماد المالك وإصدار الرابط
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, empty, badge, line, sub, btn, input, dialog, toast, notice, keyText } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";
import { waLink } from "/shared/js/whatsapp.js";

const JOBS = { admin: "إداري", accountant: "محاسب", teacher: "معلم" };
const CONTACT = { phone: "اتصال هاتفي", whatsapp: "واتساب", email: "بريد إلكتروني" };
const STATUS = {
  referred: ["بانتظار اعتمادك", "amber"], approved: ["معتمد — أُرسل الرابط", ""],
  used: ["تم التغيير", ""], rejected: ["مرفوض", "gray"], expired: ["انتهى الرابط", "gray"],
};

export default async function passwordRequests({ refresh }) {
  const list = await api("/api/owner/password-requests");
  const waiting = list.filter((x) => x.status === "referred").length;
  return panel(`طلبات تغيير كلمات المرور${waiting ? ` (${waiting} بانتظارك)` : ""}`, null,
    sub("الطلب يصل هنا بعد تحقق إدارة المدرسة من هوية صاحبه."),
    list.length ? list.map((r) => row(r, refresh)) : empty("لا توجد طلبات."));
}

function row(r, refresh) {
  const wa = waLink(r.phone, `بخصوص طلب تغيير كلمة المرور رقم ${r.ref}`);
  return line(
    h("div", { class: r.status === "referred" ? "" : "muted-row" },
      h("b", {}, `${r.full_name} — ${r.school_name}`), " ", badge(...(STATUS[r.status] || [r.status, "gray"])),
      sub(`طلب ${r.ref} — ${JOBS[r.job_title]} — الحساب: ${r.username}`),
      sub(`${r.phone} — التواصل المفضل: ${CONTACT[r.contact_pref]} — ${fmtDateTime(r.created_at)}`),
      sub(`السبب: ${r.description}`),
      r.reviewed_by ? sub(`راجعه من المدرسة: ${r.reviewed_by}${r.admin_note ? ` — ${r.admin_note}` : ""}`) : null,
      r.owner_note ? sub(`ملاحظتك: ${r.owner_note}`) : null,
      r.token_expires_at && r.status === "approved" ? sub(`الرابط صالح حتى ${fmtDateTime(r.token_expires_at)}`) : null,
      r.used_at ? sub(`استُخدم الرابط ${fmtDateTime(r.used_at)}`) : null),
    h("div", { class: "row", style: "flex:none" },
      wa ? h("a", { class: "btn ghost sm", href: wa, target: "_blank", rel: "noopener" }, "واتساب") : null,
      r.status === "referred" ? btn("اعتماد وإصدار الرابط", () => approve(r, refresh), "sm") : null,
      r.status === "referred" ? btn("رفض", () => reject(r, refresh), "danger sm") : null));
}

function approve(r, refresh) {
  const note = input({ placeholder: "ملاحظة (اختياري)" });
  const msg = h("div");
  const d = dialog(`اعتماد طلب ${r.ref}`, h("div", {},
    notice("سيُنشأ رابط يُستخدم مرة واحدة وينتهي بعد ساعتين. سلّمه لصاحب الحساب عبر القناة المعتمدة فقط.", "warn"),
    sub(`${r.full_name} — ${r.school_name} — ${JOBS[r.job_title]} — ${r.phone}`),
    note, msg),
  [btn("اعتماد وإصدار الرابط", async () => {
    mount(msg);
    try {
      const out = await api(`/api/owner/password-requests/${r.id}/review`, { decision: "approve", note: note.value || null });
      const wa = waLink(r.phone, `رابط تغيير كلمة المرور (صالح ساعتين ويُستخدم مرة واحدة): ${out.link}`);
      mount(msg,
        notice("أُصدر الرابط. انسخه الآن — لن يظهر مرة أخرى.", ""),
        h("div", { class: "pill" }, keyText(out.link)),
        h("div", { class: "row spaced" },
          btn("نسخ الرابط", async () => { await navigator.clipboard.writeText(out.link); toast("نُسخ الرابط"); }, "soft sm"),
          wa ? h("a", { class: "btn sm", href: wa, target: "_blank", rel: "noopener" }, "إرسال عبر واتساب") : null));
      refresh();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  })]);
}

function reject(r, refresh) {
  const note = input({ placeholder: "سبب الرفض" });
  const d = dialog(`رفض طلب ${r.ref}`, h("div", {}, note),
    [btn("رفض الطلب", async () => {
      await api(`/api/owner/password-requests/${r.id}/review`, { decision: "reject", note: note.value || null });
      d.close(); toast("رُفض الطلب"); refresh();
    }, "danger")]);
}
