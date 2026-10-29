/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 */
import { h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { icons } from "../shared/js/icons.js";

// The institution types on offer come from the platform (the owner manages them); this list is only a fallback.
const ORG_TYPES = [["private_school", "مدرسة أهلية"], ["public_school", "مدرسة حكومية"], ["international_school", "مدرسة دولية"], ["training_institute", "معهد تدريبي"], ["other", "نوع آخر"]];
const STAGES = [["kg", "رياض الأطفال"], ["primary", "المرحلة الابتدائية"], ["middle", "المرحلة المتوسطة"], ["secondary", "المرحلة الثانوية"]];
const CONTACT = [["whatsapp", "واتساب"], ["call", "اتصال"], ["email", "البريد الإلكتروني"]];
const PHONE_RE = /^\+?[0-9 ]{6,20}$/, EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/;
const academicYear = () => { const d = new Date(), y = d.getFullYear(); return d.getMonth() >= 6 ? `${y}/${y + 1}` : `${y - 1}/${y}`; };

function control(type, opts = {}) {
  if (type === "select") {
    const s = h("select", { class: "rg-in" }, opts.options.map(([v, t]) => h("option", { value: v }, t)));
    if (opts.value !== undefined) s.value = opts.value;
    return s;
  }
  if (type === "textarea") return h("textarea", { class: "rg-in", rows: 3, placeholder: opts.placeholder || "" });
  return h("input", { class: `rg-in${opts.ltr ? " ltr" : ""}`, type: opts.type || "text", inputMode: opts.inputMode || null,
    autocomplete: opts.autocomplete || "off", placeholder: opts.placeholder || "", value: opts.value || "", min: opts.min ?? null, dir: opts.ltr ? "ltr" : null });
}
function fieldBox(label, el, { req = false, hint, wide = false } = {}) {
  const err = h("small", { class: "rg-err", role: "alert" });
  const box = h("label", { class: `rg-f${wide ? " wide" : ""}` },
    h("span", { class: "rg-l" }, label, req ? h("i", { "aria-hidden": "true" }, " *") : h("em", {}, " (اختياري)")), el,
    hint ? h("small", { class: "rg-hint" }, hint) : null, err);
  box.fail = (text) => { box.classList.add("bad"); err.textContent = text; };
  box.clear = () => { box.classList.remove("bad"); err.textContent = ""; };
  el.addEventListener("input", () => box.clear());
  return box;
}

export function registerDialog(site, { kind = "trial", plan = null, cycle = "yearly" } = {}) {
  const plans = site.plans || [];
  const trialPlans = plans.filter((p) => p.trial);
  const days = site.trial_days || 30;
  const choices = kind === "trial"
    ? [...(site.trial_without_plan || !trialPlans.length ? [{ id: "", name: "تجربة المنصة", note: "بدون تحديد باقة الآن" }] : []), ...trialPlans.map((p) => ({ id: String(p.id), name: p.name, note: p.tagline || "" }))]
    : plans.map((p) => ({ id: String(p.id), name: p.name, note: p.tagline || "" }));
  let chosen = plan ? String(plan.id) : choices[0]?.id ?? "";
  const orgTypes = site.org_types?.length ? site.org_types.map((t) => [t.key, t.name]) : ORG_TYPES;

  const c = {
    school_name: control("input", { autocomplete: "organization", placeholder: "كما في الترخيص" }),
    short_name: control("input", { placeholder: "يظهر في التطبيق" }),
    org_type: control("select", { options: orgTypes }),
    country: control("input", { autocomplete: "country-name" }),
    city: control("input", { autocomplete: "address-level2" }),
    region: control("input", { autocomplete: "address-level1" }),
    address: control("input", { autocomplete: "street-address" }),
    school_phone: control("input", { ltr: true, inputMode: "tel", placeholder: "+000 0000 0000" }),
    school_email: control("input", { ltr: true, type: "email", placeholder: "info@school.com" }),
    website: control("input", { ltr: true, placeholder: "https://" }),
    license_no: control("input", { ltr: true }),
    students_count: control("input", { type: "number", min: 1, inputMode: "numeric" }),
    classes_count: control("input", { type: "number", min: 1, inputMode: "numeric" }),
    academic_year: control("input", { ltr: true, value: academicYear() }),
    m_first: control("input", { autocomplete: "given-name" }),
    m_second: control("input"),
    m_third: control("input"),
    m_family: control("input", { autocomplete: "family-name" }),
    m_title: control("input", { value: "مدير المدرسة" }),
    phone: control("input", { ltr: true, inputMode: "tel", autocomplete: "tel", placeholder: "+000 000 000 000" }),
    email: control("input", { ltr: true, type: "email", autocomplete: "email", placeholder: "name@example.com" }),
    preferred: control("select", { options: CONTACT }),
    note: control("textarea", { placeholder: "أي تفاصيل تساعدنا في تجهيز مدرستك" }),
  };
  const F = {
    school_name: fieldBox("اسم المدرسة الرسمي", c.school_name, { req: true, wide: true }),
    short_name: fieldBox("الاسم المختصر", c.short_name), org_type: fieldBox("نوع المؤسسة", c.org_type, { req: true }),
    country: fieldBox("الدولة", c.country, { req: true }), city: fieldBox("المدينة", c.city, { req: true }),
    region: fieldBox("المنطقة أو المحافظة", c.region), address: fieldBox("العنوان", c.address),
    school_phone: fieldBox("هاتف المدرسة", c.school_phone), school_email: fieldBox("بريد المدرسة", c.school_email),
    website: fieldBox("الموقع الإلكتروني", c.website), license_no: fieldBox("رقم الترخيص", c.license_no),
    students_count: fieldBox("عدد الطلاب التقريبي", c.students_count), classes_count: fieldBox("عدد الفصول التقريبي", c.classes_count),
    academic_year: fieldBox("العام الدراسي", c.academic_year),
    m_first: fieldBox("الاسم الأول", c.m_first, { req: true }), m_second: fieldBox("اسم الأب", c.m_second),
    m_third: fieldBox("اسم الجد", c.m_third), m_family: fieldBox("اسم العائلة", c.m_family, { req: true }),
    m_title: fieldBox("المسمى الوظيفي", c.m_title), preferred: fieldBox("وسيلة التواصل المفضلة", c.preferred, { req: true }),
    phone: fieldBox("رقم الجوال", c.phone, { req: true, hint: "اكتبه مع رمز الدولة" }), email: fieldBox("البريد الإلكتروني للمدير", c.email, { req: true, hint: "يدخل به المدير لوحة المدرسة أول مرة (أو بحساب Google بنفس البريد)" }),
    note: fieldBox("ملاحظات", c.note, { wide: true }),
  };
  const stages = new Set();
  const stageChips = h("div", { class: "rg-chips" }, STAGES.map(([k, label]) => {
    const b = h("button", { type: "button", class: "rg-chip", "aria-pressed": "false" }, icons.check({ size: 14 }), label);
    b.addEventListener("click", () => { stages.has(k) ? stages.delete(k) : stages.add(k); b.setAttribute("aria-pressed", String(stages.has(k))); });
    return b;
  }));
  const v = (k) => c[k].value.trim();
  const managerName = () => ["m_first", "m_second", "m_third", "m_family"].map(v).filter(Boolean).join(" ");

  const STEPS = [
    { title: "بيانات المدرسة", hint: "المعلومات الأساسية التي تظهر في حساب مدرستك.", icon: "building",
      body: () => [
        group("الهوية", F.school_name, F.short_name, F.org_type),
        group("الموقع", F.country, F.city, F.region, F.address),
        group("التواصل والترخيص", F.school_phone, F.school_email, F.website, F.license_no),
        group("الحجم والمراحل", h("div", { class: "rg-f wide" }, h("span", { class: "rg-l" }, "المراحل الدراسية", h("em", {}, " (اختياري)")), stageChips),
          F.students_count, F.classes_count, F.academic_year),
      ],
      check: () => req([["school_name", "اكتب اسم المدرسة"], ["country", "اكتب الدولة"], ["city", "اكتب المدينة"]])
        .concat(opt("school_email", EMAIL_RE, "البريد غير صحيح"), opt("school_phone", PHONE_RE, "رقم غير صحيح"),
          opt("website", /^https?:\/\/\S+\.\S+/, "يبدأ الرابط بـ https://")) },
    { title: "مدير المدرسة", hint: "الشخص المسؤول عن الحساب، ونتواصل معه بخصوص الطلب.", icon: "user",
      body: () => [
        group("الاسم", F.m_first, F.m_second, F.m_third, F.m_family, F.m_title),
        group("التواصل", F.phone, F.email, F.preferred),
      ],
      check: () => req([["m_first", "اكتب الاسم الأول"], ["m_family", "اكتب اسم العائلة"], ["phone", "اكتب رقم الجوال"], ["email", "اكتب البريد الإلكتروني للمدير"]])
        .concat(opt("phone", PHONE_RE, "أرقام فقط، ويمكن البدء بـ +"), opt("email", EMAIL_RE, "البريد غير صحيح")) },
    { title: "المراجعة والإرسال", hint: kind === "trial" ? "راجع بياناتك ثم أرسل الطلب، وسيصلك رقم الطلب فورًا." : "راجع بياناتك ثم أرسل طلب الاشتراك.", icon: "check",
      body: () => [
        choices.length > 1 ? group(kind === "trial" ? "الباقة التي تريد تجربتها" : "الباقة", h("div", { class: "rg-plans wide" }, choices.map((p) => {
          const b = h("button", { type: "button", class: "rg-plan", "aria-pressed": String(p.id === chosen) },
            h("span", { class: "dot" }), h("span", {}, h("b", {}, p.name), p.note ? h("small", {}, p.note) : null));
          b.addEventListener("click", () => { chosen = p.id; b.parentNode.querySelectorAll(".rg-plan").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
          return b;
        }))) : null,
        group("ملخص الطلب", h("dl", { class: "rg-sum wide" },
          sum("المدرسة", v("school_name")), sum("الموقع", [v("city"), v("country")].filter(Boolean).join("، ")),
          sum("نوع المؤسسة", orgTypes.find(([k]) => k === c.org_type.value)?.[1]),
          sum("المراحل", STAGES.filter(([k]) => stages.has(k)).map(([, t]) => t).join("، ")),
          sum("عدد الطلاب", v("students_count")), sum("المدير", managerName()), sum("الجوال", v("phone"), true), sum("البريد", v("email"), true))),
        group("", F.note),
        h("p", { class: "rg-consent" }, "بإرسال الطلب توافق على ", h("a", { href: "/terms", target: "_blank" }, "الشروط والأحكام"),
          " و", h("a", { href: "/privacy", target: "_blank" }, "سياسة الخصوصية"), "."),
      ],
      check: () => [] },
  ];
  function req(list) { return list.filter(([k]) => !v(k)).map(([k, t]) => [k, t]); }
  function opt(k, re, t) { return v(k) && !re.test(v(k)) ? [[k, t]] : []; }
  function group(title, ...kids) { return h("section", { class: "rg-group" }, title ? h("h4", {}, title) : null, h("div", { class: "rg-grid" }, kids)); }
  function sum(k, val, ltr = false) { return val ? [h("dt", {}, k), h("dd", { class: ltr ? "ltr" : "" }, val)] : null; }

  let step = 0;
  const title = { trial: "طلب تجربة مجانية", subscription: `طلب اشتراك${plan ? ` — ${plan.name}` : ""}` }[kind];
  const bar = h("ol", { class: "rg-steps" });
  const body = h("div", { class: "rg-body" });
  const back = h("button", { type: "button", class: "rg-btn ghost" }, "السابق");
  const next = h("button", { type: "button", class: `rg-btn ${kind === "trial" ? "gold" : "pri"}` });
  const msg = h("div", { class: "rg-msg", role: "alert" });
  const foot = h("footer", { class: "rg-foot" }, msg, h("div", { class: "rg-acts" }, back, next));
  const close = h("button", { type: "button", class: "rg-x", "aria-label": "إغلاق" }, icons.close({ size: 20 }));
  const d = h("dialog", { class: "rg-dlg", "aria-label": title },
    h("header", { class: "rg-head" },
      h("div", { class: "rg-top" }, h("div", {}, h("h2", {}, title),
        kind === "trial" ? h("p", {}, icons.gift({ size: 15 }), `${days} يومًا مجانًا بكل المميزات، بدون أي رسوم`) : null), close), bar),
    body, foot);

  const draw = () => {
    mount(bar, STEPS.map((s, i) => h("li", { class: i < step ? "done" : i === step ? "on" : "" },
      h("span", { class: "n" }, i < step ? icons.check({ size: 14 }) : String(i + 1)), h("span", { class: "t" }, s.title))));
    const s = STEPS[step];
    mount(body, h("div", { class: "rg-card" },
      h("div", { class: "rg-card-h" }, h("span", { class: "ic" }, icons[s.icon]({ size: 22 })), h("div", {}, h("h3", {}, s.title), h("p", {}, s.hint))),
      s.body()));
    mount(msg);
    back.hidden = step === 0;
    next.textContent = step < STEPS.length - 1 ? "التالي" : kind === "trial" ? "إرسال طلب التجربة" : "إرسال طلب الاشتراك";
    body.scrollTop = 0;
  };
  const validate = () => {
    Object.values(F).forEach((f) => f.clear());
    const bad = STEPS[step].check();
    for (const [k, t] of bad) F[k].fail(t);
    if (bad.length) { c[bad[0][0]].focus(); mount(msg, `${bad.length === 1 ? "حقل واحد" : `${bad.length} حقول`} يحتاج تصحيحًا`); }
    return !bad.length;
  };
  back.addEventListener("click", () => { step--; draw(); });
  next.addEventListener("click", async () => {
    if (!validate()) return;
    if (step < STEPS.length - 1) { step++; return draw(); }
    next.disabled = true; mount(msg);
    try {
      const r = await api("/api/public/leads", {
        kind, school_name: v("school_name"), contact_name: managerName(), phone: v("phone"), email: v("email"), city: v("city"),
        students_count: v("students_count"), note: v("note"), plan_id: chosen || null, try_plan: true,
        ...(kind === "subscription" ? { billing_cycle: cycle } : {}),
        details: {
          short_name: v("short_name"), org_type: c.org_type.value, country: v("country"), region: v("region"), address: v("address"),
          school_phone: v("school_phone"), school_email: v("school_email"), website: v("website"), license_no: v("license_no"),
          stages: [...stages], classes_count: v("classes_count"), academic_year: v("academic_year"),
          manager: { first: v("m_first"), second: v("m_second"), third: v("m_third"), family: v("m_family"), title: v("m_title"), preferred: c.preferred.value },
        },
      });
      bar.hidden = true; foot.hidden = true;
      mount(body, h("div", { class: "rg-card rg-done" },
        h("span", { class: "big" }, icons.check({ size: 36 })),
        h("h3", {}, "وصلنا طلبك"),
        h("div", { class: "rg-no" }, h("span", {}, "رقم الطلب"), h("b", { dir: "ltr" }, `#${r.id}`)),
        h("p", {}, `حالة الطلب: ${r.status_label}`),
        h("p", { class: "muted" }, kind === "trial" ? "نراجع الطلب ونتواصل معك، ثم يصلك رابط دخول مدرستك." : "نتواصل معك لإتمام الاشتراك."),
        h("p", { class: "muted" }, "احفظ رقم الطلب، وتابع حالته في أي وقت من «متابعة طلب» برقم الطلب وجوالك."),
        h("button", { type: "button", class: "rg-btn pri", onclick: () => d.close() }, "تم")));
    } catch (e) { mount(msg, e.message); next.disabled = false; }
  });
  close.addEventListener("click", () => d.close());
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  draw();
  d.showModal();
  return d;
}
