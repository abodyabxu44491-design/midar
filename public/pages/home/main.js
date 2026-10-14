/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, $, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { brandLogo, footer, field, input, textarea, select, btn, notice, sub, dialog, installButton, showInstallBar, toast } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { startAnalytics } from "../shared/js/analytics.js";
import { recentSchools, forgetSchool } from "../shared/js/recent.js";
import { registerDialog } from "./register.js";

const app = $("#app");

const CUR = { SAR: "ريال", USD: "دولار", YER: "ريال يمني" };
const fmt = (n) => Number(n).toLocaleString("ar", { maximumFractionDigits: 2 });

async function start() {
  let site = { landing_mode: "blank" };
  if (new URLSearchParams(location.search).has("app")) return launcher();
  try { site = await api("/api/site"); } catch { /* ignore */ }
  if (site.landing_mode === "marketing") {
    marketing(site);
    const want = new URLSearchParams(location.search).get("trial");
    if (want !== null && site.trial_enabled) { history.replaceState(null, "", "/"); trialDialog(site); }
  }
  else mount(app, h("main", { class: "blank-home" }, brandLogo("hero-logo", false, "stacked")),
    h("nav", { class: "blank-legal" }, h("a", { href: "/privacy" }, "سياسة الخصوصية"), h("a", { href: "/terms" }, "شروط الاستخدام")), footer());
  startAnalytics(site.landing_mode === "marketing" ? "landing" : "home");
}

const CAT_ICONS = { "الأساس": "building", "أكاديمي": "book", "التواصل": "message", "المالية": "wallet", "الموظفون": "users", "الخدمات": "bus", "التشغيل": "sparkle", "وأيضًا": "plus" };

const AUDIENCES = [
  ["shield", "للإدارة", "صورة كاملة عن المدرسة في شاشة واحدة: الطلاب والحضور والدرجات والرسوم، وتقارير جاهزة للطباعة."],
  ["clipboard", "للمعلمين", "تسجيل الحضور ورصد الدرجات والواجبات من الجوال في دقائق، وتواصل منظم مع أولياء الأمور."],
  ["users", "لأولياء الأمور", "تطبيق يتابعون منه حضور أبنائهم ودرجاتهم ورسومهم، وتصلهم الإشعارات فورًا."],
];
const KEY_FEATURES = [
  ["users", "الطلاب والفصول", "ملف كامل لكل طالب، ونقل وترقية الفصول، واستيراد الطلاب من Excel دفعة واحدة."],
  ["user", "المعلمون والمستخدمون", "حسابات للمعلمين والمحاسبين، وتوزيع المواد والجدول، وكل معلم يرى فصوله فقط."],
  ["check", "الحضور بالباركود", "بطاقة QR لكل طالب تُمسح عند البوابة فيُسجَّل الحضور تلقائيًا بدل الكشوف الورقية."],
  ["bell", "إشعار ولي الأمر بالدخول والخروج", "يصل ولي الأمر إشعار فوري عند وصول ابنه وعند انصرافه، وعند الغياب أو التأخر."],
  ["chart", "الاختبارات والدرجات والنتائج", "رصد الدرجات ومكوناتها، والاختبارات الإلكترونية والورقية، وكشوف النتائج بضغطة."],
  ["award", "الشهادات والتقارير", "شهادات رسمية برمز تحقق، وتقارير الحضور والدرجات والمالية جاهزة للطباعة."],
  ["wallet", "الشؤون المالية", "الرسوم والأقساط والإيصالات، والمصروفات والرواتب، وأرصدة الحسابات في مكان واحد."],
  ["lock", "صلاحيات لكل دور", "لوحة للإدارة وأخرى للمعلم والمحاسب وولي الأمر، وكل حساب يرى ما يخصه فقط."],
  ["refresh", "تحديثات وتطوير مستمر", "نضيف مميزات ونحسّن المنصة باستمرار، وتصلك التحديثات تلقائيًا بلا تكلفة إضافية."],
];
const STEPS = [
  ["تعرّف على المميزات والباقات", "تصفّح ما تقدمه مدار، أو جرّب المدرسة التجريبية بدون تسجيل."],
  ["قدّم طلب التجربة المجانية", "املأ بيانات مدرستك ومديرها في نموذج واحد، ويصلك رقم الطلب فورًا."],
  ["نراجع الطلب ونعتمده", "نتأكد من البيانات ونتواصل معك على الجوال أو واتساب."],
  ["فعّل حسابك بنفسك", "يصلك رابط تفعيل، تتحقق فيه من جوالك برسالة نصية وتختار كلمة المرور."],
  ["اختر الباقة المناسبة", "بعد التجربة تختار باقتك، وتبقى كل بياناتك كما هي."],
];
const PROTECT = [
  "كل مدرسة معزولة عن غيرها داخل قاعدة البيانات، ولا تستطيع أي مدرسة رؤية بيانات مدرسة أخرى.",
  "كلمات المرور محفوظة مشفّرة ولا يراها أحد، حتى نحن.",
  "نسخة احتياطية يومية من البيانات، واختبار أسبوعي لاسترجاعها.",
  "الاتصال بالمنصة مشفّر، وكل عملية حساسة تُسجَّل في سجل المدرسة.",
  "بيانات المدرسة ملك لها، وتستطيع تنزيل نسخة منها في أي وقت.",
];

function marketing(site) {
  const plans = site.plans || [];
  const trialOn = site.trial_enabled && (site.trial_without_plan || plans.some((p) => p.trial));
  const days = site.trial_days || 30;
  let cycle = plans.some((p) => p.yearly || p.first_year) ? "yearly" : "monthly";
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const link = (id, text) => h("a", { href: `#${id}`, onclick: (e) => { e.preventDefault(); go(id); } }, text);
  const phone = site.support_whatsapp || site.brand_phone;
  const wa = phone ? `https://wa.me/${String(phone).replace(/\D/g, "")}` : null;
  const insta = site.brand_instagram ? `https://instagram.com/${encodeURIComponent(site.brand_instagram)}` : null;
  const reviews = site.testimonials || [];

  const nav = h("header", { class: "st-nav" }, h("div", { class: "in" },
    h("a", { class: "brand", href: "/" }, brandLogo("", false, "row")),
    h("nav", { class: "links" }, link("features", "المميزات"), link("how", "كيف تبدأ"),
      plans.length ? link("plans", "الباقات") : null, reviews.length ? link("reviews", "آراء العملاء") : null, link("contact", "تواصل معنا"),
      h("button", { type: "button", class: "lnk", onclick: () => statusDialog() }, "متابعة طلب")),
    installButton()));

  const hero = h("section", { class: "st-hero v2" }, h("div", { class: "in" },
    h("div", { class: "txt" },
      h("span", { class: "eyebrow" }, "مدار | MIDAR"),
      h("h1", {}, site.site_headline || "كل إدارة مدرستك في مكان واحد"),
      h("p", { class: "lead" }, site.site_subheadline || "منصة متكاملة لإدارة المدارس، تجمع الشؤون الإدارية والتعليمية والمالية في نظام واحد، وتساعد على تنظيم العمل المدرسي وتسهيل متابعة الطلاب والتواصل مع أولياء الأمور."),
      h("div", { class: "cta" },
        trialOn ? h("button", { class: "st-btn gold", onclick: () => trialDialog(site) }, "ابدأ تجربتك المجانية") : null,
        h("button", { class: "st-btn ghost", onclick: () => go("features") }, "استكشف المميزات")),
      h("ul", { class: "hero-ticks" }, [trialOn ? `${days} يومًا مجانًا بكل المميزات` : null, "بدون تثبيت برامج", "على الجوال والكمبيوتر", "بيانات كل مدرسة معزولة ومشفرة"]
        .filter(Boolean).map((t) => h("li", {}, icons.check({ size: 15 }), t)))),
    h("div", { class: "hero-shot", "aria-hidden": "true" },
      h("img", { class: "desk", src: "/brand/screens/admin.jpg", alt: "", width: 1280, height: 800, decoding: "async", fetchpriority: "high" }),
      h("img", { class: "phone", src: "/brand/screens/parent.jpg", alt: "", width: 390, height: 844, decoding: "async" }))));

  const audiences = h("section", { class: "st-sec tight" }, h("div", { class: "in" },
    h("div", { class: "aud-grid" }, AUDIENCES.map(([icon, title, text]) => h("div", { class: "aud-card" },
      h("span", { class: "ic" }, icons[icon]({ size: 22 })), h("b", {}, title), h("p", {}, text))))));

  const core = (site.features || []).filter((f) => f.kind !== "service");
  const cats = [...new Set(core.map((f) => f.category))];
  const catalog = h("details", { class: "st-catalog" }, h("summary", {}, `كل أقسام المنصة (${core.length})`),
    cats.map((c) => h("div", { class: "st-cat" },
      h("h3", {}, h("span", { class: "ic" }, (icons[CAT_ICONS[c]] || icons.grid)({ size: 18 })), c),
      h("div", { class: "st-feats" }, core.filter((f) => f.category === c).map((f) =>
        h("div", { class: "st-feat" }, h("b", {}, f.name), f.description ? h("p", {}, f.description) : null))))));
  const features = h("section", { class: "st-sec", id: "features" }, h("div", { class: "in" },
    h("span", { class: "sec-eb" }, "المميزات"), h("h2", {}, "مميزات مدار"), h("p", { class: "sub-h" }, "كل ما تحتاجه المدرسة في منصة واحدة تعمل من الجوال والكمبيوتر."),
    h("div", { class: "kf-grid" }, KEY_FEATURES.map(([icon, title, text]) => h("div", { class: "kf-card" },
      h("span", { class: "ic" }, icons[icon]({ size: 22 })), h("h3", {}, title), h("p", {}, text)))),
    core.length ? catalog : null));

  const demoSec = site.demo ? h("section", { class: "st-sec soft", id: "demo" }, h("div", { class: "in" },
    h("h2", {}, "شاهد مدار من الداخل"),
    h("p", { class: "sub-h" }, "مدرسة تجريبية فيها بيانات سنة كاملة. اختر الدور وتصفّح بدون تسجيل."),
    h("div", { class: "st-demo" }, DEMO_ROLES.map(([role, icon, title, text]) =>
      h("button", { type: "button", class: "st-demo-card", onclick: (e) => startDemo(role, e.currentTarget) },
        h("span", { class: "ic" }, icons[icon]({ size: 22 })), h("b", {}, title), h("small", {}, text)))))) : null;

  const how = h("section", { class: "st-sec soft", id: "how" }, h("div", { class: "in" },
    h("span", { class: "sec-eb" }, "خطوات البدء"), h("h2", {}, "كيف تبدأ مع مدار؟"), h("p", { class: "sub-h" }, "خمس خطوات بسيطة من التعرف على المنصة إلى تشغيل مدرستك."),
    h("ol", { class: "steps-v" }, STEPS.map(([title, text], i) => h("li", {},
      h("span", { class: "n" }, String(i + 1)), h("div", {}, h("b", {}, title), h("p", {}, text)))))));

  const grid = h("div", { class: "st-plans" });
  const toggle = h("div", { class: "st-toggle" });
  const drawToggle = () => mount(toggle, plans.some((p) => p.monthly) && plans.some((p) => p.yearly) && !plans.every((p) => p.first_year) ? h("div", { class: "box" },
    h("button", { class: cycle === "monthly" ? "on" : "", onclick: () => { cycle = "monthly"; drawToggle(); drawPlans(); } }, "شهري"),
    h("button", { class: cycle === "yearly" ? "on" : "", onclick: () => { cycle = "yearly"; drawToggle(); drawPlans(); } }, "سنوي")) : null);
  const drawPlans = () => mount(grid, plans.map((p) => planCard(p, cycle, site)));
  drawToggle(); drawPlans();
  const plansSec = plans.length ? h("section", { class: "st-sec", id: "plans" }, h("div", { class: "in" },
    h("span", { class: "sec-eb" }, "الأسعار"), h("h2", {}, "الباقات والأسعار"),
    h("p", { class: "sub-h" }, plans.every((p) => p.features.length === (plans[0]?.features.length || 0))
      ? "كل المميزات متاحة في كل الباقات، والفرق في عدد الطلاب وعدد المدارس." : "اختر الباقة المناسبة لحجم مدرستك، ورقِّها في أي وقت بدون فقدان بياناتك."),
    toggle, grid, h("p", { class: "plans-note" },
      "يُدفع الاشتراك سنويًا مقدمًا. سعر السنة الأولى عرض للمدارس الجديدة، ثم يتجدد الاشتراك بالسعر السنوي المذكور. التفاصيل في ",
      h("a", { href: "/subscription-policy" }, "سياسة الاشتراكات والإلغاء"), "."))) : null;

  const reviewsSec = h("section", { class: "st-sec soft", id: "reviews" }, h("div", { class: "in" },
    h("span", { class: "sec-eb" }, "آراء العملاء"), h("h2", {}, "آراء عملائنا وشركائنا"),
    reviews.length ? h("div", { class: "rv-grid" }, reviews.map((r) => h("figure", { class: "rv-card" },
      r.rating ? h("div", { class: "rv-stars", "aria-label": `${r.rating} من 5` }, "★".repeat(r.rating), h("span", {}, "★".repeat(5 - r.rating))) : null,
      h("blockquote", {}, r.body),
      h("figcaption", {}, r.logo ? h("img", { src: r.logo, alt: "", width: 44, height: 44 }) : null,
        h("span", {}, h("b", {}, r.school_name), r.author_name || r.author_title ? h("small", {}, [r.author_name, r.author_title].filter(Boolean).join(" — ")) : null)))))
      : h("div", { class: "rv-invite" }, h("p", {}, "نجمع آراء المدارس التي تستخدم مدار وننشرها بعد موافقتها. هل تستخدم مدار في مدرستك؟ شاركنا تجربتك."),
        h("button", { type: "button", class: "st-btn out", onclick: () => contactDialog(site, "أريد مشاركة تجربة مدرستنا مع مدار: ") }, "شارك تجربتك"))));

  const trialSec = trialOn ? h("section", { class: "st-sec", id: "trial" }, h("div", { class: "in" }, h("div", { class: "trial-box" },
    h("div", {}, h("span", { class: "eyebrow light" }, "تجربة مجانية"), h("h2", {}, `جرّب مدار ${days} يومًا مجانًا`),
      h("p", {}, "كل المميزات متاحة خلال التجربة، وبياناتك تبقى محفوظة إذا اشتركت بعدها."),
      h("button", { class: "st-btn gold", onclick: () => trialDialog(site) }, "ابدأ تجربتك المجانية")),
    h("div", { class: "trial-cols" },
      h("div", {}, h("b", {}, "ماذا نحتاج منك؟"), h("ul", {}, h("li", {}, "اسم المدرسة ونوعها ومدينتها"), h("li", {}, "اسم مدير المدرسة وجواله"), h("li", {}, "عدد الطلاب التقريبي والمراحل الدراسية"))),
      h("div", {}, h("b", {}, "كيف تدخل؟"), h("ul", {}, h("li", {}, "يصلك رابط التفعيل"), h("li", {}, "تتحقق من جوالك برسالة نصية"), h("li", {}, "تختار كلمة المرور وتبدأ"))))))) : null;

  const ways = [
    wa ? h("a", { class: "way", href: wa, target: "_blank", rel: "noopener" }, icons.message({ size: 20 }), h("span", {}, h("b", {}, "واتساب"), h("small", {}, "محادثة مباشرة"))) : null,
    site.brand_phone ? h("a", { class: "way", href: `tel:${site.brand_phone}` }, icons.phone({ size: 20 }), h("span", {}, h("b", {}, "اتصال"), h("small", { class: "ltr" }, site.brand_phone))) : null,
    insta ? h("a", { class: "way", href: insta, target: "_blank", rel: "noopener" }, icons.image({ size: 20 }), h("span", {}, h("b", {}, "إنستغرام"), h("small", { class: "ltr" }, `@${site.brand_instagram}`))) : null,
    h("button", { type: "button", class: "way", onclick: () => contactDialog(site) }, icons.edit({ size: 20 }), h("span", {}, h("b", {}, "أرسل رسالة"), h("small", {}, "ونرد عليك قريبًا"))),
  ].filter(Boolean);

  const trust = h("section", { class: "st-sec soft", id: "trust" }, h("div", { class: "in" },
    h("span", { class: "sec-eb" }, "الثقة والأمان"), h("h2", {}, "لماذا تثق المدارس بمدار؟"),
    h("div", { class: "trust-grid" },
      h("div", { class: "trust-card" }, h("h3", {}, icons.building({ size: 20 }), "عن مدار"),
        h("p", {}, "مدار منصة عربية لإدارة المدارس، تعمل من المتصفح على الكمبيوتر والجوال بدون تثبيت برامج، وتناسب المدارس في أي دولة.")),
      h("div", { class: "trust-card" }, h("h3", {}, icons.shield({ size: 20 }), "كيف نحمي بيانات مدرستك"),
        h("ul", {}, PROTECT.map((x) => h("li", {}, x)))),
      h("div", { class: "trust-card" }, h("h3", {}, icons.file({ size: 20 }), "السياسات والمساعدة"),
        h("nav", { class: "trust-links" },
          h("a", { href: "/privacy" }, "سياسة الخصوصية"), h("a", { href: "/terms" }, "الشروط والأحكام"),
          h("a", { href: "/subscription-policy" }, "سياسة الاشتراكات والإلغاء"), link("faq", "الأسئلة الشائعة"),
          h("button", { type: "button", class: "lnk", onclick: () => statusDialog() }, "متابعة طلب سابق"))))));

  const endSec = h("section", { class: "st-sec", id: "contact" }, h("div", { class: "st-end" },
    h("div", { class: "txt" },
      h("h2", {}, "تواصل معنا"),
      h("p", {}, "نجاوبك على أي سؤال عن المنصة والباقات، ونساعدك في تجهيز مدرستك خطوة بخطوة.")),
    h("div", { class: "ways" }, ways)));

  const faq = readJson("faq-ld")?.mainEntity?.map((q) => [q.name, q.acceptedAnswer?.text]) || [];
  const guides = readJson("seo-links") || [];
  const faqSec = faq.length ? h("section", { class: "st-sec", id: "faq" }, h("div", { class: "in narrow" },
    h("h2", {}, "أسئلة شائعة"),
    h("div", { class: "st-faq" }, faq.map(([q, a]) => h("details", {}, h("summary", {}, q), h("p", {}, a)))))) : null;

  mount(app, h("div", { class: "st" }, nav, hero, audiences, features, demoSec, how, plansSec, reviewsSec, trialSec, trust, faqSec, endSec,
    h("footer", { class: "st-foot" },
      h("div", { class: "in" },
        brandLogo("", false, "row"),
        h("nav", { class: "legal" }, guides.map(([slug, name]) => h("a", { href: `/${slug}` }, name)),
          h("a", { href: "/privacy" }, "سياسة الخصوصية"), h("a", { href: "/terms" }, "الشروط والأحكام"), h("a", { href: "/subscription-policy" }, "سياسة الاشتراكات")),
        h("small", {}, `© ${new Date().getFullYear()} مدار — منصة إدارة المدارس`)))));
}

function readJson(id) {
  try { return JSON.parse(document.getElementById(id)?.textContent || "null"); } catch { return null; }
}

function launcher() {
  document.title = "مدار";
  const box = h("div", { class: "ln-list" });
  const draw = () => {
    const list = recentSchools();
    mount(box, list.length ? [h("h2", {}, "مدارسك"), list.map((x) => h("div", { class: "ln-item" },
      h("a", { class: "ln-school", href: x.url },
        h("span", { class: "ln-ava", "aria-hidden": "true" }, String(x.name).trim().charAt(0)),
        h("span", { class: "ln-txt" }, h("b", {}, x.name), h("small", {}, x.roleName)),
        icons.chevronLeft({ size: 18 })),
      h("button", { type: "button", class: "ln-x", title: "إزالة من هذا الجهاز", "aria-label": `إزالة ${x.name}`,
        onclick: () => { forgetSchool(x.id, x.role); draw(); } }, icons.close({ size: 16 }))))] : null);
  };
  draw();
  const code = h("input", { class: "ltr", placeholder: "رمز المدرسة أو رابطها", autocapitalize: "none", autocorrect: "off", spellcheck: false,
    "aria-label": "رمز المدرسة أو رابطها" });
  const msg = h("p", { class: "ln-msg", role: "alert" });
  const go = () => {
    let v = code.value.trim().toLowerCase();
    try { if (/^https?:|\//.test(v)) v = new URL(v, location.origin).pathname.split("/").filter(Boolean)[0] || ""; } catch { v = ""; }
    if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(v)) { msg.textContent = "اكتب رمز المدرسة كما وصلك من المدرسة، أو الصق رابطها."; return; }
    location.href = `/${encodeURIComponent(v)}`;
  };
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  mount(app, h("main", { class: "st ln" },
    brandLogo("ln-logo", false, "stacked"),
    box,
    h("div", { class: "ln-enter" },
      h("h2", {}, recentSchools().length ? "مدرسة أخرى" : "ادخل مدرستك"),
      h("p", {}, "اكتب رمز مدرستك أو الصق الرابط الذي وصلك منها."),
      h("div", { class: "ln-row" }, code, h("button", { type: "button", class: "st-btn pri", onclick: go }, "دخول")), msg),
    h("p", { class: "ln-about" }, h("a", { href: "/" }, "تعرّف على مدار"), " · ", h("a", { href: "/?trial" }, "سجّل مدرستك"), " · ",
      h("a", { href: "/privacy" }, "الخصوصية"))));
}

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

const cur = (p) => CUR[p.currency] || p.currency;
function priceBlock(p, cycle) {
  if (p.contact_only) return h("div", { class: "contact" }, "تواصل معنا للسعر");
  if (cycle === "yearly" && p.first_year) {
    return h("div", { class: "st-price fy" },
      h("div", { class: "row1" }, h("span", { class: "n" }, fmt(p.first_year.price)), h("span", { class: "u" }, `${cur(p)} للسنة الأولى`)),
      h("div", { class: "row2" }, h("del", {}, `${fmt(p.first_year.renewal)} ${cur(p)}`),
        h("span", { class: "off" }, `وفّر ${fmt(p.first_year.renewal - p.first_year.price)} ${cur(p)}`)),
      h("small", {}, `ثم ${fmt(p.first_year.renewal)} ${cur(p)} سنويًا عند التجديد`));
  }
  const pr = p[cycle] || p.yearly || p.monthly;
  const unit = pr === p.yearly ? "سنويًا" : "شهريًا";
  if (!pr) return h("div", { class: "contact" }, "تواصل معنا للسعر");
  return h("div", { class: "st-price" },
    h("span", { class: "n" }, fmt(pr.final)), h("span", { class: "u" }, `${cur(p)} ${unit}`),
    pr.promo ? [h("del", {}, fmt(pr.base)), h("span", { class: "off" }, `وفر الآن ${fmt(pr.percent)}%`)] : null);
}

const studentsText = (p) => (p.max_students ? `حتى ${fmt(p.max_students)} طالب` : "عدد طلاب مفتوح");
const schoolsText = (p) => (p.max_schools > 1 ? `${fmt(p.max_schools)} مدارس من مركز تحكم واحد` : "مدرسة واحدة");

function planCard(p, cycle, site) {
  const allFeatures = (site.features || []).filter((f) => f.kind !== "service").length;
  return h("div", { class: `st-plan${p.highlight ? " hi" : ""}` },
    p.highlight ? h("span", { class: "badge" }, p.badge || "الأكثر طلبًا") : p.badge ? h("span", { class: "badge" }, p.badge) : null,
    h("h3", {}, p.name), p.tagline ? h("div", { class: "tag" }, p.tagline) : null,
    p.audience ? h("p", { class: "aud" }, p.audience) : null,
    priceBlock(p, cycle),
    p.setup_fee > 0 ? h("div", { class: "fee" }, `+ رسوم تجهيز لمرة واحدة ${fmt(p.setup_fee)} ${cur(p)}`) : null,
    h("ul", { class: "plan-facts" },
      h("li", {}, icons.users({ size: 16 }), studentsText(p)),
      h("li", {}, icons.building({ size: 16 }), schoolsText(p)),
      p.max_schools > 1 && p.extra_school_price ? h("li", {}, icons.plus({ size: 16 }), `كل مدرسة إضافية ${fmt(p.extra_school_price)} ${cur(p)} سنويًا`) : null,
      h("li", {}, icons.check({ size: 16 }), p.features.length >= allFeatures ? "كل مميزات مدار بدون استثناء" : `${p.features.length} ميزة`),
      h("li", {}, icons.refresh({ size: 16 }), "التحديثات والدعم مشمولة")),
    h("div", { class: "acts" },
      h("button", { class: `st-btn ${p.highlight ? "pri" : "out"} wide`, onclick: () => subscribeDialog(site, p, cycle) }, p.contact_only ? "اطلب عرض سعر" : "اطلب الاشتراك"),
      p.trial ? h("button", { class: "try", onclick: () => trialDialog(site, p) }, `أو جرّبها مجانًا ${p.trial_days} يومًا`) : null));
}

function contactForm(onDone, prefill) {
  const f = { school_name: input({ autocomplete: "organization" }), contact_name: input({ autocomplete: "name" }),
    phone: input({ class: "ltr", inputMode: "tel", autocomplete: "tel" }), email: input({ type: "email", class: "ltr", autocomplete: "email" }), note: textarea({ rows: 3, value: prefill }) };
  const msg = h("div");
  const send = h("button", { class: "st-btn pri wide", type: "button" }, "إرسال");
  send.addEventListener("click", async () => {
    mount(msg); send.disabled = true;
    try {
      await api("/api/public/leads", { kind: "contact", ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()])) });
      const ok = h("div", { class: "st-ok" }, icons.check({ size: 40 }), h("h3", {}, "وصلتنا رسالتك"), h("p", {}, "سنتواصل معك قريبًا بإذن الله."));
      if (onDone) onDone(ok); else mount(msg, ok);
    } catch (e) { mount(msg, notice(e.message, "err")); send.disabled = false; }
  });
  return h("div", {}, field("اسم المدرسة", f.school_name),
    h("div", { class: "row" }, field("اسمك", f.contact_name), field("رقم الجوال", f.phone)),
    field("البريد الإلكتروني", f.email), field("رسالتك", f.note), msg, send);
}

function formDialog(title, top, form) {
  const box = h("div", { class: "st-form", style: "padding:0" }, top, form);
  const send = form.querySelector(":scope > .st-btn.wide:last-child");
  const d = dialog(title, box, send ? [send] : []);
  d.classList.add("st-dlg");
  return { d, box, send };
}

function trialDialog(site, plan = null) { registerDialog(site, { kind: "trial", plan }); }

function contactDialog(site, prefill = "") {
  let ref;
  const form = contactForm((ok) => { mount(ref.box, ok); ref.send?.remove(); }, prefill);
  ref = formDialog("تواصل معنا", null, form);
}

function subscribeDialog(site, plan, cycle) { registerDialog(site, { kind: "subscription", plan, cycle }); }

const STATUS_TONE = { new: "", reviewing: "", approved: "ok", awaiting_payment: "warn", active: "ok", rejected: "err", canceled: "err", expired: "err" };
function statusDialog() {
  const id = input({ class: "ltr", inputMode: "numeric", placeholder: "مثال: 245" });
  const phone = input({ class: "ltr", inputMode: "tel", placeholder: "الجوال المكتوب في الطلب" });
  const out = h("div");
  const look = h("button", { class: "st-btn pri wide", type: "button" }, "عرض حالة الطلب");
  look.addEventListener("click", async () => {
    mount(out); look.disabled = true;
    try {
      const r = await api("/api/public/leads/status", { id: id.value.replace(/\D/g, ""), phone: phone.value.trim() });
      mount(out, h("div", { class: `req-status ${STATUS_TONE[r.status] || ""}` },
        h("div", { class: "req-no" }, h("span", {}, `طلب ${r.kind}`), h("b", { class: "ltr" }, `#${r.id}`)),
        h("b", {}, r.school_name), h("p", {}, r.status_label),
        h("small", {}, `أُرسل ${new Date(r.created_at).toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric" })}`)));
    } catch (e) { mount(out, notice(e.message, "err")); }
    look.disabled = false;
  });
  const box = h("div", { class: "st-form", style: "padding:0" }, field("رقم الطلب", id), field("رقم الجوال", phone), out);
  const d = dialog("متابعة طلب", box, [look]);
  d.classList.add("st-dlg");
}

start();
showInstallBar();
