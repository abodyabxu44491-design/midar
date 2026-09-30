// مساعد إدخال البيانات: ما ينقص المدرسة وكيف يكتمل بأقل جهد.
//   الاكتمال: نسبة وقائمة بنود بالأرقام الحقيقية، وكل بند يفتح المكان الذي يُكمله.
//   إضافة طلاب: لصق قائمة أسماء (من واتساب أو Word أو Excel) ← معاينة قابلة للتعديل ← إضافة للشعبة.
//   إكمال البيانات: جدول واحد للجوالات وأسماء أولياء الأمور وتواريخ الميلاد، ويُحفظ ما تغيّر فقط.
//   إضافة معلمين: لصق أسماء وجوالات، وتُنشأ حساباتهم بكلمات مرور مؤقتة تُسلَّم مرة واحدة.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, notice, sub, toast, badge } from "../../shared/js/ui.js";
import { csv, arCount, NOUNS } from "../../shared/js/format.js";
import { icons } from "../../shared/js/icons.js";
import { runJob } from "../../shared/js/job.js";
import { parseList } from "../../shared/js/paste-parse.js";
import { A, loadClasses, optional } from "./common.js";

const PARTS = [["check", "اكتمال البيانات"], ["students", "إضافة طلاب بالنسخ"], ["fill", "إكمال الناقص"], ["teachers", "إضافة معلمين"]];
const LEVEL = { ok: ["مكتمل", ""], warn: ["ناقص", "amber"], todo: ["مطلوب", "red"], info: ["اختياري", "gray"] };
const FIELDS = [["any", "كل الناقص"], ["phone", "بلا جوال"], ["guardian", "بلا اسم ولي أمر"], ["birth", "بلا تاريخ ميلاد"], ["all", "كل طلاب الشعبة"]];
let state = { part: "check", classId: "", missing: "any" };

// على الجوال يصير كل سطر بطاقة: كل خانة تحمل عنوان عمودها (data-label) فلا يلزم تمرير أفقي
function cardTable(headers, rows) {
  return h("div", { class: "scroll" }, h("table", { class: "grid as-grid" },
    h("thead", {}, h("tr", {}, headers.map((x) => h("th", {}, x)))),
    h("tbody", {}, rows.map(({ cls, cells }) => h("tr", { class: cls || "" },
      cells.map((c, i) => h("td", { "data-label": headers[i] || "" }, c)))))));
}

export default async function assistant({ goTo }) {
  const [classes, tpl] = await Promise.all([loadClasses(), optional(api(`${A}/messaging/templates`), null)]);
  const dial = String(tpl?.country_code || "967");
  const homeCountry = dial === "966" ? "SA" : dial === "967" ? "YE" : null;
  const chips = h("div", { class: "xb-chips", role: "tablist" });
  const box = h("div");
  const show = async (part = state.part, extra = {}) => {
    Object.assign(state, { part }, extra);
    mount(chips, PARTS.map(([k, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(k === part),
      class: `xb-chip${k === part ? " on" : ""}`, onclick: () => show(k) }, label)));
    mount(box, empty("جارٍ التحميل…"));
    try { mount(box, await VIEWS[part]()); } catch (e) { mount(box, notice(e.message, "err")); }
    window.scrollTo?.({ top: 0 });
  };
  const classSelect = (value, { all = false } = {}) => select([["", all ? "كل الشعب" : "اختر الشعبة"], ...classes.map((c) => [c.id, c.name])], { value });

  /* ---------- الاكتمال ---------- */
  async function checkView() {
    const d = await api(`${A}/assistant/checklist`);
    const groups = [...new Set(d.items.map((x) => x.group))];
    const open = (a) => (a.part ? show(a.part, a.field ? { missing: a.field, classId: "" } : {}) : goTo?.(a.tab));
    return [
      h("section", { class: "panel as-score" },
        h("div", { class: "as-score-top" },
          h("div", {}, h("h2", {}, "اكتمال بيانات المدرسة"),
            sub(d.score >= 100 ? "كل البيانات الأساسية مكتملة." : "أكمل البنود الناقصة لتعمل الرسائل والتقارير والجدول كما يجب.")),
          h("b", { class: "as-pct" }, `${d.score}%`)),
        h("div", { class: "bar job-bar" }, h("i", { style: `width:${d.score}%` }))),
      groups.map((g) => panel(g, null, d.items.filter((x) => x.group === g).map((x) => {
        const [label, cls] = LEVEL[x.level];
        const pct = x.total ? Math.round((100 * x.done) / x.total) : null;
        return h("div", { class: `as-item lvl-${x.level}` },
          h("span", { class: "as-icon", "aria-hidden": "true" }, x.level === "ok" ? icons.check({ size: 16 }) : x.level === "info" ? icons.plus({ size: 16 }) : icons.alert({ size: 16 })),
          h("div", { class: "as-text" },
            h("b", {}, x.title, " ", badge(label, cls)),
            x.hint ? sub(x.hint) : null,
            pct !== null && x.level !== "ok" ? h("div", { class: "bar as-mini" }, h("i", { style: `width:${pct}%` })) : null),
          x.level !== "ok" ? btn("أكمل", () => open(x.action), "soft sm") : null);
      }))),
    ];
  }

  /* ---------- إضافة طلاب بلصق قائمة ---------- */
  async function studentsView() {
    const cls = classSelect(state.classId);
    const text = textarea({ rows: 8, placeholder: "الصق الأسماء هنا، كل طالب في سطر. مثال:\n1- محمد علي أحمد العريقي 777123456\n2- أحمد صالح ناجي الشميري ٧٣٣٤٥٦٧٨٩" });
    const out = h("div");
    const read = async () => {
      if (!cls.value) return toast("اختر الشعبة أولًا", true);
      if (!text.value.trim()) return toast("الصق قائمة الأسماء", true);
      state.classId = cls.value;
      const existing = (await api(`${A}/assistant/students?class_id=${cls.value}&missing=all`)).map((s) => s.name);
      const rows = parseList(text.value, { dial, existing }).map((r) => ({ ...r, on: !r.duplicate && !r.exists }));
      if (!rows.length) return mount(out, notice("لم نجد أسماء في النص. اكتب كل طالب في سطر.", "warn"));
      drawPreview(rows);
    };
    const drawPreview = (rows) => {
      const count = () => rows.filter((r) => r.on).length;
      const addBtn = btn("", async () => {
        const list = rows.filter((r) => r.on && r.name.trim());
        if (!list.length) return toast("لا يوجد طلاب محددون", true);
        const r = await api(`${A}/students/import`, { students: list.map((x) => ({
          name: x.name.trim(), class_id: Number(state.classId), guardian_name: x.guardian_name?.trim() || null, guardian_phone: x.phone || null })) });
        const n = Array.isArray(r) ? r.length : list.length;
        text.value = "";
        mount(out, notice(`تمت إضافة ${arCount(n, NOUNS.student)} إلى ${classes.find((c) => String(c.id) === String(state.classId))?.name || "الشعبة"}. الصق قائمة شعبة أخرى أو أكمل بياناتهم من «إكمال الناقص».`, ""));
        toast(`تمت إضافة ${arCount(n, NOUNS.student)}`);
      });
      const label = () => { addBtn.textContent = count() ? `إضافة ${arCount(count(), NOUNS.student)} إلى الشعبة` : "لا يوجد طلاب محددون"; addBtn.disabled = !count(); };
      const warn = rows.filter((r) => r.warnings.length || r.duplicate || r.exists).length;
      mount(out,
        h("p", {}, `وجدنا ${arCount(rows.length, NOUNS.name)}`, warn ? ` — ${arCount(warn, NOUNS.line)} تحتاج نظرة (مظللة)` : "", ". عدّل ما تريد قبل الإضافة؛ اسم ولي الأمر مقترح من اسم الطالب."),
        cardTable(["إضافة", "اسم الطالب", "ولي الأمر", "جوال ولي الأمر", "ملاحظة"], rows.map((r) => {
          const on = input({ type: "checkbox", checked: r.on, "aria-label": "إضافة" });
          on.addEventListener("change", () => { r.on = on.checked; label(); });
          const name = input({ value: r.name }); name.addEventListener("input", () => { r.name = name.value; });
          const g = input({ value: r.guardian_name || "", placeholder: "—" }); g.addEventListener("input", () => { r.guardian_name = g.value; });
          const p = input({ class: "ltr", inputMode: "tel", value: r.phone || "", placeholder: "77xxxxxxx" }); p.addEventListener("input", () => { r.phone = p.value.trim(); });
          const notes = [...(r.exists ? ["موجود في الشعبة"] : []), ...(r.duplicate ? ["مكرر في القائمة"] : []), ...r.warnings];
          // رقم من دولة أخرى (مغترب في السعودية مثلًا): يُعرض للتنبيه فقط، والرسائل تصله على دولته تلقائيًا
          const abroad = r.phone_country && r.phone_country !== homeCountry ? badge(`جوال ${r.phone_label}`, "gray") : null;
          return { cls: notes.length ? "as-flag" : "", cells: [on, name, g, p,
            [...(notes.length ? notes.map((n) => badge(n, r.exists || r.duplicate ? "red" : "amber")) : [badge("جاهز")]), abroad]] };
        })),
        h("div", { class: "row spaced" }, btn("قراءة من جديد", read, "ghost"), addBtn));
      label();
    };
    return panel("إضافة طلاب بلصق قائمة", null,
      sub("انسخ أسماء الشعبة من أي مكان (رسالة واتساب، ملف Word، عمود في Excel) والصقها هنا. نفهم الترقيم والأرقام العربية ورقم الجوال في أي مكان من السطر."),
      field("الشعبة", cls), field("القائمة", text),
      btn("قراءة القائمة", read), out);
  }

  /* ---------- إكمال الناقص في جدول ---------- */
  async function fillView() {
    const cls = classSelect(state.classId, { all: true });
    const which = select(FIELDS, { value: state.missing });
    cls.addEventListener("change", () => show("fill", { classId: cls.value }));
    which.addEventListener("change", () => show("fill", { missing: which.value }));
    if (state.missing === "all" && !state.classId) state.missing = "any";
    which.value = state.missing;
    const rows = await api(`${A}/assistant/students?${new URLSearchParams({ missing: state.missing, ...(state.classId ? { class_id: state.classId } : {}) })}`);
    const changed = new Map();
    const saveBtn = btn("حفظ التغييرات", async () => {
      if (!changed.size) return toast("لا توجد تعديلات", true);
      const r = await api(`${A}/assistant/students/fill`, { rows: [...changed.values()] });
      toast(`حُفظت بيانات ${arCount(r.updated, NOUNS.student)}${r.conflicts.length ? `، و${arCount(r.conflicts.length, NOUNS.student)} عدّل بياناتهم شخص آخر فلم تُحفظ (حدّث الصفحة)` : ""}`, Boolean(r.conflicts.length));
      show("fill");
    });
    const paint = () => { saveBtn.textContent = changed.size ? `حفظ التغييرات (${changed.size})` : "حفظ التغييرات"; saveBtn.disabled = !changed.size; };
    // Enter ينقل للخانة نفسها في السطر التالي: إدخال عمود كامل بسرعة
    const COLS = ["guardian_name", "guardian_phone", "birth_date", "student_no"];
    const cells = [];
    const table = rows.length ? cardTable(["الطالب", "اسم ولي الأمر", "جوال ولي الأمر", "تاريخ الميلاد", "رقم الطالب"], rows.map((s, ri) => {
      const mk = (col, props) => {
        const el = input({ value: s[col] || "", ...props });
        el.addEventListener("input", () => {
          const cur = changed.get(s.id) || { id: s.id, version: s.version };
          cur[col] = el.value.trim();
          changed.set(s.id, cur); el.closest("tr").classList.add("as-changed"); paint();
        });
        el.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          cells[ri + 1]?.[COLS.indexOf(col)]?.focus();
        });
        return el;
      };
      const row = [mk("guardian_name", { placeholder: "—" }), mk("guardian_phone", { class: "ltr", inputMode: "tel", placeholder: "77xxxxxxx" }),
        mk("birth_date", { type: "date", class: "ltr" }), mk("student_no", { class: "ltr", inputMode: "numeric", placeholder: "—" })];
      cells.push(row);
      return { cells: [h("div", {}, h("b", {}, s.name), state.classId ? null : sub(s.class_name || "بلا شعبة")), ...row] };
    })) : empty(state.missing === "all" ? "لا يوجد طلاب في هذه الشعبة." : "لا يوجد طلاب ناقصة بياناتهم هنا.");
    paint();
    return panel("إكمال البيانات الناقصة", null,
      sub("اكتب في الجدول مباشرة، واضغط Enter للانتقال للطالب التالي في العمود نفسه. يُحفظ ما عدّلته فقط."),
      h("div", { class: "row" }, field("الشعبة", cls), field("اعرض", which)),
      rows.length >= 500 ? notice("يُعرض أول 500 طالب. اختر شعبة لعرض البقية.", "warn") : null,
      table,
      rows.length ? h("div", { class: "as-save" }, saveBtn) : null);
  }

  /* ---------- إضافة معلمين ---------- */
  async function teachersView() {
    const text = textarea({ rows: 7, placeholder: "كل معلم في سطر: الاسم ثم الجوال ثم التخصص (اختياري). مثال:\nعبدالله محمد الشميري 777123456 رياضيات\nأحمد علي العريقي، ٧٣٣٤٥٦٧٨٩، لغة عربية" });
    const out = h("div");
    const read = () => {
      const rows = parseList(text.value, { dial }).map((r) => ({
        name: r.name, phone: r.phone, on: !r.duplicate,
        // الخانة الثانية تخصص (لا ولي أمر)، وإن لم توجد خانات فما بعد الاسم الثلاثي يبقى في الاسم
        specialty: r.guardian_suggested ? null : [r.guardian_name, r.extra].filter(Boolean).join(" ") || null,
        notes: [...(r.duplicate ? ["مكرر"] : []), ...r.warnings.filter((w) => !/ثلاثي/.test(w))],
      }));
      if (!rows.length) return mount(out, notice("لم نجد أسماء في النص.", "warn"));
      const addLabel = () => `إنشاء ${arCount(rows.filter((r) => r.on).length, NOUNS.account)}`;
      const addBtn = btn(addLabel(), async () => {
        const list = rows.filter((r) => r.on && r.name.trim());
        if (!list.length) return toast("لا يوجد معلمون محددون", true);
        const { summary, secret } = await runJob(`${A}/assistant/teachers`, { teachers: list.map((r) => ({ name: r.name.trim(), phone: r.phone || null, specialty: r.specialty || null })) },
          { title: `إضافة ${arCount(list.length, NOUNS.teacher)}`, jobsBase: `${A}/jobs` });
        const creds = secret?.credentials || [];
        const save = () => csv("بيانات-دخول-المعلمين.csv", [["المعلم", "رمز المدرسة", "اسم المستخدم", "كلمة المرور المؤقتة"], ...creds.map((c) => [c.name, c.school, c.username, c.password])]);
        text.value = "";
        mount(out,
          notice(`أُنشئ ${arCount(summary.created, NOUNS.account)}. كلمات المرور المؤقتة تظهر الآن فقط: حمّلها وسلّم كل معلم بياناته، ويغيّرها عند أول دخول. تجدها أيضًا في ملف كل معلم حتى يغيّرها.`, "warn"),
          creds.length ? h("div", { class: "scroll" }, h("table", { class: "grid" },
            h("thead", {}, h("tr", {}, ["المعلم", "اسم المستخدم", "كلمة المرور المؤقتة"].map((x) => h("th", {}, x)))),
            h("tbody", {}, creds.map((c) => h("tr", {}, h("td", {}, c.name), h("td", { class: "ltr" }, c.username), h("td", { class: "ltr" }, h("code", {}, c.password))))))) : null,
          h("div", { class: "row" }, creds.length ? btn("تحميل الملف", save) : null, btn("إسناد المواد للمعلمين", () => goTo?.("distribution"), "soft")));
      });
      mount(out,
        cardTable(["إضافة", "اسم المعلم", "الجوال", "التخصص", "ملاحظة"], rows.map((r) => {
          const on = input({ type: "checkbox", checked: r.on, "aria-label": "إضافة" });
          on.addEventListener("change", () => { r.on = on.checked; addBtn.textContent = addLabel(); });
          const name = input({ value: r.name }); name.addEventListener("input", () => { r.name = name.value; });
          const p = input({ class: "ltr", inputMode: "tel", value: r.phone || "" }); p.addEventListener("input", () => { r.phone = p.value.trim(); });
          const sp = input({ value: r.specialty || "", placeholder: "—" }); sp.addEventListener("input", () => { r.specialty = sp.value.trim(); });
          return { cls: r.notes.length ? "as-flag" : "", cells: [on, name, p, sp, r.notes.length ? r.notes.map((n) => badge(n, "amber")) : badge("جاهز")] };
        })),
        sub("يُنشأ لكل معلم اسم مستخدم تلقائي (t1001، t1002…) وكلمة مرور مؤقتة."),
        h("div", { class: "row spaced" }, btn("قراءة من جديد", read, "ghost"), addBtn));
    };
    return panel("إضافة معلمين بلصق قائمة", null,
      sub("الصق أسماء المعلمين وجوالاتهم، ونُنشئ حساباتهم دفعة واحدة. بعدها أسند لهم المواد من «توزيع المعلمين»."),
      field("القائمة", text), btn("قراءة القائمة", () => (text.value.trim() ? read() : toast("الصق قائمة الأسماء", true))), out);
  }

  const VIEWS = { check: checkView, students: studentsView, fill: fillView, teachers: teachersView };
  show(state.part);
  return [
    h("div", { class: "sub-banner" }, icons.wand({ size: 22 }),
      h("div", {}, h("b", {}, "مساعد إدخال البيانات"), sub("يبيّن ما ينقص مدرستك، ويختصر إدخال الطلاب والمعلمين بالنسخ واللصق."))),
    chips, box,
  ];
}
