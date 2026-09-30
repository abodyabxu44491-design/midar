// معالج استيراد الطلاب: طريقة الاستيراد ← فحص الملف ← معاينة وتأكيد ← نتيجة.
// لا يُكتب شيء في قاعدة البيانات قبل الضغط على «تأكيد الاستيراد».
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { field, input, select, btn, sub, notice, badge, dialog, toast, textarea } from "../../shared/js/ui.js";
import { parseCsv, csv } from "../../shared/js/format.js";
import { readXlsx } from "../../shared/js/xlsx-read.js";
import { A } from "./common.js";

const MAX_ROWS = 2000;
const download = (url) => { location.href = url; };

/** قسم «قالب الاستيراد»: قالب فارغ، أو جاهز حسب الصف (اختياري) */
export function templateSection(structure) {
  const box = h("div", { class: "tpl-box" });
  const sectionsOn = structure.sections_enabled;
  const stage = select([["", "اختر المرحلة"], ...structure.stages.map((s) => [s.id, s.name])]);
  const grade = select([["", "اختر الصف"]]);
  const sect = select([["", "كل الشعب"]]);
  const withExisting = input({ type: "checkbox" });
  const picker = h("div", { class: "tpl-picker", hidden: true },
    field("المرحلة", stage), field("الصف", grade), sectionsOn ? field("الشعبة", sect) : null,
    h("label", { class: "f pill" }, withExisting, "تضمين الطلاب الحاليين في الملف (لتحديث بياناتهم)"),
    btn("تحميل القالب", () => {
      if (!grade.value) return toast("اختر الصف أولًا أو اختر «بدون تحديد صف»", true);
      const p = new URLSearchParams();
      if (sect.value) p.set("class_id", sect.value); else p.set("grade_id", grade.value);
      if (withExisting.checked) p.set("existing", "1");
      download(`${A}/import/students/template?${p}`);
    }));
  stage.addEventListener("change", () => {
    const st = structure.stages.find((s) => String(s.id) === stage.value);
    mount(grade, h("option", { value: "" }, "اختر الصف"), (st?.grades || []).map((g) => h("option", { value: g.id }, g.name)));
    mount(sect, h("option", { value: "" }, "كل الشعب"));
  });
  grade.addEventListener("change", () => {
    const g = structure.stages.flatMap((s) => s.grades).find((x) => String(x.id) === grade.value);
    mount(sect, h("option", { value: "" }, "كل الشعب"), (g?.sections || []).map((c) => h("option", { value: c.id }, c.name)));
  });

  const ask = h("div", { class: "tpl-ask", hidden: true },
    h("b", {}, "هل تريد تحديد الصف؟"),
    h("div", { class: "row", style: "justify-content:flex-start" },
      btn("نعم، اختر الصف", () => { picker.hidden = false; ask.hidden = true; }, "soft sm"),
      btn("بدون تحديد صف", () => download(`${A}/import/students/template`), "ghost sm")),
    sub("بدون تحديد صف تحصل على قالب عام تعبّئ فيه المرحلة والصف لكل طالب."));

  mount(box,
    h("h3", { class: "sec-title" }, "قالب الاستيراد"),
    h("div", { class: "row", style: "justify-content:flex-start" },
      btn("تحميل قالب فارغ", () => download(`${A}/import/students/template`), "soft sm"),
      btn("تحميل قالب جاهز", () => { ask.hidden = false; picker.hidden = true; }, "soft sm")),
    ask, picker);
  return box;
}

export function openTemplates(structure) {
  dialog("قوالب الاستيراد", h("div", {}, sub("القالب ملف Excel جاهز بالأعمدة المطلوبة وقوائم اختيار."), templateSection(structure)));
}

export const problemsTable = (list) => h("div", { class: "scroll" }, h("table", { class: "grid" },
  h("thead", {}, h("tr", {}, ["السطر", "الطالب", "الحالة", "التفاصيل"].map((x) => h("th", {}, x)))),
  h("tbody", {}, list.map((r) => h("tr", {},
    h("td", {}, r.row), h("td", {}, r.name || "—"),
    h("td", {}, r.status === "error" ? badge("خطأ", "red") : badge("مراجعة", "amber")),
    h("td", {}, [...r.errors, ...r.notes].join(" — ")))))));

/** قراءة الملف (Excel أو CSV) إلى صفوف */
export async function readTable(file, method, max = MAX_ROWS) {
  if (file.size > 5 * 1024 * 1024) throw new Error("حجم الملف أكبر من 5 ميجابايت");
  const isX = /\.xlsx$/i.test(file.name);
  if (method === "excel" && !isX) throw new Error("اختر ملف Excel بصيغة .xlsx");
  if (method === "csv" && isX) throw new Error("هذا ملف Excel. اختر «استيراد من Excel»");
  const data = isX ? await readXlsx(file) : parseCsv(await file.text());
  if (!data.rows.length) throw new Error("الملف فارغ أو غير مقروء. استخدم القالب.");
  if (data.rows.length > max) throw new Error(`الحد ${max} سطر في المرة، وملفك فيه ${data.rows.length}. قسّمه إلى أكثر من ملف.`);
  return data;
}
const readFile = async (file, method) => (await readTable(file, method)).rows;

export async function openStudentImport({ structure, onDone } = {}) {
  structure ||= (await api(`${A}/setup`)).structure;
  let rows = null, gradeMap = {}, includeDup = false, fileName = "", d;
  const body = h("div", { class: "wiz" });
  const set = (...kids) => mount(body, kids);
  const stepper = (n) => h("ol", { class: "wiz-steps" }, ["الطريقة", "فحص الملف", "المعاينة", "النتيجة"].map((t, i) =>
    h("li", { class: i + 1 === n ? "on" : i + 1 < n ? "done" : "" }, t)));
  const payload = () => ({ rows, grade_map: gradeMap, include_duplicates: includeDup });

  /* 1) اختيار الطريقة والملف */
  const stepMethod = () => {
    const msg = h("div");
    const pick = (method) => {
      const file = input({ type: "file", accept: method === "csv" ? ".csv,text/csv" : ".xlsx" });
      file.addEventListener("change", async () => {
        const f = file.files?.[0]; if (!f) return;
        mount(msg, notice("جارٍ قراءة الملف…"));
        try { rows = await readFile(f, method); fileName = f.name; gradeMap = {}; includeDup = false; await stepAnalyze(); }
        catch (e) { mount(msg, notice(e.message, "err")); }
      });
      mount(chooser, h("div", { class: "pick-file" }, field(method === "excel" ? "اختر ملف Excel (.xlsx)" : "اختر ملف CSV", file)));
    };
    const chooser = h("div");
    const paste = () => {
      const ta = textarea({ rows: 6, placeholder: "اسم الطالب، اسم ولي الأمر، رقم الجوال\nكل طالب في سطر — انسخها من Excel مباشرة" });
      const cls = select([["", "بدون صف"], ...structure.stages.flatMap((s) => s.grades.flatMap((g) => g.sections.map((c) => [c.name, `${g.name}${structure.sections_enabled && g.sections.length > 1 ? ` — ${c.name}` : ""}`])))]);
      mount(chooser, field("الصف/الشعبة لكل الطلاب", cls), ta, h("div", { class: "spaced" }, btn("فحص", async () => {
        const list = ta.value.split(/\r?\n/).map((l) => l.split(/[,،\t]/).map((x) => x.trim())).filter((p) => p[0]);
        if (!list.length) return mount(msg, notice("الصق أسماء الطلاب أولًا", "err"));
        rows = list.map(([n, g, p]) => ({ "اسم الطالب": n, "اسم ولي الأمر": g || "", "جوال ولي الأمر": p || "", ...(cls.value ? { "الفصل": cls.value } : {}) }));
        fileName = "لصق"; gradeMap = {}; includeDup = false;
        try { await stepAnalyze(); } catch (e) { mount(msg, notice(e.message, "err")); }
      })));
    };
    set(stepper(1),
      h("h3", { class: "sec-title" }, "اختر طريقة الاستيراد"),
      h("div", { class: "method-grid" },
        h("button", { type: "button", class: "menu-card", onclick: () => pick("excel") }, h("span", { class: "menu-text" }, h("span", { class: "menu-name" }, "استيراد من Excel"), h("span", { class: "menu-note" }, "ملف .xlsx (الأفضل)"))),
        h("button", { type: "button", class: "menu-card", onclick: () => pick("csv") }, h("span", { class: "menu-text" }, h("span", { class: "menu-name" }, "استيراد من CSV"), h("span", { class: "menu-note" }, "ملف نصي مفصول بفواصل"))),
        h("button", { type: "button", class: "menu-card", onclick: paste }, h("span", { class: "menu-text" }, h("span", { class: "menu-name" }, "لصق سريع"), h("span", { class: "menu-note" }, "الأسماء والجوالات مباشرة")))),
      chooser, msg, templateSection(structure));
  };

  /* 2) فحص الملف */
  async function stepAnalyze() {
    set(stepper(2), notice("جارٍ تحليل الملف…"));
    const a = await api(`${A}/import/students/analyze`, payload());
    const s = a.summary;
    const problems = a.rows.filter((r) => r.status !== "ok");
    const dupCount = problems.filter((r) => r.review === "duplicate").length;

    const amb = a.ambiguities.map((x) => {
      const name = `amb_${Math.random().toString(36).slice(2)}`;
      const radios = x.candidates.map((c) => h("label", { class: "f pill" }, input({ type: "radio", name, value: c.grade_id, "data-key": x.key }), c.label));
      return h("div", { class: "amb" }, h("b", {}, `وجدنا قيمة «${x.value}»${x.stage ? ` (${x.stage})` : ""} في ${x.count} سطر، وقد تكون:`), ...radios);
    });
    const dupToggle = input({ type: "checkbox" }); dupToggle.checked = includeDup;

    set(stepper(2),
      h("div", { class: "kpis-row" },
        h("div", { class: "kpi" }, h("b", {}, s.total), "عدد الصفوف"),
        h("div", { class: "kpi ok" }, h("b", {}, s.valid), "صحيحة"),
        h("div", { class: "kpi warn" }, h("b", {}, s.review), "تحتاج مراجعة"),
        h("div", { class: "kpi bad" }, h("b", {}, s.errors), "أخطاء")),
      sub(`الملف: ${fileName}`),
      a.capacity.exceeded ? notice(`الاستيراد سيتجاوز حد الباقة (${a.capacity.max} طالب): المسجل ${a.capacity.active} والجديد ${s.create}.`, "err") : null,
      amb.length ? h("div", {}, h("h3", { class: "sec-title" }, "اختر المقصود"), ...amb, btn("تطبيق الاختيار", async () => {
        const picked = {};
        for (const r of body.querySelectorAll("input[type=radio]:checked")) picked[r.dataset.key] = Number(r.value);
        if (!Object.keys(picked).length) return toast("اختر صفًا واحدًا على الأقل", true);
        gradeMap = { ...gradeMap, ...picked };
        await stepAnalyze();
      }, "soft")) : null,
      dupCount ? h("label", { class: "f pill" }, dupToggle, `أضف الأسطر المتشابهة (${dupCount}) كطلاب جدد رغم التشابه`) : null,
      problems.length ? h("div", {},
        h("h3", { class: "sec-title" }, "الأسطر التي تحتاج انتباهًا"),
        problemsTable(problems.slice(0, 100)),
        problems.length > 100 ? sub(`تُعرض أول 100 من ${problems.length}. الباقي في تقرير الأخطاء.`) : null,
        btn("تحميل تقرير الأخطاء", () => csv("تقرير-الاستيراد.csv", [["السطر", "الطالب", "رقم الطالب", "الحالة", "التفاصيل"],
          ...problems.map((r) => [r.row, r.name, r.student_no || "", r.status === "error" ? "خطأ" : "مراجعة", [...r.errors, ...r.notes].join(" — ")])]), "ghost sm")) : null,
      h("div", { class: "row spaced" },
        btn("رجوع", stepMethod, "ghost"),
        btn("إعادة الفحص", async () => { includeDup = dupToggle.checked; await stepAnalyze(); }, "ghost"),
        btn("التالي: معاينة البيانات", () => stepPreview(a))));
    const next = body.querySelector(".row.spaced .btn:last-child");
    if (!s.valid || a.capacity.exceeded) next.disabled = true;
    const dupBox = body.querySelector("input[type=checkbox]");
    if (dupBox && dupCount) dupBox.addEventListener("change", async () => { includeDup = dupBox.checked; await stepAnalyze(); });
  }

  /* 3) معاينة وتأكيد */
  function stepPreview(a) {
    const s = a.summary, good = a.rows.filter((r) => r.status === "ok");
    const total = s.create + s.update;
    const fmt = (r) => [r.preview.student_no || "—", r.preview.name, r.preview.stage, r.preview.grade, r.preview.section, r.preview.guardian_name, r.preview.guardian_phone];
    set(stepper(3),
      h("h3", { class: "sec-title" }, "معاينة البيانات"),
      h("p", {}, `سيتم إضافة ${s.create} طالبًا، وتحديث ${s.update}${s.unchanged ? `، وترك ${s.unchanged} بلا تغيير` : ""}${s.review + s.errors ? `، وتجاوز ${s.review + s.errors} سطرًا` : ""}.`),
      h("div", { class: "scroll" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, ["", "رقم الطالب", "الاسم", "المرحلة", "الصف", "الشعبة", "ولي الأمر", "الجوال"].map((x) => h("th", {}, x)))),
        h("tbody", {}, good.slice(0, 10).map((r) => h("tr", {}, h("td", {}, r.action === "update" ? badge("تحديث", "amber") : r.action === "unchanged" ? badge("كما هو", "gray") : badge("جديد")),
          ...fmt(r).map((v) => h("td", {}, v || "—"))))))),
      good.length > 10 ? sub(`عينة من أول 10 من ${good.length} سطرًا صحيحًا.`) : null,
      notice("لن يُنشأ أي طالب قبل الضغط على زر التأكيد.", ""),
      h("div", { class: "row spaced" },
        btn("رجوع", () => stepAnalyze(), "ghost"),
        btn(`تأكيد استيراد ${total} طالبًا`, async function () {
          if (!total) return toast("لا يوجد ما يُستورد", true);
          try { const r = await api(`${A}/import/students/commit`, payload()); stepResult(r); onDone?.({ changed: true }); }
          catch (e) { toast(e.message, true); }
        })));
  }

  /* 4) النتيجة */
  function stepResult(r) {
    set(stepper(4),
      h("h2", { class: "wiz-done" }, "تم الاستيراد بنجاح"),
      h("ul", { class: "res-list" },
        h("li", {}, `تمت إضافة ${r.created} طالبًا`),
        h("li", {}, `تم تحديث ${r.updated} طالبًا`),
        r.unchanged ? h("li", {}, `${r.unchanged} طالبًا بلا تغيير`) : null,
        h("li", {}, `تم تجاوز ${r.skipped} سجلات`)),
      h("div", { class: "row spaced" },
        r.problems.length ? btn("تحميل تقرير الأخطاء", () => csv("تقرير-الاستيراد.csv", [["السطر", "الطالب", "رقم الطالب", "الحالة", "التفاصيل"],
          ...r.problems.map((p) => [p.row, p.name, p.student_no || "", p.status === "error" ? "خطأ" : "مراجعة", p.message])]), "ghost") : null,
        btn("عرض الطلاب المستوردين", () => { d.close(); onDone?.({ since: r.started_at }); })));
  }

  stepMethod();
  d = dialog("استيراد الطلاب", body);
  d.classList.add("dialog-lg");
  return d;
}
