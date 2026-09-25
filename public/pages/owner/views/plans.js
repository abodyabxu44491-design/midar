// الباقات وكتالوج المميزات: إنشاء، تعديل، أسعار، عروض، حدود، تجربة، إظهار وإخفاء، أرشفة — بلا أي تعديل في الكود
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, textarea, select, btn, badge, sub, notice, toast, dialog, empty, confirmAction } from "/shared/js/ui.js";
import { icons } from "/shared/js/icons.js";
import { CUR } from "./sub-form.js";

const PSTATUS = { active: ["فعّالة", ""], paused: ["موقوفة مؤقتًا", "amber"], archived: ["مؤرشفة", "gray"] };
const money = (v, cur) => (v == null || v === "" ? "—" : `${Number(v).toLocaleString("ar")} ${CUR[cur] || ""}`);

export default async function plans({ refresh }) {
  const [list, catalog] = await Promise.all([api("/api/owner/plans"), api("/api/owner/catalog")]);
  const byKey = new Map(catalog.map((f) => [f.key, f]));
  const card = (p) => panel(null, null,
    h("div", { class: "row", style: "justify-content:space-between;align-items:flex-start" },
      h("div", {}, h("h3", { style: "margin:0" }, p.name, " ", badge(...PSTATUS[p.status]), p.highlight ? badge("مميزة", "blue") : null,
        p.is_public ? null : badge("مخفية من الموقع", "gray")),
        sub(`${p.tagline || ""}${p.badge ? ` — شارة: ${p.badge}` : ""}`)),
      h("div", { class: "row", style: "flex:none" },
        btn("تعديل الباقة", () => editor(p, catalog, refresh), "sm"),
        p.status !== "active" ? btn("تفعيل", () => setStatus(p, "active", refresh), "soft sm") : btn("إيقاف مؤقت", () => setStatus(p, "paused", refresh), "ghost sm"),
        p.status !== "archived" ? btn("أرشفة", () => setStatus(p, "archived", refresh), "danger sm") : null)),
    h("div", { class: "row spaced", style: "flex-wrap:wrap;gap:18px" },
      h("div", {}, sub("شهري"), h("b", {}, p.contact_only ? "تواصل معنا" : money(p.monthly_price, p.currency))),
      h("div", {}, sub("سنوي"), h("b", {}, p.contact_only ? "تواصل معنا" : money(p.yearly_price, p.currency))),
      h("div", {}, sub("الطلاب"), h("b", {}, p.max_students ?? "مفتوح")),
      h("div", {}, sub("المعلمون"), h("b", {}, p.max_teachers ?? "مفتوح")),
      h("div", {}, sub("مدارس عليها"), h("b", {}, p.schools)),
      h("div", {}, sub("تجربة مجانية"), h("b", {}, p.trial_enabled ? "متاحة" : "لا"))),
    p.discount_kind && p.discount_kind !== "none" ? sub(`خصم: ${{ percent: `${Number(p.discount_value)}%`, amount: `${Number(p.discount_value)} ${CUR[p.currency] || ""}`,
      price: `سعر بعد الخصم ${p.sale_monthly_price ?? "—"} شهري / ${p.sale_yearly_price ?? "—"} سنوي` }[p.discount_kind]}${p.discount_starts_at ? ` من ${String(p.discount_starts_at).slice(0, 10)}` : ""}${p.discount_ends_at ? ` حتى ${String(p.discount_ends_at).slice(0, 10)}` : ""}`) : null,
    h("div", { class: "xb-chips", style: "margin-top:10px" }, p.features.map((k) => h("span", { class: "xb-chip", style: "cursor:default" }, icons.check({ size: 12 }), " ", byKey.get(k)?.name || k))));

  return [
    h("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:10px" },
      notice("الأسعار والمميزات هنا هي ما يظهر في الصفحة الرسمية فورًا بعد الحفظ.", ""),
      btn("+ باقة جديدة", () => editor(null, catalog, refresh))),
    list.length ? list.map(card) : empty("لا توجد باقات."),
    catalogPanel(catalog, refresh),
  ];
}

async function setStatus(p, status, refresh) {
  const msg = { paused: `إيقاف «${p.name}» مؤقتًا؟ تختفي من الموقع ولا تُباع، والمدارس المشتركة لا تتأثر.`,
    archived: `أرشفة «${p.name}»؟ لا تُباع ولا تُختار لاشتراكات جديدة. المدارس المشتركة عليها لا تتأثر.` }[status];
  if (msg && !confirmAction(msg)) return;
  await api(`/api/owner/plans/${p.id}/status`, { status });
  toast("تم"); refresh();
}

function editor(p, catalog, refresh) {
  const isNew = !p;
  p = p || { code: "", name: "", currency: "SAR", trial_enabled: true, is_public: true, features: catalog.filter((f) => f.kind === "core").map((f) => f.key), sort: 100, discount_percent: 0, setup_fee: 0 };
  const f = {
    name: input({ value: p.name }), code: input({ value: p.code, class: "ltr", placeholder: "pro", disabled: !isNew && p.schools > 0 }),
    tagline: input({ value: p.tagline || "" }), badge: input({ value: p.badge || "", placeholder: "مثل: الأكثر طلبًا" }),
    description: textarea({ rows: 2, value: p.description || "" }),
    currency: select(Object.entries(CUR), { value: p.currency }),
    monthly_price: input({ type: "number", min: 0, step: "0.01", value: p.monthly_price ?? "" }),
    yearly_price: input({ type: "number", min: 0, step: "0.01", value: p.yearly_price ?? "" }),
    setup_fee: input({ type: "number", min: 0, step: "0.01", value: p.setup_fee ?? 0 }),
    discount_kind: select([["none", "بدون خصم"], ["percent", "نسبة مئوية %"], ["amount", "مبلغ يُخصم من السعر"], ["price", "سعر نهائي بعد الخصم"]], { value: p.discount_kind || "none" }),
    discount_value: input({ type: "number", min: 0, step: "0.01", value: p.discount_value ?? "" }),
    sale_monthly_price: input({ type: "number", min: 0, step: "0.01", value: p.sale_monthly_price ?? "" }),
    sale_yearly_price: input({ type: "number", min: 0, step: "0.01", value: p.sale_yearly_price ?? "" }),
    discount_starts_at: input({ type: "date", value: (p.discount_starts_at || "").slice(0, 10) }),
    discount_ends_at: input({ type: "date", value: (p.discount_ends_at || "").slice(0, 10) }),
    promo_label: input({ value: p.promo_label || "", placeholder: "اختياري، مثل: عرض الافتتاح" }),
    max_students: input({ type: "number", min: 1, value: p.max_students ?? "", placeholder: "مفتوح" }),
    max_teachers: input({ type: "number", min: 1, value: p.max_teachers ?? "", placeholder: "مفتوح" }),
    sort: input({ type: "number", value: p.sort ?? 100 }),
  };
  const chk = (key, label) => { const el = h("input", { type: "checkbox", checked: !!p[key], style: "width:18px;height:18px" }); f[key] = el; return h("label", { class: "row", style: "align-items:center;gap:6px;min-width:0" }, el, label); };

  // المميزات: علامة لكل ميزة، والترتيب بأزرار أعلى/أسفل
  let order = [...p.features, ...catalog.filter((c) => !p.features.includes(c.key) && c.is_active).map((c) => c.key)];
  const on = new Set(p.features);
  const featBox = h("div");
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const drawFeats = () => mount(featBox, order.filter((k) => byKey.has(k)).map((k, i) => {
    const c = byKey.get(k);
    return h("div", { class: "row", style: "align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--line)" },
      h("input", { type: "checkbox", checked: on.has(k), style: "width:18px;height:18px;flex:none", onchange: (e) => { if (e.target.checked) on.add(k); else on.delete(k); } }),
      h("span", { style: "flex:1;min-width:0" }, c.name, " ", h("small", { class: "sub" }, `${c.category}${c.kind === "module" ? " — قسم" : c.kind === "core" ? " — أساسي" : " — خدمة"}${c.is_active ? "" : " — متوقفة"}`)),
      h("button", { type: "button", class: "xb-icon", "aria-label": "أعلى", onclick: () => { if (i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; drawFeats(); } } }, icons.up({ size: 14 })),
      h("button", { type: "button", class: "xb-icon", "aria-label": "أسفل", onclick: () => { if (i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; drawFeats(); } } }, icons.down({ size: 14 })));
  }));
  drawFeats();

  // الخصم: الحقول المناسبة لنوعه فقط، مع معاينة حية للسعر كما سيظهر في الصفحة العامة
  const discountBox = h("div");
  const preview = h("div", { class: "notice" });
  const drawDiscount = () => {
    const k = f.discount_kind.value;
    mount(discountBox,
      h("div", { class: "row" }, field("نوع الخصم", f.discount_kind),
        k === "percent" ? field("النسبة %", f.discount_value) : k === "amount" ? field("المبلغ المخصوم", f.discount_value) : null),
      k === "price" ? h("div", { class: "row" }, field("السعر الشهري بعد الخصم", f.sale_monthly_price), field("السعر السنوي بعد الخصم", f.sale_yearly_price)) : null,
      k !== "none" ? h("div", { class: "row" }, field("يبدأ في (اختياري)", f.discount_starts_at), field("ينتهي في (اختياري)", f.discount_ends_at), field("نص العرض (اختياري)", f.promo_label)) : null,
      k !== "none" ? preview : null);
    paintPreview();
  };
  const paintPreview = () => {
    const k = f.discount_kind.value;
    const v = Number(f.discount_value.value || 0);
    const cur = CUR[f.currency.value] || "";
    const line = (label, base, sale) => {
      if (base === "" || base == null) return null;
      const b = Number(base);
      const fin = k === "percent" ? b * (100 - v) / 100 : k === "amount" ? Math.max(0, b - v) : sale !== "" ? Number(sale) : b;
      return h("div", {}, `${label}: `, fin < b ? [h("del", {}, `${b} ${cur}`), " ← ", h("b", {}, `${Math.round(fin * 100) / 100} ${cur}`), ` (وفر ${Math.round((1 - fin / b) * 100)}%)`] : h("b", {}, `${b} ${cur} (بدون خصم)`));
    };
    mount(preview, h("b", {}, "كما سيظهر للعملاء:"), line("شهري", f.monthly_price.value, f.sale_monthly_price.value), line("سنوي", f.yearly_price.value, f.sale_yearly_price.value));
  };
  f.discount_kind.addEventListener("change", drawDiscount);
  for (const el of [f.discount_value, f.sale_monthly_price, f.sale_yearly_price, f.monthly_price, f.yearly_price]) el.addEventListener("input", paintPreview);
  drawDiscount();

  const body = h("div", {},
    h("div", { class: "row" }, field("اسم الباقة", f.name), field("رمز الباقة", f.code, "إنجليزي، لا يظهر للعملاء")),
    h("div", { class: "row" }, field("وصف مختصر", f.tagline), field("شارة", f.badge)),
    field("وصف", f.description),
    h("h4", {}, "الأسعار"),
    h("div", { class: "row" }, field("العملة", f.currency), field("السعر الشهري", f.monthly_price, "فارغ = غير متاح شهريًا"), field("السعر السنوي", f.yearly_price)),
    field("رسوم تجهيز لمرة واحدة", f.setup_fee),
    h("h4", {}, "الخصم (اختياري)"), discountBox,
    h("h4", {}, "الحدود والإعدادات"),
    h("div", { class: "row" }, field("حد الطلاب", f.max_students), field("حد المعلمين", f.max_teachers), field("الترتيب في الصفحة", f.sort)),
    h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px 14px;margin:8px 0" },
      chk("trial_enabled", "تتيح تجربة مجانية"), chk("is_public", "تظهر في الموقع"), chk("highlight", "باقة مميزة (بإطار)"), chk("contact_only", "«تواصل معنا» بدل السعر")),
    h("h4", {}, "المميزات (علّم ما تشمله الباقة، ورتّبها كما تظهر)"), featBox);

  const collect = () => {
    const num = (el) => (el.value === "" ? null : Number(el.value));
    return {
      name: f.name.value, code: f.code.value, tagline: f.tagline.value, badge: f.badge.value, description: f.description.value,
      currency: f.currency.value, monthly_price: num(f.monthly_price), yearly_price: num(f.yearly_price), setup_fee: Number(f.setup_fee.value || 0),
      discount_kind: f.discount_kind.value, discount_value: num(f.discount_value),
      sale_monthly_price: num(f.sale_monthly_price), sale_yearly_price: num(f.sale_yearly_price),
      discount_starts_at: f.discount_starts_at.value || null, discount_ends_at: f.discount_ends_at.value || null,
      promo_label: f.promo_label.value, max_students: num(f.max_students), max_teachers: num(f.max_teachers),
      trial_enabled: f.trial_enabled.checked, is_public: f.is_public.checked, highlight: f.highlight.checked, contact_only: f.contact_only.checked,
      sort: Number(f.sort.value || 100), features: order.filter((k) => on.has(k)),
    };
  };
  const d = dialog(isNew ? "باقة جديدة" : `تعديل الباقة — ${p.name}`, body, [btn("حفظ", async () => {
    const plan = collect();
    if (isNew) { await api("/api/owner/plans", plan); d.close(); toast("أُنشئت الباقة"); return refresh(); }
    if (p.schools > 0) return applyDialog(p, plan, () => { d.close(); refresh(); });
    await api(`/api/owner/plans/${p.id}`, { plan, apply: "new" }, "PUT");
    d.close(); toast("حُفظت الباقة وظهرت في الموقع"); refresh();
  })]);
  d.classList.add("xb-wide");
}

// أين يُطبَّق التعديل: الاشتراكات الجديدة فقط (الافتراضي)، الحالية والجديدة، أو مدرسة محددة — مع تأكيد
async function applyDialog(p, plan, done) {
  const subs = await api(`/api/owner/subscriptions?plan_id=${p.id}`);
  const scope = select([["new", "الاشتراكات الجديدة فقط"], ["existing", `الاشتراكات الحالية والجديدة (${p.schools} مدرسة)`], ["tenant", "مدرسة محددة"]]);
  const tenant = select(subs.map((x) => [x.tenant_id, x.name]));
  const tBox = h("div", { class: "hidden" }, field("المدرسة", tenant));
  scope.addEventListener("change", () => tBox.classList.toggle("hidden", scope.value !== "tenant"));
  const d = dialog("تطبيق التعديل", h("div", {},
    notice(`على هذه الباقة ${p.schools} مدرسة. كل اشتراك قائم يحتفظ بلقطة مميزاته وحدوده وقت التفعيل.`, "warn"),
    field("طبّق التعديل على", scope), tBox,
    sub("الأسعار الجديدة تنطبق على التجديدات والاشتراكات الجديدة. أسعار الاشتراكات القائمة لا تتغير.")),
  [btn("تأكيد الحفظ", async () => {
    const r = await api(`/api/owner/plans/${p.id}`, { plan, apply: scope.value, tenant_id: scope.value === "tenant" ? tenant.value : undefined, confirm: true }, "PUT");
    d.close(); toast(r.affected ? `حُفظت الباقة وحُدّث ${r.affected} اشتراك` : "حُفظت الباقة للاشتراكات الجديدة"); done();
  })]);
}

/* ---------- كتالوج المميزات ---------- */
function catalogPanel(catalog, refresh) {
  const KIND = { core: "أساسي", module: "قسم برمجي", service: "خدمة" };
  return panel("كتالوج المميزات", btn("+ ميزة (خدمة)", () => featureDialog(null, refresh), "sm"),
    sub("الأقسام البرمجية الجديدة تظهر هنا تلقائيًا عند إضافتها للمنصة، ثم تحدد أنت الباقات التي تشملها. الخدمات (دعم، تدريب…) تضيفها من هنا."),
    catalog.map((c) => h("div", { class: "xb-list-row" },
      h("div", { class: c.is_active ? "" : "muted-row" }, h("b", {}, c.name), " ", badge(KIND[c.kind], c.kind === "module" ? "blue" : "gray"),
        c.is_active ? null : badge("متوقفة", "red"),
        sub([c.category, c.description, `في ${c.plans} باقة`, c.requestable ? "تُطلب كإضافة" : null,
          c.addon_yearly != null ? `سعر الإضافة سنويًا ${c.addon_yearly}` : null].filter(Boolean).join(" — "))),
      h("div", { class: "acts" }, btn("تعديل", () => featureDialog(c, refresh), "ghost sm")))));
}

function featureDialog(c, refresh) {
  const isNew = !c;
  const f = {
    key: input({ class: "ltr", value: c?.key || "", disabled: !isNew, placeholder: "custom_domain" }),
    name: input({ value: c?.name || "" }), description: input({ value: c?.description || "" }),
    category: input({ value: c?.category || "الخدمات" }), sort: input({ type: "number", value: c?.sort ?? 100 }),
    addon_monthly: input({ type: "number", min: 0, value: c?.addon_monthly ?? "" }), addon_yearly: input({ type: "number", min: 0, value: c?.addon_yearly ?? "" }),
    requestable: h("input", { type: "checkbox", checked: c ? c.requestable : true, style: "width:18px;height:18px" }),
    is_active: h("input", { type: "checkbox", checked: c ? c.is_active : true, style: "width:18px;height:18px" }),
  };
  const d = dialog(isNew ? "ميزة جديدة" : `تعديل — ${c.name}`, h("div", {},
    isNew ? field("المفتاح", f.key, "إنجليزي صغير و _") : null,
    h("div", { class: "row" }, field("الاسم", f.name), field("الفئة", f.category)), field("الوصف", f.description),
    h("div", { class: "row" }, field("سعر الإضافة شهريًا", f.addon_monthly), field("سنويًا", f.addon_yearly), field("الترتيب", f.sort)),
    h("label", { class: "row", style: "align-items:center;gap:6px" }, f.requestable, "تستطيع المدرسة طلبها كإضافة"),
    !isNew ? h("label", { class: "row", style: "align-items:center;gap:6px" }, f.is_active, "مفعّلة في الكتالوج") : null),
  [btn("حفظ", async () => {
    const num = (el) => (el.value === "" ? null : Number(el.value));
    const body = { name: f.name.value, description: f.description.value, category: f.category.value, sort: Number(f.sort.value || 100),
      addon_monthly: num(f.addon_monthly), addon_yearly: num(f.addon_yearly), requestable: f.requestable.checked };
    if (isNew) await api("/api/owner/catalog", { ...body, key: f.key.value });
    else await api(`/api/owner/catalog/${c.key}`, { ...body, is_active: f.is_active.checked }, "PATCH");
    d.close(); toast("تم الحفظ"); refresh();
  })]);
}
