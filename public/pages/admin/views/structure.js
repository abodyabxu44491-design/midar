// الهيكل الأكاديمي: المراحل ← الصفوف ← الشعب ← المواد، في شاشة واحدة
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, dialog,
  notice, confirmAction } from "/shared/js/ui.js";
import { A } from "./common.js";

export default async function structure({ refresh }) {
  const d = await api(`${A}/setup`);
  const { stages, unassigned, subjects } = d.structure;
  const naming = d.catalog.naming;
  const allGrades = stages.flatMap((st) => st.grades.map((g) => ({ ...g, stage: st.name })));

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

      st.grades.length ? st.grades.map((g, i) => gradeRow(st, g, i, refresh, naming, allGrades)) : empty("لا توجد صفوف في هذه المرحلة."),

      h("div", { class: "row spaced" }, field("إضافة صف", gradeName),
        btn("إضافة الصف", async () => {
          await api(`${A}/setup/grades`, { stage_id: st.id, name: gradeName.value });
          toast("أُضيف الصف"); refresh();
        }, "soft")));
  });

  /* ---------- شعب بلا صف ---------- */
  const orphans = unassigned.length ? panel("شعب غير مرتبطة بصف", null,
    sub("اربطها بصفّها ليظهر الهيكل مرتبًا."),
    unassigned.map((c) => line(
      h("div", {}, h("b", {}, c.name), sub(`${c.students} طالب`)),
      btn("ربط بصف", () => linkDialog(c, allGrades, refresh), "soft sm")))) : null;

  /* ---------- المواد ---------- */
  const sName = input({ placeholder: "اسم المادة" });
  const sCode = input({ class: "ltr", placeholder: "الرمز" });
  const sWeekly = input({ type: "number", min: 0, max: 40, placeholder: "حصص/أسبوع" });

  const subjectsPanel = panel("المواد الدراسية", null,
    subjects.length ? subjects.map((s) => line(
      h("div", { class: s.is_active ? "" : "muted-row" },
        h("b", {}, s.name), " ", s.code ? badge(s.code, "gray") : null,
        s.is_active ? null : badge("موقوفة", "gray"),
        sub(`${s.weekly_periods ?? "—"} حصص أسبوعيًا — ${s.grade_ids.length ? `${s.grade_ids.length} صفوف` : "غير مرتبطة بصفوف"}`)),
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

  return [
    d.profile?.setup_completed_at ? null
      : notice("لم يكتمل إعداد المدرسة بعد. افتح «معالج الإعداد» لبناء الهيكل في ثلاث خطوات.", "warn"),
    addStage, ...tree, orphans, subjectsPanel,
  ];
}

/* ---------- صف مع شعبه ---------- */
function gradeRow(stage, g, index, refresh, naming, allGrades = []) {
  const count = input({ type: "number", min: 1, max: 20, value: 1, style: "max-width:90px" });
  const pattern = select(naming.map((n) => [n.key, n.name]));
  return h("div", { class: "grade-block" },
    h("div", { class: "grade-head" },
      h("b", {}, g.name),
      h("span", { class: "sub" }, `${g.sections.length} شعب — ${g.sections.reduce((n, s) => n + s.students, 0)} طالب`),
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

    h("div", { class: "sections" }, g.sections.length
      ? g.sections.map((c) => h("span", { class: "section-chip" }, c.name,
          h("span", { class: "small muted" }, ` ${c.students}`),
          btn("✎", () => renameDialog("الشعبة", c.name, async (name) => {
            await api(`${A}/setup/sections/${c.id}`, { name }, "PATCH"); refresh();
          }), "ghost sm")))
      : sub("لا توجد شعب.")),

    h("div", { class: "row" }, field("عدد الشعب", count), field("التسمية", pattern),
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
    return { id: g.id, cb, el: h("label", { class: "subject-pick" }, cb, h("span", {}, `${g.stage} — ${g.name}`)) };
  });
  const d = dialog(`تعديل ${s.name}`, h("div", {},
    h("div", { class: "row" }, field("الاسم", name), field("الرمز", code), field("حصص أسبوعية", weekly)),
    h("h3", { class: "sec-title" }, "الصفوف التي تُدرّس فيها"),
    picks.length ? h("div", { class: "subject-grid" }, picks.map((p) => p.el)) : sub("أضف صفوفًا أولًا.")),
  [btn("حفظ", async () => {
    await api(`${A}/setup/subjects/${s.id}`, {
      name: name.value, code: code.value || null,
      weekly_periods: weekly.value === "" ? null : Number(weekly.value),
      grade_ids: picks.filter((p) => p.cb.checked).map((p) => p.id),
    }, "PATCH");
    d.close(); toast("تم الحفظ"); refresh();
  })]);
}
