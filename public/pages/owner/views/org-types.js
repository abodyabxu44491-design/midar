/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { filterByType } from "./schools.js";
import { panel, field, input, textarea, select, btn, badge, sub, notice, toast, dialog, empty } from "/shared/js/ui.js";

const A = "/api/owner/org-types";
const TONE = { available: "", beta: "blue", planned: "amber", disabled: "gray" };
// The request form's older values, so requests sent before the types list still show their type.
const LEGACY = { private: "private_school", public: "public_school", international: "international_school", institute: "training_institute" };

let cache = null;
export async function loadOrgTypes(force = false) {
  if (!cache || force) cache = await api(A);
  return cache;
}
export const typeOf = (d, key) => d.types.find((t) => t.key === (LEGACY[key] || key));
// Types an institution can be created on or moved to: on an engine that runs today, and not switched off.
export const usableTypes = (d) => d.types.filter((t) => t.status !== "disabled" && d.engines.find((e) => e.key === t.engine)?.live);
export const typeOptions = (d) => usableTypes(d).map((t) => [t.key, t.status === "available" ? t.name : `${t.name} (${statusName(d, t.status)})`]);
const statusName = (d, s) => d.statuses.find((x) => x.key === s)?.name || s;

export default async function orgTypes({ refresh, go }) {
  const d = await loadOrgTypes(true);
  const engine = (k) => d.engines.find((e) => e.key === k);
  const card = (t) => {
    const e = engine(t.engine);
    const terms = Object.entries(t.terms || {});
    return panel(null, null,
      h("div", { class: "row", style: "justify-content:space-between;align-items:flex-start" },
        h("div", {}, h("h3", { style: "margin:0" }, t.name, " ", badge(statusName(d, t.status), TONE[t.status]),
          " ", badge(`المحرك ${e?.name || t.engine}`, e?.live ? "violet" : "gray")),
          sub(t.description || "")),
        h("div", { class: "row", style: "flex:none" },
          btn("تعديل", () => editor(t, d, refresh), "sm"),
          t.tenants ? btn(`المؤسسات (${t.tenants})`, () => { filterByType(t.key); if (go) go("schools"); }, "ghost sm") : null)),
      h("div", { class: "row spaced", style: "flex-wrap:wrap;gap:18px" },
        h("div", {}, sub("المؤسسات"), h("b", {}, `${t.tenants} (${t.active_tenants} فعّالة)`)),
        h("div", {}, sub("الأقسام الافتراضية"), h("b", {}, t.default_features.length ? String(t.default_features.length) : "—")),
        h("div", {}, sub("المفتاح"), h("b", { class: "ltr" }, t.key)),
        h("div", {}, sub("نسخة الإعدادات"), h("b", {}, String(t.version)))),
      terms.length ? h("div", { class: "xb-chips", style: "margin-top:10px" },
        terms.map(([k, v]) => h("span", { class: "xb-chip", style: "cursor:default" }, `${d.term_keys.find((x) => x.key === k)?.name || k} ← ${v}`))) : null);
  };
  const live = d.types.filter((t) => engine(t.engine)?.live && ["available", "beta"].includes(t.status));
  return [
    h("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:10px" },
      notice(`الأنواع «المتاحة» و«التجريبية» تظهر في نموذج طلب الاشتراك (${live.length} الآن). «قيد التطوير» تظهر هنا فقط حتى تكتمل أقسامها. تعديل نوع لا يغيّر المؤسسات التي عليه.`, ""),
      btn("+ نوع جديد", () => editor(null, d, refresh))),
    d.types.length ? d.types.map(card) : empty("لا توجد أنواع."),
  ];
}

function editor(t, d, refresh) {
  const isNew = !t;
  const f = {
    name: input({ value: t?.name || "" }),
    key: input({ class: "ltr", placeholder: "quran_center" }),
    engine: select(d.engines.map((e) => [e.key, e.public ? e.name : `${e.name} (قيد التطوير، للتجربة فقط)`]), { value: t?.engine || "school" }),
    status: select(d.statuses.map((s) => [s.key, s.name]), { value: t?.status || "planned" }),
    sort: input({ type: "number", value: t?.sort ?? 150 }),
    description: textarea({ rows: 2, value: t?.description || "" }),
  };
  // The words shown are those of the type's engine (a school's classes and subjects, an institute's courses and sessions).
  const termIn = {};
  const termsBox = h("div", { class: "form-grid" });
  const drawTerms = () => {
    const keys = d.engine_terms[isNew ? f.engine.value : t.engine] || d.term_keys;
    for (const k of Object.keys(termIn)) if (!keys.some((x) => x.key === k)) delete termIn[k];
    mount(termsBox, keys.map((k) => field(k.name, termIn[k.key] ||= input({ value: t?.terms?.[k.key] || "", placeholder: k.name }))));
  };
  f.engine.addEventListener("change", drawTerms);
  drawTerms();
  const chosen = new Set(t?.default_features || d.features.map((x) => x.key));
  const feats = h("div", { class: "xb-chips" }, d.features.map((x) => {
    const cb = h("input", { type: "checkbox", checked: chosen.has(x.key), onchange: () => (cb.checked ? chosen.add(x.key) : chosen.delete(x.key)) });
    return h("label", { class: "xb-chip" }, cb, " ", x.name);
  }));
  const dd = dialog(isNew ? "نوع مؤسسة جديد" : `تعديل «${t.name}»`, h("div", {},
    h("div", { class: "form-grid" }, field("اسم النوع", f.name), isNew ? field("المفتاح", f.key, "حروف إنجليزية صغيرة وأرقام و _ ، لا يتغير بعد الحفظ") : null),
    h("div", { class: "form-grid" },
      isNew ? field("المحرك", f.engine, "طريقة تنظيم الدراسة: مدرسي (صفوف وشعب) أو تدريبي (برامج ودورات)") : null,
      field("الحالة", f.status), field("الترتيب", f.sort)),
    field("الوصف", f.description),
    h("h3", {}, "المصطلحات"),
    sub("الكلمات التي تظهر لمؤسسات هذا النوع بدل كلمات المنصة. اترك الخانة فارغة لتبقى الكلمة الأصلية. تُطبَّق على الشاشات تدريجيًا."),
    termsBox,
    h("h3", {}, "الأقسام الافتراضية"),
    sub("الأقسام التي تُشغَّل للمؤسسة الجديدة من هذا النوع. لا تتغير أقسام المؤسسات القائمة."),
    feats),
  [btn("حفظ", async () => {
    const terms = Object.fromEntries(Object.entries(termIn).map(([k, el]) => [k, el.value.trim()]));
    const body = { name: f.name.value, status: f.status.value, sort: Number(f.sort.value), description: f.description.value,
      terms, default_features: d.features.map((x) => x.key).filter((k) => chosen.has(k)) };
    try {
      if (isNew) await api(A, { ...body, key: f.key.value.trim(), engine: f.engine.value });
      else await api(`${A}/${t.key}`, body, "PATCH");
      dd.close(); toast("حُفظ النوع"); refresh();
    } catch (e) { toast(e.message, true); }
  })]);
  dd.classList.add("xb-wide");
}
