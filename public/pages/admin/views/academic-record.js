// السجل الأكاديمي في الإعدادات: كل ما يخص بنية المدرسة في مكان واحد.
// لا منطق خاص به: يعرض نفس أجزاء «الهيكل الأكاديمي» و«السنة الدراسية» ويستدعي نفس الواجهات البرمجية
// التي يحفظ فيها معالج أول دخول، فأي تعديل هنا يظهر في المعالج والنظام كله، والعكس.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, btn, sub, empty, notice, toast, confirmAction, line, badge, stats } from "../../shared/js/ui.js";
import { A } from "./common.js";
import { loadStructure, stagesParts, subjectsPanel, sectionsModePanel } from "./structure.js";
import { yearParts, daysParts } from "./academic.js";

const PARTS = [
  ["structure", "المراحل والصفوف والشعب"],
  ["subjects", "المواد"],
  ["year", "السنة والفصول"],
  ["days", "أيام الدراسة والإجازات"],
  ["system", "إعدادات النظام الأكاديمي"],
];

let remembered = "structure";   // يبقى القسم المفتوح بعد الحفظ

export default async function academicRecord() {
  const chips = h("div", { class: "xb-chips ar-chips", role: "tablist" });
  const box = h("div");

  const show = async (key = remembered) => {
    remembered = key;
    mount(chips, PARTS.map(([k, label]) => h("button", {
      type: "button", role: "tab", "aria-selected": String(k === key), class: `xb-chip${k === key ? " on" : ""}`, onclick: () => show(k),
    }, label)));
    mount(box, empty("جارٍ التحميل…"));
    const refresh = () => show(key);
    try { mount(box, await RENDER[key](refresh)); } catch (e) { mount(box, notice(e.message, "err")); }
  };

  const RENDER = {
    structure: async (refresh) => {
      const d = await loadStructure();
      return [summary(d), ...stagesParts(d, refresh)];
    },
    subjects: async (refresh) => subjectsPanel(await loadStructure(), refresh),
    year: (refresh) => yearParts({ refresh }),
    days: (refresh) => daysParts({ refresh }),
    system: async (refresh) => {
      const d = await loadStructure();
      return [sectionsModePanel(d, refresh), namingPanel(d, refresh), wizardPanel(d)];
    },
  };

  await show();
  return [sub("مصدر واحد لبنية المدرسة: ما يُعدَّل هنا يظهر في الطلاب والمعلمين والجداول والاختبارات والتقارير والصفحة العامة."), chips, box];
}

// ملخص سريع أعلى الهيكل
function summary(d) {
  const st = d.structure;
  const grades = st.stages.flatMap((x) => x.grades);
  const sections = grades.reduce((n, g) => n + g.sections.length, 0);
  const students = grades.reduce((n, g) => n + g.sections.reduce((m, c) => m + c.students, 0), 0);
  return stats([["المراحل", st.stages.length], ["الصفوف", grades.length], st.sections_enabled ? ["الشعب", sections] : null,
    ["المواد", st.subjects.filter((x) => x.is_active).length], ["الطلاب", students]].filter(Boolean));
}

// نمط تسمية الصفوف: نفس الصفوف (نفس المعرّفات) بأسماء عرض جديدة
function namingPanel(d, refresh) {
  const sets = d.catalog.grade_sets;
  const catalogStages = d.structure.stages.filter((s) => s.code && sets[0].names[s.code]);
  if (!catalogStages.length) return panel("نمط تسمية الصفوف", null, sub("لا توجد مراحل من الأنماط الجاهزة. عدّل أسماء الصفوف من «المراحل والصفوف والشعب»."));
  const pick = select(sets.map((g) => [g.key, g.name]));
  const preview = h("div");
  const paint = () => {
    const set = sets.find((g) => g.key === pick.value);
    let changes = 0;
    mount(preview, catalogStages.map((st) => h("div", {},
      h("h3", { class: "sec-title" }, st.name),
      st.grades.map((g, i) => {
        const next = set.names[st.code]?.[i];
        const same = !next || next === g.name;
        if (!same) changes++;
        return line(h("span", {}, g.name), h("b", { class: same ? "muted" : "" }, same ? "بدون تغيير" : `← ${next}`));
      }))));
    apply.disabled = !changes;
  };
  const apply = btn("تطبيق النمط", async () => {
    if (!confirmAction("تغيير أسماء الصفوف؟ الصفوف نفسها لا تتغير: يبقى الطلاب والمعلمون والدرجات مرتبطين بها، ويتغير الاسم الظاهر في كل مكان.")) return;
    const r = await api(`${A}/setup/rename-grades`, { grade_set: pick.value });
    toast(r.renamed || r.stages ? `تم تحديث الأسماء: ${[r.renamed ? `${r.renamed} صف` : null, r.stages ? `${r.stages} مرحلة` : null].filter(Boolean).join(" و")}` : "الأسماء مطابقة للنمط مسبقًا"); refresh();
  });
  pick.addEventListener("change", paint);
  queueMicrotask(paint);
  return panel("نمط تسمية الصفوف", null,
    sub("للمراحل الجاهزة (ابتدائي، متوسط، ثانوي، رياض أطفال). المراحل المخصصة وأي صف أعدت تسميته يدويًا تعدّله من قائمة الصفوف."),
    field("النمط", pick), preview, apply);
}

function wizardPanel(d) {
  const done = d.profile?.setup_completed_at;
  return panel("معالج الإعداد", null,
    line(h("span", {}, "حالة الإعداد"), done ? badge("مكتمل") : badge("لم يكتمل", "amber")),
    sub("المعالج يضيف ما ينقص فقط (مراحل وصفوف ومواد جديدة) ولا يحذف أو يكرر شيئًا موجودًا."),
    btn("فتح معالج الإعداد مرة أخرى", async () => {
      if (!confirmAction("فتح معالج الإعداد؟ ستظهر شاشة المعالج حتى تنهيه أو تتخطاه.")) return;
      await api(`${A}/setup/reopen`, {});
      location.reload();
    }, "ghost"));
}
