// توزيع المعلمين: مصفوفة الشعب × المواد، وكل خلية تختار المعلم
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, select, btn, empty, sub, toast, notice, badge } from "/shared/js/ui.js";
import { csv } from "/shared/js/format.js";
import { A } from "./common.js";

export default async function distribution({ refresh }) {
  const [setup, teachers] = await Promise.all([api(`${A}/setup`), api(`${A}/teachers`)]);
  const stages = setup.structure.stages;
  const subjects = setup.structure.subjects.filter((s) => s.is_active);
  if (!stages.length || !subjects.length) {
    return panel("توزيع المعلمين", null, empty("أضف الصفوف والمواد أولًا من «الهيكل الأكاديمي»."));
  }

  const gradePick = select(stages.flatMap((st) => st.grades.map((g) => [g.id, `${st.name} — ${g.name}`])));
  const box = h("div");
  const msg = h("div");
  const changes = new Map();     // "classId:subjectId" ← teacherId|null

  // الإسناد الحالي: شعبة+مادة ← معلم
  const current = new Map();
  for (const t of teachers) for (const l of t.load) current.set(`${l.class_id}:${l.subject_id}`, t.id);

  const teacherOptions = (subjectId) => {
    // المعلمون الذين يدرّسون هذه المادة في أي شعبة يظهرون أولًا
    const related = teachers.filter((t) => t.load.some((l) => Number(l.subject_id) === Number(subjectId)));
    const others = teachers.filter((t) => !related.includes(t));
    return [["", "— بدون —"], ...related.map((t) => [t.id, `${t.name} ★`]), ...others.map((t) => [t.id, t.name])];
  };

  const draw = () => {
    const grade = stages.flatMap((st) => st.grades).find((g) => String(g.id) === gradePick.value);
    if (!grade || !grade.sections.length) return mount(box, empty("لا توجد شعب في هذا الصف."));
    const mine = subjects.filter((s) => !s.grade_ids.length || s.grade_ids.includes(Number(grade.id)));
    if (!mine.length) return mount(box, empty("لا توجد مواد مرتبطة بهذا الصف."));

    mount(box, h("div", { class: "scroll" }, h("table", { class: "grid matrix" },
      h("thead", {}, h("tr", {}, h("th", {}, "الشعبة"), mine.map((s) => h("th", {}, s.name)))),
      h("tbody", {}, grade.sections.map((c) => h("tr", {},
        h("th", {}, c.name),
        mine.map((s) => {
          const key = `${c.id}:${s.id}`;
          const pick = select(teacherOptions(s.id), { value: changes.has(key) ? (changes.get(key) ?? "") : (current.get(key) ?? "") });
          pick.addEventListener("change", () => {
            changes.set(key, pick.value ? Number(pick.value) : null);
            mount(msg, notice(`${changes.size} تغيير غير محفوظ`, "warn"));
          });
          return h("td", {}, pick);
        })))))));
  };
  gradePick.addEventListener("change", draw);
  draw();

  return panel("توزيع المعلمين",
    btn("تصدير التوزيع", () => exportMatrix(stages, subjects, current, teachers), "ghost sm"),
    sub("اختر الصف، ثم عيّن معلم كل مادة في كل شعبة. النجمة ★ بجانب من يدرّس المادة فعلًا."),
    field("الصف", gradePick),
    box, msg,
    btn("حفظ التوزيع", async () => {
      if (!changes.size) return toast("لا توجد تغييرات");
      const items = [...changes.entries()].map(([key, teacherId]) => {
        const [class_id, subject_id] = key.split(":").map(Number);
        return { class_id, subject_id, teacher_id: teacherId };
      });
      const r = await api(`${A}/teachers/assignments/bulk`, { items });
      toast(`حُفظ ${r.saved} إسنادًا`);
      refresh();
    }));
}

function exportMatrix(stages, subjects, current, teachers) {
  const nameOf = (id) => teachers.find((t) => Number(t.id) === Number(id))?.name || "";
  const rows = [["المرحلة", "الصف", "الشعبة", "المادة", "المعلم"]];
  for (const st of stages) {
    for (const g of st.grades) {
      for (const c of g.sections) {
        for (const s of subjects) {
          if (s.grade_ids.length && !s.grade_ids.includes(Number(g.id))) continue;
          rows.push([st.name, g.name, c.name, s.name, nameOf(current.get(`${c.id}:${s.id}`))]);
        }
      }
    }
  }
  csv("توزيع-المعلمين.csv", rows);
}
