/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, empty, badge, btn, sub, toast, confirmAction, input, select, textarea, field, notice, linkRow, stats, skeleton, dialog,
  kpiCard, kpiGrid, brandLogo } from "/shared/js/ui.js";
import { fmtDate, fmtDateTime } from "/shared/js/format.js";
import { icons } from "/shared/js/icons.js";
import { waLink } from "/shared/js/whatsapp.js";
import { SUB_STATUS, KIND, limitText } from "./sub-form.js";
import { loadOrgTypes, typeOf, typeOptions } from "./org-types.js";

const F = "/api/owner/files";
const STATUS = { active: ["فعّال", ""], suspended: ["موقوف", "red"], archived: ["مؤرشف", "gray"] };
const DELIV = { sent: ["تم التسليم", ""], pending: ["بانتظار التأكيد", "amber"], failed: ["فشل الإرسال", "red"] };
const STAGE_TONE = { received: "amber", review: "amber", approved: "violet", account: "violet", delivered: "", first_login: "" };
const STAGE_NAMES = { kg: "رياض الأطفال", primary: "الابتدائية", middle: "المتوسطة", secondary: "الثانوية" };
const filters = { q: "", stage: "", delivery: "", status: "", org_type: "", sort: "newest" };
export const filterByType = (key) => { filters.org_type = key; };

let latestRefresh = null, lastHash = "";
window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#/schools") && location.hash !== lastHash && latestRefresh) latestRefresh();
});

export default async function schools({ refresh, go }) {
  latestRefresh = refresh; lastHash = location.hash;
  const root = h("div");
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const open = params.get("school");
  if (open) {
    await filePage(open, root, () => { history.replaceState(null, "", "#/schools"); refresh(); }, params.get("handover") === "1");
    if (params.get("handover") === "1") { history.replaceState(null, "", `#/schools?school=${open}`); lastHash = location.hash; }
    return root;
  }
  await listPage(root, refresh, go);
  return root;
}

async function listPage(root, refresh, go) {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const [d, types] = await Promise.all([api(`${F}?${qs}`), loadOrgTypes()]);
  const c = d.counts;
  const chosen = new Set();
  const q = input({ type: "search", placeholder: "ابحث باسم المدرسة أو رمزها أو جوال المسؤول", value: filters.q });
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { filters.q = q.value.trim(); listPage(root, refresh, go); }, 350); });
  const sel = (key, opts) => { const s = select(opts, { value: filters[key] }); s.addEventListener("change", () => { filters[key] = s.value; listPage(root, refresh, go); }); return s; };
  const exportCsv = () => {
    const p = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    if (chosen.size) p.set("ids", [...chosen].join(","));
    location.href = `${F}/export.csv?${p}`;
  };
  const row = (x) => {
    const cb = h("input", { type: "checkbox", "aria-label": `تحديد ${x.name}`, onclick: (e) => { e.stopPropagation(); cb.checked ? chosen.add(x.id) : chosen.delete(x.id); } });
    const step = d.stages.findIndex(([k]) => k === x.stage);
    const openIt = () => { location.hash = `#/schools?school=${x.id}`; };
    return h("div", { class: "sf-row", role: "button", tabindex: 0, onclick: openIt, onkeydown: (e) => { if (e.key === "Enter") openIt(); } },
      h("label", { class: "sf-cb", onclick: (e) => e.stopPropagation() }, cb),
      h("div", { class: "sf-name" }, h("b", {}, x.name), h("small", { class: "ltr" }, x.id),
        h("span", { class: "sub" }, [x.contact_name, x.phone].filter(Boolean).join(" · ") || "—")),
      h("div", { class: "sf-stage" }, badge(Object.fromEntries(d.stages)[x.stage], STAGE_TONE[x.stage]),
        h("div", { class: "sf-steps", "aria-hidden": "true" }, d.stages.map((_, i) => h("i", { class: i <= step ? "on" : "" })))),
      h("div", { class: "sf-meta" }, badge(x.org_type_name, "violet"), badge(...(STATUS[x.status] || [x.status, "gray"])),
        x.delivery ? badge(...DELIV[x.delivery]) : x.activated_at ? null : badge("لم تُسلَّم البيانات", "gray")),
      h("div", { class: "sf-dates" }, h("small", {}, `سُجلت ${fmtDate(x.created_at)}`), h("small", {}, `تحديث ${fmtDate(x.updated_at)}`)),
      h("span", { class: "go", "aria-hidden": "true" }, "‹"));
  };
  const table = h("div", { class: "sf-table" });
  mount(root,
    kpiGrid(
      kpiCard({ icon: "building", tone: "navy", label: "المدارس المسجلة", value: String(c.schools) }),
      kpiCard({ icon: "userPlus", tone: "amber", label: "طلبات جديدة", value: String(c.new_requests), note: c.reviewing ? `${c.reviewing} قيد المراجعة` : null, onClick: go ? () => go("requests") : null }),
      kpiCard({ icon: "share", tone: "violet", label: "لم تُسلَّم بياناتها", value: String(c.not_delivered), onClick: () => { filters.delivery = "none"; listPage(root, refresh, go); } }),
      kpiCard({ icon: "check", tone: "teal", label: "فعّلت حساباتها", value: String(c.activated) })),
    c.failed || c.create_errors ? notice([c.failed ? `${c.failed} مدرسة فشل إرسال بياناتها. ` : "", c.create_errors ? `${c.create_errors} طلب تعثّر إنشاء مدرسته، أعد المحاولة من «الطلبات».` : ""].join(""), "warn") : null,
    panel(`ملفات المدارس (${d.items.length}${d.items.length >= 1000 ? "+" : ""})`, h("div", { class: "row", style: "flex:none;gap:6px" },
      btn([icons.download ? icons.download({ size: 15 }) : null, "تصدير CSV"], exportCsv, "ghost sm")),
      h("div", { class: "sf-filters" }, q,
        sel("org_type", [["", "كل الأنواع"], ...types.types.map((x) => [x.key, x.name])]),
        sel("stage", [["", "كل المراحل"], ...d.stages]),
        sel("delivery", [["", "كل حالات التسليم"], ["none", "لم تُسلَّم"], ["pending", "بانتظار التأكيد"], ["sent", "تم التسليم"], ["failed", "فشل الإرسال"]]),
        sel("status", [["", "كل الحسابات"], ["active", "فعّال"], ["suspended", "موقوف"], ["archived", "مؤرشف"]]),
        sel("sort", [["newest", "الأحدث تسجيلًا"], ["oldest", "الأقدم تسجيلًا"], ["updated", "آخر تحديث"]])),
      h("p", { class: "sub no-print" }, "حدد مدارس لتصديرها فقط، أو صدّر القائمة الظاهرة كلها."),
      d.items.length ? table : empty("لا توجد مدرسة مطابقة.")));
  let shown = 0;
  const more = h("div", { class: "row", style: "justify-content:center;margin-top:10px" });
  const page = () => {
    const next = d.items.slice(shown, shown + 50);
    shown += next.length;
    table.append(...next.map(row));
    mount(more, shown < d.items.length ? btn(`عرض المزيد (${d.items.length - shown})`, page, "ghost sm") : null);
  };
  if (d.items.length) { table.after(more); page(); }
}

// ---------- School file ----------
async function filePage(id, root, back, openHandover = false) {
  mount(root, skeleton(8));
  const [d, ov, types] = await Promise.all([api(`${F}/${id}`), api(`/api/owner/tenants/${id}/overview`).catch(() => null), loadOrgTypes().catch(() => null)]);
  const s = d.school, p = d.profile;
  const reload = () => filePage(id, root, back);
  const tabs = [["info", "المعلومات الأساسية"], ["activation", "الاعتماد والتفعيل"], ["deliveries", "سجل الإرسال"], ["notes", "الملاحظات والتعديلات"], ["account", "الاشتراك والروابط"]];
  let tab = "info";
  const body = h("div");
  const nav = h("div", { class: "seg-tabs file-tabs", role: "tablist" });
  const show = (k) => { tab = k; mount(nav, tabs.map(([key, label]) => h("button", { type: "button", role: "tab", class: key === tab ? "on" : "", onclick: () => show(key) }, label))); mount(body, VIEWS[k]()); };
  const step = d.stages.findIndex(([k]) => k === d.stage);

  const act = (icon, label, fn, cls = "") => h("button", { type: "button", class: `sf-act ${cls}`, onclick: fn }, icons[icon] ? icons[icon]({ size: 17 }) : null, h("span", {}, label));
  const actions = h("div", { class: "sf-bar" },
    act("share", "شاشة التسليم", () => handover(d, reload), "pri"),
    act("print", "بطاقة التسليم", () => pdfDialog(d)),
    act("copy", "رابط الدخول", async () => { await navigator.clipboard.writeText(d.links.login); toast("نُسخ رابط الدخول"); }),
    act("edit", "تعديل", () => editDialog(d, reload)),
    act("grid", "المزيد", () => moreMenu(d, reload)));

  const VIEWS = {
    info: () => infoTab(d, types, reload),
    activation: () => activationTab(d, reload),
    deliveries: () => deliveriesTab(d, reload),
    notes: () => notesTab(d, reload),
    account: () => accountTab(id, ov, reload),
  };
  mount(root,
    h("div", { class: "file-top" },
      btn([icons.chevronLeft ? null : null, "رجوع لملفات المدارس"], back, "ghost sm"),
      h("div", { class: "file-head" },
        h("span", { class: "file-ic", "aria-hidden": "true" }, icons.building({ size: 26 })),
        h("div", {}, h("h2", {}, s.name), h("div", { class: "sub" }, h("bdi", { dir: "ltr" }, s.id), ` · سُجلت ${fmtDate(s.requested_at)}`),
          h("div", { class: "row", style: "justify-content:flex-start;gap:6px;margin-top:4px" }, badge(...(STATUS[s.status] || [s.status, "gray"])),
            ACT_STATE[d.activation_state] ? badge(...ACT_STATE[d.activation_state]) : null, d.delivery ? badge(...DELIV[d.delivery]) : null, s.is_demo ? badge("العرض التجريبي", "blue") : null)))),
    h("ol", { class: "pipeline" }, d.stages.map(([k, label], i) => h("li", { class: i < step ? "done" : i === step ? "on" : "" },
      h("span", { class: "n" }, i < step || (i === step && k === "first_login") ? icons.check({ size: 13 }) : String(i + 1)), h("span", { class: "t" }, label)))),
    h("p", { class: "pipeline-next" }, NEXT[d.stage] || ""),
    actions, nav, body);
  show(tab);
  window.scrollTo({ top: 0 });
  if (openHandover) handover(d, reload);
}
const NEXT = {
  received: "الخطوة التالية: راجع الطلب ثم اعتمده من «الطلبات».",
  review: "الخطوة التالية: اعتمد الطلب لإنشاء المدرسة.",
  approved: "الخطوة التالية: أكمل إنشاء حساب المدير.",
  account: "الخطوة التالية: تأكد من بريد المدير، ثم أرسل للمدرسة رابطها من «شاشة التسليم» وأكّد التسليم.",
  delivered: "الخطوة التالية: بانتظار تفعيل المدير للحساب.",
  first_login: "اكتملت كل الخطوات.",
};

const dl = (rows) => h("dl", { class: "file-dl" }, rows.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
function infoTab(d, types, reload) {
  const p = d.profile, m = p.manager || {};
  return [
    panel("بيانات المدرسة", types ? btn("تغيير النوع", () => changeType(d, types, reload), "ghost sm") : null, dl([["اسم المدرسة", d.school.name], ["الاسم المختصر", p.short_name], ["نوع المؤسسة", d.school.org_type_name],
      ["النوع المطلوب في الطلب", p.org_type && types && typeOf(types, p.org_type)?.key !== d.school.org_type_key ? typeOf(types, p.org_type)?.name || p.org_type : null],
      ["المراحل", (p.stages || []).map((x) => STAGE_NAMES[x] || x).join("، ")], ["عدد الطلاب", p.students_count], ["عدد الفصول", p.classes_count],
      ["العام الدراسي", p.academic_year], ["رقم الترخيص", p.license_no], ["الموقع الإلكتروني", p.website]])),
    panel("المسؤول والتواصل", null, dl([["المسؤول", p.contact_name || [m.first, m.second, m.third, m.family].filter(Boolean).join(" ")], ["المسمى", m.title],
      ["رقم الجوال", p.phone ? h("bdi", { dir: "ltr" }, p.phone) : null], ["رقم بديل", p.phone2 ? h("bdi", { dir: "ltr" }, p.phone2) : null],
      ["البريد الإلكتروني", p.email], ["هاتف المدرسة", p.school_phone], ["بريد المدرسة", p.school_email],
      ["وسيلة التواصل المفضلة", { whatsapp: "واتساب", call: "اتصال", email: "البريد" }[m.preferred]]])),
    panel("الموقع", null, dl([["الدولة", p.country], ["المدينة", p.city], ["المنطقة", p.region], ["العنوان", p.address]])),
    p.note ? panel("ملاحظة المدرسة عند التسجيل", null, h("p", {}, p.note)) : null,
    !Object.keys(p).length ? notice("هذه المدرسة أُنشئت يدويًا بدون طلب تسجيل. أضف بياناتها من «تعديل المعلومات».", "") : null,
  ];
}

// Moving an institution to another type of the same engine. Nothing in its data changes; the change is logged in its file.
function changeType(d, types, reload) {
  const s = d.school;
  const opts = typeOptions(types).filter(([k]) => typeOf(types, k)?.engine === s.org_type);
  const to = select(opts, { value: s.org_type_key });
  const reason = input({ placeholder: "مثال: المدرسة حكومية وسُجلت أهلية بالخطأ" });
  const dd = dialog(`نوع «${s.name}»`, h("div", {},
    notice(`النوع الحالي: ${s.org_type_name}. التغيير هنا بين أنواع نفس طريقة التنظيم فقط، ولا يحذف أي بيانات أو يغيّر أقسام المؤسسة. ويُسجَّل في ملفها.`, ""),
    field("النوع الجديد", to), field("السبب (اختياري)", reason)),
  [btn("حفظ", async () => {
    try {
      const r = await api(`/api/owner/tenants/${s.id}/org-type`, { org_type_key: to.value, reason: reason.value.trim() || undefined }, "PATCH");
      dd.close(); toast(r.changed ? "تغيّر نوع المؤسسة" : "لم يتغير شيء"); reload();
    } catch (e) { toast(e.message, true); }
  })]);
}

export const ACT_STATE = {
  no_email: ["أضف بريد المدير", "red"], waiting: ["جاهزة للتسليم", "blue"], link_sent: ["أُرسل رابط المدرسة — بانتظار أول دخول", "amber"],
  activated: ["اكتمل التفعيل", "green"], recovery: ["رابط استعادة وصول مفتوح", "red"],
};
const VIA = { email: "البريد الإلكتروني", password: "البريد وكلمة المرور", google: "Google", apple: "Apple" };
// The manager's email: their first entry from the school's login link works with this email only.
function managerEmailRow(d, reload) {
  const inp = input({ type: "email", class: "ltr", value: d.profile.email || "", placeholder: "manager@example.com" });
  return h("div", { class: "row", style: "align-items:flex-end;gap:8px" }, field("بريد مدير المدرسة", inp,
    "أول دخول للمدير من رابط المدرسة يقبل هذا البريد فقط (بالبريد أو بحساب Google بنفس البريد)."),
  btn("حفظ البريد", async () => {
    const v = inp.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast("اكتب بريدًا صحيحًا", true);
    try { await api(`${F}/${d.school.id}`, { email: v }, "PATCH"); toast("حُفظ بريد المدير"); reload(); } catch (e) { toast(e.message, true); }
  }, "soft sm"));
}

function activationTab(d, reload) {
  const s = d.school, a = d.admin, st = ACT_STATE[d.activation_state];
  const recovering = d.activation?.recovery;
  return [
    panel("الاعتماد", null, dl([["تاريخ تقديم الطلب", fmtDateTime(s.requested_at)], ["رقم الطلب", s.lead_id ? `#${s.lead_id}` : "أُنشئت يدويًا"],
      ["تاريخ الاعتماد", s.approved_at ? fmtDateTime(s.approved_at) : "—"], ["المسؤول عن الاعتماد", s.approved_by]])),
    panel("التفعيل والدخول", st ? badge(...st) : null, a ? [
      d.account ? null : managerEmailRow(d, reload),
      dl([["مدير المدرسة", d.profile.contact_name || a.full_name],
        ["رابط دخول المدرسة", h("a", { href: d.links.login, target: "_blank", rel: "noopener", class: "ltr" }, d.links.login)],
        ["حساب المدير في مدار", d.account ? h("bdi", { dir: "ltr" }, d.account.email) : "يُنشئه المدير في أول دخول من رابط المدرسة"],
        ["طريقة الربط", d.account ? `${VIA[d.account.linked_via] || d.account.linked_via} — ${fmtDateTime(d.account.linked_at)}` : "—"],
        ["تفعيل الحساب", s.activated_at ? fmtDateTime(s.activated_at) : "لم يتم بعد"],
        ["حالة الحساب", a.is_active ? "فعّال" : "موقوف"],
        ["آخر دخول", a.last_login_at ? fmtDateTime(a.last_login_at) : "—"]]),
      d.account ? h("div", { class: "row act-tools", style: "justify-content:flex-start;gap:8px;flex-wrap:wrap;margin-top:10px" },
        sub("إذا فقد المدير الوصول لحسابه (أو تغيّر المدير): أصدر رابط استعادة وصول، فيربط المدير حسابه الجديد بالمدرسة ويخرج الحساب الحالي."),
        btn(recovering ? "إعادة إصدار رابط الاستعادة" : "رابط استعادة وصول المدير", async () => {
          if (!confirmAction("إصدار رابط استعادة وصول؟ الحساب الذي يربطه المدير به يحل محل الحساب الحالي، ويخرج الحساب الحالي من المدرسة.")) return;
          try { const r = await api(`${F}/${s.id}/link`, {}); await navigator.clipboard.writeText(r.url).catch(() => null); toast("صدر رابط الاستعادة ونُسخ — أرسله للمدير"); reload(); } catch (e) { toast(e.message, true); }
        }, "ghost sm"),
        recovering ? btn("إلغاء رابط الاستعادة", async () => {
          if (!confirmAction("إلغاء رابط الاستعادة؟ لن يعمل بعد الآن.")) return;
          try { await api(`${F}/${s.id}/link/revoke`, {}); toast("أُلغي الرابط"); reload(); } catch (e) { toast(e.message, true); }
        }, "ghost sm") : null) : null,
    ] : notice("لم يُنشأ حساب المدير بعد.", "warn")),
  ];
}

function deliveriesTab(d, reload) {
  const list = d.events.filter((e) => e.kind === "delivery");
  return panel(`سجل الإرسال (${list.length})`, btn("تسليم جديد", () => handover(d, reload), "sm"),
    list.length ? h("div", { class: "dlv-list" }, list.map((e) => h("div", { class: `dlv-row s-${e.status}` },
      h("div", {}, h("b", {}, d.channels[e.channel]), " ", badge(...DELIV[e.status]),
        h("div", { class: "sub" }, [e.recipient, fmtDateTime(e.created_at), e.actor].filter(Boolean).join(" · ")),
        e.error ? h("div", { class: "danger-text" }, e.error) : null,
        e.meta?.confirmed_by ? h("div", { class: "sub" }, `أكّده ${e.meta.confirmed_by}`) : null),
      e.status !== "sent" ? h("div", { class: "row", style: "flex:none;gap:6px" },
        e.status === "pending" ? btn("تم الوصول", () => confirmDelivery(d, e, "sent", reload), "sm") : null,
        e.status === "pending" ? btn("لم يصل", () => confirmDelivery(d, e, "failed", reload), "ghost sm") : null,
        e.status === "failed" ? btn("إعادة المحاولة", () => handover(d, reload), "ghost sm") : null) : null)))
      : empty("لم يُرسل رابط المدرسة بعد."));
}
async function confirmDelivery(d, e, status, reload) {
  let error = null;
  if (status === "failed") { error = prompt("سبب عدم الوصول (اختياري)") || null; }
  try { await api(`${F}/${d.school.id}/deliveries/${e.id}`, { status, error }); toast(status === "sent" ? "سُجّل التسليم" : "سُجّل الفشل"); reload(); }
  catch (err) { toast(err.message, true); }
}

const EVENT_LABEL = { note: "ملاحظة", change: "تعديل البيانات", approved: "الاعتماد", account: "إنشاء الحساب", activation_link: "رابط تفعيل", delivery: "تسليم",
  password: "كلمة مرور مؤقتة", status: "حالة الحساب", activated: "تفعيل المدرسة", error: "خطأ",
  setup_started: "إعداد حساب المدير", account_linked: "ربط حساب المدير", access_reset: "استعادة الوصول" };
function notesTab(d, reload) {
  const t = textarea({ rows: 3, placeholder: "مثال: تواصلنا مع المدير وطلب تأجيل التفعيل لبداية الفصل" });
  const fmtChange = (c) => `${c.label}: ${Array.isArray(c.from) ? c.from.join("، ") : c.from ?? "—"} ← ${Array.isArray(c.to) ? c.to.join("، ") : c.to ?? "—"}`;
  return [
    panel("ملاحظة داخلية", null, field("الملاحظة (لا تظهر للمدرسة)", t), btn("حفظ الملاحظة", async () => {
      if (!t.value.trim()) return toast("اكتب الملاحظة", true);
      try { await api(`${F}/${d.school.id}/notes`, { body: t.value }); toast("حُفظت الملاحظة"); reload(); } catch (e) { toast(e.message, true); }
    }, "sm")),
    panel("سجل النشاط", null, d.events.length ? h("ol", { class: "timeline" }, d.events.map((e) => h("li", { class: `k-${e.kind}` },
      h("div", { class: "tl-head" }, h("b", {}, EVENT_LABEL[e.kind] || e.kind), h("small", {}, `${fmtDateTime(e.created_at)} · ${e.actor}`)),
      e.kind === "change" ? h("ul", { class: "tl-changes" }, (e.meta?.changes || []).map((c) => h("li", {}, fmtChange(c))))
        : e.kind === "delivery" ? h("p", {}, `${d.channels[e.channel]} — ${DELIV[e.status][0]}${e.recipient ? ` — ${e.recipient}` : ""}`)
          : e.body ? h("p", {}, e.body) : null))) : empty("لا يوجد نشاط بعد.")),
  ];
}

function accountTab(id, ov, reload) {
  if (!ov) return notice("تعذر تحميل بيانات الاشتراك.", "err");
  const s = ov.school, sub1 = ov.subscription, L = ov.links;
  const patch = (b, msg, ask) => async () => { if (ask && !confirmAction(ask)) return; await api(`/api/owner/tenants/${id}`, b, "PATCH"); toast(msg); reload(); };
  return [
    stats([["الطلاب", sub1?.max_students ? `${s.students} / ${limitText(sub1.max_students)}` : s.students], ["المعلمون", s.teachers], ["الشعب", s.sections]]),
    panel("الاشتراك", null, sub1 ? dl([["الباقة", sub1.plan_name], ["الحالة", SUB_STATUS[sub1.status]?.[0] || sub1.status], ["النوع", KIND[sub1.kind]],
      ["البداية", fmtDate(sub1.starts_on)], ["النهاية", sub1.ends_on ? fmtDate(sub1.ends_on) : "بلا نهاية"],
      ["المتبقي", sub1.days_left != null ? `${sub1.days_left} يوم` : null]]) : notice("لا يوجد اشتراك.", "warn"),
      sub("لإدارة الاشتراك (تجديد، ترقية، إضافات) افتح تبويب «الاشتراكات».")),
    panel("روابط المدرسة", null, linkRow("دخول الإدارة", L.staff.admin), linkRow("دخول المعلمين", L.staff.teacher), linkRow("دخول المحاسب", L.staff.accountant),
      linkRow("صفحة الطلاب وأولياء الأمور", L.public.home)),
    panel("العرض التجريبي", s.is_demo ? badge("مفعّل", "blue") : null,
      s.is_demo ? btn("إيقاف العرض التجريبي", patch({ is_demo: false }, "أُوقف العرض التجريبي"), "ghost sm")
        : btn("اجعلها مدرسة العرض التجريبي", patch({ is_demo: true }, "صارت مدرسة العرض", "يدخلها أي زائر للتصفح فقط. استخدمها لمدرسة عرض لا لمدرسة حقيقية. متابعة؟"), "ghost sm")),
  ];
}

function editDialog(d, reload) {
  const p = d.profile;
  const name = input({ value: d.school.name });
  const inputs = Object.fromEntries(Object.entries(d.fields).map(([k]) => [k, input({ value: p[k] ?? "", class: ["phone", "phone2", "email", "school_phone", "school_email", "website"].includes(k) ? "ltr" : "" })]));
  const dd = dialog("تعديل معلومات المدرسة", h("div", { class: "edit-grid" }, field("اسم المدرسة", name),
    Object.entries(d.fields).map(([k, label]) => field(label, inputs[k])),
    sub("يُحفظ كل تعديل في سجل التعديلات مع القيمة السابقة واسم من عدّل.")), [
    btn("حفظ", async () => {
      const b = { name: name.value, ...Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim() || null])) };
      try { const r = await api(`${F}/${d.school.id}`, b, "PATCH"); dd.close(); toast(r.changed ? `حُفظ ${r.changed} تعديل` : "لا تغييرات"); reload(); } catch (e) { toast(e.message, true); }
    })]);
  dd.classList.add("xb-wide");
}

function moreMenu(d, reload) {
  const id = d.school.id;
  const items = [
    d.school.status === "active"
      ? btn("إيقاف الحساب مؤقتًا", async () => {
        const reason = prompt("سبب الإيقاف (يظهر في السجل)");
        if (reason === null) return;
        await api(`${F}/${id}/status`, { status: "suspended", reason }); dd.close(); toast("أُوقف الحساب"); reload();
      }, "danger")
      : btn("إعادة تفعيل الحساب", async () => { await api(`${F}/${id}/status`, { status: "active" }); dd.close(); toast("أُعيد التفعيل"); reload(); }),
    btn("نسخ رابط صفحة أولياء الأمور", async () => { await navigator.clipboard.writeText(d.links.parents); toast("نُسخ"); }, "ghost"),
  ].filter(Boolean);
  const dd = dialog("إجراءات أخرى", h("div", { class: "more-acts" }, items));
}

// ---------- Handover ----------
// The school's own login link is all the manager needs: on first entry it asks them to create the manager
// account with the email recorded here (or Google with the same email). No separate activation link.
function welcome(d) {
  const mail = d.profile.email;
  return ["أهلًا بكم في مدار | MIDAR", "",
    `نرحب بكم في منصة مدار لإدارة المدارس، ونسعد بانضمام ${d.school.name} إلى المنصة.`, "",
    "حساب مدرستكم جاهز، وهذا رابط الدخول الخاص بها:", d.links.login, "",
    "أول دخول:",
    "1. افتحوا الرابط.",
    `2. اختاروا «إنشاء حساب المدير» وسجّلوا بالبريد الإلكتروني ${mail || "المسجل لدينا"}، أو تابعوا بحساب Google بنفس البريد.`,
    "3. أدخلوا رمز التحقق الذي يصل بريدكم، وتفتح لوحة المدرسة مباشرة.", "",
    "بعدها تدخلون من الرابط نفسه بأي جهاز.", "",
    "نتمنى لكم تجربة موفقة مع مدار.", "مدار | كل إدارة مدرستك في مكان واحد."].join("\n");
}

async function handover(d, reload) {
  const id = d.school.id, p = d.profile;
  const text = textarea({ rows: 14, class: "ho-msg" });
  text.value = welcome(d);
  const record = async (channel, recipient) => {
    try { const r = await api(`${F}/${id}/deliveries`, { channel, recipient }); return r; } catch (e) { toast(e.message, true); return null; }
  };
  const askConfirm = (r, label) => {
    if (!r) return;
    const c = dialog("تأكيد التسليم", h("div", {}, h("p", {}, `هل وصلت الرسالة للمدرسة عبر ${label}؟`),
      sub("لا تُسجَّل كمسلَّمة إلا بعد تأكيدك. يمكنك التأكيد لاحقًا من «سجل الإرسال».")), [
      btn("نعم، وصلت", async () => { await api(`${F}/${id}/deliveries/${r.event_id}`, { status: "sent" }); c.close(); toast("سُجّل التسليم"); }),
      btn("لاحقًا", () => c.close(), "ghost")]);
  };
  const phone = p.phone || p.school_phone;
  const ready = Boolean(p.email) || d.account;
  const ways = h("div", { class: "ho-ways" },
    h("button", { type: "button", class: "ho-way", disabled: !phone || !ready, onclick: async () => {
      const r = await record("whatsapp", phone); if (!r) return;
      window.open(waLink(phone, text.value) || `https://wa.me/?text=${encodeURIComponent(text.value)}`, "_blank", "noopener"); askConfirm(r, "واتساب");
    } }, icons.message({ size: 20 }), h("b", {}, "واتساب"), h("small", {}, phone ? `يفتح محادثة مع ${phone}` : "لا يوجد جوال")),
    h("button", { type: "button", class: "ho-way", disabled: !ready, onclick: async () => {
      await navigator.clipboard.writeText(text.value); const r = await record("copy", null); toast("نُسخت الرسالة"); askConfirm(r, "النسخ والإرسال اليدوي");
    } }, icons.copy({ size: 20 }), h("b", {}, "نسخ الرسالة"), h("small", {}, "ترسلها بنفسك من أي تطبيق")),
    h("button", { type: "button", class: "ho-way", disabled: !ready, onclick: () => pdfDialog(d) }, icons.print({ size: 20 }), h("b", {}, "بطاقة التسليم"), h("small", {}, "وثيقة رسمية للطباعة أو الحفظ PDF")));
  const dd = dialog("تسليم رابط المدرسة", h("div", { class: "handover-x" },
    h("header", { class: "ho-hero" }, brandLogo("ho-logo", true, "row"),
      h("h2", {}, "تم اعتماد مدرستكم بنجاح"), h("p", {}, `أهلًا بـ ${d.school.name} في منصة مدار. حساب المدرسة جاهز للبدء.`)),
    h("div", { class: "ho-cards" },
      h("section", { class: "ho-card" }, h("h3", {}, icons.building({ size: 18 }), "بيانات المدرسة"),
        dl([["اسم المدرسة", d.school.name], ["مدير المدرسة", p.contact_name],
          ["رابط الدخول", h("a", { href: d.links.login, target: "_blank", rel: "noopener", class: "ltr" }, d.links.login)]])),
      h("section", { class: "ho-card" }, h("h3", {}, icons.key({ size: 18 }), "أول دخول"),
        h("ol", { class: "ho-steps" }, h("li", {}, "يفتح المدير رابط المدرسة."),
          h("li", {}, "يختار «إنشاء حساب المدير» ويسجّل بالبريد المسجل أو بحساب Google بنفس البريد."),
          h("li", {}, "يدخل رمز التحقق وتفتح لوحة المدرسة مباشرة.")),
        d.account ? notice("المدير أنشأ حسابه ودخل المدرسة.", "") : managerEmailRow(d, reload))),
    ready ? null : notice("أضف بريد المدير أولًا: أول دخول من رابط المدرسة لا يتم إلا به.", "warn"),
    h("section", { class: "ho-card" }, h("h3", {}, icons.message({ size: 18 }), "رسالة الترحيب الجاهزة"), text),
    h("h3", { class: "ho-sub" }, "طريقة التسليم"), ways, handoverDoc(d)), []);
  dd.classList.add("xb-wide", "ho-dlg");
  dd.addEventListener("close", () => reload());
}

function pdfDialog(d) {
  const dd = dialog("بطاقة تسليم حساب المدرسة", h("div", {},
    sub("يُنشأ ملف أنيق للطباعة أو الحفظ كـ PDF (من نافذة الطباعة اختر «حفظ كـ PDF»). لا يحتوي أي رابط سري أو كلمة مرور.")), [
    btn([icons.print({ size: 15 }), "إنشاء الملف"], async () => {
      dd.close();
      await api(`${F}/${d.school.id}/deliveries`, { channel: "pdf", recipient: null }).catch(() => null);
      printActivation(d);
    })]);
}

// The handover document: one printed page that the school keeps. It carries the school's login link (with a QR
// code), the manager's email for first entry, the first-entry steps and the security rules. Never a password.
function handoverDoc(d) {
  const p = d.profile;
  const issued = new Date();
  const ref = `MD-${d.school.id.toUpperCase()}-${issued.toISOString().slice(0, 10).replace(/-/g, "")}`;
  const row = (k, v, cls = "") => h("div", { class: `hd-row ${cls}` }, h("span", {}, k), h("b", {}, v));
  return h("article", { class: "ho-doc", "aria-hidden": "true" },
    h("header", { class: "hd-head" },
      brandLogo("hd-logo", false, "row"),
      h("div", { class: "hd-title" }, h("h1", {}, "بطاقة تسليم حساب المدرسة"), h("small", {}, "وثيقة صادرة من منصة مدار لإدارة المدارس")),
      h("div", { class: "hd-ref" }, h("small", {}, "رقم الوثيقة"), h("b", { class: "ltr" }, ref), h("small", {}, `تاريخ الإصدار ${fmtDate(issued)}`))),
    h("p", { class: "hd-hello" }, `يسعدنا انضمام ${d.school.name} إلى منصة مدار. حساب المدرسة مفعّل وجاهز، وهذه البطاقة تتضمن كل ما يحتاجه مدير المدرسة للدخول الأول بأمان.`),
    h("div", { class: "hd-grid" },
      h("section", { class: "hd-box" }, h("h2", {}, "بيانات المدرسة"),
        row("اسم المدرسة", d.school.name),
        row("رمز المدرسة", d.school.id, "ltr-v"),
        row("مدير المدرسة", p.contact_name || "—"),
        row("تاريخ الاعتماد", fmtDate(d.school.approved_at || d.school.requested_at)),
        row("حالة الحساب", "مفعّل")),
      h("section", { class: "hd-box hd-login" }, h("h2", {}, "الدخول إلى المنصة"),
        h("div", { class: "hd-qr" },
          d.links.login_qr ? h("img", { src: d.links.login_qr, alt: "" }) : null,
          h("div", {},
            h("small", {}, "رابط دخول المدرسة"), h("b", { class: "ltr hd-link" }, d.links.login),
            h("small", {}, "بريد المدير المعتمد لأول دخول"), h("b", { class: "ltr" }, p.email || "—"),
            h("small", { class: "hd-scan" }, "امسح الرمز بكاميرا الجوال لفتح رابط الدخول"))))),
    h("section", { class: "hd-box" }, h("h2", {}, "خطوات الدخول الأول"),
      h("ol", { class: "hd-steps" },
        h("li", {}, h("b", {}, "افتحوا رابط الدخول"), h("span", {}, "من الرابط أعلاه أو بمسح الرمز.")),
        h("li", {}, h("b", {}, "أنشئوا حساب المدير"), h("span", {}, "بالبريد المعتمد أعلاه، أو بحساب Google بنفس البريد.")),
        h("li", {}, h("b", {}, "أدخلوا رمز التحقق"), h("span", {}, "يصل إلى البريد نفسه، وتفتح لوحة المدرسة مباشرة.")),
        h("li", {}, h("b", {}, "أكملوا إعداد المدرسة"), h("span", {}, "المراحل والفصول والمعلمون والطلاب من معالج الإعداد.")))),
    h("section", { class: "hd-box hd-safe" }, h("h2", {}, "أمان حسابكم"),
      h("ul", {},
        h("li", {}, "لا تحتوي هذه البطاقة أي كلمة مرور، ولن يطلب منكم فريق مدار كلمة المرور أو رمز التحقق أبدًا."),
        h("li", {}, "الدخول الأول لا يتم إلا بالبريد المعتمد أعلاه، فلا يستطيع غيركم إنشاء حساب المدير."),
        h("li", {}, "أي دخول من جهاز جديد يحتاج رمز تحقق يصل إلى بريد المدير، ويصلكم إشعار بكل دخول جديد."),
        h("li", {}, "بيانات مدرستكم معزولة تمامًا عن غيرها، وتُحفظ لها نسخ احتياطية يومية."))),
    h("section", { class: "hd-sign" },
      h("div", {}, h("small", {}, "اعتماد"), h("b", {}, "إدارة منصة مدار"), h("i", {})),
      h("div", {}, h("small", {}, "استلام"), h("b", {}, "مدير المدرسة"), h("i", {})),
      h("div", {}, h("small", {}, "التاريخ"), h("b", {}, fmtDate(issued)), h("i", {}))),
    h("footer", { class: "hd-foot" },
      h("div", {}, h("small", {}, "الدعم والتواصل"), h("b", {}, "midarschool.com"), h("b", { class: "ltr" }, "0510235422"), h("b", { class: "ltr" }, "@midar.school")),
      h("div", { class: "hd-seal" }, h("b", {}, "مدار | MIDAR"), h("small", {}, "كل إدارة مدرستك في مكان واحد"))));
}

function printActivation(d) {
  document.querySelectorAll("body > .act-sheet").forEach((x) => x.remove());
  const sheet = h("div", { class: "act-sheet" }, handoverDoc(d));
  document.body.append(sheet);
  document.body.classList.add("act-printing");
  const done = () => { sheet.remove(); document.body.classList.remove("act-printing"); window.removeEventListener("afterprint", done); };
  // On phones the print window opens without waiting, so nothing is removed on a timer (the preview would then show
  // the panel behind instead of the card). The card is invisible on screen anyway; it goes after printing or on the
  // next print.
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 150);
}
