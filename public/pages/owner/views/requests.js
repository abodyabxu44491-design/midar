/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, badge, sub, notice, toast, dialog, empty, textarea, confirmAction, line, keyText } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";
import { waLink } from "/shared/js/whatsapp.js";
import { loadRefs, subForm, REQ_KINDS, REQ_STATUS } from "./sub-form.js";
import { detail } from "./subscriptions.js";
import { loadOrgTypes, typeOf, typeOptions } from "./org-types.js";

let typesCache = null;

export const KINDS = REQ_KINDS;
export const RSTATUS = REQ_STATUS;
let kind = "";
let status = "open";

export default async function requests({ refresh }) {
  const [list, types] = await Promise.all([api(`/api/owner/requests?kind=${kind}&status=${status}`), loadOrgTypes().catch(() => null)]);
  typesCache = types;
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
      badge(...KINDS[r.kind]), " ", h("b", {}, r.tenant_name || r.school_name), " ", h("small", { class: "ltr muted" }, `#${r.id}`), " ", badge(...RSTATUS[r.status]),
      r.source === "school" ? badge("من داخل المدرسة", "gray") : null,
      sub([r.contact_name, r.phone, r.email, r.city, r.students_count ? `${r.students_count} طالب` : null].filter(Boolean).join(" — ")),
      sub([r.plan_name ? `الباقة: ${r.plan_name}` : r.kind === "trial" ? "بدون تحديد باقة" : null,
        r.kind === "trial" && r.plan_name ? (r.try_plan ? "يريد تجربة الباقة المختارة" : "لا يشترط تجربة الباقة") : null,
        r.billing_cycle ? (r.billing_cycle === "yearly" ? "سنوي" : "شهري") : null, r.months ? `${r.months} شهر` : null,
        r.feature_name ? `الميزة: ${r.feature_name}` : null, r.addon_names?.length ? `إضافات مطلوبة: ${r.addon_names.join("، ")}` : null,
        fmtDateTime(r.created_at)].filter(Boolean).join(" — ")),
      leadDetails(r.details),
      r.note ? sub(`«${r.note}»`) : null,
      r.owner_note ? sub(`ملاحظتك: ${r.owner_note}`) : null,
      r.last_error ? notice(`تعثّر إنشاء المدرسة: ${r.last_error} — صحّح البيانات وأعد «إنشاء وتفعيل».`, "err") : null,
      r.similar_trials ? notice(`تنبيه: ${r.similar_trials} طلب تجربة سابق بنفس الجوال أو البريد`, "warn") : null,
      r.tenant_trials && r.kind === "trial" ? notice(`هذه المدرسة استخدمت ${r.tenant_trials} تجربة سابقة`, "warn") : null),
    h("div", { class: "acts" },
      setStatus,
      canConvert ? btn(r.kind === "trial" ? "تفعيل التجربة" : "إنشاء المدرسة والاشتراك", () => convert(r, refresh), "sm") : null,
      r.kind === "feature" && r.tenant_id && r.status !== "active" ? btn("منح الميزة", () => grant(r, refresh), "sm") : null,
      r.tenant_id ? btn("ملف المدرسة", () => { location.hash = `#/schools?school=${r.tenant_id}`; }, "soft sm") : null,
      r.tenant_id ? btn("اشتراك المدرسة", () => detail(r.tenant_id, root, refresh), "ghost sm") : null,
      wa ? h("a", { class: "btn ghost sm", href: wa, target: "_blank", rel: "noopener" }, "واتساب") : null,
      btn("ملاحظة", () => note(r, refresh), "ghost sm"),
      r.source === "public" ? btn("حذف", async () => { if (!confirmAction("حذف الطلب نهائيًا؟")) return; await api(`/api/owner/requests/${r.id}`, undefined, "DELETE"); refresh(); }, "danger sm") : null));
}

async function convert(r, refresh) {
  const refs = await loadRefs();
  const name = input({ value: r.school_name });
  const types = await loadOrgTypes();
  const asked = typeOf(types, r.details?.org_type);
  const org = select(typeOptions(types), { value: asked && typeOptions(types).some(([k]) => k === asked.key) ? asked.key : "private_school" });
  // The school code is derived from the name on the server (unique, readable); the owner may still adjust it.
  const id = input({ class: "ltr", dir: "ltr", placeholder: "alnoor", "aria-label": "رمز المدرسة" });
  let touched = false, seq = 0;
  const preview = h("bdi", { dir: "ltr", class: "code-url" });
  const paint = () => { preview.textContent = `${location.host}/${id.value || "…"}`; };
  const suggest = async () => {
    if (touched) return;
    const n = ++seq;
    try { const { code } = await api(`/api/owner/files/suggest-code?name=${encodeURIComponent(name.value)}`); if (n === seq && !touched) { id.value = code; paint(); } } catch { /* keep current */ }
  };
  let t;
  name.addEventListener("input", () => { clearTimeout(t); t = setTimeout(suggest, 350); });
  id.addEventListener("input", () => { touched = true; id.value = id.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30); paint(); });
  const codeBox = h("div", { class: "code-pick" }, h("span", { class: "sub" }, "رابط المدرسة"), preview,
    h("details", {}, h("summary", {}, "تعديل الرمز"), id));
  suggest();
  const admin = input({ value: r.contact_name || "مدير المدرسة" });
  const form = subForm(refs, { kind: r.kind === "trial" ? "trial" : "paid", plan_id: r.plan_id ?? undefined, billing_cycle: r.billing_cycle || "yearly",
    addons: (r.addon_keys || []).map((k) => ({ key: k })) });
  const d = dialog(r.kind === "trial" ? "تفعيل التجربة المجانية" : "إنشاء المدرسة وتفعيل الاشتراك", h("div", {},
    !r.plan_id && r.kind === "trial" ? notice("طلب العميل تجربة المنصة بدون تحديد باقة. اختر الباقة التي سيجربها.", "") : null,
    field("نوع المؤسسة", org), field("الاسم", name), codeBox,
    field("اسم المدير", admin),
    h("hr"), form.el),
  [btn("إنشاء وتفعيل", async (e) => {
    const b = e?.currentTarget; if (b) b.disabled = true;
    try {
      const res = await api(`/api/owner/requests/${r.id}/convert`, { id: id.value || undefined, org_type_key: org.value, name: name.value, admin_name: admin.value, subscription: form.value() });
      d.close(); toast("اعتُمدت المدرسة وأُنشئ حسابها");
      location.hash = `#/schools?school=${res.tenant_id}&handover=1`;
    } catch (err) {
      if (err.data?.tenant_id) { d.close(); location.hash = `#/schools?school=${err.data.tenant_id}`; return; }
      toast(err.message, true); if (b) b.disabled = false;
    }
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

const COUNTRY = { YE: "اليمن", SA: "السعودية", OTHER: "دولة أخرى" };
const STAGE = { kg: "رياض الأطفال", primary: "ابتدائي/أساسي", middle: "متوسط", secondary: "ثانوي" };
const PREF = { whatsapp: "واتساب", call: "اتصال", email: "البريد" };
function leadDetails(d) {
  if (!d || !Object.keys(d).length) return null;
  const m = d.manager || {};
  const rows = [
    ["الاسم المختصر", d.short_name], ["نوع المؤسسة", d.org_type && typesCache ? typeOf(typesCache, d.org_type)?.name || d.org_type : null], ["الدولة", COUNTRY[d.country] || d.country], ["المنطقة", d.region], ["العنوان", d.address],
    ["هاتف المدرسة", d.school_phone], ["بريد المدرسة", d.school_email], ["الموقع", d.website], ["رقم الترخيص", d.license_no],
    ["المراحل", (d.stages || []).map((x) => STAGE[x]).join("، ")], ["عدد الفصول", d.classes_count], ["العام الدراسي", d.academic_year],
    ["مدير المدرسة", [m.first, m.second, m.third, m.family].filter(Boolean).join(" ")], ["المسمى", m.title], ["التواصل المفضل", PREF[m.preferred]],
  ].filter(([, v]) => v);
  if (!rows.length) return null;
  return h("details", { class: "lead-details" }, h("summary", {}, "بيانات التسجيل الكاملة"),
    h("dl", {}, rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, String(v))])));
}
