// الصفحة الرئيسية: فاضية (الشعار فقط) أو تسويقية، حسب إعداد لوحة المالك.
import { h, $, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { brandLogo, footer, field, input, textarea, select, btn, notice, sub, dialog, showInstallBar } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { startAnalytics } from "../shared/js/analytics.js";

const app = $("#app");

const CUR = { SAR: "ريال", USD: "دولار", YER: "ريال يمني" };
const fmt = (n) => Number(n).toLocaleString("ar", { maximumFractionDigits: 2 });

async function start() {
  let site = { landing_mode: "blank" };
  try { site = await api("/api/site"); } catch { /* الوضع الافتراضي */ }
  if (site.landing_mode === "marketing") marketing(site);
  else mount(app, h("main", { class: "blank-home" }, brandLogo("hero-logo", false, "stacked")), footer());
  startAnalytics(site.landing_mode === "marketing" ? "landing" : "home");
}

/* ======================= الصفحة الرسمية ======================= */
// كل ما في الصفحة يأتي من لوحة المالك: العناوين، المميزات، الباقات، الأسعار، العروض، والتجربة المجانية
function marketing(site) {
  const plans = site.plans || [];
  const trialOn = site.trial_enabled && (site.trial_without_plan || plans.some((p) => p.trial));
  const days = site.trial_days || 30;
  let cycle = plans.some((p) => p.monthly) ? "monthly" : "yearly";
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const phone = site.support_whatsapp || site.brand_phone;
  const wa = phone ? `https://wa.me/${String(phone).replace(/\D/g, "")}` : null;

  const nav = h("header", { class: "st-nav" }, h("div", { class: "in" },
    h("a", { class: "brand", href: "/" }, brandLogo("", false, "row")),
    h("nav", { class: "links" },
      h("a", { href: "#features", onclick: (e) => { e.preventDefault(); go("features"); } }, "المميزات"),
      h("a", { href: "#plans", onclick: (e) => { e.preventDefault(); go("plans"); } }, "الباقات"),
      trialOn ? h("a", { href: "#trial", onclick: (e) => { e.preventDefault(); go("trial"); } }, "التجربة المجانية") : null,
      h("a", { href: "#contact", onclick: (e) => { e.preventDefault(); go("contact"); } }, "تواصل معنا")),
    trialOn ? h("button", { class: "st-btn gold sm", onclick: () => trialDialog(site) }, icons.gift({ size: 16 }), "ابدأ تجربتك المجانية") : null));

  const core = (site.features || []).filter((f) => f.kind !== "service");
  const hero = h("section", { class: "st-hero" }, h("div", { class: "in" },
    h("div", {},
      brandLogo("hero-logo", true, "stacked"),
      h("h1", {}, site.site_headline || "إدارة مدرستك كاملة في مكان واحد"),
      h("p", { class: "lead" }, site.site_subheadline || "الطلاب والحضور والدرجات والرسوم وأولياء الأمور، في منصة عربية واحدة سهلة تعمل من الجوال والكمبيوتر."),
      h("div", { class: "cta" },
        trialOn ? h("button", { class: "st-btn gold", onclick: () => trialDialog(site) }, icons.gift({ size: 18 }), "اطلب تجربة مجانية") : null,
        plans.length ? h("button", { class: "st-btn light", onclick: () => go("plans") }, "عرض الباقات") : null,
        h("button", { class: "st-btn out", onclick: () => go("contact") }, "تواصل معنا")),
      trialOn ? h("div", { class: "st-trial-note" }, icons.gift({ size: 16 }), `تجربة مجانية لمدة ${days} يومًا — بدون رسوم خلال فترة التجربة`) : null),
    h("div", { class: "points" }, core.slice(0, 6).map((f) => h("div", {}, icons.check({ size: 18 }),
      h("span", {}, h("b", {}, f.name), f.description ? ` — ${f.description}` : ""))))));

  // المميزات مجمّعة حسب الفئة (من كتالوج المميزات)
  const cats = [...new Set(core.map((f) => f.category))];
  const features = h("section", { class: "st-sec", id: "features" },
    h("h2", {}, "ماذا تقدم مدار؟"), h("p", { class: "sub-h" }, "كل أقسام المدرسة في منصة واحدة، ويمكن تشغيل ما تحتاجه فقط."),
    cats.map((c) => [h("div", { class: "st-cat" }, c),
      h("div", { class: "st-feats" }, core.filter((f) => f.category === c).map((f) =>
        h("div", { class: "st-feat" }, h("h3", {}, icons.check({ size: 18 }), f.name), f.description ? h("p", {}, f.description) : null)))]));

  // الباقات
  const grid = h("div", { class: "st-plans" });
  const toggle = h("div", { class: "st-toggle" });
  const saving = (() => {
    const pc = plans.filter((p) => p.monthly && p.yearly).map((p) => 1 - p.yearly.final / (p.monthly.final * 12));
    return pc.length ? Math.round(Math.max(...pc) * 100) : 0;
  })();
  const drawToggle = () => mount(toggle, plans.some((p) => p.monthly) && plans.some((p) => p.yearly) ? h("div", { class: "box" },
    h("button", { class: cycle === "monthly" ? "on" : "", onclick: () => { cycle = "monthly"; drawToggle(); drawPlans(); } }, "شهري"),
    h("button", { class: cycle === "yearly" ? "on" : "", onclick: () => { cycle = "yearly"; drawToggle(); drawPlans(); } },
      "سنوي", saving > 0 ? h("span", { class: "save" }, `وفّر حتى ${saving}%`) : null)) : null);
  const drawPlans = () => mount(grid, plans.map((p) => planCard(p, cycle, site)));
  drawToggle(); drawPlans();
  const plansSec = plans.length ? h("section", { class: "st-sec soft", id: "plans" }, h("div", { class: "in" },
    h("h2", {}, "الباقات"), h("p", { class: "sub-h" }, "اختر الباقة المناسبة لمدرستك، ويمكنك الترقية في أي وقت دون فقدان أي بيانات."),
    toggle, grid)) : null;

  const trialSec = trialOn ? h("section", { class: "st-sec", id: "trial" }, h("div", { class: "st-trial" },
    h("div", {},
      h("h2", {}, `جرّب مدار مجانًا لمدة ${days} يومًا`),
      h("p", {}, "بدون أي رسوم خلال فترة التجربة، ولا تحتاج شراء باقة قبل التجربة."),
      h("ul", {},
        h("li", {}, icons.check({ size: 18 }), "تحصل على كل مميزات الباقة التي تختارها للتجربة"),
        h("li", {}, icons.check({ size: 18 }), "بياناتك تبقى محفوظة بعد التجربة، وتكمل عليها عند الاشتراك"),
        h("li", {}, icons.check({ size: 18 }), "نفعّل التجربة بعد مراجعة طلبك ونرسل لك بيانات الدخول"))),
    h("div", { class: "st-form" }, leadForm(site, { kind: "trial" })))) : null;

  const contact = h("section", { class: "st-sec soft", id: "contact" }, h("div", { class: "in" },
    h("h2", {}, "تواصل معنا"), h("p", { class: "sub-h" }, "أرسل استفسارك وسنعود إليك قريبًا."),
    h("div", { class: "st-contact" },
      h("div", { class: "ways" },
        wa ? h("a", { href: wa, target: "_blank", rel: "noopener" }, h("b", {}, "واتساب"), h("span", { class: "ltr" }, phone)) : null,
        site.brand_email ? h("a", { href: `mailto:${site.brand_email}` }, h("b", {}, "البريد"), h("span", { class: "ltr" }, site.brand_email)) : null),
      h("div", { class: "st-form" }, leadForm(site, { kind: "contact" })))));

  mount(app, h("div", { class: "st" }, nav, hero, features, plansSec, trialSec, contact,
    h("footer", { class: "st-foot" }, `© ${new Date().getFullYear()} مدار — منصة إدارة المدارس`)));
}

function priceBlock(p, cycle) {
  if (p.contact_only) return h("div", { class: "contact" }, "تواصل معنا للسعر");
  const pr = p[cycle] || p.monthly || p.yearly;
  const unit = pr === p.yearly ? "سنويًا" : "شهريًا";
  if (!pr) return h("div", { class: "contact" }, "تواصل معنا للسعر");
  return h("div", { class: "st-price" },
    h("span", { class: "n" }, fmt(pr.final)), h("span", { class: "u" }, `${CUR[p.currency] || p.currency} ${unit}`),
    pr.percent > 0 ? [h("del", {}, fmt(pr.base)), h("span", { class: "off" }, `خصم ${fmt(pr.percent)}%`)] : null);
}

// قائمة طويلة تُطوى بعد 9 مميزات مع زر لعرض الكل
function featureList(list) {
  const ul = h("ul");
  const draw = (all) => mount(ul, (all ? list : list.slice(0, 9)).map((f) => h("li", {}, icons.check({ size: 16 }), f.name)),
    !all && list.length > 9 ? h("li", {}, h("button", { class: "try", style: "padding:0", onclick: () => draw(true) }, `وعرض ${list.length - 9} ميزة أخرى`)) : null);
  draw(false);
  return ul;
}

function planCard(p, cycle, site) {
  return h("div", { class: `st-plan${p.highlight ? " hi" : ""}` },
    p.badge ? h("span", { class: "badge" }, p.badge) : null,
    p.promo_label ? h("div", { class: "promo" }, `${p.promo_label} — حتى ${p.promo_ends_at}`) : null,
    h("h3", {}, p.name), h("div", { class: "tag" }, p.tagline || ""),
    priceBlock(p, cycle),
    p.setup_fee > 0 ? h("div", { class: "sub" }, `رسوم تجهيز لمرة واحدة: ${fmt(p.setup_fee)} ${CUR[p.currency] || ""}`) : null,
    h("div", { class: "st-limits" },
      h("span", {}, p.max_students ? `حتى ${fmt(p.max_students)} طالب` : "عدد طلاب مفتوح"),
      h("span", {}, p.max_teachers ? `حتى ${fmt(p.max_teachers)} معلم` : "عدد معلمين مفتوح")),
    featureList(p.features),
    h("div", { class: "acts" },
      h("button", { class: `st-btn ${p.highlight ? "pri" : "out"} wide`, onclick: () => subscribeDialog(site, p, cycle) }, p.contact_only ? "اطلب عرض سعر" : "اشترك الآن"),
      p.trial ? h("button", { class: "try", onclick: () => trialDialog(site, p) }, icons.gift({ size: 16 }), `جرّب مجانًا لمدة ${p.trial_days} يومًا`) : null));
}

/* ======================= النماذج ======================= */
function leadForm(site, { kind, plan = null, cycle = "yearly", onDone }) {
  const plans = site.plans || [];
  const trialPlans = plans.filter((p) => p.trial);
  const f = {
    school_name: input({ autocomplete: "organization" }), contact_name: input({ autocomplete: "name" }),
    phone: input({ class: "ltr", inputMode: "tel", autocomplete: "tel" }), email: input({ type: "email", class: "ltr", autocomplete: "email" }),
    city: input(), students_count: input({ type: "number", min: 1 }), note: textarea({ rows: 2 }),
  };
  const planOpts = kind === "trial"
    ? [...(site.trial_without_plan ? [["", "أريد تجربة المنصة (بدون تحديد باقة)"]] : []), ...trialPlans.map((p) => [p.id, p.name])]
    : plans.map((p) => [p.id, p.name]);
  const planSel = kind === "contact" ? null : select(planOpts, { value: plan?.id ?? (kind === "trial" ? (site.trial_without_plan ? "" : trialPlans[0]?.id) : plans[0]?.id) });
  const cycleSel = kind === "subscription" ? select([["monthly", "شهري"], ["yearly", "سنوي"]], { value: cycle }) : null;
  const tryPlan = kind === "trial" ? h("input", { type: "checkbox", checked: true }) : null;
  const addonsBox = h("div");
  const drawAddons = () => {
    if (kind !== "subscription") return;
    const p = plans.find((x) => String(x.id) === String(planSel.value));
    const have = new Set(p?.features.map((x) => x.key) || []);
    const extra = (site.features || []).filter((x) => x.requestable && !have.has(x.key));
    mount(addonsBox, extra.length ? [h("div", { class: "sub" }, "مميزات إضافية تريدها (اختياري)"),
      h("div", { class: "addons" }, extra.map((x) => h("label", { class: "chk" }, h("input", { type: "checkbox", value: x.key }), x.name)))] : null);
  };
  planSel?.addEventListener("change", drawAddons);
  drawAddons();
  const msg = h("div");
  const label = { trial: "طلب التجربة المجانية", subscription: "إرسال طلب الاشتراك", contact: "إرسال" }[kind];
  const send = h("button", { class: `st-btn ${kind === "trial" ? "gold" : "pri"} wide`, type: "button" }, label);
  send.addEventListener("click", async () => {
    mount(msg);
    send.disabled = true;
    try {
      await api("/api/public/leads", {
        kind, ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])),
        plan_id: planSel?.value || null, billing_cycle: cycleSel?.value || null, try_plan: tryPlan ? tryPlan.checked : true,
        addon_keys: [...addonsBox.querySelectorAll("input:checked")].map((x) => x.value),
      });
      for (const el of Object.values(f)) el.value = "";
      const ok = h("div", { class: "st-ok" }, icons.check({ size: 40 }), h("h3", {}, "وصلنا طلبك"),
        h("p", {}, kind === "trial" ? "سنراجع طلب التجربة ونرسل لك بيانات الدخول قريبًا بإذن الله." : "سنتواصل معك قريبًا بإذن الله."));
      if (onDone) onDone(ok); else mount(msg, ok);
    } catch (e) { mount(msg, notice(e.message, "err")); }
    send.disabled = false;
  });
  return h("div", {},
    kind === "subscription" && plan ? h("div", { class: "notice" }, `الباقة المختارة: ${plan.name}`) : null,
    field("اسم المدرسة", f.school_name),
    h("div", { class: "row" }, field("اسم المسؤول", f.contact_name), field("رقم الجوال", f.phone)),
    kind !== "contact" ? h("div", { class: "row" }, field("البريد الإلكتروني", f.email), field("المدينة", f.city)) : field("البريد الإلكتروني", f.email),
    kind !== "contact" ? field("عدد الطلاب التقريبي", f.students_count) : null,
    planSel ? h("div", { class: "row" }, field(kind === "trial" ? "الباقة المرغوبة للتجربة" : "الباقة المطلوبة", planSel), cycleSel ? field("المدة المطلوبة", cycleSel) : null) : null,
    tryPlan ? h("label", { class: "chk" }, tryPlan, "أريد تجربة الباقة المختارة") : null,
    addonsBox,
    field(kind === "contact" ? "رسالتك" : "ملاحظات", f.note),
    msg, send);
}

function trialDialog(site, plan = null) {
  const box = h("div");
  const d = dialog("اطلب تجربة مجانية", box);
  d.classList.add("st-dlg");
  mount(box, h("div", { class: "st-form", style: "padding:0" },
    h("div", { class: "st-trial-note", style: "color:#9A5B00;background:#FFF4E0;margin:0 0 12px" }, icons.gift({ size: 16 }),
      `${site.trial_days || 30} يومًا مجانًا — بدون رسوم خلال فترة التجربة`),
    leadForm(site, { kind: "trial", plan, onDone: (ok) => mount(box, ok) })));
}

function subscribeDialog(site, plan, cycle) {
  const box = h("div");
  const d = dialog(`طلب اشتراك — ${plan.name}`, box);
  d.classList.add("st-dlg");
  mount(box, h("div", { class: "st-form", style: "padding:0" }, leadForm(site, { kind: "subscription", plan, cycle, onDone: (ok) => mount(box, ok) })));
}

start();
showInstallBar();
