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

const F = "/api/owner/files";
const STATUS = { active: ["فعّال", ""], suspended: ["موقوف", "red"], archived: ["مؤرشف", "gray"] };
const DELIV = { sent: ["تم التسليم", ""], pending: ["بانتظار التأكيد", "amber"], failed: ["فشل الإرسال", "red"] };
const STAGE_TONE = { received: "amber", review: "amber", approved: "violet", account: "violet", delivered: "", first_login: "" };
const ORG = { private: "أهلية", public: "حكومية", international: "دولية", institute: "معهد تعليمي", other: "أخرى" };
const STAGE_NAMES = { kg: "رياض الأطفال", primary: "الابتدائية", middle: "المتوسطة", secondary: "الثانوية" };
const filters = { q: "", stage: "", delivery: "", status: "", sort: "newest" };

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
  const d = await api(`${F}?${qs}`);
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
      h("div", { class: "sf-meta" }, badge(...(STATUS[x.status] || [x.status, "gray"])),
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
        sel("stage", [["", "كل المراحل"], ...d.stages]),
        sel("delivery", [["", "كل حالات التسليم"], ["none", "لم تُسلَّم"], ["pending", "بانتظار التأكيد"], ["sent", "تم التسليم"], ["failed", "فشل الإرسال"]]),
        sel("status", [["", "كل الحسابات"], ["active", "فعّال"], ["suspended", "موقوف"], ["archived", "مؤرشف"]]),
        sel("sort", [["newest", "الأحدث تسجيلًا"], ["oldest", "الأقدم تسجيلًا"], ["updated", "آخر تحديث"]])),
      sub("حدد مدارس لتصديرها فقط، أو صدّر القائمة الظاهرة كلها."),
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
  const [d, ov] = await Promise.all([api(`${F}/${id}`), api(`/api/owner/tenants/${id}/overview`).catch(() => null)]);
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
    d.admin ? act("key", "رابط جديد", async () => {
      if (!confirmAction("إصدار رابط تفعيل جديد؟ يتوقف الرابط السابق فورًا.")) return;
      try { await api(`${F}/${id}/link`, {}); toast("صدر رابط تفعيل جديد"); const fresh = await api(`${F}/${id}`); handover(fresh, reload); } catch (e) { toast(e.message, true); }
    }) : null,
    act("print", "ملف PDF", () => pdfDialog(d)),
    act("copy", "رابط الدخول", async () => { await navigator.clipboard.writeText(d.links.login); toast("نُسخ رابط الدخول"); }),
    act("edit", "تعديل", () => editDialog(d, reload)),
    act("grid", "المزيد", () => moreMenu(d, reload)));

  const VIEWS = {
    info: () => infoTab(d),
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
  account: "الخطوة التالية: أرسل للمدرسة رابط التفعيل من «شاشة التسليم»، ثم أكّد التسليم.",
  delivered: "الخطوة التالية: بانتظار تفعيل المدير للحساب.",
  first_login: "اكتملت كل الخطوات.",
};

const dl = (rows) => h("dl", { class: "file-dl" }, rows.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
function infoTab(d) {
  const p = d.profile, m = p.manager || {};
  return [
    panel("بيانات المدرسة", null, dl([["اسم المدرسة", d.school.name], ["الاسم المختصر", p.short_name], ["نوع المؤسسة", ORG[p.org_type] || p.org_type],
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

export const ACT_STATE = {
  pending: ["بانتظار التفعيل", "gray"], link_ready: ["رابط الإعداد جاهز", "blue"], link_sent: ["أُرسل رابط الإعداد", "blue"],
  started: ["بدأ إعداد الحساب", "amber"], account_created: ["أنشأ حسابه ووثّق بريده", "amber"],
  activated: ["اكتمل التفعيل", "green"], recovery: ["يحتاج إلى استعادة الوصول", "red"], expired: ["انتهت صلاحية الرابط", "red"],
};
const VIA = { email: "البريد الإلكتروني", password: "البريد وكلمة المرور", google: "Google", apple: "Apple" };
function activationTab(d, reload) {
  const s = d.school, a = d.admin, st = ACT_STATE[d.activation_state];
  const open = d.activation && d.activation_state !== "activated";
  return [
    panel("الاعتماد", null, dl([["تاريخ تقديم الطلب", fmtDateTime(s.requested_at)], ["رقم الطلب", s.lead_id ? `#${s.lead_id}` : "أُنشئت يدويًا"],
      ["تاريخ الاعتماد", s.approved_at ? fmtDateTime(s.approved_at) : "—"], ["المسؤول عن الاعتماد", s.approved_by]])),
    panel("التفعيل والدخول", st ? badge(...st) : null, a ? [
      dl([["مدير المدرسة", d.profile.contact_name || a.full_name],
        ["حساب المدير في مدار", d.account ? h("bdi", { dir: "ltr" }, d.account.email) : "يُنشئه المدير من رابط الإعداد"],
        ["طريقة الربط", d.account ? `${VIA[d.account.linked_via] || d.account.linked_via} — ${fmtDateTime(d.account.linked_at)}` : "—"],
        ["رابط التفعيل", d.activation ? `صالح حتى ${fmtDateTime(d.activation.expires_at)}` : "لا يوجد رابط صالح"],
        ["فتح رابط الإعداد", d.activation?.started_at ? fmtDateTime(d.activation.started_at) : d.account ? "تم" : "لم يُفتح بعد"],
        ["تفعيل الحساب", s.activated_at ? fmtDateTime(s.activated_at) : "لم يتم بعد"],
        ["حالة الحساب", a.is_active ? "فعّال" : "موقوف"],
        ["آخر دخول", a.last_login_at ? fmtDateTime(a.last_login_at) : "—"]]),
      h("div", { class: "row act-tools", style: "justify-content:flex-start;gap:8px;flex-wrap:wrap;margin-top:10px" },
        btn(open ? "إعادة إصدار الرابط" : "إصدار رابط تفعيل", async () => {
          if (!confirmAction(open ? "إصدار رابط جديد؟ يتوقف الرابط الحالي فورًا."
            : d.account ? "إصدار رابط استعادة وصول؟ الحساب الذي يربطه المدير به يحل محل الحساب الحالي، ويخرج الحساب الحالي من المدرسة." : "إصدار رابط إعداد حساب المدير؟")) return;
          try { await api(`${F}/${s.id}/link`, {}); toast("صدر رابط تفعيل جديد"); reload(); } catch (e) { toast(e.message, true); }
        }, "sm"),
        open ? btn("إلغاء الرابط", async () => {
          if (!confirmAction("إلغاء رابط التفعيل الحالي؟ لن يعمل بعد الآن.")) return;
          try { await api(`${F}/${s.id}/link/revoke`, {}); toast("أُلغي الرابط"); reload(); } catch (e) { toast(e.message, true); }
        }, "ghost sm") : null,
        null),
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
      : empty("لم يُرسل رابط التفعيل لهذه المدرسة بعد."));
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
function welcome(d, link) {
  return ["أهلًا بكم في مدار | MIDAR", "",
    `نرحب بكم في منصة مدار لإدارة المدارس، ونسعد بانضمام ${d.school.name} إلى المنصة.`, "",
    "تم تجهيز حساب مدرستكم. لتفعيله:",
    `1. افتحوا رابط الإعداد:\n${link || "(سيصلكم رابط الإعداد)"}`,
    "2. أنشئوا حسابكم بالبريد الإلكتروني أو تابعوا بحساب Google أو Apple.",
    "3. يرتبط الحساب بمدرستكم وتدخلون لوحة المدرسة مباشرة.",
    `بعدها تدخلون من أي جهاز عبر:\n${d.links.login}`, "",
    "نتمنى لكم تجربة موفقة مع مدار.", "مدار | كل إدارة مدرستك في مكان واحد."].join("\n");
}

async function handover(d, reload) {
  let link = d.activation?.url || null;
  const id = d.school.id, p = d.profile;
  const linkBox = h("div");
  const text = textarea({ rows: 12, class: "ho-msg" });
  const drawLink = () => {
    text.value = welcome(d, link);
    mount(linkBox, d.school.activated_at && !link
      ? notice("المدرسة فعّلت حسابها.", "")
      : link ? h("div", { class: "ho-link" }, h("span", {}, "رابط الإعداد (يُستخدم مرة واحدة)"), h("code", { class: "ltr" }, link),
        h("small", {}, `صالح حتى ${fmtDateTime(d.activation?.expires_at || Date.now() + 7 * 864e5)}`))
        : h("div", { class: "row", style: "justify-content:flex-start" }, notice("لا يوجد رابط إعداد صالح.", "warn"),
          btn("إصدار رابط إعداد", async () => {
            try { const r = await api(`${F}/${id}/link`, {}); link = r.url; d.activation = r; drawLink(); toast("صدر الرابط"); } catch (e) { toast(e.message, true); }
          }, "sm")));
  };
  drawLink();
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
  const ways = h("div", { class: "ho-ways" },
    h("button", { type: "button", class: "ho-way", disabled: !phone, onclick: async () => {
      const r = await record("whatsapp", phone); if (!r) return;
      window.open(waLink(phone, text.value) || `https://wa.me/?text=${encodeURIComponent(text.value)}`, "_blank", "noopener"); askConfirm(r, "واتساب");
    } }, icons.message({ size: 20 }), h("b", {}, "واتساب"), h("small", {}, phone ? `يفتح محادثة مع ${phone}` : "لا يوجد جوال")),
    h("button", { type: "button", class: "ho-way", onclick: async () => {
      await navigator.clipboard.writeText(text.value); const r = await record("copy", null); toast("نُسخت الرسالة"); askConfirm(r, "النسخ والإرسال اليدوي");
    } }, icons.copy({ size: 20 }), h("b", {}, "نسخ الرسالة"), h("small", {}, "ترسلها بنفسك من أي تطبيق")),
    h("button", { type: "button", class: "ho-way", onclick: () => pdfDialog(d, link) }, icons.print({ size: 20 }), h("b", {}, "ملف PDF"), h("small", {}, "ملف تفعيل المدرسة للطباعة أو الحفظ")),
    h("button", { type: "button", class: "ho-way off", disabled: true, title: "خدمة البريد غير مهيأة" }, icons.send ? icons.send({ size: 20 }) : icons.message({ size: 20 }),
      h("b", {}, "البريد الإلكتروني"), h("small", {}, "غير مهيأ بعد في المنصة")));
  const dd = dialog("تسليم رابط الإعداد", h("div", { class: "handover-x" },
    h("header", { class: "ho-hero" }, brandLogo("ho-logo", true, "row"),
      h("h2", {}, "تم اعتماد مدرستكم بنجاح"), h("p", {}, `أهلًا بـ ${d.school.name} في منصة مدار. حساب المدرسة جاهز للبدء.`)),
    h("div", { class: "ho-cards" },
      h("section", { class: "ho-card" }, h("h3", {}, icons.building({ size: 18 }), "بيانات المدرسة"),
        dl([["اسم المدرسة", d.school.name], ["مدير المدرسة", p.contact_name],
          ["رابط تسجيل الدخول", h("a", { href: d.links.login, target: "_blank", rel: "noopener", class: "ltr" }, d.links.login)]])),
      h("section", { class: "ho-card" }, h("h3", {}, icons.key({ size: 18 }), "التفعيل"),
        h("ol", { class: "ho-steps" }, h("li", {}, "يفتح المدير رابط الإعداد."), h("li", {}, "ينشئ حسابه بالبريد الإلكتروني أو Google أو Apple."),
          h("li", {}, "يرتبط الحساب بالمدرسة ويدخل لوحتها مباشرة.")),
        linkBox)),
    h("section", { class: "ho-card" }, h("h3", {}, icons.message({ size: 18 }), "رسالة الترحيب الجاهزة"), text),
    h("h3", { class: "ho-sub" }, "طريقة التسليم"), ways,), []);
  dd.classList.add("xb-wide", "ho-dlg");
  dd.addEventListener("close", () => reload());
}

function pdfDialog(d, link = d.activation?.url) {
  const withLink = h("input", { type: "checkbox", checked: Boolean(link), disabled: !link });
  const dd = dialog("ملف تفعيل المدرسة – مدار MIDAR", h("div", {},
    sub("يُنشأ ملف أنيق للطباعة أو الحفظ كـ PDF (من نافذة الطباعة اختر «حفظ كـ PDF»)."),
    h("label", { class: "chk" }, withLink, link ? "تضمين رابط التفعيل (الملف يصبح سريًا حتى يُستخدم الرابط)" : "لا يوجد رابط تفعيل صالح لتضمينه"),
  ), [
    btn([icons.print({ size: 15 }), "إنشاء الملف"], async () => {
      dd.close();
      await api(`${F}/${d.school.id}/deliveries`, { channel: "pdf", recipient: null }).catch(() => null);
      printActivation(d, withLink.checked ? link : null);
    })]);
}

function printActivation(d, link) {
  const p = d.profile;
  const sheet = h("div", { class: "act-sheet" },
    h("header", {}, brandLogo("act-logo", false, "row"), h("div", {}, h("h1", {}, "ملف تفعيل المدرسة"), h("small", {}, "مدار | MIDAR — كل إدارة مدرستك في مكان واحد"))),
    h("p", { class: "act-hello" }, `أهلًا بكم في مدار. نسعد بانضمام ${d.school.name} إلى المنصة، وقد أصبح حساب مدرستكم جاهزًا للبدء.`),
    h("section", {}, h("h2", {}, "بيانات المدرسة"), dl([["اسم المدرسة", d.school.name], ["مدير المدرسة", p.contact_name],
      ["تاريخ الاعتماد", d.school.approved_at ? fmtDate(d.school.approved_at) : fmtDate(d.school.requested_at)]])),
    h("section", {}, h("h2", {}, "الدخول إلى المنصة"), dl([["رابط تسجيل الدخول", d.links.login],
      link ? ["رابط التفعيل", link] : null].filter(Boolean)),
      link ? h("p", { class: "act-warn" }, "رابط التفعيل سري ويُستخدم مرة واحدة. احفظوا هذا الملف في مكان آمن.") : null),
    h("section", {}, h("h2", {}, "خطوات البدء"), h("ol", {},
      h("li", {}, link ? "افتحوا رابط التفعيل أعلاه." : "افتحوا رابط التفعيل الذي يصلكم."),
      h("li", {}, "أنشئوا حسابكم بالبريد الإلكتروني أو تابعوا بحساب Google أو Apple."),
      h("li", {}, "يرتبط الحساب بالمدرسة، وبعدها تدخلون من أي جهاز بالحساب نفسه."),
      h("li", {}, "أكملوا معالج الإعداد: المراحل والفصول والمعلمون والطلاب."),
      h("li", {}, "شاركوا رابط صفحة المدرسة مع أولياء الأمور."))),
    h("section", {}, h("h2", {}, "الدعم"), dl([["الموقع", "midarschool.com"], ["الجوال وواتساب", "0510235422"], ["إنستغرام", "@midar.school"]])),
    h("footer", {}, `أُنشئ ${fmtDateTime(new Date())} · مدار | MIDAR`));
  document.body.append(sheet);
  document.body.classList.add("act-printing");
  const done = () => { sheet.remove(); document.body.classList.remove("act-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(() => { if (!matchMedia("print").matches) done(); }, 1500); }, 150);
}
