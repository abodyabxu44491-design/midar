// معالج استيراد المعلمين: ملف ← مطابقة الأعمدة ← فحص ← معاينة وتأكيد ← نتيجة.
// لا يُكتب شيء قبل «تأكيد الاستيراد». كلمات المرور المؤقتة تظهر في النتيجة مرة واحدة فقط.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { field, input, select, btn, sub, notice, badge, dialog, toast } from "../../shared/js/ui.js";
import { csv } from "../../shared/js/format.js";
import { A, loadSubjects } from "./common.js";
import { readTable, problemsTable } from "./student-import.js";

const MAX = 200;
const download = (url) => { location.href = url; };

/** قسم «قالب المعلمين»: فارغ أو جاهز (مرحلة/مادة اختياريتان)، والقوائم من الهيكل الأكاديمي الحالي */
export function teacherTemplateSection(structure, subjects) {
  const stage = select([["", "كل المراحل"], ...structure.stages.map((s) => [s.id, s.name])]);
  const subject = select([["", "كل المواد"], ...subjects.map((s) => [s.id, s.name])]);
  const existing = input({ type: "checkbox" });
  const picker = h("div", { class: "tpl-picker", hidden: true },
    field("المرحلة (اختياري)", stage), field("المادة (اختياري)", subject),
    h("label", { class: "f pill" }, existing, "تضمين المعلمين الحاليين في الملف (لتحديث بياناتهم)"),
    btn("تحميل القالب", () => {
      const p = new URLSearchParams();
      if (stage.value) p.set("stage_id", stage.value);
      if (subject.value) p.set("subject_id", subject.value);
      if (existing.checked) p.set("existing", "1");
      download(`${A}/import/teachers/template?${p}`);
    }));
  return h("div", { class: "tpl-box" },
    h("h3", { class: "sec-title" }, "قالب المعلمين"),
    h("div", { class: "row", style: "justify-content:flex-start" },
      btn("تحميل قالب فارغ", () => download(`${A}/import/teachers/template`), "soft sm"),
      btn("تحميل قالب جاهز", () => { picker.hidden = !picker.hidden; }, "soft sm")),
    sub("القالب لا يحمل أسماء صفوف ثابتة: قوائمه من الهيكل الأكاديمي الحالي للمدرسة."), picker);
}

export function openTeacherTemplates(structure, subjects) {
  dialog("قالب المعلمين", h("div", {}, teacherTemplateSection(structure, subjects)));
}

export async function openTeacherImport({ onDone } = {}) {
  const [setup, subjects, fields] = await Promise.all([api(`${A}/setup`), loadSubjects().catch(() => []), api(`${A}/import/teachers/fields`)]);
  const structure = setup.structure;
  let table = null, mapping = {}, rows = null, gradeMap = {}, fileName = "", d;
  const body = h("div", { class: "wiz" });
  const set = (...kids) => mount(body, kids);
  const steps = (n) => h("ol", { class: "wiz-steps" }, ["الملف", "الأعمدة", "الفحص", "المعاينة", "النتيجة"].map((t, i) =>
    h("li", { class: i + 1 === n ? "on" : i + 1 < n ? "done" : "" }, t)));
  const payload = () => ({ rows, grade_map: gradeMap });

  /* 1) اختيار الملف */
  const stepFile = () => {
    const msg = h("div");
    const pick = (method) => {
      const file = input({ type: "file", accept: method === "csv" ? ".csv,text/csv" : ".xlsx" });
      file.addEventListener("change", async () => {
        const f = file.files?.[0]; if (!f) return;
        mount(msg, notice("جارٍ قراءة الملف…"));
        try {
          table = await readTable(f, method, MAX); fileName = f.name; gradeMap = {};
          mapping = await api(`${A}/import/teachers/map`, { headers: table.headers.filter(Boolean) });
          stepMap();
        } catch (e) { mount(msg, notice(e.message, "err")); }
      });
      mount(chooser, field(method === "excel" ? "اختر ملف Excel (.xlsx)" : "اختر ملف CSV", file));
    };
    const chooser = h("div");
    set(steps(1), h("h3", { class: "sec-title" }, "اختر الملف"),
      h("div", { class: "method-grid" },
        h("button", { type: "button", class: "menu-card", onclick: () => pick("excel") }, h("span", { class: "menu-text" }, h("span", { class: "menu-name" }, "استيراد من Excel"), h("span", { class: "menu-note" }, "ملف .xlsx (الأفضل)"))),
        h("button", { type: "button", class: "menu-card", onclick: () => pick("csv") }, h("span", { class: "menu-text" }, h("span", { class: "menu-name" }, "استيراد من CSV"), h("span", { class: "menu-note" }, "ملف نصي مفصول بفواصل")))),
      chooser, msg, sub(`الحد ${MAX} معلم في المرة.`), teacherTemplateSection(structure, subjects));
  };

  /* 2) قراءة الأعمدة ومطابقتها */
  function stepMap() {
    const sample = (h2) => { const r = table.rows.find((x) => String(x[h2] ?? "").trim()); return r ? String(r[h2]).slice(0, 30) : ""; };
    const sels = table.headers.filter(Boolean).map((hd) => {
      const el = select([["", "— تجاهل هذا العمود —"], ...fields.map((f) => [f.key, f.label + (f.required ? " *" : "")])], { value: mapping[hd] || "" });
      return { hd, el };
    });
    const msg = h("div");
    set(steps(2),
      h("h3", { class: "sec-title" }, "مطابقة الأعمدة"),
      sub(`قرأنا ${table.headers.filter(Boolean).length} عمودًا و${table.rows.length} سطرًا من «${fileName}». عدّل المطابقة إن لزم.`),
      h("div", { class: "scroll" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, ["عمود الملف", "مثال", "يُحفظ في"].map((x) => h("th", {}, x)))),
        h("tbody", {}, sels.map(({ hd, el }) => h("tr", {}, h("td", {}, hd), h("td", { class: "sub" }, sample(hd) || "—"), h("td", {}, el)))))),
      msg,
      h("div", { class: "row spaced" }, btn("رجوع", stepFile, "ghost"), btn("التالي: فحص الملف", async () => {
        const chosen = sels.map(({ hd, el }) => [hd, el.value]).filter(([, k]) => k);
        const keys = chosen.map(([, k]) => k);
        if (!keys.includes("name")) return mount(msg, notice("حدّد العمود الذي يحوي «اسم المعلم».", "err"));
        const dup = keys.find((k, i) => keys.indexOf(k) !== i);
        if (dup) return mount(msg, notice(`تمت مطابقة أكثر من عمود مع «${fields.find((f) => f.key === dup).label}». اجعل لكل حقل عمودًا واحدًا.`, "err"));
        mapping = Object.fromEntries(chosen);
        rows = table.rows.map((r) => Object.fromEntries(chosen.map(([hd, k]) => [k, r[hd] ?? ""])));
        try { await stepAnalyze(); } catch (e) { mount(msg, notice(e.message, "err")); }
      })));
  }

  /* 3) فحص الملف: أخطاء، تكرار، التباس الصف */
  async function stepAnalyze() {
    set(steps(3), notice("جارٍ تحليل الملف…"));
    const a = await api(`${A}/import/teachers/analyze`, payload());
    const s = a.summary, problems = a.rows.filter((r) => r.status !== "ok");
    const amb = a.ambiguities.map((x) => {
      const name = `amb_${Math.random().toString(36).slice(2)}`;
      return h("div", { class: "amb" }, h("b", {}, `وجدنا قيمة «${x.value}»${x.stage ? ` (${x.stage})` : ""} في ${x.count} سطر، وقد تكون:`),
        ...x.candidates.map((c) => h("label", { class: "f pill" }, input({ type: "radio", name, value: c.grade_id, "data-key": x.key }), c.label)));
    });
    set(steps(3),
      h("div", { class: "kpis-row" },
        h("div", { class: "kpi" }, h("b", {}, s.total), "عدد الصفوف"), h("div", { class: "kpi ok" }, h("b", {}, s.valid), "صحيحة"),
        h("div", { class: "kpi warn" }, h("b", {}, s.review), "تحتاج مراجعة"), h("div", { class: "kpi bad" }, h("b", {}, s.errors), "أخطاء")),
      a.capacity.exceeded ? notice(`الاستيراد سيتجاوز حد المعلمين في باقتك (${a.capacity.max}): الحاليون ${a.capacity.current} والجدد ${s.create}.`, "err") : null,
      amb.length ? h("div", {}, h("h3", { class: "sec-title" }, "اختر المقصود"), ...amb, btn("تطبيق الاختيار", async () => {
        const picked = {};
        for (const r of body.querySelectorAll("input[type=radio]:checked")) picked[r.dataset.key] = Number(r.value);
        if (!Object.keys(picked).length) return toast("اختر صفًا واحدًا على الأقل", true);
        gradeMap = { ...gradeMap, ...picked }; await stepAnalyze();
      }, "soft")) : null,
      problems.length ? h("div", {}, h("h3", { class: "sec-title" }, "التكرار والأخطاء والمراجعة"), problemsTable(problems.slice(0, 100)),
        problems.length > 100 ? sub(`تُعرض أول 100 من ${problems.length}. الباقي في تقرير الأخطاء.`) : null,
        btn("تحميل تقرير الأخطاء", () => csv("تقرير-استيراد-المعلمين.csv", [["السطر", "المعلم", "الرقم الوظيفي", "الحالة", "التفاصيل"],
          ...problems.map((r) => [r.row, r.name, r.employee_no || "", r.status === "error" ? "خطأ" : "مراجعة", [...r.errors, ...r.notes].join(" — ")])]), "ghost sm")) : null,
      h("div", { class: "row spaced" }, btn("رجوع", stepMap, "ghost"), btn("إعادة الفحص", stepAnalyze, "ghost"),
        btn("التالي: معاينة البيانات", () => stepPreview(a))));
    const next = body.querySelector(".row.spaced .btn:last-child");
    if (!s.valid || a.capacity.exceeded) next.disabled = true;
  }

  /* 4) معاينة وتأكيد */
  function stepPreview(a) {
    const s = a.summary, good = a.rows.filter((r) => r.status === "ok"), total = s.create + s.update;
    set(steps(4), h("h3", { class: "sec-title" }, "معاينة البيانات"),
      h("p", {}, `سيتم إضافة ${s.create} معلمًا، وتحديث ${s.update}${s.unchanged ? `، وترك ${s.unchanged} بلا تغيير` : ""}${s.review + s.errors ? `، وتجاوز ${s.review + s.errors} سطرًا` : ""}.`),
      h("div", { class: "scroll" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, ["", "الرقم الوظيفي", "الاسم", "اسم المستخدم", "التخصص", "الإسناد"].map((x) => h("th", {}, x)))),
        h("tbody", {}, good.slice(0, 10).map((r) => h("tr", {},
          h("td", {}, r.action === "update" ? badge("تحديث", "amber") : r.action === "unchanged" ? badge("كما هو", "gray") : badge("جديد")),
          ...[r.preview.employee_no, r.preview.name, r.preview.username, r.preview.specialty, r.preview.load].map((v) => h("td", {}, v || "—"))))))),
      good.length > 10 ? sub(`عينة من أول 10 من ${good.length} سطرًا صحيحًا.`) : null,
      s.create ? notice(`ستُنشأ ${s.create} حسابات بكلمات مرور مؤقتة تظهر لك مرة واحدة بعد التأكيد. حمّلها فورًا.`, "warn") : null,
      notice("لن يُنشأ أو يُعدَّل أي معلم قبل الضغط على زر التأكيد.", ""),
      h("div", { class: "row spaced" }, btn("رجوع", () => stepAnalyze(), "ghost"),
        btn(`تأكيد استيراد ${total} معلمًا`, async () => {
          if (!total) return toast("لا يوجد ما يُستورد", true);
          try { stepResult(await api(`${A}/import/teachers/commit`, payload())); onDone?.(); } catch (e) { toast(e.message, true); }
        })));
  }

  /* 5) النتيجة */
  function stepResult(r) {
    const saveCreds = () => csv("بيانات-دخول-المعلمين.csv", [["المعلم", "رمز المدرسة", "اسم المستخدم", "كلمة المرور المؤقتة"], ...r.credentials.map((c) => [c.name, c.school, c.username, c.password])]);
    set(steps(5), h("h2", { class: "wiz-done" }, "تم الاستيراد بنجاح"),
      h("ul", { class: "res-list" },
        h("li", {}, `تمت إضافة ${r.created} معلمًا`), h("li", {}, `تم تحديث ${r.updated}`),
        r.unchanged ? h("li", {}, `${r.unchanged} بلا تغيير`) : null,
        r.review ? h("li", {}, `يوجد ${r.review} سجلات تحتاج مراجعة`) : null, h("li", {}, `تم تجاوز ${r.skipped} سجلات`)),
      r.credentials.length ? notice("كلمات المرور المؤقتة أعلاه تظهر الآن فقط ولا يمكن استرجاعها لاحقًا. حمّل الملف وسلّمه لكل معلم بأمان، وسيُطلب منهم تغييرها عند أول دخول.", "warn") : null,
      h("div", { class: "row spaced" },
        r.credentials.length ? btn("تحميل بيانات الدخول", saveCreds, "") : null,
        r.problems.length ? btn("تحميل تقرير الأخطاء", () => csv("تقرير-استيراد-المعلمين.csv", [["السطر", "المعلم", "الرقم الوظيفي", "الحالة", "التفاصيل"],
          ...r.problems.map((p) => [p.row, p.name, p.employee_no || "", p.status === "error" ? "خطأ" : "مراجعة", p.message])]), "ghost") : null,
        btn("إغلاق", () => d.close(), "ghost")));
  }

  stepFile();
  d = dialog("استيراد المعلمين", body);
  d.classList.add("dialog-lg");
  return d;
}
