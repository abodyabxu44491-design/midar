// «اشتراكي»: الباقة والحالة والتواريخ والاستخدام، ومميزات الاشتراك (الفعّالة والمقفلة)، والترقية والتجديد،
// وطلبات المدرسة وسجل الاشتراك. نفس الصفحة تظهر كشاشة وحيدة عند توقف الاشتراك (والبيانات محفوظة).
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, badge, sub, notice, toast, dialog, empty, line, topbar, footer } from "../../shared/js/ui.js";
import { icons } from "../../shared/js/icons.js";
import { fmtDate } from "../../shared/js/format.js";

const A = "/api/admin/subscription";
const CUR = { SAR: "ريال", USD: "دولار", YER: "ريال يمني" };
const STATE_BADGE = { trial: ["تجربة مجانية", "amber"], trial_grace: ["انتهت التجربة — فترة سماح", "amber"], active: ["فعّالة", ""], grace: ["فترة سماح", "amber"], locked: ["متوقفة", "red"] };
const REQ = { feature: "طلب ميزة", upgrade: "طلب ترقية", renewal: "طلب تجديد", subscription: "طلب اشتراك", contact: "تواصل" };
const RSTATUS = { new: ["بانتظار الرد", "amber"], reviewing: ["قيد المراجعة", "blue"], approved: ["تمت الموافقة", ""], awaiting_payment: ["بانتظار الدفع", "amber"],
  active: ["منفّذ", ""], rejected: ["مرفوض", "gray"], canceled: ["ملغي", "gray"], expired: ["منتهي", "gray"] };

// تاريخ عربي مختصر مثل «17 أكتوبر»
const dayMonth = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("ar", { day: "numeric", month: "long" }) : "");

/* ---------- الشريط أعلى اللوحة ---------- */
export function accessBanner(access, goTo) {
  if (!access || access.locked) return null;
  const go = goTo ? btn("اشتراكي", () => goTo("subscription"), "ghost sm") : null;
  if (access.state === "trial" || access.state === "trial_grace") {
    const d = access.days_left;
    const soon = d !== null && d <= 7;
    const text = access.state === "trial_grace" ? "انتهت فترة التجربة المجانية، وأنت الآن في فترة سماح قصيرة. اختر باقة للاستمرار."
      : d === 0 ? "تنتهي تجربتك المجانية اليوم." : d === 1 ? "تنتهي تجربتك المجانية غدًا."
      : soon ? `تبقى ${d} أيام على انتهاء تجربتك المجانية.` : `أنت تستخدم النسخة التجريبية المجانية — متبقي ${d} يومًا.`;
    return h("div", { class: `sub-banner ${soon ? "warn" : "trial"}` }, icons.gift({ size: 20 }),
      h("div", {}, h("b", {}, text), h("small", {}, `تنتهي التجربة في: ${dayMonth(access.ends_on)} — بياناتك تبقى محفوظة بعد التجربة.`)), go);
  }
  if (access.state === "grace") {
    return h("div", { class: "sub-banner warn" }, icons.calendar({ size: 20 }),
      h("div", {}, h("b", {}, "انتهى اشتراك مدرستك، وأنت الآن في فترة السماح."), h("small", {}, `يتوقف الوصول بعد ${access.grace_left} يوم. جدّد الاشتراك للاستمرار.`)), go);
  }
  if (access.state === "active" && access.days_left !== null && access.days_left <= 7) {
    return h("div", { class: "sub-banner" }, icons.calendar({ size: 20 }),
      h("div", {}, h("b", {}, `ينتهي اشتراك مدرستك بعد ${access.days_left} يوم (${dayMonth(access.ends_on)}).`), h("small", {}, "جدّد مبكرًا لتجنب أي توقف.")), go);
  }
  return null;
}

/* ---------- شاشة الاشتراك المتوقف ---------- */
export async function lockScreen(me, root) {
  mount(root,
    topbar({ school: me.school.name, subtitle: `إدارة المدرسة — ${me.name}`, onLogout: async () => { await api("/api/admin/logout", {}); location.reload(); } }),
    h("main", {}, await mySubscription({ me, show: () => location.reload() })), footer());
}

/* ---------- الصفحة ---------- */
export async function mySubscription({ me, show }) {
  const d = await api(A);
  const s = d.subscription;
  const a = d.access;
  const locked = a.locked;
  const expiredTrial = a.status === "trial_expired";
  const wa = d.support?.whatsapp ? `https://wa.me/${String(d.support.whatsapp).replace(/\D/g, "")}` : null;
  const reqMode = d.feature_request_mode;
  const pct = (used, max) => (max ? Math.min(100, Math.round((used / max) * 100)) : 0);
  const usageRow = (label, used, max) => h("div", { style: "margin-bottom:8px" },
    h("div", { class: "row", style: "justify-content:space-between" }, h("span", {}, label), h("b", { style: "flex:none" }, `${used} / ${max ?? "مفتوح"}`)),
    max ? h("div", { class: "bar" }, h("i", { style: `width:${pct(used, max)}%` })) : null);

  const header = locked
    ? h("div", { class: "sub-lock" }, icons.lock({ size: 34 }),
      h("h2", {}, expiredTrial ? "انتهت تجربتك المجانية" : a.status === "expired" ? "انتهى اشتراك مدرستك" : "اشتراك مدرستك متوقف"),
      h("p", {}, a.message),
      h("p", { class: "sub" }, "كل بيانات مدرستك محفوظة كما هي: الطلاب والمعلمون والدرجات والحضور والرسوم والإعدادات، وتعود للعمل فور التفعيل."),
      h("div", { class: "row", style: "justify-content:center;gap:8px" },
        d.plans.length ? btn(expiredTrial ? "اختر باقة للاستمرار" : "تجديد الاشتراك", () => document.getElementById("sub-plans")?.scrollIntoView({ behavior: "smooth" })) : null,
        btn("طلب تجديد", () => requestDialog("renewal", {}, show), "soft"),
        wa ? h("a", { class: "btn ghost", href: wa, target: "_blank", rel: "noopener" }, "تواصل عبر واتساب") : null))
    : null;

  const current = s ? panel("اشتراكي", badge(...(STATE_BADGE[a.state] || [s.status_label, "gray"])),
    h("div", { class: "row", style: "flex-wrap:wrap;gap:22px;margin-bottom:10px" },
      h("div", {}, sub("الباقة"), h("b", { style: "font-size:18px" }, s.plan_name)),
      h("div", {}, sub("الحالة"), h("b", {}, s.status_label)),
      h("div", {}, sub("تاريخ البداية"), h("b", {}, fmtDate(s.starts_on))),
      h("div", {}, sub("تاريخ الانتهاء"), h("b", {}, s.ends_on ? fmtDate(s.ends_on) : "بلا نهاية")),
      a.days_left != null && !locked ? h("div", {}, sub("المتبقي"), h("b", {}, `${a.days_left} يوم`)) : null),
    s.kind === "trial" && !locked ? notice(`أنت تستخدم النسخة التجريبية المجانية بكل مميزات «${s.plan_name}». تنتهي في ${dayMonth(s.ends_on)}، وبياناتك تبقى بعدها.`, "warn") : null,
    usageRow("عدد الطلاب المستخدم", d.usage.students, s.max_students),
    usageRow("عدد المعلمين", d.usage.teachers, s.max_teachers),
    !locked ? h("div", { class: "row spaced", style: "justify-content:flex-start;flex-wrap:wrap" },
      s.kind === "trial" ? btn("اشترك الآن", () => document.getElementById("sub-plans")?.scrollIntoView({ behavior: "smooth" })) : btn("تجديد الاشتراك", () => requestDialog("renewal", {}, show)),
      btn("ترقية الباقة", () => document.getElementById("sub-plans")?.scrollIntoView({ behavior: "smooth" }), "soft"),
      btn("تواصل مع إدارة المنصة", () => requestDialog("contact", {}, show), "ghost")) : null) : null;

  // المميزات: الفعّالة، ثم المقفلة مع زر الطلب حسب إعداد المنصة
  const cats = [...new Set(d.features.map((f) => f.category))];
  const features = panel("مميزات اشتراكك", null,
    cats.map((c) => [h("div", { class: "sub", style: "margin:10px 0 4px;font-weight:700" }, c),
      d.features.filter((f) => f.category === c).map((f) => h("div", { class: `feat-row${f.included ? "" : " off"}` },
        f.included ? icons.check({ size: 18 }) : icons.lock({ size: 16 }),
        h("div", { style: "flex:1;min-width:0" }, h("b", {}, f.name), f.addon ? badge("إضافة", "blue") : null,
          f.included ? null : h("small", {}, " غير متاحة في باقتك")),
        !f.included && !locked && reqMode !== "hidden" && f.requestable
          ? btn(reqMode === "upgrade" ? "طلب ترقية الباقة" : "طلب هذه الميزة", () => requestDialog(reqMode === "upgrade" ? "upgrade" : "feature", { feature: f }, show), "ghost sm")
          : null))]));

  const plans = d.plans.length ? panel(locked ? "اختر باقة للاستمرار" : "الباقات المتاحة", null,
    h("div", { class: "sub-plans", id: "sub-plans" }, d.plans.map((p) => h("div", { class: `sub-plan${p.name === s?.plan_name ? " cur" : ""}` },
      h("h3", {}, p.name, p.name === s?.plan_name ? badge("باقتك الحالية") : null), p.tagline ? sub(p.tagline) : null,
      p.contact_only ? h("b", {}, "تواصل معنا للسعر") : h("div", {},
        p.monthly ? h("div", {}, h("b", { style: "font-size:20px" }, Number(p.monthly.final).toLocaleString("ar")), ` ${CUR[p.currency]} شهريًا`) : null,
        p.yearly ? h("div", {}, h("b", {}, Number(p.yearly.final).toLocaleString("ar")), ` ${CUR[p.currency]} سنويًا`) : null),
      sub(`${p.max_students ? `حتى ${p.max_students} طالب` : "طلاب بلا حد"} — ${p.features.length} ميزة`),
      btn(p.name === s?.plan_name ? "طلب تجديد" : "طلب هذه الباقة", () => requestDialog(p.name === s?.plan_name ? "renewal" : (s?.kind === "trial" || locked ? "subscription" : "upgrade"), { plan: p }, show),
        p.highlight ? "" : "soft"))))) : null;

  const requests = panel("طلباتك", null, d.requests.length ? d.requests.map((r) => line(
    h("div", {}, h("b", {}, REQ[r.kind] || r.kind), " ", badge(...(RSTATUS[r.status] || [r.status, "gray"])),
      sub([r.feature_name, r.plan_name, r.months ? `${r.months} شهر` : null, fmtDate(String(r.created_at).slice(0, 10))].filter(Boolean).join(" — ")),
      r.note ? sub(r.note) : null, r.owner_note ? sub(`رد إدارة المنصة: ${r.owner_note}`) : null))) : empty("لا توجد طلبات."));

  const history = d.history.length ? h("details", { class: "panel" }, h("summary", { style: "cursor:pointer;font-weight:700" }, "سجل الاشتراك"),
    d.history.map((e) => line(h("span", {}, e.label, e.details?.plan ? ` — ${e.details.plan}` : ""), h("small", { class: "sub" }, fmtDate(String(e.created_at).slice(0, 10)))))) : null;

  const support = panel("التواصل مع إدارة المنصة", null, d.support?.note ? sub(d.support.note) : null,
    wa ? h("a", { class: "btn", href: wa, target: "_blank", rel: "noopener" }, "مراسلة عبر واتساب") : null,
    d.support?.email ? sub(`البريد: ${d.support.email}`) : null);

  return [header, current, locked ? plans : null, features, locked ? null : plans, requests, history, support];
}

function requestDialog(kind, { feature, plan } = {}, show) {
  const title = { feature: `طلب ميزة: ${feature?.name}`, upgrade: plan ? `طلب ترقية إلى ${plan.name}` : "طلب ترقية الباقة", renewal: "طلب تجديد الاشتراك",
    subscription: plan ? `طلب اشتراك: ${plan.name}` : "طلب اشتراك", contact: "تواصل مع إدارة المنصة" }[kind];
  const cycle = select([["yearly", "سنوي"], ["monthly", "شهري"]]);
  const months = select([[12, "سنة"], [6, "6 أشهر"], [3, "3 أشهر"], [1, "شهر"]]);
  const name = input({ placeholder: "اسم المسؤول" });
  const phone = input({ class: "ltr", inputMode: "tel", placeholder: "رقم للتواصل" });
  const note = textarea({ rows: 3, placeholder: kind === "contact" ? "اكتب رسالتك" : "ملاحظات (اختياري)" });
  const msg = h("div");
  const d = dialog(title, h("div", {},
    kind === "feature" ? notice("سيتم إرسال طلبك إلى إدارة المنصة، ويصلك الرد في هذه الصفحة.", "") : null,
    ["subscription", "upgrade"].includes(kind) && plan ? field("المدة المطلوبة", cycle) : null,
    kind === "renewal" ? field("مدة التجديد", months) : null,
    h("div", { class: "row" }, field("اسم المسؤول", name), field("رقم التواصل", phone)),
    field("ملاحظات", note), msg),
  [btn("إرسال الطلب", async () => {
    mount(msg);
    try {
      await api(`${A}/requests`, { kind, feature_key: feature?.key, plan_id: plan?.id, billing_cycle: plan ? cycle.value : undefined,
        months: kind === "renewal" ? Number(months.value) : undefined, contact_name: name.value, contact_phone: phone.value, note: note.value });
      d.close(); toast("وصل طلبك لإدارة المنصة"); show();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  })]);
}
