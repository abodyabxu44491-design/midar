// الصفحة الرئيسية: فاضية (الشعار فقط) أو تسويقية، حسب إعداد لوحة المالك.
import { h, $, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { brandLogo, footer, field, input, textarea, btn, notice, sub , showInstallBar} from "/shared/js/ui.js";
import { startAnalytics } from "/shared/js/analytics.js";

const app = $("#app");

const FEATURES = [
  ["صفحة لكل مدرسة", "رابط خاص باسم مدرستك، يفتح منه أولياء الأمور والطلاب صفحاتهم."],
  ["ملف كامل لكل طالب", "الدرجات والحضور والرسوم، ولا يفتحه إلا من يملك معرّف الطالب."],
  ["إدارة ومعلمون", "لوحة للإدارة وبوابة للمعلم، وكل معلم يرى فصوله فقط."],
  ["الحضور والغياب", "تسجيل سريع، وتنبيه ولي الأمر عبر واتساب بضغطة."],
  ["الاختبارات والدرجات", "المعلم يُدخل الدرجات، والإدارة تعتمدها قبل ظهورها للأهالي."],
  ["الرسوم والسداد", "فواتير وإيصالات، وتحويل بنكي يؤكده المحاسب، وكشف بالمبالغ المتبقية."],
  ["الجدول الدراسي", "جدول لكل صف مع منع تعارض المعلمين تلقائيًا."],
  ["كشف درجات جاهز", "كشف رسمي قابل للطباعة أو الحفظ PDF لكل طالب."],
];

const PLANS = [
  ["الأساسية", "مدرسة صغيرة", ["حتى 150 طالبًا", "الحضور والدرجات", "صفحة أولياء الأمور", "دعم عبر واتساب"]],
  ["الاحترافية", "الأكثر طلبًا", ["حتى 800 طالب", "كل مزايا الأساسية", "الرسوم والفواتير", "الجدول الدراسي وكشوف الدرجات"]],
  ["المؤسسات", "مجمّعات ومدارس كبيرة", ["عدد طلاب مفتوح", "كل المزايا", "تدريب ومتابعة", "أولوية في الدعم"]],
];

async function start() {
  let site = { landing_mode: "blank" };
  try { site = await api("/api/site"); } catch { /* الوضع الافتراضي */ }
  if (site.landing_mode === "marketing") marketing(site);
  else mount(app, h("main", { class: "blank-home" }, brandLogo("hero-logo", false, "stacked")), footer());
  startAnalytics(site.landing_mode === "marketing" ? "landing" : "home");
}

function marketing(site) {
  const form = leadForm();
  mount(app,
    h("div", { class: "mk-hero" },
      h("div", {}, brandLogo("hero-logo", true, "stacked")),
      h("h1", {}, "إدارة مدرستك كاملة في مكان واحد"),
      h("p", {}, "الطلاب والحضور والدرجات والرسوم وأولياء الأمور، في منصة عربية واحدة سهلة تعمل من الجوال."),
      h("div", { class: "mk-cta" },
        h("a", { class: "btn", href: "#تجربة" }, "اطلب تجربة مجانية"),
        site.brand_phone ? h("a", { class: "btn ghost", href: `https://wa.me/${String(site.brand_phone).replace(/\D/g, "")}`, target: "_blank", rel: "noopener" }, "تواصل واتساب") : null)),

    h("section", { class: "mk-section" }, h("h2", {}, "ماذا تقدم مِدار؟"),
      h("div", { class: "mk-grid" }, FEATURES.map(([t, d]) => h("div", { class: "mk-card" }, h("h3", {}, t), h("p", {}, d))))),

    h("section", { class: "mk-section" }, h("h2", {}, "الباقات"),
      h("div", { class: "mk-grid" }, PLANS.map(([name, tag, items]) => h("div", { class: "mk-card mk-price" },
        h("h3", {}, name), h("p", {}, tag),
        h("ul", {}, items.map((i) => h("li", {}, i))),
        h("a", { class: "btn", href: "#تجربة", style: "margin-top:10px;display:inline-block" }, "اطلبها"))))),

    h("section", { class: "mk-section", id: "تجربة" }, h("h2", {}, "اطلب تجربة لمدرستك"),
      h("div", { class: "auth-card", style: "margin:0 auto" }, form)),

    site.brand_phone || site.brand_email
      ? h("section", { class: "mk-section" }, h("p", { style: "text-align:center" },
          [site.brand_phone && `للتواصل: ${site.brand_phone}`, site.brand_email].filter(Boolean).join(" — ")))
      : null,
    footer());
}

function leadForm() {
  const f = {
    school_name: input(), contact_name: input(), phone: input({ class: "ltr", inputMode: "tel" }),
    city: input(), students_count: input({ type: "number", min: 1 }), note: textarea({ rows: 2 }),
  };
  const msg = h("div");
  const send = btn("إرسال الطلب", async () => {
    mount(msg);
    try {
      await api("/api/public/leads", Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])));
      mount(msg, notice("وصلنا طلبك. سنتواصل معك قريبًا بإذن الله.", ""));
      for (const el of Object.values(f)) el.value = "";
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "wide");
  return h("div", {},
    field("اسم المدرسة", f.school_name),
    field("اسم المسؤول", f.contact_name),
    field("رقم الجوال", f.phone),
    h("div", { class: "row" }, field("المدينة", f.city), field("عدد الطلاب تقريبًا", f.students_count)),
    field("ملاحظات", f.note),
    sub("بياناتك تصل لإدارة المنصة فقط."),
    msg, send);
}

start();
showInstallBar();
