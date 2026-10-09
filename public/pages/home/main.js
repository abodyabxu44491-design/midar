// الصفحة الرئيسية: فاضية (الشعار فقط) أو تسويقية، حسب إعداد لوحة المالك.
import { h, $, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { brandLogo, footer, field, input, textarea, select, btn, notice, sub, dialog, installButton, showInstallBar, toast } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { startAnalytics } from "../shared/js/analytics.js";

const app = $("#app");

const CUR = { SAR: "ريال", USD: "دولار", YER: "ريال يمني" };
const fmt = (n) => Number(n).toLocaleString("ar", { maximumFractionDigits: 2 });

async function start() {
  let site = { landing_mode: "blank" };
  try { site = await api("/api/site"); } catch { /* الوضع الافتراضي */ }
  if (site.landing_mode === "marketing") {
    marketing(site);
    const want = new URLSearchParams(location.search).get("trial");
    if (want !== null && site.trial_enabled) { history.replaceState(null, "", "/"); trialDialog(site); }
  }
  else mount(app, h("main", { class: "blank-home" }, brandLogo("hero-logo", false, "stacked")),
    h("nav", { class: "blank-legal" }, h("a", { href: "/privacy" }, "سياسة الخصوصية"), h("a", { href: "/terms" }, "شروط الاستخدام")), footer());
  startAnalytics(site.landing_mode === "marketing" ? "landing" : "home");
}

/* ======================= الصفحة الرسمية ======================= */
// كل ما في الصفحة يأتي من لوحة المالك: العناوين، المميزات، الباقات، الأسعار، العروض، والتجربة المجانية.
// الترتيب: رأس → واجهة → المميزات (بطاقة لكل فئة) → جرّب الآن → الباقات (كل باقة تعرض ما تضيفه فقط) → ابدأ وتواصل
const CAT_ICONS = { "الأساس": "building", "أكاديمي": "book", "التواصل": "message", "المالية": "wallet", "الموظفون": "users", "الخدمات": "bus", "التشغيل": "sparkle", "وأيضًا": "plus" };

function marketing(site) {
  const plans = site.plans || [];
  const trialOn = site.trial_enabled && (site.trial_without_plan || plans.some((p) => p.trial));
  const days = site.trial_days || 30;
  let cycle = plans.some((p) => p.monthly) ? "monthly" : "yearly";
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const link = (id, text) => h("a", { href: `#${id}`, onclick: (e) => { e.preventDefault(); go(id); } }, text);
  const phone = site.support_whatsapp || site.brand_phone;
  const wa = phone ? `https://wa.me/${String(phone).replace(/\D/g, "")}` : null;
  const insta = site.brand_instagram ? `https://instagram.com/${encodeURIComponent(site.brand_instagram)}` : null;

  const nav = h("header", { class: "st-nav" }, h("div", { class: "in" },
    h("a", { class: "brand", href: "/" }, brandLogo("", false, "row")),
    h("nav", { class: "links" }, link("features", "المميزات"), site.demo ? link("demo", "جرّب الآن") : null,
      plans.length ? link("plans", "الباقات") : null, link("contact", "تواصل معنا")),
    installButton()));

  // الواجهة: عنوان ووصف وزران فقط، في الوسط
  const hero = h("section", { class: "st-hero" }, h("div", { class: "in" },
    h("div", { class: "txt" },
      h("h1", {}, site.site_headline || "إدارة مدرستك كاملة في مكان واحد"),
      h("p", { class: "lead" }, site.site_subheadline || "الطلاب والحضور والدرجات والرسوم وأولياء الأمور، في منصة عربية واحدة تعمل من الجوال والكمبيوتر."),
      h("div", { class: "cta" },
        trialOn ? h("button", { class: "st-btn gold", onclick: () => trialDialog(site) }, "ابدأ تجربتك المجانية") : null,
        site.demo ? h("button", { class: "st-btn ghost", onclick: () => go("demo") }, icons.eye({ size: 18 }), "شاهد مدرسة تجريبية")
          : plans.length ? h("button", { class: "st-btn ghost", onclick: () => go("plans") }, "الباقات والأسعار") : null),
      trialOn ? h("p", { class: "note" }, `${days} يومًا مجانًا، بدون رسوم خلال التجربة`) : null)));

  // المميزات مجمّعة حسب الفئة: عنوان الفئة ثم بطاقة لكل ميزة باسمها ووصفها
  const core = (site.features || []).filter((f) => f.kind !== "service");
  const cats = [...new Set(core.map((f) => f.category))];
  const features = h("section", { class: "st-sec", id: "features" }, h("div", { class: "in" },
    h("h2", {}, "ماذا تقدم مدار؟"), h("p", { class: "sub-h" }, "كل أقسام المدرسة في منصة واحدة، ويمكن تشغيل ما تحتاجه فقط."),
    cats.map((c) => h("div", { class: "st-cat" },
      h("h3", {}, h("span", { class: "ic" }, (icons[CAT_ICONS[c]] || icons.grid)({ size: 18 })), c),
      h("div", { class: "st-feats" }, core.filter((f) => f.category === c).map((f) =>
        h("div", { class: "st-feat" }, h("b", {}, f.name), f.description ? h("p", {}, f.description) : null)))))));

  // العرض التجريبي: يدخل الزائر مدرسة كاملة البيانات بضغطة، للتصفح فقط
  const demoSec = site.demo ? h("section", { class: "st-sec soft", id: "demo" }, h("div", { class: "in" },
    h("h2", {}, "شاهد مدار من الداخل"),
    h("p", { class: "sub-h" }, "مدرسة تجريبية فيها بيانات سنة كاملة. اختر الدور وتصفّح بدون تسجيل."),
    h("div", { class: "st-demo" }, DEMO_ROLES.map(([role, icon, title, text]) =>
      h("button", { type: "button", class: "st-demo-card", onclick: (e) => startDemo(role, e.currentTarget) },
        h("span", { class: "ic" }, icons[icon]({ size: 22 })), h("b", {}, title), h("small", {}, text)))))) : null;

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
      "سنوي", saving > 0 ? h("span", { class: "save" }, `وفّر ${saving}%`) : null)) : null);
  const drawPlans = () => mount(grid, plans.map((p, i) => planCard(p, cycle, site, plans[i - 1])));
  drawToggle(); drawPlans();
  const plansSec = plans.length ? h("section", { class: "st-sec", id: "plans" }, h("div", { class: "in" },
    h("h2", {}, "الباقات"), h("p", { class: "sub-h" }, "رقِّ باقتك في أي وقت بدون فقدان أي بيانات."),
    toggle, grid)) : null;

  // الخاتمة: التجربة والتواصل في قسم واحد، والنماذج تفتح في نافذة
  const ways = [
    wa ? h("a", { class: "way", href: wa, target: "_blank", rel: "noopener" }, icons.message({ size: 20 }), h("span", {}, h("b", {}, "واتساب"), h("small", {}, "محادثة مباشرة"))) : null,
    site.brand_phone ? h("a", { class: "way", href: `tel:${site.brand_phone}` }, icons.phone({ size: 20 }), h("span", {}, h("b", {}, "اتصال"), h("small", { class: "ltr" }, site.brand_phone))) : null,
    insta ? h("a", { class: "way", href: insta, target: "_blank", rel: "noopener" }, icons.image({ size: 20 }), h("span", {}, h("b", {}, "إنستغرام"), h("small", { class: "ltr" }, `@${site.brand_instagram}`))) : null,
    h("button", { type: "button", class: "way", onclick: () => contactDialog(site) }, icons.edit({ size: 20 }), h("span", {}, h("b", {}, "أرسل رسالة"), h("small", {}, "ونرد عليك قريبًا"))),
  ].filter(Boolean);
  const endSec = h("section", { class: "st-sec", id: "contact" }, h("div", { class: "st-end", id: "trial" },
    h("div", { class: "txt" },
      h("h2", {}, trialOn ? `جرّب مدار ${days} يومًا مجانًا` : "ابدأ مع مدار"),
      h("p", {}, !trialOn ? "تواصل معنا ونجهّز مدرستك خطوة بخطوة."
        : site.instant_trial ? "سجّل مدرستك وادخل لوحتها خلال دقيقة، وبياناتك تبقى محفوظة إذا اشتركت بعدها."
        : "نجهّز مدرستك ونرسل لك بيانات الدخول، وبياناتك تبقى محفوظة إذا اشتركت بعدها."),
      trialOn ? h("button", { class: "st-btn gold", onclick: () => trialDialog(site) }, "اطلب التجربة المجانية") : null),
    h("div", { class: "ways" }, ways)));

  // الأسئلة الشائعة وروابط الصفحات التعريفية: من البيانات التي يضمّنها الخادم في الصفحة (نفس ما يقرؤه جوجل)
  const faq = readJson("faq-ld")?.mainEntity?.map((q) => [q.name, q.acceptedAnswer?.text]) || [];
  const guides = readJson("seo-links") || [];
  const faqSec = faq.length ? h("section", { class: "st-sec soft", id: "faq" }, h("div", { class: "in narrow" },
    h("h2", {}, "أسئلة شائعة"),
    h("div", { class: "st-faq" }, faq.map(([q, a]) => h("details", {}, h("summary", {}, q), h("p", {}, a)))))) : null;

  mount(app, h("div", { class: "st" }, nav, hero, features, demoSec, plansSec, faqSec, endSec,
    h("footer", { class: "st-foot" },
      h("div", { class: "in" },
        brandLogo("", false, "row"),
        h("nav", { class: "legal" }, guides.map(([slug, name]) => h("a", { href: `/${slug}` }, name)),
          h("a", { href: "/privacy" }, "سياسة الخصوصية"), h("a", { href: "/terms" }, "شروط الاستخدام")),
        h("small", {}, `© ${new Date().getFullYear()} مدار — منصة إدارة المدارس`)))));
}

function readJson(id) {
  try { return JSON.parse(document.getElementById(id)?.textContent || "null"); } catch { return null; }
}

// أدوار العرض التجريبي
const DEMO_ROLES = [
  ["admin", "building", "مدير المدرسة", "لوحة المدرسة كاملة: الطلاب والحضور والدرجات والمالية والتقارير"],
  ["teacher", "clipboard", "المعلم", "تطبيق المعلم: فصوله وحصصه، الحضور، رصد الدرجات والواجبات"],
  ["accountant", "wallet", "المحاسب", "الرسوم والأقساط والإيصالات والتحويلات والرواتب"],
  ["parent", "user", "ولي الأمر", "ملف الطالب: الدرجات والحضور والواجبات والرسوم والإشعارات"],
];
async function startDemo(role, el) {
  el.disabled = true;
  el.classList.add("busy");
  try {
    const r = await api("/api/public/demo/start", { role });
    location.href = r.url;
  } catch (e) {
    toast(e.message, true);
    el.disabled = false;
    el.classList.remove("busy");
  }
}

function priceBlock(p, cycle) {
  if (p.contact_only) return h("div", { class: "contact" }, "تواصل معنا للسعر");
  const pr = p[cycle] || p.monthly || p.yearly;
  const unit = pr === p.yearly ? "سنويًا" : "شهريًا";
  if (!pr) return h("div", { class: "contact" }, "تواصل معنا للسعر");
  return h("div", { class: "st-price" },
    h("span", { class: "n" }, fmt(pr.final)), h("span", { class: "u" }, `${CUR[p.currency] || p.currency} ${unit}`),
    pr.promo ? [h("del", {}, fmt(pr.base)), h("span", { class: "off" }, `وفر الآن ${fmt(pr.percent)}%`)] : null);
}

// قائمة تُطوى بعد 6 مميزات مع زر لعرض الكل
function featureList(list) {
  const ul = h("ul");
  const draw = (all) => mount(ul, (all ? list : list.slice(0, 6)).map((f) => h("li", {}, icons.check({ size: 16 }), f.name)),
    !all && list.length > 6 ? h("li", { class: "more" }, h("button", { type: "button", onclick: () => draw(true) }, `+ ${list.length - 6} ميزة أخرى`)) : null);
  draw(false);
  return ul;
}

// كل باقة تعرض ما تضيفه على الباقة التي قبلها فقط، فلا تتكرر نفس القائمة في كل بطاقة
function planCard(p, cycle, site, prev) {
  const had = new Set(prev?.features.map((f) => f.key) || []);
  const extra = prev ? p.features.filter((f) => !had.has(f.key)) : p.features;
  const lim = [p.max_students ? `حتى ${fmt(p.max_students)} طالب` : "طلاب بلا حد", p.max_teachers ? `${fmt(p.max_teachers)} معلم` : "معلمون بلا حد"].join(" · ");
  return h("div", { class: `st-plan${p.highlight ? " hi" : ""}` },
    p.badge ? h("span", { class: "badge" }, p.badge) : null,
    (p.monthly?.promo || p.yearly?.promo) && (p.promo_label || p.promo_ends_at)
      ? h("div", { class: "promo" }, [p.promo_label, p.promo_ends_at ? `حتى ${p.promo_ends_at}` : null].filter(Boolean).join(" — ")) : null,
    h("h3", {}, p.name), p.tagline ? h("div", { class: "tag" }, p.tagline) : null,
    priceBlock(p, cycle),
    p.setup_fee > 0 ? h("div", { class: "fee" }, `+ رسوم تجهيز لمرة واحدة ${fmt(p.setup_fee)} ${CUR[p.currency] || ""}`) : null,
    h("div", { class: "lim" }, lim),
    h("div", { class: "inc" }, prev ? `كل مميزات ${prev.name}، وأيضًا:` : `${p.features.length} ميزة، منها:`),
    extra.length ? featureList(extra) : h("p", { class: "same" }, "بسعة أكبر وأولوية في الدعم"),
    h("div", { class: "acts" },
      h("button", { class: `st-btn ${p.highlight ? "pri" : "out"} wide`, onclick: () => subscribeDialog(site, p, cycle) }, p.contact_only ? "اطلب عرض سعر" : "اشترك الآن"),
      p.trial ? h("button", { class: "try", onclick: () => trialDialog(site, p) }, `أو جرّبها مجانًا ${p.trial_days} يومًا`) : null));
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
  const label = { trial: site.instant_trial ? "ابدأ التجربة الآن" : "طلب التجربة المجانية", subscription: "إرسال طلب الاشتراك", contact: "إرسال" }[kind];
  const send = h("button", { class: `st-btn ${kind === "trial" ? "gold" : "pri"} wide`, type: "button" }, label);
  send.addEventListener("click", async () => {
    mount(msg);
    send.disabled = true;
    try {
      // التسجيل الفوري (إن فعّله المالك): تُنشأ المدرسة وتظهر بيانات الدخول مباشرة
      const instant = kind === "trial" && site.instant_trial;
      const r = await api(instant ? "/api/public/leads/signup" : "/api/public/leads", {
        kind, ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])),
        plan_id: planSel?.value || null, ...(kind === "subscription" ? { billing_cycle: cycleSel?.value || "yearly" } : {}),
        try_plan: tryPlan ? tryPlan.checked : true,
        addon_keys: [...addonsBox.querySelectorAll("input:checked")].map((x) => x.value),
      });
      for (const el of Object.values(f)) el.value = "";
      if (instant && r?.credentials) { const ready = readyView(r); if (onDone) onDone(ready); else mount(msg, ready); send.disabled = false; return; }
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
    kind !== "contact" ? h("p", { class: "st-consent" }, "بإرسال الطلب توافق على ", h("a", { href: "/terms", target: "_blank" }, "شروط الاستخدام"),
      " و", h("a", { href: "/privacy", target: "_blank" }, "سياسة الخصوصية"), ".") : null,
    msg, send);
}

// المدرسة أُنشئت فورًا: بيانات الدخول وزر الدخول مباشرة
function readyView(r) {
  const c = r.credentials;
  const link = r.links?.staff?.admin || `/${c.school}/idara?role=admin`;
  const ends = r.trial?.ends_on ? new Date(r.trial.ends_on).toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric" }) : null;
  const text = `منصة مدار — بيانات دخول ${r.school.name}\nرابط الدخول: ${link}\nاسم المستخدم: ${c.username}\nكلمة المرور المؤقتة: ${c.password}`;
  const row = (label, value) => h("div", { class: "rd-row" }, h("span", {}, label), h("b", { class: "ltr" }, value));
  return h("div", { class: "st-ready" },
    h("div", { class: "st-ok" }, icons.check({ size: 40 }), h("h3", {}, "مدرستك جاهزة"),
      h("p", {}, ends ? `تجربتك المجانية فعّالة حتى ${ends}.` : "تجربتك المجانية فعّالة الآن.")),
    h("div", { class: "rd-creds" }, row("رابط الدخول", link.replace(/^https?:\/\//, "")), row("اسم المستخدم", c.username), row("كلمة المرور المؤقتة", c.password)),
    h("p", { class: "st-consent" }, "احفظ هذه البيانات الآن. عند أول دخول تختار كلمة مرور جديدة خاصة بك."),
    h("div", { class: "ready-acts" },
      h("a", { class: "st-btn gold wide", href: link }, "ادخل لوحة مدرستك"),
      h("button", { type: "button", class: "st-btn out wide", onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast("نُسخت بيانات الدخول"); } catch { toast("انسخها يدويًا من الأعلى", true); }
      } }, icons.copy({ size: 18 }), "نسخ البيانات")));
}

// زر الإرسال في شريط أزرار النافذة الثابت (بجانب «إغلاق»): ظاهر دائمًا ولا يغطيه شيء
function formDialog(title, top, form) {
  const box = h("div", { class: "st-form", style: "padding:0" }, top, form);
  const send = form.querySelector(":scope > .st-btn.wide:last-child");
  const d = dialog(title, box, send ? [send] : []);
  d.classList.add("st-dlg");
  return { d, box, send };
}

function trialDialog(site, plan = null) {
  let ref;
  const form = leadForm(site, { kind: "trial", plan, onDone: (ok) => { mount(ref.box, ok); ref.send?.remove(); } });
  ref = formDialog("اطلب تجربة مجانية", h("div", { class: "st-dlg-note" }, icons.gift({ size: 16 }),
    `${site.trial_days || 30} يومًا مجانًا — بدون رسوم خلال فترة التجربة`), form);
}

function contactDialog(site) {
  let ref;
  const form = leadForm(site, { kind: "contact", onDone: (ok) => { mount(ref.box, ok); ref.send?.remove(); } });
  ref = formDialog("تواصل معنا", null, form);
}

function subscribeDialog(site, plan, cycle) {
  let ref;
  const form = leadForm(site, { kind: "subscription", plan, cycle, onDone: (ok) => { mount(ref.box, ok); ref.send?.remove(); } });
  ref = formDialog(`طلب اشتراك — ${plan.name}`, null, form);
}

start();
// الصفحة بلا رأس (وضع «الشعار فقط»): أيقونة تثبيت صغيرة في الزاوية، وتختفي متى ظهر رأس فيه أيقونته
showInstallBar();
