// الهيكل الأكاديمي: المراحل ← الصفوف ← الشعب ← المواد، في شاشة واحدة
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, dialog,
  notice, confirmAction } from "../../shared/js/ui.js";
import { A } from "./common.js";

// الشاشة مقسّمة إلى أجزاء يعيد «السجل الأكاديمي» في الإعدادات استخدامها نفسها (لا نسخة ثانية):
// الهيكل (المراحل والصفوف والشعب)، المواد، ووضع الشعب.
export const loadStructure = () => api(`${A}/setup`);

export default async function structure({ refresh }) {
  const d = await loadStructure();
  return [...stagesParts(d, refresh), sectionsModePanel(d, refresh), subjectsPanel(d, refresh)];
}

export function sectionsModePanel(d, refresh) {
  const sectionsEnabled = d.structure.sections_enabled;
  /* ---------- تفعيل/تعطيل نظام الشعب ---------- */
  const sectionsToggle = input({ type: "checkbox", checked: sectionsEnabled });
  return panel("نظام الشعب", null,
    h("label", { class: "f pill" }, sectionsToggle, "هذه المدرسة تستخدم شعبًا متعددة لكل صف"),
    sub(sectionsEnabled
      ? "عند الإيقاف: يختفي مفهوم «الشعبة» من كل الواجهات، ويرتبط كل طالب بصفه مباشرة. لا فقدان بيانات — الشعب الحالية تبقى محفوظة."
      : "الآن كل صف يُعامل كوحدة واحدة بلا شعب. عند التفعيل تقدر تنشئ شعبًا متعددة لكل صف."),
    btn("حفظ", async () => {
      const want = sectionsToggle.checked;
      try {
        await api(`${A}/setup/sections-mode`, { sections_enabled: want }, "PUT");
      } catch (e) {
        // تحذير الإيقاف: نعرض التفاصيل ونطلب تأكيدًا صريحًا قبل المتابعة
        if (e.status !== 409 || !confirmAction(`${e.message}\n\nهل تريد المتابعة؟`)) { sectionsToggle.checked = !want; return toast(e.status === 409 ? "لم يتغير شيء" : e.message); }
        await api(`${A}/setup/sections-mode`, { sections_enabled: want, confirm: true }, "PUT");
      }
      toast("تم الحفظ"); refresh();
    }, "soft"));
}

const gradesWithStage = (stages) => stages.flatMap((st) => st.grades.map((g) => ({ ...g, stage: st.name, stage_id: st.id })));

export function stagesParts(d, refresh) {
  const { stages, unassigned, sections_enabled: sectionsEnabled } = d.structure;
  const naming = d.catalog.naming;
  const allGrades = gradesWithStage(stages);

  /* ---------- إضافة مرحلة ---------- */
  const stageName = input({ placeholder: "اسم المرحلة" });
  const addStage = panel("المراحل", null,
    h("div", { class: "row" }, field("إضافة مرحلة", stageName),
      btn("إضافة", async () => {
        await api(`${A}/setup/stages`, { name: stageName.value });
        toast("أُضيفت المرحلة"); refresh();
      }, "soft")),
    stages.length ? null : empty("لا توجد مراحل بعد. أضف مرحلة أو طبّق قالبًا من معالج الإعداد."));

  /* ---------- شجرة المراحل ---------- */
  const tree = stages.map((st) => {
    const gradeName = input({ placeholder: "اسم الصف" });
    return panel(st.name,
      h("div", { class: "row", style: "flex:none" },
        btn("تعديل الاسم", () => renameDialog("المرحلة", st.name, async (name) => {
          await api(`${A}/setup/stages/${st.id}`, { name }, "PATCH"); refresh();
        }), "ghost sm"),
        btn("حذف", async () => {
          if (!confirmAction(`حذف ${st.name} بكل صفوفها وشعبها الفارغة؟`)) return;
          await api(`${A}/setup/stages/${st.id}`, undefined, "DELETE"); toast("حُذفت المرحلة"); refresh();
        }, "danger sm")),

      st.grades.length ? st.grades.map((g, i) => gradeRow(st, g, i, refresh, naming, allGrades, sectionsEnabled)) : empty("لا توجد صفوف في هذه المرحلة."),

      h("div", { class: "row spaced" }, field("إضافة صف", gradeName),
        btn("إضافة الصف", async () => {
          await api(`${A}/setup/grades`, { stage_id: st.id, name: gradeName.value });
          toast("أُضيف الصف"); refresh();
        }, "soft")));
  });

  /* ---------- شعب بلا صف ---------- */
  const orphans = (sectionsEnabled && unassigned.length) ? panel("شعب غير مرتبطة بصف", null,
    sub("اربطها بصفّها ليظهر الهيكل مرتبًا."),
    unassigned.map((c) => line(
      h("div", {}, h("b", {}, c.name), sub(`${c.students} طالب`)),
      btn("ربط بصف", () => linkDialog(c, allGrades, refresh), "soft sm")))) : null;

  return [
    d.profile?.setup_completed_at ? null
      : notice("لم يكتمل إعداد المدرسة بعد. افتح «معالج الإعداد» لبناء الهيكل خطوة بخطوة.", "warn"),
    addStage, ...tree, orphans,
  ];
}

export function subjectsPanel(d, refresh) {
  const { stages, subjects } = d.structure;
  const allGrades = gradesWithStage(stages);
  /* ---------- المواد ---------- */
  const sName = input({ placeholder: "اسم المادة" });
  const sCode = input({ class: "ltr", placeholder: "الرمز" });
  const sWeekly = input({ type: "number", min: 0, max: 40, placeholder: "حصص/أسبوع" });

  return panel("المواد الدراسية", null,
    subjects.length ? subjects.map((s) => line(
      h("div", { class: s.is_active ? "" : "muted-row" },
        h("b", {}, s.name), " ", s.code ? badge(s.code, "gray") : null,
        s.is_active ? null : badge("موقوفة", "gray"),
        sub(`${s.weekly_periods ?? "—"} حصص أسبوعيًا — ${linkedSummary(s, stages)}`)),
      h("div", { class: "row", style: "flex:none" },
        btn("تعديل", () => subjectDialog(s, allGrades, refresh), "ghost sm"),
        btn(s.is_active ? "إيقاف" : "تفعيل", async () => {
          await api(`${A}/setup/subjects/${s.id}`, { is_active: !s.is_active }, "PATCH"); refresh();
        }, "ghost sm")))) : empty("لا توجد مواد بعد."),
    h("h3", { class: "sec-title" }, "إضافة مادة"),
    h("div", { class: "row" }, field("الاسم", sName), field("الرمز", sCode), field("حصص أسبوعية", sWeekly)),
    btn("إضافة المادة", async () => {
      await api(`${A}/setup/subjects`, { name: sName.value, code: sCode.value || null,
        weekly_periods: sWeekly.value === "" ? null : Number(sWeekly.value) });
      toast("أُضيفت المادة"); refresh();
    }));
}

// «المرحلة الثانوية كاملة، أول متوسط» بدل عدد مجرد
function linkedSummary(s, stages) {
  if (!s.grade_ids.length) return "غير مرتبطة بصفوف";
  const ids = new Set(s.grade_ids.map(Number));
  const parts = [];
  for (const st of stages) {
    const inStage = st.grades.filter((g) => ids.has(Number(g.id)));
    if (!inStage.length) continue;
    parts.push(inStage.length === st.grades.length ? `${st.name} كاملة` : inStage.map((g) => g.name).join("، "));
  }
  return parts.join(" · ");
}

/* ---------- صف مع شعبه ---------- */
function gradeRow(stage, g, index, refresh, naming, allGrades = [], sectionsEnabled = true) {
  const count = input({ type: "number", min: 1, max: 20, value: 1, style: "max-width:90px" });
  const pattern = select(naming.map((n) => [n.key, n.name]));
  const totalStudents = g.sections.reduce((n, s) => n + s.students, 0);
  return h("div", { class: "grade-block" },
    h("div", { class: "grade-head" },
      h("b", {}, g.name),
      h("span", { class: "sub" }, sectionsEnabled
        ? `${g.sections.length} شعب — ${totalStudents} طالب`
        : `${totalStudents} طالب`),
      h("div", { class: "row", style: "flex:none" },
        index > 0 ? btn("↑", async () => {
          const ids = stage.grades.map((x) => x.id);
          [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
          await api(`${A}/setup/stages/${stage.id}/reorder`, { ids });
          refresh();
        }, "ghost sm") : null,
        index < stage.grades.length - 1 ? btn("↓", async () => {
          const ids = stage.grades.map((x) => x.id);
          [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
          await api(`${A}/setup/stages/${stage.id}/reorder`, { ids });
          refresh();
        }, "ghost sm") : null,
        btn("تعديل", () => renameDialog("الصف", g.name, async (name) => {
          await api(`${A}/setup/grades/${g.id}`, { name }, "PATCH"); refresh();
        }), "ghost sm"),
        btn("نسخ المواد", () => copySubjectsDialog(g, refresh), "ghost sm"),
        btn("حذف", async () => {
          if (!confirmAction(`حذف ${g.name}؟`)) return;
          await api(`${A}/setup/grades/${g.id}`, undefined, "DELETE"); toast("حُذف الصف"); refresh();
        }, "danger sm"))),

    !sectionsEnabled ? null : h("div", { class: "sections" }, g.sections.length
      ? g.sections.map((c) => h("span", { class: "section-chip" }, c.name,
          h("span", { class: "small muted" }, ` ${c.students}`),
          btn("✎", () => renameDialog("الشعبة", c.name, async (name) => {
            await api(`${A}/setup/sections/${c.id}`, { name }, "PATCH"); refresh();
          }), "ghost sm")))
      : sub("لا توجد شعب.")),

    !sectionsEnabled ? null : h("div", { class: "row" }, field("عدد الشعب", count), field("التسمية", pattern),
      btn("إنشاء الشعب تلقائيًا", async () => {
        const r = await api(`${A}/setup/grades/${g.id}/sections`, { count: Number(count.value), naming: pattern.value });
        toast(r.created ? `أُنشئت ${r.created} شعبة` : "الشعب موجودة مسبقًا");
        refresh();
      }, "soft")));
}

// نسخ مواد صف إلى صف آخر
function copySubjectsDialog(grade, refresh) {
  const box = h("div");
  const d = dialog(`نسخ مواد ${grade.name}`, box, []);
  api(`${A}/setup`).then(({ structure }) => {
    const targets = structure.stages.flatMap((st) => st.grades)
      .filter((g) => Number(g.id) !== Number(grade.id))
      .map((g) => [g.id, g.name]);
    if (!targets.length) return mount(box, empty("لا يوجد صف آخر."));
    const to = select(targets);
    const replace = input({ type: "checkbox", checked: true });
    mount(box,
      sub("تُنسخ المواد المرتبطة بهذا الصف إلى الصف المختار، ثم عدّل الفروق."),
      field("إلى الصف", to),
      h("label", { class: "f pill" }, replace, "استبدال مواد الصف الهدف"),
      btn("نسخ", async () => {
        const r = await api(`${A}/setup/grades/${grade.id}/copy-subjects`,
          { to_grade_id: to.value, replace: replace.checked });
        d.close(); toast(`نُسخت ${r.copied} مادة`); refresh();
      }));
  });
}

/* ---------- نوافذ ---------- */
function renameDialog(label, value, save) {
  const name = input({ value });
  const d = dialog(`تعديل اسم ${label}`, h("div", {}, field("الاسم", name)),
    [btn("حفظ", async () => { await save(name.value); d.close(); toast("تم الحفظ"); })]);
  name.focus();
}

function linkDialog(section, grades, refresh) {
  const pick = select(grades.map((g) => [g.id, `${g.stage} — ${g.name}`]));
  const d = dialog(`ربط ${section.name} بصف`, h("div", {}, field("الصف", pick)),
    [btn("ربط", async () => {
      await api(`${A}/setup/sections/${section.id}`, { grade_id: pick.value }, "PATCH");
      d.close(); toast("تم الربط"); refresh();
    })]);
}

function subjectDialog(s, grades, refresh) {
  const name = input({ value: s.name });
  const code = input({ class: "ltr", value: s.code || "" });
  const weekly = input({ type: "number", min: 0, max: 40, value: s.weekly_periods ?? "" });
  const picks = grades.map((g) => {
    const cb = input({ type: "checkbox", checked: s.grade_ids.includes(Number(g.id)) });
    return { id: g.id, stage_id: g.stage_id, cb, el: h("label", { class: "subject-pick" }, cb, h("span", {}, g.name)) };
  });
  // الصفوف مجمّعة حسب المرحلة، مع اختيار المرحلة كاملة بضغطة
  const stageIds = [...new Set(grades.map((g) => g.stage_id))];
  const groups = stageIds.map((sid) => {
    const mine = picks.filter((p) => p.stage_id === sid);
    const all = input({ type: "checkbox", checked: mine.every((p) => p.cb.checked) });
    all.addEventListener("change", () => { for (const p of mine) p.cb.checked = all.checked; });
    for (const p of mine) p.cb.addEventListener("change", () => { all.checked = mine.every((x) => x.cb.checked); });
    return h("section", { class: "subject-group" },
      h("label", { class: "f pill sec-title" }, all, h("b", {}, `${grades.find((g) => g.stage_id === sid).stage} — كل الصفوف`)),
      h("div", { class: "subject-grid" }, mine.map((p) => p.el)));
  });
  const d = dialog(`تعديل ${s.name}`, h("div", {},
    h("div", { class: "row" }, field("الاسم", name), field("الرمز", code), field("حصص أسبوعية", weekly)),
    h("h3", { class: "sec-title" }, "الصفوف التي تُدرّس فيها"),
    picks.length ? groups : sub("أضف صفوفًا أولًا.")),
  [btn("حفظ", async () => {
    await api(`${A}/setup/subjects/${s.id}`, {
      name: name.value, code: code.value || null,
      weekly_periods: weekly.value === "" ? null : Number(weekly.value),
      grade_ids: picks.filter((p) => p.cb.checked).map((p) => p.id),
    }, "PATCH");
    d.close(); toast("تم الحفظ"); refresh();
  })]);
}
