// معالج إعداد المدرسة: بيانات المدرسة ← القالب والمراحل ← الشعب ← المواد
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, sub, badge, notice, toast, empty } from "/shared/js/ui.js";
import { A } from "./common.js";

export default async function setup({ refresh }) {
  const d = await api(`${A}/setup`);
  const c = d.catalog;
  const p = d.profile || {};
  const box = h("div");
  let step = 1;

  /* ---- الخطوة 1: بيانات المدرسة ---- */
  const f = {
    name: input({ value: p.name || "" }),
    school_type: select(c.school_types.map((x) => [x.key, x.name]), { value: p.school_type || "private" }),
    gender: select(c.genders.map((x) => [x.key, x.name]), { value: p.gender || "boys" }),
    country: input({ value: p.country || "" }),
    city: input({ value: p.city || "" }),
    address: input({ value: p.address || "" }),
    email: input({ class: "ltr", type: "email", value: p.email || "" }),
    phone: input({ class: "ltr", inputMode: "tel", value: p.phone || "" }),
  };

  /* ---- الخطوة 2: القالب والشعب ---- */
  const template = select(c.templates.map((x) => [x.key, `${x.name}${x.grades ? ` — ${x.grades} صفوف` : ""}`]), { value: "primary" });
  const sections = input({ type: "number", min: 0, max: 20, value: 2 });
  const naming = select(c.naming.map((n) => [n.key, `${n.name} (${n.sample})`]));

  /* ---- الخطوة 3: المواد ---- */
  const subjectBox = h("div");
  const chosen = new Map();     // اسم المادة ← مفعّلة

  const stagesOfTemplate = () => (c.templates.find((x) => x.key === template.value)?.stages || []);
  const subjectsOfTemplate = () => {
    const names = stagesOfTemplate();
    const list = [];
    for (const st of c.stages) {
      if (!names.includes(st.name)) continue;
      for (const s of st.subjects) if (!list.some((x) => x.name === s.name)) list.push(s);
    }
    return list;
  };

  const drawSubjects = () => {
    const list = subjectsOfTemplate();
    if (!list.length) return mount(subjectBox, empty("لا توجد مواد مقترحة لهذا القالب. أضفها لاحقًا من الهيكل الأكاديمي."));
    for (const s of list) if (!chosen.has(s.name)) chosen.set(s.name, true);
    mount(subjectBox,
      h("div", { class: "subject-grid" }, list.map((s) => {
        const cb = input({ type: "checkbox", checked: chosen.get(s.name) !== false });
        cb.addEventListener("change", () => chosen.set(s.name, cb.checked));
        return h("label", { class: "subject-pick" }, cb,
          h("span", {}, h("b", {}, s.name), sub(`${s.code} — ${s.weekly} حصص أسبوعيًا`)));
      })));
  };
  template.addEventListener("change", () => { chosen.clear(); drawSubjects(); draw(); });

  /* ---- العرض ---- */
  const draw = () => {
    const stages = stagesOfTemplate();
    mount(box,
      h("div", { class: "steps" }, [1, 2, 3].map((n) => h("span", { class: `step ${n === step ? "on" : n < step ? "done" : ""}` }, `${n}`))),

      step === 1 ? panel("بيانات المدرسة", null,
        field("اسم المدرسة", f.name),
        h("div", { class: "row" }, field("نوع المدرسة", f.school_type), field("الجنس", f.gender)),
        h("div", { class: "row" }, field("الدولة", f.country), field("المدينة", f.city)),
        field("العنوان", f.address),
        h("div", { class: "row" }, field("البريد الإلكتروني", f.email), field("رقم الهاتف", f.phone)),
        sub("كل هذه البيانات قابلة للتعديل لاحقًا من الإعدادات."),
        btn("التالي", async () => {
          await api(`${A}/setup/profile`, {
            name: f.name.value || undefined, school_type: f.school_type.value, gender: f.gender.value,
            country: f.country.value || null, city: f.city.value || null, address: f.address.value || null,
            email: f.email.value || "", phone: f.phone.value || "",
          }, "PUT");
          step = 2; draw();
        })) : null,

      step === 2 ? panel("المراحل والصفوف والشعب", null,
        field("قالب المدرسة", template),
        stages.length ? h("div", { class: "pill" }, "المراحل: ", ...stages.map((s) => badge(s, "gray"))) : sub("بدون قالب: ستبني الهيكل بنفسك."),
        h("div", { class: "row" }, field("عدد الشعب لكل صف", sections), field("تسمية الشعب", naming)),
        sub("مثال: الصف الأول مع 3 شعب ينشئ: الأول - أ، الأول - ب، الأول - ج."),
        h("div", { class: "row spaced" },
          btn("السابق", () => { step = 1; draw(); }, "ghost"),
          btn("التالي", () => { step = 3; drawSubjects(); draw(); }))) : null,

      step === 3 ? panel("المواد الدراسية", null,
        sub("أزل علامة أي مادة لا تُدرّس عندكم. يمكنك إضافة مواد وتعديلها لاحقًا."),
        subjectBox,
        h("div", { class: "row spaced" },
          btn("السابق", () => { step = 2; draw(); }, "ghost"),
          btn("إنشاء الهيكل", async () => {
            const picked = [...chosen.entries()].filter(([, on]) => on).map(([name]) => name);
            const r = await api(`${A}/setup/template`, {
              template: template.value, sections_per_grade: Number(sections.value),
              naming: naming.value, subjects: picked,
            });
            await api(`${A}/setup/complete`, {});
            toast(`تم: ${r.stages} مراحل، ${r.grades} صفوف، ${r.sections} شعب، ${r.subjects} مواد`);
            setTimeout(() => location.reload(), 900);   // تختفي تبويبة المعالج وتظهر اللوحة كاملة
          }))) : null,

      step === 1 ? h("div", { class: "spaced" },
        btn("تخطي المعالج", async () => { await api(`${A}/setup/complete`, {}); location.reload(); }, "ghost sm")) : null);
  };

  drawSubjects();
  draw();
  return [notice("إعداد المدرسة لأول مرة. ثلاث خطوات وتصبح جاهزة.", ""), box];
}
