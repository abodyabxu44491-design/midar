// الطلبات: تجربة، اشتراك، ميزة، تواصل، ترقية، تجديد — من الصفحة العامة ومن المدارس، في مكان واحد
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, badge, sub, notice, toast, dialog, empty, textarea, confirmAction, line, keyText } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";
import { waLink } from "/shared/js/whatsapp.js";
import { loadRefs, subForm, handoverText, REQ_KINDS, REQ_STATUS } from "./sub-form.js";
import { detail } from "./subscriptions.js";

export const KINDS = REQ_KINDS;
export const RSTATUS = REQ_STATUS;
let kind = "";
let status = "open";

export default async function requests({ refresh }) {
  const list = await api(`/api/owner/requests?kind=${kind}&status=${status}`);
  api("/api/owner/requests/seen", {}).then(() => document.dispatchEvent(new Event("owner-badge"))).catch(() => {});
  const chip = (cur, set, k, l) => h("button", { type: "button", class: `xb-chip${cur === k ? " on" : ""}`, onclick: () => { set(k); refresh(); } }, l);
  const root = h("div");
  mount(root,
    h("div", { class: "xb-chips" }, chip(kind, (v) => { kind = v; }, "", "كل الأنواع"), Object.entries(KINDS).map(([k, [l]]) => chip(kind, (v) => { kind = v; }, k, l))),
    h("div", { class: "xb-chips" }, chip(status, (v) => { status = v; }, "open", "المفتوحة"), chip(status, (v) => { status = v; }, "", "الكل"),
      Object.entries(RSTATUS).map(([k, [l]]) => chip(status, (v) => { status = v; }, k, l))),
    panel(`الطلبات (${list.length})`, null, list.length ? list.map((r) => row(r, refresh, root)) : empty("لا توجد طلبات هنا.")));
  return root;
}

function row(r, refresh, root) {
  const setStatus = select(Object.entries(RSTATUS).map(([k, [l]]) => [k, l]), { value: r.status, style: "width:auto" });
  setStatus.addEventListener("change", async () => { await api(`/api/owner/requests/${r.id}`, { status: setStatus.value }, "PATCH"); toast("حُدّثت الحالة"); refresh(); });
  const wa = r.phone ? waLink(r.phone, `السلام عليكم ${r.contact_name || ""}، بخصوص طلبكم على منصة مدار لمدرسة ${r.school_name}.`) : null;
  const canConvert = !r.tenant_id && ["trial", "subscription", "contact"].includes(r.kind);
  return h("div", { class: "xb-list-row" },
    h("div", { class: ["rejected", "canceled", "expired", "active"].includes(r.status) ? "muted-row" : "" },
      badge(...KINDS[r.kind]), " ", h("b", {}, r.tenant_name || r.school_name), " ", badge(...RSTATUS[r.status]),
      r.source === "school" ? badge("من داخل المدرسة", "gray") : null,
      sub([r.contact_name, r.phone, r.email, r.city, r.students_count ? `${r.students_count} طالب` : null].filter(Boolean).join(" — ")),
      sub([r.plan_name ? `الباقة: ${r.plan_name}` : r.kind === "trial" ? "بدون تحديد باقة" : null,
        r.kind === "trial" && r.plan_name ? (r.try_plan ? "يريد تجربة الباقة المختارة" : "لا يشترط تجربة الباقة") : null,
        r.billing_cycle ? (r.billing_cycle === "yearly" ? "سنوي" : "شهري") : null, r.months ? `${r.months} شهر` : null,
        r.feature_name ? `الميزة: ${r.feature_name}` : null, r.addon_names?.length ? `إضافات مطلوبة: ${r.addon_names.join("، ")}` : null,
        fmtDateTime(r.created_at)].filter(Boolean).join(" — ")),
      r.note ? sub(`«${r.note}»`) : null,
      r.owner_note ? sub(`ملاحظتك: ${r.owner_note}`) : null,
      r.similar_trials ? notice(`تنبيه: ${r.similar_trials} طلب تجربة سابق بنفس الجوال أو البريد`, "warn") : null,
      r.tenant_trials && r.kind === "trial" ? notice(`هذه المدرسة استخدمت ${r.tenant_trials} تجربة سابقة`, "warn") : null),
    h("div", { class: "acts" },
      setStatus,
      canConvert ? btn(r.kind === "trial" ? "تفعيل التجربة" : "إنشاء المدرسة والاشتراك", () => convert(r, refresh), "sm") : null,
      r.kind === "feature" && r.tenant_id && r.status !== "active" ? btn("منح الميزة", () => grant(r, refresh), "sm") : null,
      r.tenant_id ? btn("اشتراك المدرسة", () => detail(r.tenant_id, root, refresh), "soft sm") : null,
      wa ? h("a", { class: "btn ghost sm", href: wa, target: "_blank", rel: "noopener" }, "واتساب") : null,
      btn("ملاحظة", () => note(r, refresh), "ghost sm"),
      r.source === "public" ? btn("حذف", async () => { if (!confirmAction("حذف الطلب نهائيًا؟")) return; await api(`/api/owner/requests/${r.id}`, undefined, "DELETE"); refresh(); }, "danger sm") : null));
}

// من الطلب إلى مدرسة تعمل: رمز المدرسة وحساب المدير والاشتراك (تجربة أو مدفوع) في خطوة واحدة
async function convert(r, refresh) {
  const refs = await loadRefs();
  const suggested = (r.email?.split("@")[0] || "school").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20) || "school";
  const id = input({ class: "ltr", value: `${suggested}${Math.floor(Math.random() * 90 + 10)}` });
  const name = input({ value: r.school_name });
  const admin = input({ value: r.contact_name || "مدير المدرسة" });
  const form = subForm(refs, { kind: r.kind === "trial" ? "trial" : "paid", plan_id: r.plan_id ?? undefined, billing_cycle: r.billing_cycle || "yearly",
    addons: (r.addon_keys || []).map((k) => ({ key: k })) });
  const d = dialog(r.kind === "trial" ? "تفعيل التجربة المجانية" : "إنشاء المدرسة وتفعيل الاشتراك", h("div", {},
    !r.plan_id && r.kind === "trial" ? notice("طلب العميل تجربة المنصة بدون تحديد باقة. اختر الباقة التي سيجربها.", "") : null,
    h("div", { class: "row" }, field("اسم المدرسة", name), field("رمز المدرسة", id, "إنجليزي صغير، يظهر في الرابط")),
    field("اسم المدير", admin), h("hr"), form.el),
  [btn("إنشاء وتفعيل", async () => {
    const res = await api(`/api/owner/requests/${r.id}/convert`, { id: id.value, name: name.value, admin_name: admin.value, subscription: form.value() });
    d.close(); refresh();
    const text = handoverText(res);
    const wa = res.lead?.phone ? waLink(res.lead.phone, text) : null;
    dialog("تم تفعيل المدرسة", h("div", {},
      notice("أرسل بيانات الدخول للمدرسة الآن. كلمة المرور لن تظهر مرة أخرى.", "warn"),
      [["رابط الدخول", `${location.origin}/${res.credentials.school}/idara`], ["اسم المستخدم", res.credentials.username],
        ["كلمة المرور المؤقتة", res.credentials.password], ["رابط أولياء الأمور", `${location.origin}/${res.credentials.school}`],
        ["رمز صفحة الطلاب", res.credentials.directory_code]].map(([k, v]) => line(h("span", { class: "sub" }, k), keyText(v))),
      sub("بعد أول دخول: تغيير كلمة المرور ← معالج إعداد المدرسة ← لوحة التحكم.")),
    [wa ? h("a", { class: "btn", href: wa, target: "_blank", rel: "noopener" }, "إرسال عبر واتساب") : null,
      btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); }, "ghost")].filter(Boolean));
  })]);
  d.classList.add("xb-wide");
}

function grant(r, refresh) {
  const mode = select([["free", "مجانًا ودائمة"], ["priced", "بسعر"], ["period", "لفترة محددة"]]);
  const price = input({ type: "number", min: 0, value: 0 });
  const until = input({ type: "date" });
  const extra = h("div");
  const draw = () => mount(extra, mode.value === "priced" ? field("السعر", price) : null, mode.value === "period" ? field("حتى تاريخ", until) : null);
  mode.addEventListener("change", draw); draw();
  const d = dialog(`منح «${r.feature_name}» لـ ${r.tenant_name}`, h("div", {}, field("طريقة المنح", mode), extra,
    sub("تُضاف الميزة لاشتراك المدرسة الحالي كإضافة، وتظهر في سجل الاشتراك.")),
  [btn("موافقة ومنح", async () => {
    await api(`/api/owner/requests/${r.id}/grant-feature`, { price: mode.value === "priced" ? Number(price.value) : 0, until: mode.value === "period" ? until.value || null : null });
    d.close(); toast("مُنحت الميزة للمدرسة"); refresh();
  }), btn("رفض", async () => { await api(`/api/owner/requests/${r.id}`, { status: "rejected" }, "PATCH"); d.close(); refresh(); }, "danger")]);
}

function note(r, refresh) {
  const t = textarea({ rows: 3, value: r.owner_note || "" });
  const d = dialog("ملاحظة على الطلب", field("ملاحظتك (تظهر للمدرسة في طلباتها)", t),
    [btn("حفظ", async () => { await api(`/api/owner/requests/${r.id}`, { owner_note: t.value }, "PATCH"); d.close(); refresh(); })]);
}
