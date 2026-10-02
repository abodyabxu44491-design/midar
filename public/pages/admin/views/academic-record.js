// السجل الأكاديمي في الإعدادات: كل ما يخص بنية المدرسة في مكان واحد.
// لا منطق خاص به: يعرض نفس أجزاء «الهيكل الأكاديمي» و«السنة الدراسية» ويستدعي نفس الواجهات البرمجية
// التي يحفظ فيها معالج أول دخول، فأي تعديل هنا يظهر في المعالج والنظام كله، والعكس.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, input, btn, sub, empty, notice, toast, confirmAction, line, badge, stats } from "../../shared/js/ui.js";
import { A } from "./common.js";
import { loadStructure, stagesParts, subjectsPanel, sectionsModePanel } from "./structure.js";
import { yearParts, daysParts } from "./academic.js";

const PARTS = [
  ["structure", "المراحل والصفوف والشعب"],
  ["subjects", "المواد"],
  ["year", "السنة والفصول"],
  ["days", "أيام الدراسة والإجازات"],
  ["grading", "توزيع الدرجات"],
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
    grading: (refresh) => gradingPanel(refresh),
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

// توزيع الدرجات: أنواع الدرجات التي يرصدها المعلم ووزن كل نوع من 100، لكل المدرسة أو لصف بعينه
let gradingScope = "";
async function gradingPanel(refresh) {
  const d = await api(`${A}/grade-components`);
  const scope = select([["", "كل الصفوف (التوزيع العام)"], ...d.grades.map((g) => [g.id, `${g.stage} — ${g.name}`])], { value: gradingScope });
  const rowsBox = h("div", { class: "gc-rows" });
  const total = h("b");
  const msg = h("div");
  let rows = [];
  const load = () => {
    const sid = scope.value ? Number(scope.value) : null;
    rows = d.items.filter((x) => (x.grade_id ?? null) === sid).map((x) => ({ ...x }));
    draw();
  };
  const sum = () => Math.round(rows.reduce((a, r) => a + (Number(r.weight) || 0), 0) * 100) / 100;
  const draw = () => {
    mount(rowsBox, rows.length ? rows.map((r, i) => {
      const name = input({ value: r.name, maxLength: 40, placeholder: "اسم النوع", "aria-label": "اسم نوع الدرجة" });
      const weight = input({ type: "number", value: r.weight, min: 0.5, max: 100, step: "0.5", class: "ltr", style: "width:90px", "aria-label": "الوزن" });
      const def = h("input", { type: "radio", name: "gc-default", checked: !!r.is_default, "aria-label": "النوع الافتراضي" });
      name.addEventListener("input", () => { r.name = name.value; });
      weight.addEventListener("input", () => { r.weight = Number(weight.value); paintTotal(); });
      def.addEventListener("change", () => rows.forEach((x, j) => { x.is_default = j === i; }));
      return h("div", { class: "gc-row" },
        h("span", { class: "gc-n" }, String(i + 1)), name,
        h("label", { class: "gc-w" }, weight, h("span", {}, "من 100")),
        h("label", { class: "gc-d" }, def, h("span", {}, "افتراضي")),
        r.used ? badge(`${r.used} رصد`, "gray") : btn("حذف", () => { rows.splice(i, 1); draw(); }, "ghost sm"));
    }) : empty("لا يوجد توزيع لهذا النطاق. اختر قالبًا جاهزًا أو أضف الأنواع بنفسك."));
    paintTotal();
  };
  const paintTotal = () => {
    const t = sum();
    total.textContent = `${t} من 100`;
    total.className = rows.length && t !== 100 ? "danger-text" : "";
  };
  scope.addEventListener("change", () => { gradingScope = scope.value; load(); });
  const templates = h("div", { class: "row", style: "flex-wrap:wrap;justify-content:flex-start" },
    d.templates.map((tp) => btn(tp.name, () => {
      if (rows.some((r) => r.used)) return toast("هذا التوزيع عليه درجات مرصودة؛ عدّل الأنواع بدل استبدالها", true);
      rows = tp.items.map((x) => ({ ...x })); draw();
    }, "soft sm")));
  load();
  return [
    panel("توزيع الدرجات", null,
      sub("حدد أنواع الدرجات التي يرصدها المعلم (مشاركة، واجبات، اختبارات قصيرة، شهري، نهائي…) ووزن كل نوع. نتيجة المادة في كشف الدرجات والشهادة = مجموع (نسبة الطالب في كل نوع × وزنه)."),
      field("النطاق", scope, "توزيع خاص بصف يتقدم على التوزيع العام لذلك الصف."),
      h("div", {}, h("span", { class: "sub" }, "قوالب جاهزة: "), templates),
      rowsBox,
      line(h("span", {}, "مجموع الأوزان"), total),
      sub("النوع «الافتراضي» تُحسب عليه الدرجات التي لم يُحدَّد نوعها (مثل درجات الاختبارات الإلكترونية والدرجات القديمة)."),
      msg,
      h("div", { class: "row", style: "justify-content:flex-start" },
        btn("+ نوع", () => { rows.push({ name: "", weight: 0, is_default: !rows.length }); draw(); }, "ghost"),
        btn("حفظ التوزيع", async () => {
          mount(msg);
          try {
            await api(`${A}/grade-components`, { grade_id: scope.value ? Number(scope.value) : null,
              items: rows.map((r) => ({ id: r.id, name: (r.name || "").trim(), weight: Number(r.weight), is_default: !!r.is_default })) }, "PUT");
            toast("تم حفظ توزيع الدرجات"); refresh();
          } catch (e) { mount(msg, notice(e.message, "err")); }
        }))),
  ];
}
