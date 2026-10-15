/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// How teachers work in this school, in three plain choices: who approves grades, who takes the daily attendance,
// and which sections teachers see (for all teachers, or a different list for one teacher).
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, btn, sub, toast, dialog, badge, empty } from "../../shared/js/ui.js";
import { A } from "./common.js";

const URL = `${A}/communication/features/teachers`;
export const TEACHER_SECTION_NAMES = {
  attendance: "تسجيل الحضور", exams: "رصد الدرجات", chat: "رسائل أولياء الأمور", students: "طلابي", behavior: "السلوك",
  homework: "الواجبات", timetable: "جدولي", papers: "أوراق الاختبارات", lessons: "تحضير الدروس", announcements: "التعاميم",
  calendar: "التقويم", meetings: "المواعيد", surveys: "الاستبيانات", me: "حضوري وإجازاتي",
};

// Large option cards: one choice, the explanation under each.
function choice(options, value, onPick) {
  const box = h("div", { class: "pick-cards", role: "radiogroup" });
  const draw = (v) => mount(box, options.map(([key, title, note]) => h("button", {
    type: "button", role: "radio", "aria-checked": String(key === v), class: `pick-card${key === v ? " on" : ""}`,
    onclick: async () => { if (key !== v && (await onPick(key)) !== false) draw(key); },
  }, h("span", { class: "pick-dot", "aria-hidden": "true" }), h("span", {}, h("b", {}, title), note ? h("small", {}, note) : null))));
  draw(value);
  return box;
}

// Sections as on/off chips: on = the teacher sees it.
function sectionChips(hidden, onChange) {
  const set = new Set(hidden);
  const box = h("div", { class: "sec-chips" });
  const draw = () => mount(box, Object.entries(TEACHER_SECTION_NAMES).map(([key, name]) => h("button", {
    type: "button", class: `sec-chip${set.has(key) ? "" : " on"}`, "aria-pressed": String(!set.has(key)),
    onclick: () => { set.has(key) ? set.delete(key) : set.add(key); draw(); onChange([...set]); },
  }, h("span", { class: "sec-tick", "aria-hidden": "true" }, set.has(key) ? "" : "✓"), name)));
  draw();
  return box;
}

export default async function teacherControl() {
  const [all, teachers] = await Promise.all([api(`${A}/communication/features`), api(`${A}/teachers`)]);
  const s = all.teachers;
  const save = async (patch) => {
    try { Object.assign(s, await api(URL, patch, "PUT")); toast("حُفظ — يظهر للمعلمين عند فتح البوابة"); return true; }
    catch (e) { toast(e.message, true); return false; }
  };
  let pending = null;
  const saveHidden = (hidden) => { clearTimeout(pending); pending = setTimeout(() => save({ hidden }), 600); };

  const list = h("div", { class: "tc-list" });
  const search = h("input", { type: "search", class: "tc-search", placeholder: "ابحث باسم المعلم", "aria-label": "ابحث باسم المعلم" });
  search.addEventListener("input", () => drawTeachers());
  const custom = h("b", {}, "0");
  const drawTeachers = async (changed) => {
    if (changed) Object.assign(teachers.find((t) => t.id === changed.id) || {}, { hidden_sections: changed.hidden });
    const term = search.value.trim();
    const rows = teachers.filter((t) => !term || String(t.name).includes(term))
      .map((t) => ({ t, x: { own: t.hidden_sections ?? null, school: s.hidden } }))
      .sort((a, b) => Number(Boolean(b.x.own)) - Number(Boolean(a.x.own)));
    custom.textContent = String(teachers.filter((t) => t.hidden_sections).length);
    mount(list, rows.length ? rows.map(({ t, x }) => h("div", { class: "tc-row" },
      h("div", {}, h("b", {}, t.name), h("small", {}, x.own ? `أقسام خاصة به (${Object.keys(TEACHER_SECTION_NAMES).length - x.own.length} ظاهرة)` : "مثل كل المعلمين")),
      x.own ? badge("مخصص", "amber") : null,
      btn("تخصيص", () => perTeacher(t, { own: t.hidden_sections ?? null, school: s.hidden }, drawTeachers), "ghost sm")))
      : empty("لا يوجد معلمون بعد."));
  };
  drawTeachers();

  return [
    panel("١. اعتماد الدرجات", null,
      sub("من يعتمد الدرجات قبل أن يراها ولي الأمر؟ الإدارة تستطيع دائمًا مراجعة أي درجة وتصحيحها أو إخفاءها من «الدرجات»."),
      choice([
        [true, "المعلم يعتمد وتُنشر مباشرة", "الأسهل: المعلم يرصد ثم يضغط «اعتماد ونشر»، ويستطيع تصحيح الدرجة بعد النشر."],
        [false, "الإدارة تعتمد قبل النشر", "المعلم يرسل الدرجات، والإدارة تراجعها ثم تنشرها."],
      ], s.teacher_publishes, (v) => save({ teacher_publishes: v }))),
    panel("٢. من يسجل حضور الطلاب؟", null,
      sub("الحضور يُسجَّل في مكان واحد فقط حتى لا يتكرر. من لا يسجله يراه للاطلاع."),
      choice([
        ["teacher", "المعلم في الحصة", "يظهر للمعلم زر «تسجيل الحضور» لفصوله."],
        ["admin", "الإدارة", "الإدارة تسجل من «الحضور»، ويختفي التسجيل من بوابة المعلم."],
        ["gate", "بوابة الحضور الذكية", "الطالب يمسح بطاقته عند الدخول، والإدارة تصحح عند الحاجة."],
      ], s.attendance_by, (v) => save({ attendance_by: v }))),
    panel("٣. الأقسام التي يراها المعلمون", null,
      sub("اضغط على القسم لإخفائه أو إظهاره لكل المعلمين. الأقسام المخفية لا تظهر في القائمة ولا في الرئيسية."),
      sectionChips(s.hidden, saveHidden),
      h("details", { class: "tc-more" },
        h("summary", {}, "معلم بعينه يحتاج أقسامًا مختلفة؟ ", h("small", {}, "المخصصون: ", custom)),
        sub("خصّص له قائمته، والباقون يتبعون الاختيار أعلاه."),
        search, list)),
  ];
}

function perTeacher(t, x, done) {
  let hidden = x.own ?? x.school ?? [];
  const body = h("div", {}, sub("الأقسام الظاهرة لهذا المعلم فقط."), sectionChips(hidden, (v) => { hidden = v; }));
  const d = dialog(`أقسام ${t.name}`, body, [
    btn("حفظ", async () => {
      try { await api(`${A}/teachers/${t.id}/sections`, { hidden }, "PUT"); toast("حُفظ"); d.close(); done({ id: t.id, hidden }); }
      catch (e) { toast(e.message, true); }
    }),
    x.own ? btn("مثل كل المعلمين", async () => {
      await api(`${A}/teachers/${t.id}/sections`, { hidden: null }, "PUT"); toast("يتبع إعداد كل المعلمين"); d.close(); done({ id: t.id, hidden: null });
    }, "ghost") : null,
  ].filter(Boolean));
}
