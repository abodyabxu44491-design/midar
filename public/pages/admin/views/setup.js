// معالج «إعداد المدرسة الأكاديمي» — يحفظ في نفس الجداول والخدمات التي تديرها شاشات الإعدادات
// (الهيكل الأكاديمي، السنة الدراسية، الإجازات، أيام الدراسة)، فلا يوجد نظام ثانٍ.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, sub, badge, notice, toast } from "../../shared/js/ui.js";
import { A } from "./common.js";
import { logoPanel } from "./school-identity.js";

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const TITLES = ["بيانات المدرسة", "المراحل", "أسماء الصفوف", "الشعب", "السنة الدراسية", "نظام الفصول", "أيام الدراسة", "الإجازات", "المواد", "المراجعة"];

// المسودة تُحفظ في هذا المتصفح مع كل خطوة: تحديث الصفحة أو انقطاع الاتصال لا يضيّع ما أُدخل
const draftKey = (me) => `midar:setup-draft:${me?.school?.id || "school"}`;
const readDraft = (me) => { try { return JSON.parse(localStorage.getItem(draftKey(me)) || "null"); } catch { return null; } };
const writeDraft = (me, v) => { try { localStorage.setItem(draftKey(me), JSON.stringify(v)); } catch { /* تخزين غير متاح: يعمل المعالج بدونه */ } };
const clearDraft = (me) => { try { localStorage.removeItem(draftKey(me)); } catch { /* لا شيء */ } };

export default async function setup({ me } = {}) {
  const [d, hol] = await Promise.all([api(`${A}/setup`), api(`${A}/academic/holidays`)]);
  const c = d.catalog, p = d.profile || {};
  const box = h("div");
  const now = new Date();
  const y0 = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;

  // كل ما يدخله المدير يبقى هنا حتى «إنهاء الإعداد»
  const st = {
    step: 1,
    stages: new Set(["primary"]),
    gradeSet: "arabic_full",
    sections: true, sectionCount: 2, naming: "arabic",
    year: { name: `${y0}–${y0 + 1}`, start: `${y0}-09-01`, end: `${y0 + 1}-06-30` },
    termMode: "2", termCustom: 4,
    days: new Set([0, 1, 2, 3, 4]),
    holidays: [],
    subjects: new Map(),
    custom: {},          // أسماء معدَّلة يدويًا لكل مرحلة
    customStages: [],    // مراحل خاصة بالمدرسة: [{ key, name, grades: [] }]
    editNames: false,
    reached: 1,          // أبعد خطوة وصلها المدير (للتنقل بالضغط على الخطوات)
  };
  // استكمال مسودة سابقة
  const saved = readDraft(me);
  let restored = false;
  if (saved?.v === 1) {
    Object.assign(st, saved.st, {
      stages: new Set(saved.st.stages), days: new Set(saved.st.days), subjects: new Map(saved.st.subjects), editNames: false });
    restored = st.step > 1;
  }
  const persist = () => writeDraft(me, { v: 1, st: { ...st, stages: [...st.stages], days: [...st.days], subjects: [...st.subjects], editNames: false } });
  // الشعار يُحفظ فور رفعه (نفس لوحة «هوية المدرسة» في الإعدادات)
  const logoWidget = logoPanel({ me, profile: p, onChange: (logo) => { if (me?.school) me.school.logo = logo; } });
  const f = {
    name: input({ value: p.name || "" }),
    school_type: select(c.school_types.map((x) => [x.key, x.name]), { value: p.school_type || "private" }),
    gender: select(c.genders.map((x) => [x.key, x.name]), { value: p.gender || "boys" }),
    country: input({ value: p.country || "" }), city: input({ value: p.city || "" }),
    email: input({ class: "ltr", type: "email", value: p.email || "" }),
    phone: input({ class: "ltr", inputMode: "tel", value: p.phone || "" }),
  };

  const ORDER = ["kindergarten", "primary", "middle", "secondary"];
  // مراحل الكتالوج المختارة بالترتيب، ثم المراحل المخصصة
  const orderedStages = () => [
    ...ORDER.map((k) => c.stages.find((s) => s.key === k)).filter((s) => s && st.stages.has(s.key)),
    ...st.customStages.map((x) => ({ key: x.key, name: x.name, custom: true })),
  ];
  const stageKeys = () => orderedStages().filter((s) => !s.custom).map((s) => s.key);
  const customOf = (key) => st.customStages.find((x) => x.key === key);
  // أسماء صفوف مرحلة: المعدَّلة يدويًا إن وُجدت، وإلا من النمط المختار (والمخصصة من تعريفها)
  const gradesOf = (key) => st.custom[key] || customOf(key)?.grades || c.grade_sets.find((g) => g.key === st.gradeSet)?.names?.[key] || [];
  const allGrades = () => orderedStages().flatMap((s) => gradesOf(s.key));
  const termCount = () => (st.termMode === "custom" ? Number(st.termCustom) : Number(st.termMode));
  const suggested = () => {
    const names = new Set();
    for (const s of c.stages) if (st.stages.has(s.key)) for (const x of s.subjects) names.add(x.name);
    return names;
  };

  // بطاقة اختيار كبيرة (مناسبة للمس)
  const pick = (type, name, checked, title, note, onChange) => {
    const el = input({ type, name, checked });
    el.addEventListener("change", () => onChange(el.checked));
    return h("label", { class: `pick-card ${checked ? "on" : ""}` }, el, h("span", {}, h("b", {}, title), note ? sub(note) : null));
  };

  const nav = (back, next, nextLabel = "التالي") => h("div", { class: "row spaced" },
    back ? btn("السابق", () => go(st.step - 1), "ghost") : h("span"),
    btn(nextLabel, next));
  const go = (n) => { st.step = n; st.reached = Math.max(st.reached, n); if (n === 9) fillSubjects(); draw(); window.scrollTo?.({ top: 0 }); };
  const need = (ok, msg) => { if (!ok) toast(msg); return ok; };

  function fillSubjects() {
    const sg = suggested();
    for (const s of sg) if (!st.subjects.has(s)) st.subjects.set(s, true);
  }

  // معاينة كاملة: كل مرحلة وصفوفها بالترتيب، مع إمكانية تعديل أي اسم
  const gradesPreview = () => {
    const stages = orderedStages();
    const total = allGrades().length;
    return panel(`معاينة صفوف مدرستك (${total} صفًا)`, null,
      sub("هكذا ستظهر أسماء الصفوف في النظام كله: الطلاب والحضور والاختبارات والتقارير."),
      stages.map((s) => {
        const names = gradesOf(s.key);
        return h("section", { class: "prev-stage" },
          h("h3", { class: "sec-title" }, `${s.name} — ${names.length} صفوف`),
          st.editNames
            ? h("div", { class: "prev-edit" }, names.map((n, i) => {
                const el = input({ value: n });
                el.addEventListener("input", () => {
                  st.custom[s.key] = [...(st.custom[s.key] || gradesOf(s.key))];
                  st.custom[s.key][i] = el.value;
                });
                return field(`الصف ${i + 1}`, el);
              }))
            : h("ol", { class: "prev-list" }, names.map((n) => h("li", {}, n))));
      }),
      h("div", { class: "row" },
        btn(st.editNames ? "تم" : "تعديل الأسماء يدويًا", () => { st.editNames = !st.editNames; draw(); }, "soft"),
        Object.keys(st.custom).length ? btn("استعادة أسماء النمط", () => { st.custom = {}; st.editNames = false; draw(); }, "ghost") : null));
  };

  // مرحلة غير موجودة في القائمة (تحفيظ، تمهيدي خاص، دبلوم…): اسمها وعدد صفوفها، والأسماء تُعدَّل في الخطوة التالية
  const customStagesBox = () => {
    const name = input({ placeholder: "مثال: مرحلة التحفيظ" });
    const count = input({ type: "number", min: 1, max: 20, value: 3, style: "max-width:110px" });
    return h("div", { class: "custom-stages" },
      h("h3", { class: "sec-title" }, "مرحلة غير موجودة في القائمة؟"),
      st.customStages.map((x, i) => h("div", { class: "line" },
        h("div", {}, h("b", {}, x.name), sub(`${x.grades.length} صفوف: ${gradesOf(x.key).join("، ")}`)),
        btn("حذف", () => { st.customStages.splice(i, 1); delete st.custom[x.key]; draw(); }, "danger sm"))),
      h("div", { class: "row", style: "align-items:end" }, field("اسم المرحلة", name), field("عدد الصفوف", count),
        btn("إضافة المرحلة", () => {
          const n = name.value.trim(), k = Math.min(20, Math.max(1, Number(count.value) || 1));
          if (!need(n.length >= 2, "اكتب اسم المرحلة")) return;
          if (!need(![...c.stages.map((x) => x.name), ...st.customStages.map((x) => x.name)].includes(n), "المرحلة موجودة مسبقًا")) return;
          st.customStages.push({ key: `custom_${Date.now().toString(36)}`, name: n, grades: Array.from({ length: k }, (_, j) => `${n} ${j + 1}`) });
          draw();
        }, "soft")),
      sub("تُضاف بصفوف مرقّمة، وتغيّر أسماءها في الخطوة التالية بـ«تعديل الأسماء يدويًا»."));
  };

  const steps = {
    1: () => panel("بيانات المدرسة", null,
      h("div", { class: "spaced", style: "margin:0 0 14px" }, h("b", { class: "small" }, "شعار المدرسة (اختياري)"), logoWidget),
      field("اسم المدرسة", f.name),
      h("div", { class: "row" }, field("نوع المدرسة", f.school_type), field("الجنس", f.gender)),
      h("div", { class: "row" }, field("الدولة", f.country), field("المدينة", f.city)),
      h("div", { class: "row" }, field("البريد الإلكتروني", f.email), field("رقم الهاتف", f.phone)),
      nav(false, async () => {
        await api(`${A}/setup/profile`, {
          name: f.name.value || undefined, school_type: f.school_type.value, gender: f.gender.value,
          country: f.country.value || null, city: f.city.value || null,
          email: f.email.value || "", phone: f.phone.value || "" }, "PUT");
        go(2);
      })),

    2: () => panel("ما المراحل الموجودة في مدرستك؟", null,
      sub("اختر المراحل فقط. لا يلزم أن تكون كلها موجودة."),
      h("div", { class: "pick-grid" }, c.stages.map((s) =>
        pick("checkbox", "stage", st.stages.has(s.key), s.name, `${s.grades.length} صفوف`, (on) => {
          on ? st.stages.add(s.key) : st.stages.delete(s.key); draw(); }))),
      btn("مدرسة شاملة (كل المراحل)", () => { for (const k of ["primary", "middle", "secondary"]) st.stages.add(k); draw(); }, "soft"),
      customStagesBox(),
      nav(true, () => need(st.stages.size || st.customStages.length, "اختر مرحلة واحدة على الأقل") && go(3))),

    3: () => panel("كيف تريد تسمية الصفوف؟", null,
      sub("اختر النمط، وستظهر تحته قائمة كاملة بكل صفوف مدرستك."),
      h("div", { class: "pick-grid one-col" }, c.grade_sets.map((g) => {
        const seq = orderedStages().filter((s) => !s.custom).flatMap((s) => g.names?.[s.key] || []);
        const ends = seq.length > 3 ? `${seq[0]} ← … ← ${seq[seq.length - 1]}` : seq.join(" ← ");
        return pick("radio", "gs", st.gradeSet === g.key, g.name, ends, () => {
          if (Object.keys(st.custom).some((k) => !customOf(k)) && !confirm("سيتم تجاهل تعديلاتك اليدوية على الأسماء. متابعة؟")) return draw();
          st.gradeSet = g.key; st.custom = Object.fromEntries(Object.entries(st.custom).filter(([k]) => customOf(k))); st.editNames = false; draw();
        });
      })),
      gradesPreview(),
      sub("كل الأسماء قابلة للتعديل لاحقًا، وتغيير الاسم ينعكس على النظام كله."),
      nav(true, () => {
        const all = allGrades().map((x) => x.trim());
        if (all.some((x) => !x)) return toast("يوجد اسم صف فارغ");
        if (new Set(all).size !== all.length) return toast("يوجد اسم صف مكرر. لكل صف اسم مختلف");
        st.editNames = false; go(4);
      })),

    4: () => {
      const count = input({ type: "number", min: 1, max: 20, value: st.sectionCount });
      count.addEventListener("input", () => { st.sectionCount = Number(count.value) || 1; });
      const naming = select(c.naming.map((n) => [n.key, `${n.name} (${n.sample})`]), { value: st.naming });
      naming.addEventListener("change", () => { st.naming = naming.value; });
      return panel("هل تستخدم المدرسة نظام الشعب؟", null,
        h("div", { class: "pick-grid" },
          pick("radio", "sec", st.sections, "نعم", "أكثر من شعبة للصف الواحد (أ، ب، ج)", () => { st.sections = true; draw(); }),
          pick("radio", "sec", !st.sections, "لا", "كل صف وحدة واحدة، ولا تظهر كلمة «شعبة»", () => { st.sections = false; draw(); })),
        st.sections ? h("div", { class: "row" }, field("عدد الشعب لكل صف", count), field("تسمية الشعب", naming)) : null,
        nav(true, () => go(5)));
    },

    5: () => {
      const n = input({ value: st.year.name }), a = input({ type: "date", class: "ltr", value: st.year.start }), b = input({ type: "date", class: "ltr", value: st.year.end });
      return panel("السنة الدراسية", null,
        field("اسم السنة", n),
        h("div", { class: "row" }, field("بداية السنة", a), field("نهاية السنة", b)),
        nav(true, () => {
          st.year = { name: n.value.trim(), start: a.value, end: b.value };
          if (need(st.year.name && st.year.start && st.year.end, "أكمل بيانات السنة") &&
              need(st.year.end > st.year.start, "نهاية السنة يجب أن تكون بعد بدايتها")) go(6);
        }));
    },

    6: () => {
      const custom = input({ type: "number", min: 1, max: 6, value: st.termCustom });
      custom.addEventListener("input", () => { st.termCustom = Number(custom.value) || 1; });
      const opt = (v, t, n) => pick("radio", "tm", st.termMode === v, t, n, () => { st.termMode = v; draw(); });
      return panel("نظام الفصول الدراسية", null,
        h("div", { class: "pick-grid" }, opt("1", "فصل واحد"), opt("2", "فصلان", "الأكثر شيوعًا"), opt("3", "ثلاثة فصول"), opt("custom", "مخصص", "حتى 6 فصول")),
        st.termMode === "custom" ? field("عدد الفصول", custom) : null,
        sub("تُقسّم مدة السنة على الفصول بالتساوي، وتعدّل تواريخها لاحقًا من: السنة الدراسية."),
        nav(true, () => go(7)));
    },

    7: () => panel("أيام الدراسة", null,
      sub("اختر أيام الدوام الأسبوعية في مدرستك."),
      h("div", { class: "pick-grid" }, DAYS.map((name, i) =>
        pick("checkbox", "day", st.days.has(i), name, null, (on) => { on ? st.days.add(i) : st.days.delete(i); }))),
      nav(true, () => need(st.days.size, "اختر يومًا واحدًا على الأقل") && go(8))),

    8: () => {
      const name = input({ placeholder: "مثال: إجازة منتصف الفصل" });
      const kind = select(Object.entries(hol.kinds));
      const a = input({ type: "date", class: "ltr" }), b = input({ type: "date", class: "ltr" });
      return panel("الإجازات والعطل", null,
        sub("اختياري — تُستخدم في الحضور والجدول. تقدر تضيفها لاحقًا."),
        st.holidays.length ? st.holidays.map((x, i) => h("div", { class: "line" },
          h("div", {}, h("b", {}, x.name), sub(`${hol.kinds[x.kind]} — ${x.start_date} إلى ${x.end_date}`)),
          btn("حذف", () => { st.holidays.splice(i, 1); draw(); }, "danger sm"))) : null,
        field("اسم الإجازة", name), field("النوع", kind),
        h("div", { class: "row" }, field("من", a), field("إلى", b)),
        btn("إضافة الإجازة", () => {
          if (!need(name.value.trim() && a.value && b.value, "أكمل اسم الإجازة وتاريخيها") ||
              !need(b.value >= a.value, "نهاية الإجازة قبل بدايتها")) return;
          st.holidays.push({ name: name.value.trim(), kind: kind.value, start_date: a.value, end_date: b.value,
            affects_attendance: true, show_in_calendar: true });
          draw();
        }, "soft"),
        nav(true, () => go(9)));
    },

    9: () => panel("المواد الدراسية", null,
      sub("المقترح لمراحلك مفعّل مسبقًا. أزل ما لا يُدرَّس عندكم."),
      c.subject_library.map((g) => h("section", { class: "subject-group" }, h("h3", { class: "sec-title" }, g.group),
        h("div", { class: "subject-grid" }, g.items.map((s) => {
          const cb = input({ type: "checkbox", checked: st.subjects.get(s.name) === true });
          cb.addEventListener("change", () => st.subjects.set(s.name, cb.checked));
          return h("label", { class: `subject-pick ${suggested().has(s.name) ? "suggested" : ""}` }, cb,
            h("span", {}, h("b", {}, s.name), sub(`${s.code} — ${s.weekly} حصص أسبوعيًا`)));
        })))),
      nav(true, () => go(10))),

    10: () => {
      const line = (k, v) => h("div", { class: "line" }, h("span", {}, k), h("b", {}, v));
      const picked = [...st.subjects.entries()].filter(([, on]) => on).map(([n]) => n);
      return panel("المراجعة النهائية", null,
        line("المدرسة", f.name.value || p.name || "—"),
        line("المراحل", orderedStages().map((s) => s.name).join("، ")),
        line("تسمية الصفوف", (Object.keys(st.custom).some((k) => !customOf(k)) ? "مخصص (عدّلته يدويًا)" : c.grade_sets.find((g) => g.key === st.gradeSet)?.name) || ""),
        line("عدد الصفوف", `${allGrades().length}`),
        ...orderedStages().map((s) => line(s.name, gradesOf(s.key).join("، "))),
        line("الشعب", st.sections ? `نعم — ${st.sectionCount} لكل صف` : "لا"),
        line("السنة الدراسية", `${st.year.name} (${st.year.start} → ${st.year.end})`),
        line("الفصول", `${termCount()}`),
        line("أيام الدراسة", [...st.days].sort().map((i) => DAYS[i]).join("، ")),
        line("الإجازات", `${st.holidays.length}`),
        line("المواد", `${picked.length}`),
        h("div", { class: "row spaced" },
          btn("السابق", () => go(9), "ghost"),
          btn("إنهاء إعداد المدرسة", async () => {
            const r = await api(`${A}/setup/finish`, {
              sections_enabled: st.sections,
              template: { template: "empty", stages: stageKeys(), grade_set: st.gradeSet,
                sections_per_grade: st.sections ? st.sectionCount : 0, naming: st.naming, subjects: picked,
                custom_grades: Object.keys(st.custom).some((k) => !customOf(k)) ? Object.fromEntries(stageKeys().map((k) => [k, gradesOf(k).map((x) => x.trim())])) : undefined,
                custom_stages: st.customStages.length ? st.customStages.map((x) => ({ name: x.name, grades: gradesOf(x.key).map((g) => g.trim()) })) : undefined },
              year: { name: st.year.name, start_date: st.year.start, end_date: st.year.end, terms: termCount() },
              days: [...st.days], holidays: st.holidays,
            });
            clearDraft(me);
            toast(`تم: ${r.stages} مراحل، ${r.grades} صفوف، ${r.sections} شعب، ${r.subjects} مواد`);
            setTimeout(() => location.reload(), 900);
          })));
    },
  };

  const draw = () => {
    const pct = Math.round((st.step / TITLES.length) * 100);
    persist();
    mount(box,
      h("div", { class: "wiz-progress" },
        h("div", { class: "wiz-bar" }, h("i", { style: `width:${pct}%` })),
        h("small", {}, `الخطوة ${st.step} من ${TITLES.length} — ${TITLES[st.step - 1]}`),
        // الخطوات السابقة قابلة للضغط: الرجوع لأي خطوة دون فقدان ما بعدها
        h("ol", { class: "setup-steps" }, TITLES.map((t, i) => {
          const n = i + 1;
          const can = n <= st.reached && n !== st.step;
          return h("li", { class: `${n === st.step ? "on" : ""}${n < st.reached || (n <= st.reached && n !== st.step) ? " done" : ""}` },
            can ? h("button", { type: "button", onclick: () => go(n) }, t) : h("span", {}, t));
        }))),
      steps[st.step](),
      h("div", { class: "spaced" },
        btn("تخطي المعالج والدخول للوحة", async () => { await api(`${A}/setup/complete`, {}); clearDraft(me); location.reload(); }, "ghost sm"),
        sub("تعدّل أي شيء لاحقًا من: الإعدادات ← السجل الأكاديمي.")));
  };

  draw();
  return [notice("إعداد المدرسة الأكاديمي لأول مرة: خطوات بسيطة وتصبح المدرسة جاهزة.", ""),
    restored ? h("div", { class: "row", style: "align-items:center;justify-content:space-between;margin-bottom:10px" },
      sub("أكملنا من حيث توقفت آخر مرة."),
      btn("البدء من جديد", () => { if (!confirm("مسح ما أدخلته في المعالج والبدء من الخطوة الأولى؟")) return; clearDraft(me); location.reload(); }, "ghost sm")) : null,
    box];
}
