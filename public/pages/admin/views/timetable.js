// تبويب الجدول الدراسي: تعديل مباشر في الشبكة، ومنع تعارض المعلمين
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, select, btn, empty, sub, toast, notice, confirmAction } from "/shared/js/ui.js";
import { timetableGrid, WORK_DAYS, PERIODS } from "/shared/js/timetable.js";
import { A, loadClasses, loadSubjects } from "./common.js";

export default async function timetable({ refresh }) {
  const [classes, subjects, teachers] = await Promise.all([loadClasses(), loadSubjects(), api(`${A}/teachers`)]);
  if (!classes.length) return panel("الجدول الدراسي", null, empty("أضف الفصول والمواد أولًا."));

  const picker = select(classes.map((c) => [c.id, c.name]));
  const msg = h("div");
  const box = h("div");

  // الخيارات المتاحة للصف = المواد المسندة لمعلميه، مع خيار «بدون معلم»
  const optionsFor = (classId) => {
    const out = [["", "—"]];
    for (const s of subjects) {
      const mine = teachers.filter((t) => t.load.some((l) => l.class_id === Number(classId) && l.subject_id === s.id));
      for (const t of mine) out.push([`${s.id}:${t.id}`, `${s.name} — ${t.name}`]);
      out.push([`${s.id}:`, `${s.name} — بدون معلم`]);
    }
    return out;
  };

  async function load() {
    const classId = Number(picker.value);
    mount(box, empty("جارٍ التحميل…"));
    const slots = await api(`${A}/timetable?class_id=${classId}`);
    const options = optionsFor(classId);
    mount(box, timetableGrid(slots, {
      cell: (day, period, slot) => {
        const sel = select(options, { value: slot ? `${slot.subject_id}:${slot.teacher_id ?? ""}` : "" });
        sel.addEventListener("change", async () => {
          const [subject_id, teacher_id] = sel.value.split(":");
          mount(msg);
          try {
            await api(`${A}/timetable/slot`, { class_id: classId, day, period, subject_id: subject_id || null, teacher_id: teacher_id || null }, "PUT");
            toast("تم الحفظ");
            load();
          } catch (e) { mount(msg, notice(e.message, "err")); load(); }
        });
        return sel;
      },
    }));
  }
  picker.addEventListener("change", load);
  await load();

  return panel("الجدول الدراسي", btn("مسح جدول الصف", async () => {
    if (!confirmAction("حذف كل حصص هذا الصف؟")) return;
    const r = await api(`${A}/timetable/class/${picker.value}`, undefined, "DELETE");
    toast(`حُذفت ${r.deleted} حصة`);
    load();
  }, "danger sm"),
    field("الصف", picker),
    sub("اختر المادة والمعلم في كل خانة. النظام يمنع وضع المعلم في فصلين بنفس الوقت."),
    msg, box);
}
