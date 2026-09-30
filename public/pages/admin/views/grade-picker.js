// منتقي واحد «المرحلة ← الصف ← الشعبة»: زر يفتح تصفّحًا متدرجًا بدل 3 قوائم منفصلة في صف الفلاتر.
// نفس فكرة تصفّح الصفوف الموجودة عندك أصلًا، بمكوّن واحد يُعاد استخدامه في الطلاب والمعلمين.
import { h, mount } from "../../shared/js/dom.js";
import { dialog, btn } from "../../shared/js/ui.js";

/**
 * @param {object} structure  هيكل المدرسة (stages → grades → sections) من /setup
 * @param {object} opts       { sectionsOn, onChange(state) } — تُستدعى onChange بعد أي اختيار
 * @returns {{ el, stageId, gradeId, classId, classIds, reset }}
 */
export function gradePicker(structure, { sectionsOn = true, onChange } = {}) {
  const state = { stageId: "", gradeId: "", classId: "" };
  const btnEl = h("button", { type: "button", class: "picker-btn" });

  const stageOf = () => structure.stages.find((s) => String(s.id) === state.stageId);
  const gradeOf = () => stageOf()?.grades.find((g) => String(g.id) === state.gradeId);

  // كل الشعب ضمن نطاق الاختيار الحالي (تُستخدم للتصفية الفعلية في القوائم)
  const classIds = () => {
    if (state.classId) return [Number(state.classId)];
    const grades = state.gradeId ? [gradeOf()].filter(Boolean)
      : state.stageId ? stageOf().grades : structure.stages.flatMap((s) => s.grades);
    return grades.flatMap((g) => g.sections.map((c) => Number(c.id)));
  };

  const label = () => {
    if (state.classId) return `${gradeOf()?.name} — ${gradeOf()?.sections.find((c) => String(c.id) === state.classId)?.name}`;
    if (state.gradeId) return gradeOf()?.name || "";
    if (state.stageId) return stageOf()?.name || "";
    return "كل المراحل والصفوف";
  };
  const paint = () => { btnEl.textContent = label(); btnEl.classList.toggle("has-value", Boolean(state.stageId)); };
  paint();

  const choose = (patch) => { Object.assign(state, { stageId: "", gradeId: "", classId: "", ...patch }); paint(); onChange?.(state); };

  const open = () => {
    const body = h("div", { class: "picker-list" });
    let d;
    const level0 = () => mount(body,
      row("كل المراحل والصفوف", !state.stageId, () => { choose({}); d.close(); }),
      structure.stages.map((s) => row(s.name, false, () => level1(s), true)));
    const level1 = (s) => mount(body,
      back(level0),
      row(`كل صفوف ${s.name}`, state.stageId === String(s.id) && !state.gradeId, () => { choose({ stageId: String(s.id) }); d.close(); }),
      s.grades.map((g) => row(g.name, false,
        () => (sectionsOn && g.sections.length > 1) ? level2(s, g) : (() => { choose({ stageId: String(s.id), gradeId: String(g.id) }); d.close(); })(),
        sectionsOn && g.sections.length > 1)));
    const level2 = (s, g) => mount(body,
      back(() => level1(s)),
      row(`كل شعب ${g.name}`, state.gradeId === String(g.id) && !state.classId, () => { choose({ stageId: String(s.id), gradeId: String(g.id) }); d.close(); }),
      g.sections.map((c) => row(c.name, false, () => { choose({ stageId: String(s.id), gradeId: String(g.id), classId: String(c.id) }); d.close(); })));
    const row = (text, active, onclick, hasNext = false) => h("button", { type: "button", class: `picker-row ${active ? "on" : ""}`, onclick },
      h("span", {}, text), hasNext ? h("span", { class: "sub", "aria-hidden": "true" }, "‹") : null);
    const back = (to) => h("button", { type: "button", class: "picker-row back", onclick: to }, "‹ رجوع");

    level0();
    d = dialog("اختر المرحلة والصف", body);
  };
  btnEl.addEventListener("click", open);

  return {
    el: btnEl,
    get stageId() { return state.stageId; }, get gradeId() { return state.gradeId; }, get classId() { return state.classId; },
    classIds,
    set: (patch) => choose(patch),
    reset: () => choose({}),
    // مسح صامت: يغيّر الاختيار والزر دون استدعاء onChange (للاستخدام مع «مسح الفلاتر»)
    clear: () => { Object.assign(state, { stageId: "", gradeId: "", classId: "" }); paint(); },
  };
}
