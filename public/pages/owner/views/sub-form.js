// نموذج تفعيل الاشتراك (مشترك): التجربة، الاشتراك المدفوع، والمجاني — بالباقة أو بمميزات مخصصة
// التجربة: تاريخ النهاية يُحسب تلقائيًا من مدة التجربة في الإعدادات (لا يُدخل يدويًا).
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { field, input, select, sub, notice } from "/shared/js/ui.js";

export const CUR = { SAR: "ريال", USD: "دولار", YER: "ريال يمني" };
export const KIND = { trial: "تجربة مجانية", paid: "اشتراك مدفوع", free: "مجاني (منحة)" };
export const SUB_STATUS = {
  trial: ["تجربة مجانية", "amber"], active: ["فعّال", ""], pending_payment: ["بانتظار الدفع", "amber"], trial_expired: ["انتهت التجربة", "red"],
  expired: ["منتهي", "red"], suspended: ["موقوف", "red"], canceled: ["ملغي", "gray"], ended: ["منتهٍ (استُبدل)", "gray"],
};
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export async function loadRefs() {
  const [plans, catalog, settings] = await Promise.all([api("/api/owner/plans"), api("/api/owner/catalog"), api("/api/owner/settings")]);
  return { plans: plans.filter((p) => p.status !== "archived"), catalog: catalog.filter((f) => f.is_active), settings };
}

/**
 * defaults: { kind, plan_id, billing_cycle, features, addons, tenantPrices }
 * يعيد { el, value() }
 */
export function subForm(refs, defaults = {}) {
  const { plans, catalog, settings } = refs;
  const kind = select(Object.entries(KIND), { value: defaults.kind || "trial" });
  const plan = select([...plans.map((p) => [p.id, `${p.name}${p.status === "paused" ? " (موقوفة)" : ""}`]), ["", "باقة مخصصة (اختيار المميزات)"]],
    { value: defaults.plan_id ?? plans.find((p) => p.highlight)?.id ?? plans[0]?.id ?? "" });
  const cycle = select([["yearly", "سنوي"], ["monthly", "شهري"], ["custom", "عدد أشهر"], ["none", "بلا تاريخ نهاية"]], { value: defaults.billing_cycle || "yearly" });
  const months = input({ type: "number", min: 1, max: 60, value: 6 });
  const start = input({ type: "date", value: today() });
  const end = input({ type: "date" });
  const price = input({ type: "number", min: 0, step: "0.01", placeholder: "تلقائي من الباقة" });
  const discount = input({ type: "number", min: 0, step: "0.01", value: 0 });
  const maxS = input({ type: "number", min: 1 });
  const maxT = input({ type: "number", min: 1 });
  const status = select([["active", "فعّال فورًا"], ["pending_payment", "بانتظار الدفع"]]);
  const force = h("input", { type: "checkbox" });
  const note = input({ placeholder: "ملاحظة داخلية (اختياري)" });
  const planName = input({ placeholder: "اسم الباقة المخصصة", value: "باقة مخصصة" });
  const box = h("div");
  const addonsBox = h("div");
  const customBox = h("div");
  const addonState = new Map((defaults.addons || []).map((a) => [a.key, a]));

  const selPlan = () => plans.find((p) => String(p.id) === String(plan.value));
  const drawAddons = () => {
    const p = selPlan();
    const inPlan = new Set(p ? p.features : [...customBox.querySelectorAll("input:checked")].map((x) => x.value));
    const extra = catalog.filter((f) => !inPlan.has(f.key));
    mount(addonsBox, extra.length ? h("details", { open: addonState.size > 0 },
      h("summary", { class: "small", style: "cursor:pointer;margin:6px 0" }, `مميزات إضافية خارج الباقة (${addonState.size})`),
      extra.map((f) => {
        const cur = addonState.get(f.key);
        const chk = h("input", { type: "checkbox", checked: !!cur, style: "width:18px;height:18px;flex:none" });
        const until = input({ type: "date", value: cur?.until || "", style: "max-width:160px", title: "حتى تاريخ (اختياري)" });
        const pr = input({ type: "number", min: 0, value: cur?.price ?? "", placeholder: f.addon_yearly ?? "مجانًا", style: "max-width:110px", title: "السعر" });
        const sync = () => { if (chk.checked) addonState.set(f.key, { key: f.key, until: until.value || null, price: Number(pr.value || 0) }); else addonState.delete(f.key); };
        for (const el of [chk, until, pr]) el.addEventListener("change", sync);
        return h("div", { class: "row", style: "align-items:center;gap:8px;margin-bottom:4px" }, chk, h("span", { style: "flex:1" }, f.name), pr, until);
      })) : null);
  };
  const drawCustom = () => {
    if (selPlan()) return mount(customBox);
    const chosen = new Set(defaults.features || catalog.filter((f) => f.kind === "core").map((f) => f.key));
    mount(customBox, field("اسم الباقة", planName), h("div", { class: "xb-toggles", style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:4px 12px" },
      catalog.map((f) => h("label", { class: "row", style: "align-items:center;gap:6px;min-width:0" },
        h("input", { type: "checkbox", value: f.key, checked: chosen.has(f.key), style: "width:18px;height:18px;flex:none", onchange: drawAddons }), f.name))));
  };
  const draw = () => {
    const trial = kind.value === "trial";
    const p = selPlan();
    const trialEnd = addDays(start.value || today(), settings.trial_days);
    maxS.placeholder = p ? (p.max_students ?? "مفتوح") : "مفتوح";
    maxT.placeholder = p ? (p.max_teachers ?? "مفتوح") : "مفتوح";
    const priceHint = p && kind.value === "paid" ? `سعر الباقة: ${cycle.value === "monthly" ? p.monthly_price ?? "—" : p.yearly_price ?? "—"} ${CUR[p.currency] || ""}${defaults.tenantPrices?.some((x) => x.plan_id === p.id) ? " — لهذه المدرسة سعر خاص يُطبَّق تلقائيًا" : ""}` : "";
    mount(box,
      h("div", { class: "row" }, field("نوع الاشتراك", kind), field("الباقة", plan)),
      customBox,
      trial ? [
        notice(`تجربة مجانية ${settings.trial_days} يومًا بلا رسوم. تنتهي تلقائيًا في ${trialEnd}.`, ""),
        h("div", { class: "row" }, field("تبدأ من", start), field("حد الطلاب", maxS), field("حد المعلمين", maxT)),
        h("label", { class: "row", style: "align-items:center;gap:6px;margin-bottom:10px" }, force, "منح تجربة جديدة حتى لو استُخدمت تجربة سابقة لهذه المدرسة"),
      ] : [
        h("div", { class: "row" }, field("المدة", cycle), cycle.value === "custom" ? field("عدد الأشهر", months) : null, field("تبدأ من", start),
          cycle.value !== "none" ? field("تنتهي في (اختياري)", end, "يُحسب من المدة إن تُرك فارغًا") : null),
        kind.value === "paid" ? h("div", { class: "row" }, field("السعر", price, priceHint), field("خصم (مبلغ)", discount)) : null,
        h("div", { class: "row" }, field("حد الطلاب", maxS), field("حد المعلمين", maxT), field("الحالة", status)),
      ],
      addonsBox, note);
    drawAddons();
  };
  for (const el of [kind, cycle, start]) el.addEventListener("change", draw);
  plan.addEventListener("change", () => { drawCustom(); draw(); });
  drawCustom(); draw();

  const value = () => {
    const k = kind.value;
    const out = { kind: k, plan_id: plan.value ? Number(plan.value) : null, starts_on: start.value || null, note: note.value || undefined,
      addons: [...addonState.values()], max_students: maxS.value ? Number(maxS.value) : undefined, max_teachers: maxT.value ? Number(maxT.value) : undefined };
    if (!plan.value) { out.features = [...customBox.querySelectorAll("input:checked")].map((x) => x.value); out.plan_name = planName.value; }
    if (k === "trial") { out.force_trial = force.checked; return out; }
    out.billing_cycle = cycle.value === "custom" ? "custom" : cycle.value;
    if (cycle.value === "custom") out.months = Number(months.value);
    if (end.value && cycle.value !== "none") out.ends_on = end.value;
    if (k === "paid" && price.value !== "") out.price = Number(price.value);
    out.discount = Number(discount.value || 0);
    out.status = status.value;
    return out;
  };
  return { el: h("div", {}, box, sub("المميزات والحدود تُحفظ كلقطة وقت التفعيل؛ تعديل الباقة لاحقًا لا يغيّر هذا الاشتراك إلا بقرارك.")), value };
}

// نص رسالة تسليم بيانات الدخول (يُرسل بواتساب للمدرسة)
export function handoverText(r) {
  const link = `${location.origin}/${r.credentials.school}`;
  return [`مرحبًا ${r.lead?.contact_name || ""}، تم تفعيل حساب ${r.school.name} على منصة مدار.`,
    `رابط دخول الإدارة: ${link}/idara`, `اسم المستخدم: ${r.credentials.username}`, `كلمة المرور المؤقتة: ${r.credentials.password}`,
    `رابط أولياء الأمور: ${link} — رمز الصفحة: ${r.credentials.directory_code}`,
    "بعد الدخول سيطلب النظام تغيير كلمة المرور، ثم يبدأ معالج إعداد المدرسة."].join("\n");
}

export const REQ_KINDS = { trial: ["طلب تجربة", "amber"], subscription: ["طلب اشتراك", "blue"], feature: ["طلب ميزة", ""], contact: ["تواصل", "gray"],
  upgrade: ["طلب ترقية", "blue"], renewal: ["طلب تجديد", ""] };
export const REQ_STATUS = { new: ["جديد", "amber"], reviewing: ["قيد المراجعة", "blue"], approved: ["تمت الموافقة", ""], awaiting_payment: ["بانتظار الدفع", "amber"],
  active: ["فعّال", ""], rejected: ["مرفوض", "red"], canceled: ["ملغي", "gray"], expired: ["منتهي", "gray"] };
// حد «مفتوح» يُخزَّن داخليًا كرقم كبير
export const limitText = (n) => (n == null || Number(n) >= 100000 ? "مفتوح" : n);
