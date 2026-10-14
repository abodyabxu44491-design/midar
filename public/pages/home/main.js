/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, $, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { brandLogo, footer, field, input, textarea, select, btn, notice, sub, dialog, installButton, showInstallBar, toast } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { startAnalytics } from "../shared/js/analytics.js";
import { recentSchools, forgetSchool } from "../shared/js/recent.js";

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
  ["نراجع الطلب ونتواصل معك", "نتأكد من البيانات ونتواصل معك على الجوال أو واتساب."],
  ["استلم بيانات الدخول وجرّب", "نرسل رابط مدرستك وحساب المدير، وتبدأ التجربة كاملة."],
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
  let cycle = plans.some((p) => p.yearly) ? "yearly" : "monthly";
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
      trialOn ? h("p", { class: "note" }, `${days} يومًا مجانًا كاملة، بدون رسوم خلال التجربة`) : null),
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
    h("h2", {}, "مميزات مدار"), h("p", { class: "sub-h" }, "كل ما تحتاجه المدرسة في منصة واحدة تعمل من الجوال والكمبيوتر."),
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
    h("h2", {}, "كيف تبدأ مع مدار؟"), h("p", { class: "sub-h" }, "خمس خطوات بسيطة من التعرف على المنصة إلى تشغيل مدرستك."),
    h("ol", { class: "steps-v" }, STEPS.map(([title, text], i) => h("li", {},
      h("span", { class: "n" }, String(i + 1)), h("div", {}, h("b", {}, title), h("p", {}, text)))))));

  const grid = h("div", { class: "st-plans" });
  const toggle = h("div", { class: "st-toggle" });
  const drawToggle = () => mount(toggle, plans.some((p) => p.monthly) && plans.some((p) => p.yearly) ? h("div", { class: "box" },
    h("button", { class: cycle === "monthly" ? "on" : "", onclick: () => { cycle = "monthly"; drawToggle(); drawPlans(); } }, "شهري"),
    h("button", { class: cycle === "yearly" ? "on" : "", onclick: () => { cycle = "yearly"; drawToggle(); drawPlans(); } }, "سنوي")) : null);
  const drawPlans = () => mount(grid, plans.map((p) => planCard(p, cycle, site)));
  drawToggle(); drawPlans();
  const plansSec = plans.length ? h("section", { class: "st-sec", id: "plans" }, h("div", { class: "in" },
    h("h2", {}, "الباقات والأسعار"),
    h("p", { class: "sub-h" }, plans.every((p) => p.features.length === (plans[0]?.features.length || 0))
      ? "كل المميزات متاحة في كل الباقات، والفرق في عدد الطلاب وعدد المدارس." : "اختر الباقة المناسبة لحجم مدرستك، ورقِّها في أي وقت بدون فقدان بياناتك."),
    toggle, grid, compareTable(plans), h("p", { class: "plans-note" },
      "يُدفع الاشتراك سنويًا مقدمًا. سعر السنة الأولى عرض للمدارس الجديدة، ثم يتجدد الاشتراك بالسعر السنوي المذكور. التفاصيل في ",
      h("a", { href: "/subscription-policy" }, "سياسة الاشتراكات والإلغاء"), "."))) : null;

  const reviewsSec = h("section", { class: "st-sec soft", id: "reviews" }, h("div", { class: "in" },
    h("h2", {}, "آراء عملائنا وشركائنا"),
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
      h("div", {}, h("b", {}, "ماذا يحدث بعد الإرسال؟"), h("ul", {}, h("li", {}, "يصلك رقم الطلب فورًا لمتابعة حالته"), h("li", {}, "نراجع الطلب ونتواصل معك"), h("li", {}, "نرسل رابط مدرستك وبيانات دخول المدير"))))))) : null;

  const ways = [
    wa ? h("a", { class: "way", href: wa, target: "_blank", rel: "noopener" }, icons.message({ size: 20 }), h("span", {}, h("b", {}, "واتساب"), h("small", {}, "محادثة مباشرة"))) : null,
    site.brand_phone ? h("a", { class: "way", href: `tel:${site.brand_phone}` }, icons.phone({ size: 20 }), h("span", {}, h("b", {}, "اتصال"), h("small", { class: "ltr" }, site.brand_phone))) : null,
    insta ? h("a", { class: "way", href: insta, target: "_blank", rel: "noopener" }, icons.image({ size: 20 }), h("span", {}, h("b", {}, "إنستغرام"), h("small", { class: "ltr" }, `@${site.brand_instagram}`))) : null,
    h("button", { type: "button", class: "way", onclick: () => contactDialog(site) }, icons.edit({ size: 20 }), h("span", {}, h("b", {}, "أرسل رسالة"), h("small", {}, "ونرد عليك قريبًا"))),
  ].filter(Boolean);

  const trust = h("section", { class: "st-sec soft", id: "trust" }, h("div", { class: "in" },
    h("h2", {}, "لماذا تثق المدارس بمدار؟"),
    h("div", { class: "trust-grid" },
      h("div", { class: "trust-card" }, h("h3", {}, icons.building({ size: 20 }), "عن مدار"),
        h("p", {}, "مدار منصة عربية لإدارة المدارس، صُممت للمدارس في اليمن والسعودية والمنطقة، وتعمل من المتصفح على الكمبيوتر والجوال بدون تثبيت برامج."),
        h("p", { class: "sub" }, "برمجة وتطوير وتشغيل: المبرمج عبدالله السكني.")),
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

function compareTable(plans) {
  if (plans.length < 2) return null;
  const rows = [
    ["السعر للسنة الأولى", (p) => (p.first_year ? `${fmt(p.first_year.price)} ${cur(p)}` : p.yearly ? `${fmt(p.yearly.final)} ${cur(p)}` : "—")],
    ["السعر السنوي عند التجديد", (p) => (p.first_year ? `${fmt(p.first_year.renewal)} ${cur(p)}` : p.yearly ? `${fmt(p.yearly.base)} ${cur(p)}` : "—")],
    ["عدد الطلاب", (p) => (p.max_students ? fmt(p.max_students) : "مفتوح")],
    ["عدد المدارس", (p) => fmt(p.max_schools || 1)],
    ["مدرسة إضافية", (p) => (p.max_schools > 1 && p.extra_school_price ? `${fmt(p.extra_school_price)} ${cur(p)} سنويًا` : "—")],
    ["مركز تحكم لعدة مدارس", (p) => (p.max_schools > 1 ? "✓" : "—")],
    ["كل المميزات", () => "✓"],
    ["تجربة مجانية", (p) => (p.trial ? `${p.trial_days} يومًا` : "—")],
  ];
  return h("div", { class: "cmp-wrap" }, h("table", { class: "cmp" },
    h("thead", {}, h("tr", {}, h("th", {}, "المقارنة"), plans.map((p) => h("th", { class: p.highlight ? "hi" : "" }, p.name)))),
    h("tbody", {}, rows.map(([label, fn]) => h("tr", {}, h("th", { scope: "row" }, label), plans.map((p) => h("td", { class: p.highlight ? "hi" : "" }, fn(p))))))));
}

const ORG_TYPES = [["private", "مدرسة أهلية"], ["public", "مدرسة حكومية"], ["international", "مدرسة دولية"], ["institute", "معهد تدريبي"], ["other", "نوع آخر"]];
const COUNTRIES = [["YE", "اليمن"], ["SA", "السعودية"], ["OTHER", "دولة أخرى"]];
const STAGES = [["kg", "رياض الأطفال"], ["primary", "ابتدائي / أساسي"], ["middle", "متوسط"], ["secondary", "ثانوي"]];
const PHONE_RE = /^[0-9+ ]{6,20}$/, EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/;
const academicYear = () => { const d = new Date(), y = d.getFullYear(); return d.getMonth() >= 6 ? `${y}/${y + 1}` : `${y - 1}/${y}`; };

function leadForm(site, { kind, plan = null, cycle = "yearly", onDone, prefill = "" }) {
  if (kind === "contact") return contactForm(onDone, prefill);
  const plans = site.plans || [];
  const trialPlans = plans.filter((p) => p.trial);
  const i = (props = {}) => input(props);
  const f = {
    school_name: i({ autocomplete: "organization" }), short_name: i(), org_type: select(ORG_TYPES), country: select(COUNTRIES),
    city: i(), region: i(), address: i(), school_phone: i({ class: "ltr", inputMode: "tel" }), school_email: i({ type: "email", class: "ltr" }),
    website: i({ class: "ltr", placeholder: "https://" }), license_no: i(), students_count: i({ type: "number", min: 1 }),
    classes_count: i({ type: "number", min: 1 }), academic_year: i({ value: academicYear() }),
    m_first: i({ autocomplete: "given-name" }), m_second: i(), m_third: i(), m_family: i({ autocomplete: "family-name" }),
    m_title: i({ value: "مدير المدرسة" }), phone: i({ class: "ltr", inputMode: "tel", autocomplete: "tel" }), email: i({ type: "email", class: "ltr", autocomplete: "email" }),
    preferred: select([["whatsapp", "واتساب"], ["call", "اتصال"], ["email", "البريد الإلكتروني"]]), note: textarea({ rows: 2 }),
  };
  const stageBoxes = STAGES.map(([k, label]) => { const c = h("input", { type: "checkbox", value: k }); return [c, h("label", { class: "chk" }, c, label)]; });
  const licenseField = field("رقم ترخيص المدرسة (اختياري)", f.license_no);
  const syncCountry = () => {
    licenseField.hidden = f.country.value === "OTHER";
    licenseField.querySelector("span").textContent = f.country.value === "SA" ? "رقم ترخيص وزارة التعليم (اختياري)" : "رقم ترخيص المدرسة (اختياري)";
  };
  f.country.addEventListener("change", syncCountry); syncCountry();
  const fullName = h("div", { class: "full-name" });
  const syncName = () => { const n = [f.m_first, f.m_second, f.m_third, f.m_family].map((x) => x.value.trim()).filter(Boolean).join(" "); mount(fullName, n ? ["الاسم الكامل: ", h("b", {}, n)] : null); };
  [f.m_first, f.m_second, f.m_third, f.m_family].forEach((x) => x.addEventListener("input", syncName));

  const planOpts = kind === "trial"
    ? [...(site.trial_without_plan ? [["", "أريد تجربة المنصة (بدون تحديد باقة)"]] : []), ...trialPlans.map((p) => [p.id, p.name])]
    : plans.map((p) => [p.id, p.name]);
  const planSel = select(planOpts, { value: plan?.id ?? (kind === "trial" ? (site.trial_without_plan ? "" : trialPlans[0]?.id) : plans[0]?.id) });
  const cycleSel = kind === "subscription" && plans.some((p) => p.monthly) ? select([["monthly", "شهري"], ["yearly", "سنوي"]], { value: cycle }) : null;
  const msg = h("div");
  const label = { trial: "إرسال طلب التجربة المجانية", subscription: "إرسال طلب الاشتراك" }[kind];
  const send = h("button", { class: `st-btn ${kind === "trial" ? "gold" : "pri"} wide`, type: "button" }, label);

  const check = () => {
    const req = [[f.school_name, "اكتب اسم المدرسة الرسمي"], [f.city, "اكتب المدينة"], [f.m_first, "اكتب الاسم الأول للمدير"],
      [f.m_family, "اكتب اسم العائلة للمدير"], [f.phone, "اكتب رقم جوال المسؤول"]];
    for (const [el, text] of req) if (!el.value.trim()) return [el, text];
    if (!PHONE_RE.test(f.phone.value.trim())) return [f.phone, "رقم الجوال غير صحيح: أرقام فقط مع رمز الدولة إن وجد"];
    if (f.email.value.trim() && !EMAIL_RE.test(f.email.value.trim())) return [f.email, "البريد الإلكتروني غير صحيح"];
    if (f.school_email.value.trim() && !EMAIL_RE.test(f.school_email.value.trim())) return [f.school_email, "بريد المدرسة غير صحيح"];
    if (f.school_phone.value.trim() && !PHONE_RE.test(f.school_phone.value.trim())) return [f.school_phone, "هاتف المدرسة غير صحيح"];
    if (f.website.value.trim() && !/^https?:\/\/\S+\.\S+/.test(f.website.value.trim())) return [f.website, "رابط الموقع يبدأ بـ https://"];
    return null;
  };
  send.addEventListener("click", async () => {
    mount(msg);
    form.querySelectorAll(".bad").forEach((x) => x.classList.remove("bad"));
    const bad = check();
    if (bad) { bad[0].classList.add("bad"); bad[0].focus(); return mount(msg, notice(bad[1], "err")); }
    send.disabled = true;
    try {
      const v = (el) => el.value.trim();
      const r = await api("/api/public/leads", {
        kind, school_name: v(f.school_name), contact_name: [f.m_first, f.m_second, f.m_third, f.m_family].map(v).filter(Boolean).join(" "),
        phone: v(f.phone), email: v(f.email), city: v(f.city), students_count: v(f.students_count), note: v(f.note),
        plan_id: planSel.value || null, ...(kind === "subscription" ? { billing_cycle: cycleSel?.value || "yearly" } : {}), try_plan: true,
        details: {
          short_name: v(f.short_name), org_type: f.org_type.value, country: f.country.value, region: v(f.region), address: v(f.address),
          school_phone: v(f.school_phone), school_email: v(f.school_email), website: v(f.website), license_no: f.country.value === "OTHER" ? "" : v(f.license_no),
          stages: stageBoxes.filter(([c]) => c.checked).map(([c]) => c.value), classes_count: v(f.classes_count), academic_year: v(f.academic_year),
          manager: { first: v(f.m_first), second: v(f.m_second), third: v(f.m_third), family: v(f.m_family), title: v(f.m_title), preferred: f.preferred.value },
        },
      });
      const ok = h("div", { class: "st-ok" }, icons.check({ size: 40 }), h("h3", {}, "وصلنا طلبك"),
        h("div", { class: "req-no" }, h("span", {}, "رقم الطلب"), h("b", { class: "ltr" }, `#${r.id}`)),
        h("p", {}, `الحالة: ${r.status_label}.`),
        h("p", {}, kind === "trial" ? "سنراجع الطلب ونتواصل معك، ثم نرسل رابط مدرستك وبيانات دخول المدير." : "سنتواصل معك لإتمام الاشتراك."),
        h("p", { class: "sub" }, "احفظ رقم الطلب. تستطيع متابعة حالته من «متابعة طلب» برقم الطلب وجوالك."));
      if (onDone) onDone(ok); else mount(msg, ok);
    } catch (e) { mount(msg, notice(e.message, "err")); send.disabled = false; }
  });
  const sec = (title, ...kids) => h("fieldset", { class: "fs" }, h("legend", {}, title), ...kids);
  const form = h("div", {},
    kind === "subscription" && plan ? h("div", { class: "notice" }, `الباقة المختارة: ${plan.name}`) : null,
    h("p", { class: "req-hint" }, "الحقول المعلَّمة بـ * مطلوبة، والباقي اختياري."),
    sec("1. بيانات المدرسة",
      field("اسم المدرسة الرسمي *", f.school_name),
      h("div", { class: "row" }, field("الاسم المختصر", f.short_name), field("نوع المؤسسة", f.org_type)),
      h("div", { class: "row" }, field("الدولة", f.country), field("المدينة *", f.city)),
      h("div", { class: "row" }, field("المنطقة أو المحافظة", f.region), field("العنوان", f.address)),
      h("div", { class: "row" }, field("هاتف المدرسة", f.school_phone), field("بريد المدرسة", f.school_email)),
      h("div", { class: "row" }, field("الموقع الإلكتروني", f.website), licenseField),
      h("div", { class: "f" }, h("span", {}, "المراحل الدراسية"), h("div", { class: "stage-grid" }, stageBoxes.map((x) => x[1]))),
      h("div", { class: "row" }, field("عدد الطلاب التقريبي", f.students_count), field("عدد الفصول التقريبي", f.classes_count), field("العام الدراسي", f.academic_year))),
    sec("2. بيانات مدير المدرسة والمسؤول عن الحساب",
      h("div", { class: "row" }, field("الاسم الأول *", f.m_first), field("الاسم الثاني", f.m_second)),
      h("div", { class: "row" }, field("الاسم الثالث", f.m_third), field("اسم العائلة *", f.m_family)),
      fullName,
      h("div", { class: "row" }, field("المسمى الوظيفي", f.m_title), field("وسيلة التواصل المفضلة", f.preferred)),
      h("div", { class: "row" }, field("رقم الجوال *", f.phone, "مع رمز الدولة إن كان خارج بلد المدرسة"), field("البريد الإلكتروني", f.email))),
    sec("3. الباقة",
      h("div", { class: "row" }, field(kind === "trial" ? "الباقة المرغوبة للتجربة" : "الباقة المطلوبة", planSel), cycleSel ? field("المدة", cycleSel) : null),
      field("ملاحظات", f.note)),
    h("p", { class: "st-consent" }, "بإرسال الطلب توافق على ", h("a", { href: "/terms", target: "_blank" }, "الشروط والأحكام"),
      " و", h("a", { href: "/privacy", target: "_blank" }, "سياسة الخصوصية"), ". لا نطلب كلمة مرور الآن، ونرسل لك بيانات الدخول بعد المراجعة."),
    msg, send);
  return form;
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

function trialDialog(site, plan = null) {
  let ref;
  const form = leadForm(site, { kind: "trial", plan, onDone: (ok) => { mount(ref.box, ok); ref.send?.remove(); } });
  ref = formDialog("طلب تجربة مجانية", h("div", { class: "st-dlg-note" }, icons.gift({ size: 16 }),
    `${site.trial_days || 30} يومًا مجانًا — بدون رسوم خلال فترة التجربة`), form);
}

function contactDialog(site, prefill = "") {
  let ref;
  const form = leadForm(site, { kind: "contact", prefill, onDone: (ok) => { mount(ref.box, ok); ref.send?.remove(); } });
  ref = formDialog("تواصل معنا", null, form);
}

function subscribeDialog(site, plan, cycle) {
  let ref;
  const form = leadForm(site, { kind: "subscription", plan, cycle, onDone: (ok) => { mount(ref.box, ok); ref.send?.remove(); } });
  ref = formDialog(`طلب اشتراك — ${plan.name}`, null, form);
}

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
