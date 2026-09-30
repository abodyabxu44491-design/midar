// تبويب الطلاب: صفحة رئيسية بسيطة (إحصائيات + بحث + قائمة بطاقات). كل العمليات التفصيلية تُفتح في نوافذ.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { field, input, select, btn, empty, badge, line, sub, keyText, toast, dialog,
  showCredentials, confirmAction, notice, brandLogo, skeleton, stats as statCards, switchBtn } from "../../shared/js/ui.js";
import { csv } from "../../shared/js/format.js";
import { waButton, messageVars } from "../../shared/js/whatsapp.js";
import { A, loadClasses, directoryLink, optional, rememberField } from "./common.js";
import { openStudentImport } from "./student-import.js";
import { studentFile } from "../../shared/js/student-file.js";
import { gradePicker } from "./grade-picker.js";

const PAGE = 60;
let importedSince = null;   // «عرض الطلاب المستوردين»: يبقى بعد إعادة رسم التبويب

const GENDER = { male: "ذكر", female: "أنثى" };
const photoUrl = (s) => `${A}/students/${s.id}/photo?v=${s.version || 0}`;
const initial = (name) => [...(name || "؟")][0];
const avatar = (s, big = false) => (s.has_photo
  ? h("img", { class: `s-photo${big ? " lg" : ""}`, src: photoUrl(s), alt: "", loading: "lazy" })
  : h("span", { class: `s-photo ph${big ? " lg" : ""}`, "aria-hidden": "true" }, initial(s.name)));

// نافذة كبيرة مناسبة للجوال (تملأ الشاشة) ولسطح المكتب
const bigDialog = (title, body, actions) => { const d = dialog(title, body, actions); d.classList.add("dialog-lg"); return d; };

export default async function students({ me, refresh }) {
  const [classes, summary, inactiveSummary, templates, setup, st, academic] = await Promise.all([
    loadClasses(), api(`${A}/students?summary=1`), api(`${A}/students?summary=1&status=inactive`),
    optional(api(`${A}/messaging/templates`), null), api(`${A}/setup`), api(`${A}/students?stats=1`),
    optional(api(`${A}/academic`), null)]);
  const structure = { ...setup.structure, year_name: academic?.current?.year_name || "" };
  const sectionsOn = structure.sections_enabled;
  const perClass = new Map(summary.map((r) => [Number(r.class_id), r.n]));
  const countIn = (ids) => ids.reduce((a, id) => a + (perClass.get(Number(id)) || 0), 0);

  // خريطة الفصل ← المرحلة/الصف/الشعبة (تُعرض في البطاقات بلا استعلام إضافي)
  const info = new Map();
  for (const stg of structure.stages) for (const g of stg.grades) for (const c of g.sections) {
    const short = c.name.replace(g.name, "").replace(/^[\s\-–—]+/, "").trim();
    info.set(Number(c.id), { stage: stg.name, grade: g.name, section: sectionsOn && g.sections.length > 1 ? (short || c.name) : "" });
  }
  const afterChange = () => { refresh(); };

  /* ---------- الإحصائيات ---------- */
  const byStage = structure.stages.map((s) => [s, countIn(s.grades.flatMap((g) => g.sections.map((c) => c.id)))]);
  const byGrade = structure.stages.flatMap((s) => s.grades.map((g) => [g, countIn(g.sections.map((c) => c.id))]));
  const chips = (items, kind) => h("div", { class: "chips" }, items.filter(([, n]) => n > 0).map(([o, n]) =>
    h("button", { type: "button", class: "stat-chip", onclick: () => {
      if (kind === "stage") picker.set({ stageId: String(o.id) });
      else picker.set({ stageId: String(structure.stages.find((x) => x.grades.includes(o)).id), gradeId: String(o.id) });
    } }, o.name, h("b", {}, n))));

  const statsBox = h("div", {},
    statCards([["إجمالي الطلاب", st.total], ["الطلاب النشطون", st.active], ["الطلاب الجدد", st.new_30d, "آخر 30 يومًا"]]),
    byStage.some(([, n]) => n) ? h("details", { class: "more-stats" }, h("summary", {}, "حسب المرحلة والصف"),
      h("div", { class: "sub" }, "حسب المرحلة"), chips(byStage, "stage"),
      h("div", { class: "sub" }, "حسب الصف"), chips(byGrade, "grade")) : null);

  /* ---------- البحث والفلاتر ---------- */
  const q = rememberField("students-q", input({ placeholder: "ابحث عن طالب بالاسم أو رقم الطالب…", type: "search", "aria-label": "بحث" }));
  const picker = gradePicker(structure, { sectionsOn, onChange: () => load() });
  const statusSel = select([["active", "نشط"], ["graduated", "متخرج"], ["transferred", "منقول"], ["withdrawn", "منسحب"], ["all", "كل الحالات"]]);
  const feeFilter = rememberField("students-fees", select([["", "كل الحالات المالية"], ["unpaid", "عليه رسوم متبقية"], ["paid", "مسدد"], ["off", "الرسوم موقوفة"]]), { event: "change" });
  for (const el of [statusSel, feeFilter]) el.addEventListener("change", () => load());
  // مسح الفلاتر: يعيد كل شيء لقيمه الافتراضية (نشط، بدون بحث، بدون صف/مالية)
  const setVal = (el, v, ev) => { el.value = v; el.dispatchEvent(new Event(ev)); };
  const filters = filterReset([
    { active: () => Boolean(picker.stageId), reset: () => picker.clear() },
    { active: () => statusSel.value !== "active", reset: () => setVal(statusSel, "active", "change") },
    { active: () => Boolean(feeFilter.value), reset: () => setVal(feeFilter, "", "change") },
    { active: () => Boolean(q.value.trim()), reset: () => setVal(q, "", "input") },
  ], () => load());

  /* ---------- القائمة ---------- */
  let list = [], total = 0, seq = 0, loadingMore = false, selectMode = false;
  const selected = new Set();
  const box = h("div", { class: "s-list" });
  const count = h("span", { class: "sub" });
  const sentinel = h("div", { class: "load-more" });
  const bulkBar = h("div");
  const sinceBar = h("div");

  const query = (offset) => {
    const p = new URLSearchParams({ limit: PAGE, offset });
    const term = q.value.trim();
    if (term) p.set("q", term);
    if (statusSel.value === "active" || statusSel.value === "all") p.set("status", statusSel.value); else p.set("st", statusSel.value);
    if (picker.stageId || picker.classId) p.set("class_ids", picker.classIds().join(",") || "0");
    if (feeFilter.value) p.set("fees", feeFilter.value);
    if (importedSince) p.set("since", importedSince);
    return `${A}/students?${p}`;
  };
  const fetchPage = async (offset) => {
    const res = await fetch(query(offset), { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "تعذر تحميل الطلاب");
    return { rows: await res.json(), total: Number(res.headers.get("X-Total-Count") || 0) };
  };
  const observer = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "400px" });
  async function loadMore() {
    if (loadingMore || list.length >= total) return;
    loadingMore = true; const my = seq;
    try {
      const r = await fetchPage(list.length);
      if (my !== seq) return;
      list = list.concat(r.rows);
      sentinel.before(...r.rows.map(card));
      count.textContent = `${list.length} من ${total}`;
      if (list.length >= total) sentinel.remove();
    } finally { loadingMore = false; }
  }
  async function load() {
    const my = ++seq;
    filters.update();
    mount(box, skeleton(6));
    mount(sinceBar, importedSince ? notice("تعرض القائمة الطلاب المضافين أو المحدَّثين في آخر استيراد.", "") : null,
      importedSince ? btn("إظهار كل الطلاب", () => { importedSince = null; load(); }, "ghost sm") : null);
    let r;
    try { r = await fetchPage(0); } catch (e) { if (my === seq) mount(box, notice(e.message, "err")); return; }
    if (my !== seq) return;
    list = r.rows; total = r.total;
    count.textContent = `${list.length} من ${total}`;
    mount(box, list.length ? [...list.map(card), list.length < total ? sentinel : null] : empty("لا يوجد طالب مطابق."));
    if (list.length < total) observer.observe(sentinel);
    drawBulk();
  }

  // بطاقة الطالب: صورة، الاسم، رقم الطالب، المرحلة، الصف، الشعبة، الحالة. الضغط يفتح ملفه.
  function card(s) {
    const loc = info.get(Number(s.class_id));
    const pick = input({ type: "checkbox", "aria-label": `تحديد ${s.name}`, "data-id": s.id });
    pick.checked = selected.has(s.id);
    pick.addEventListener("click", (e) => e.stopPropagation());
    pick.addEventListener("change", () => { if (pick.checked) selected.add(s.id); else selected.delete(s.id); drawBulk(); });
    const open = () => openFile(s);
    const el = h("div", { class: "s-card", role: "button", tabindex: "0", onclick: open,
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } },
      selectMode ? h("span", { class: "s-pick" }, pick) : null,
      avatar(s),
      h("div", { class: "s-main" },
        h("b", { class: "s-title" }, s.name),
        h("span", { class: "sub" }, s.student_no ? `رقم الطالب: ${s.student_no}` : "بدون رقم طالب"),
        h("span", { class: "s-meta" }, [loc?.stage, loc?.grade, loc?.section ? `شعبة ${loc.section}` : null].filter(Boolean).join(" • ") || (s.class_name || "بدون فصل"))),
      s.status !== "active" ? statusBadge(s.status) : badge("نشط"));
    return el;
  }

  function drawBulk() {
    if (!selectMode || !selected.size) return mount(bulkBar, selectMode ? sub("اضغط على البطاقات لتحديدها.") : null);
    const chosen = () => [...selected];
    mount(bulkBar, h("div", { class: "bulk-bar" },
      h("b", {}, `${selected.size} محدد`),
      btn("نقل لشعبة", () => moveDialog(chosen(), classes, afterChange), "sm"),
      btn("تفعيل الرسوم", () => runBulk({ ids: chosen(), action: "fees", fees_enabled: true }, afterChange), "soft sm"),
      btn("إيقاف الرسوم", () => runBulk({ ids: chosen(), action: "fees", fees_enabled: false }, afterChange), "soft sm"),
      btn("تغيير الحالة", () => statusBulkDialog(chosen(), afterChange), "danger sm"),
      btn("تصدير المحدد", () => exportStudents(list.filter((x) => selected.has(x.id)), info), "ghost sm")));
  }
  const toggleSelect = () => { selectMode = !selectMode; selected.clear(); load(); };

  /* ---------- ملف الطالب (نفس ما يراه ولي الأمر، بلا رمز) ---------- */
  async function openFile(s) {
    const holder = h("div", {}, skeleton(4));
    const d = bigDialog("ملف الطالب", holder);
    try {
      const data = await api(`${A}/students/${s.id}/profile`);
      const cur = { ...s, ...data.student, name: data.student.name };
      const toolbar = h("div", { class: "file-actions" },
        btn("تعديل", () => { d.close(); studentForm({ student: s, classes, structure, sectionsOn, onSaved: afterChange }); }, "sm"),
        btn("بطاقة ولي الأمر", () => card2(me, s), "ghost sm"),
        templates && waButton({ phone: s.guardian_phone, template: templates.general, countryCode: templates.country_code,
          vars: messageVars({ student: s, school: me.school.name, fees: s.fees, link: directoryLink(me) }), label: "واتساب" }),
        h("span", { class: "fees-switch" }, h("span", { class: "sub" }, "الرسوم"),
          switchBtn(s.fees_enabled, `الرسوم للطالب ${s.name}`, async () => {
            try { const r = await api(`${A}/students/${s.id}`, { version: s.version, fees_enabled: !s.fees_enabled }, "PATCH");
              s.version = r.version; s.fees_enabled = !s.fees_enabled; d.close(); afterChange(); return true; }
            catch (e) { toast(e.message, true); return false; }
          })),
        btn("معرّف جديد", async () => {
          if (!confirmAction("المعرّف القديم سيتوقف فورًا. متابعة؟")) return;
          const r = await api(`${A}/students/${s.id}/regenerate-key`, {});
          d.close(); showCredentials("المعرّف الجديد", { access_key: r.access_key }); afterChange();
        }, "ghost sm"),
        btn("تغيير الحالة", () => { d.close(); statusDialog(s, afterChange); }, "danger sm"),
        btn("طباعة", () => window.print(), "ghost sm"));
      const file = studentFile(data, { toolbar, photo: s.has_photo ? photoUrl(s) : null });
      mount(holder, file.el);
      void cur;
    } catch (e) { mount(holder, notice(e.message, "err")); }
  }

  /* ---------- الأزرار العلوية ---------- */
  // تصدير: خيار واحد يفتح ما يريده المستخدم — كل البيانات أو المعرّفات فقط (بدل زرّين متفرقين)
  const exportMenu = () => {
    const d = dialog("تصدير الطلاب", h("div", { class: "more-list" },
      btn("كل بيانات الطلاب (CSV)", async () => { d.close(); const all = await api(`${A}/students`); exportStudents(all, info); }),
      btn("معرّفات الطلاب فقط (CSV)", async () => { d.close();
        const all = await api(`${A}/students`);
        csv("معرفات_الطلاب.csv", [["الطالب", "الفصل", "ولي الأمر", "الجوال", "المعرّف"], ...all.map((s) => [s.name, s.class_name, s.guardian_name, s.guardian_phone, s.access_key])]);
      }, "ghost")));
  };
  // المزيد: فقط لما فيه فعلًا إجراءات ثانوية غير مكرّرة مع بقية الأزرار
  const moreMenu = () => {
    const d = dialog("المزيد", h("div", { class: "more-list" },
      btn(selectMode ? "إنهاء التحديد المتعدد" : "تحديد متعدد (نقل، رسوم، حالة)", () => { d.close(); toggleSelect(); }, "ghost"),
      btn("عرض الطلاب خارج القيد", () => { d.close(); statusSel.value = "all"; load(); }, "ghost")));
  };
  const actions = h("div", { class: "s-actions-top" },
    btn("+ إضافة طالب", () => studentForm({ classes, structure, sectionsOn, onSaved: afterChange })),
    btn("استيراد الطلاب", () => openStudentImport({ structure, onDone: (r) => { if (r?.since) importedSince = r.since; afterChange(); } }), "soft"),
    btn("تصدير", exportMenu, "ghost"),
    btn("المزيد ⋮", moreMenu, "ghost"));

  const inactive = inactiveSummary.reduce((a, r) => a + r.n, 0);
  load();
  let timer;
  q.addEventListener("input", () => { filters.update(); clearTimeout(timer); timer = setTimeout(load, 300); });

  return [
    h("div", { class: "panel s-head" },
      h("div", { class: "section-head" }, h("h2", {}, "الطلاب"),
        sub(me.school.max_students >= 100000 ? `${st.active} طالبًا` : `${st.active} من ${me.school.max_students}`)),
      statsBox, actions),
    h("div", { class: "panel" },
      h("div", { class: "search-row" }, q),
      h("div", { class: "filters" }, picker.el, statusSel, feeFilter), filters.el,
      inactive ? sub(`${inactive} طالبًا خارج القيد — اختر الحالة من الفلتر لعرضهم.`) : null,
      sinceBar, h("div", { class: "toolbar" }, count), bulkBar, box),
  ];
}

/* ---------- نافذة إضافة/تعديل طالب: أقسام مرتبة ومتجاوبة ---------- */
async function resizePhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("اختر صورة JPG أو PNG أو WebP");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

function studentForm({ student = null, classes, structure, sectionsOn, onSaved }) {
  const s = student, editing = Boolean(s);
  const f = {
    name: input({ value: s?.name || "" }), no: input({ class: "ltr", value: s?.student_no || "", placeholder: "اختياري — يُستخدم للتحديث عبر الاستيراد" }),
    birth: input({ type: "date", value: s?.birth_date ? String(s.birth_date).slice(0, 10) : "" }),
    gender: select([["", "—"], ["male", "ذكر"], ["female", "أنثى"]], { value: s?.gender || "" }),
    status: select(Object.entries(STATUS_LABEL), { value: s?.status || "active" }),
    stage: select([["", "اختر المرحلة"], ...structure.stages.map((x) => [x.id, x.name])]),
    grade: select([["", "اختر الصف"]]), section: select([["", "اختر الشعبة"]]),
    sphone: input({ class: "ltr", inputMode: "tel", value: s?.student_phone || "" }),
    gname: input({ value: s?.guardian_name || "", placeholder: "يُملأ تلقائيًا من اسم الطالب" }),
    gphone: input({ class: "ltr", inputMode: "tel", value: s?.guardian_phone || "" }),
    fees: input({ type: "checkbox" }),
  };
  f.fees.checked = Boolean(s?.fees_enabled);
  let photoData = null, photoRemoved = false;
  const preview = h("div", { class: "photo-prev" });
  const drawPhoto = () => mount(preview,
    photoData ? h("img", { class: "s-photo lg", src: photoData, alt: "" })
      : s?.has_photo && !photoRemoved ? h("img", { class: "s-photo lg", src: photoUrl(s), alt: "" })
      : h("span", { class: "s-photo lg ph" }, initial(f.name.value || s?.name)));
  const file = input({ type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
  file.addEventListener("change", async () => {
    try { photoData = await resizePhoto(file.files[0]); photoRemoved = false; drawPhoto(); } catch (e) { toast(e.message, true); }
  });
  drawPhoto();

  // الشعبة: مرحلة ← صف ← شعبة، وتُملأ من فصل الطالب عند التعديل
  const gradesOf = () => structure.stages.find((x) => String(x.id) === f.stage.value)?.grades || [];
  const fillG = () => mount(f.grade, h("option", { value: "" }, "اختر الصف"), gradesOf().map((g) => h("option", { value: g.id }, g.name)));
  const fillS = () => { const g = gradesOf().find((x) => String(x.id) === f.grade.value);
    mount(f.section, h("option", { value: "" }, sectionsOn ? "اختر الشعبة" : "—"), (g?.sections || []).map((c) => h("option", { value: c.id }, c.name)));
    if (g && (!sectionsOn || g.sections.length === 1)) f.section.value = String(g.sections[0]?.id || ""); };
  f.stage.addEventListener("change", () => { fillG(); fillS(); });
  f.grade.addEventListener("change", fillS);
  if (s?.class_id) for (const stg of structure.stages) for (const g of stg.grades) if (g.sections.some((c) => Number(c.id) === Number(s.class_id))) {
    f.stage.value = String(stg.id); fillG(); f.grade.value = String(g.id); fillS(); f.section.value = String(s.class_id);
  }
  else {
    const last = localStorage.getItem("midar_last_class");
    if (!editing && last) for (const stg of structure.stages) for (const g of stg.grades) if (g.sections.some((c) => String(c.id) === last)) {
      f.stage.value = String(stg.id); fillG(); f.grade.value = String(g.id); fillS(); f.section.value = last; }
  }

  let touched = editing && Boolean(s.guardian_name);
  f.gname.addEventListener("input", () => { touched = f.gname.value.trim().length > 0; });
  f.name.addEventListener("input", () => {
    if (!touched) { const p = f.name.value.trim().split(/\s+/).filter(Boolean); f.gname.value = p.length >= 3 ? p.slice(1).join(" ") : ""; }
    if (!photoData && !(s?.has_photo && !photoRemoved)) drawPhoto();
  });
  const hint = h("div");
  f.gphone.addEventListener("blur", async () => {
    const raw = f.gphone.value.trim(); if (!raw) return mount(hint);
    try {
      const r = await api(`${A}/students/guardian?phone=${encodeURIComponent(raw)}`);
      if (r.phone) f.gphone.value = r.phone;
      if (r.guardian_name && !touched) f.gname.value = r.guardian_name;
      const others = r.siblings.filter((x) => !s || x.id !== s.id);
      mount(hint, others.length ? notice(`ولي الأمر مسجل مسبقًا: ${r.guardian_name || "—"} — إخوة: ${others.map((x) => x.name).join("، ")}`, "") : null);
    } catch { mount(hint); }
  });

  // الحقول الإضافية التي عرّفتها المدرسة
  const extra = h("div"), custom = { fields: [], inputs: new Map() };
  Promise.all([api(`${A}/custom-fields?entity=student`), editing ? api(`${A}/custom-fields/values/student/${s.id}`) : {}]).then(([fields, values]) => {
    custom.fields = fields.filter((x) => x.is_active && x.show_admin);
    if (!custom.fields.length) return;
    mount(extra, h("h3", { class: "sec-title" }, "معلومات إضافية"), h("div", { class: "form-grid" }, custom.fields.map((x) => {
      const el = x.type === "select" ? select([["", "—"], ...x.options.map((o) => [o, o])], { value: values[x.key] ?? "" })
        : x.type === "boolean" ? select([["", "—"], ["نعم", "نعم"], ["لا", "لا"]], { value: values[x.key] ?? "" })
        : input({ type: x.type === "number" ? "number" : x.type === "date" ? "date" : "text", value: values[x.key] ?? "" });
      custom.inputs.set(x.key, el);
      return field(`${x.label}${x.required ? " *" : ""}`, el);
    })));
  }).catch(() => {});

  const grid = (...k) => h("div", { class: "form-grid" }, ...k);
  const body = h("div", { class: "student-form" },
    h("h3", { class: "sec-title first" }, "المعلومات الأساسية"),
    h("div", { class: "photo-row" }, preview, h("div", {},
      btn(s?.has_photo || photoData ? "تغيير الصورة" : "إضافة صورة", () => file.click(), "ghost sm"), file,
      (s?.has_photo && !photoRemoved) || photoData ? btn("حذف الصورة", () => { photoData = null; photoRemoved = true; drawPhoto(); }, "ghost sm") : null)),
    grid(field("الاسم الكامل *", f.name), field("رقم الطالب", f.no), field("تاريخ الميلاد", f.birth), field("الجنس", f.gender),
      editing ? field("الحالة", f.status) : null),
    h("h3", { class: "sec-title" }, "المعلومات الأكاديمية"),
    grid(field("المرحلة", f.stage), field("الصف", f.grade), sectionsOn ? field("الشعبة", f.section) : null,
      field("السنة الدراسية", input({ value: structure.year_name || "غير محددة", disabled: true }))),
    h("h3", { class: "sec-title" }, "معلومات التواصل"),
    grid(field("جوال الطالب (إن وجد)", f.sphone), field("اسم ولي الأمر", f.gname), field("جوال ولي الأمر", f.gphone)),
    hint,
    h("label", { class: "f pill" }, f.fees, "تفعيل الرسوم لهذا الطالب"),
    extra);

  const d = bigDialog(editing ? `تعديل: ${s.name}` : "إضافة طالب", body, [btn(editing ? "حفظ التعديلات" : "حفظ الطالب", async () => {
    if (!f.name.value.trim()) return toast("اسم الطالب مطلوب", true);
    const classId = f.section.value || null;
    const common = { name: f.name.value, class_id: classId, guardian_name: f.gname.value, guardian_phone: f.gphone.value,
      student_no: f.no.value.trim(), birth_date: f.birth.value, gender: f.gender.value, student_phone: f.sphone.value };
    let id, result;
    if (editing) {
      const r = await api(`${A}/students/${s.id}`, { version: s.version, ...common }, "PATCH");
      id = s.id; s.version = r.version;
    } else {
      result = await api(`${A}/students`, { ...common, fees_enabled: f.fees.checked });
      id = result.id ?? result[0]?.id;
      localStorage.setItem("midar_last_class", classId || "");
    }
    if (editing && f.status.value !== s.status) await api(`${A}/students/${s.id}/status`, { status: f.status.value, note: s.status_note || null });
    if (custom.fields.length) await api(`${A}/custom-fields/values/student/${id}`, {
      values: Object.fromEntries([...custom.inputs.entries()].map(([k, el]) => [k, el.value || null])) }, "PUT");
    try {
      if (photoData) await api(`${A}/students/${id}/photo`, { data_url: photoData }, "PUT");
      else if (photoRemoved && s?.has_photo) await api(`${A}/students/${id}/photo`, null, "DELETE");
    } catch (e) { toast(`تم الحفظ لكن تعذر رفع الصورة: ${e.message}`, true); }
    d.close();
    if (editing) toast("تم الحفظ");
    else showCredentials(`تمت إضافة ${result.name || f.name.value}`, { access_key: result.access_key }, `ولي الأمر: ${result.guardian_name || "—"} — سلّم المعرّف له.`);
    onSaved();
  })]);
  return d;
}

function card2(me, s) {
  dialog("بطاقة ولي الأمر", h("div", {},
    h("div", { class: "print-only" }, brandLogo("print-logo", false)),
    h("p", {}, `الطالب: ${s.name}`), h("p", {}, `المدرسة: ${me.school.name}`),
    line(h("span", {}, "رابط الصفحة"), keyText(directoryLink(me))),
    line(h("span", {}, "رمز الصفحة"), keyText(me.school.directory_code)),
    line(h("span", {}, "معرّف الطالب"), keyText(s.access_key)),
    notice("افتح الرابط، أدخل رمز الصفحة، ثم اسم ابنك ومعرّفه. لا تشارك المعرّف.", "warn")),
  [btn("طباعة", () => window.print())]);
}

function exportStudents(rows, info) {
  csv("الطلاب.csv", [
    ["رقم الطالب", "الاسم", "تاريخ الميلاد", "الجنس", "المرحلة", "الصف", "الشعبة", "ولي الأمر", "جوال ولي الأمر", "جوال الطالب", "المعرّف", "الرسوم", "الحالة"],
    ...rows.map((s) => { const l = info.get(Number(s.class_id)) || {};
      return [s.student_no || "", s.name, s.birth_date ? String(s.birth_date).slice(0, 10) : "", GENDER[s.gender] || "", l.stage || "", l.grade || "", l.section || "",
        s.guardian_name || "", s.guardian_phone || "", s.student_phone || "", s.access_key, s.fees_enabled ? "مفعّلة" : "موقوفة", STATUS_LABEL[s.status] || s.status]; }),
  ]);
}

export const STATUS_LABEL = {
  active: "على رأس القيد", graduated: "متخرج", transferred: "منقول لمدرسة أخرى", withdrawn: "منسحب",
};
const STATUS_TONE = { active: "", graduated: "", transferred: "gray", withdrawn: "red" };
export const statusBadge = (status) => badge(STATUS_LABEL[status] || status, STATUS_TONE[status] ?? "gray");

// تغيير حالة الطالب: تخرّج، نقل لمدرسة أخرى، انسحاب، أو إعادة للقيد
function statusDialog(s, refresh) {
  const status = select(Object.entries(STATUS_LABEL), { value: s.status || "active" });
  const note = input({ placeholder: "السبب أو الملاحظة (اختياري)", value: s.status_note || "" });
  const d = dialog(`حالة الطالب: ${s.name}`, h("div", {},
    sub("خارج القيد: لا يظهر في القوائم ولا يُفتح ملفه، وتبقى سجلاته."),
    field("الحالة", status), field("ملاحظة", note)),
  [btn("حفظ الحالة", async () => {
    await api(`${A}/students/${s.id}/status`, { status: status.value, note: note.value || null });
    d.close(); toast("تم تحديث الحالة"); refresh();
  })]);
}

/* ---------- الإجراءات الجماعية ---------- */
async function runBulk(body, refresh) {
  const r = await api(`${A}/students/bulk`, body);
  toast(`تم على ${r.done} طالبًا`);
  refresh();
}

function moveDialog(ids, classes, refresh) {
  const cls = select(classOptions(classes, "بدون شعبة"));
  const d = dialog(`نقل ${ids.length} طالبًا`, h("div", {},
    sub("ينتقل الطلاب المحددون إلى الشعبة المختارة."), field("الشعبة", cls)),
  [btn("نقل", async () => {
    await runBulk({ ids, action: "move_class", class_id: cls.value || null }, refresh);
    d.close();
  })]);
}

function statusBulkDialog(ids, refresh) {
  const status = select(Object.entries(STATUS_LABEL));
  const note = input({ placeholder: "ملاحظة (اختياري)" });
  const d = dialog(`تغيير حالة ${ids.length} طالبًا`, h("div", {},
    sub("الطالب خارج القيد يختفي من القوائم وتبقى سجلاته."),
    field("الحالة", status), field("ملاحظة", note)),
  [btn("حفظ", async () => {
    await runBulk({ ids, action: "status", status: status.value, note: note.value || null }, refresh);
    d.close();
  }, "danger")]);
}

