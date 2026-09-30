// تبويب المعلمين: صفحة رئيسية بسيطة (إحصائيات + بحث + بطاقات). التفاصيل في نوافذ: إضافة، وملف المعلم الكامل.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { field, input, select, btn, empty, badge, line, sub, toast, dialog, notice, showCredentials, confirmAction, skeleton,
  stats as statCards } from "../../shared/js/ui.js";
import { fmtDate, fmtDateTime, csv, EXAM } from "../../shared/js/format.js";
import { timetableGrid } from "../../shared/js/timetable.js";
import { A, loadClasses, loadSubjects, staffLink, rememberField } from "./common.js";
import { openTeacherImport } from "./teacher-import.js";
import { gradePicker } from "./grade-picker.js";

const GENDER = { male: "ذكر", female: "أنثى" };
const EMPLOYMENT = { full_time: "دوام كامل", part_time: "دوام جزئي", contract: "عقد", volunteer: "تطوع" };
const STATE_TONE = { inactive: "red", locked: "red", not_activated: "amber", initial: "amber", password_changed: "", username_changed: "", credentials_changed: "" };
const STATE_LABEL = { inactive: "الحساب غير فعال", locked: "الحساب مقفل مؤقتًا", not_activated: "حساب لم يتم تفعيله",
  initial: "بيانات الدخول الأولية ما زالت مستخدمة", password_changed: "تم تغيير كلمة المرور",
  username_changed: "تم تغيير اسم المستخدم", credentials_changed: "تم تغيير بيانات الدخول" };

const photoUrl = (t) => `${A}/teachers/${t.id}/photo?v=${encodeURIComponent(t.updated_at || 0)}`;
const initial = (name) => [...(name || "؟")][0];
const avatar = (t, big = false) => (t.has_photo
  ? h("img", { class: `s-photo${big ? " lg" : ""}`, src: photoUrl(t), alt: "", loading: "lazy" })
  : h("span", { class: `s-photo ph${big ? " lg" : ""}`, "aria-hidden": "true" }, initial(t.name)));
const bigDialog = (title, body, actions) => { const d = dialog(title, body, actions); d.classList.add("dialog-lg"); return d; };
const uniq = (list, key) => [...new Set(list.map((t) => (t[key] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
const kv = (label, value, cls = "") => line(h("span", { class: "sub" }, label), h("b", { class: cls }, value || "—"));

// تصغير صورة المعلم في المتصفح (الكاميرا أو الملفات) قبل الرفع
async function resizePhoto(file) {
  if (!/^image\//.test(file.type)) throw new Error("اختر صورة");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

export default async function teachers({ me, refresh }) {
  const [classes, subjects, list, setup] = await Promise.all([loadClasses(), loadSubjects(), api(`${A}/teachers`), api(`${A}/setup`)]);
  const structure = setup.structure, sectionsOn = structure.sections_enabled;
  // الفصل ← المرحلة/الصف/الشعبة من الهيكل الأكاديمي المركزي (لا أسماء صفوف مكتوبة هنا)
  const info = new Map();
  for (const stg of structure.stages) for (const g of stg.grades) for (const c of g.sections) info.set(Number(c.id), { stage: stg, grade: g, cls: c });
  const placesOf = (t) => {
    const places = t.load.map((l) => info.get(Number(l.class_id))).filter(Boolean);
    const names = (arr) => [...new Set(arr)];
    return { stages: names(places.map((p) => p.stage.name)), grades: names(places.map((p) => p.grade.name)),
      sections: sectionsOn ? names(places.filter((p) => p.grade.sections.length > 1).map((p) => p.cls.name)) : [] };
  };
  const active = list.filter((t) => t.is_active).length;
  const unassigned = list.filter((t) => !t.load.length).length;
  const pending = list.filter((t) => ["not_activated", "initial"].includes(t.account_state) && t.is_active).length;

  /* ---------- البحث والفلاتر (في المتصفح: عدد المعلمين صغير) ---------- */
  const q = rememberField("teachers-q", input({ placeholder: "ابحث بالاسم أو الرقم الوظيفي أو اسم المستخدم أو الهوية أو البريد أو الجوال…", type: "search", "aria-label": "بحث" }));
  const picker = gradePicker(structure, { sectionsOn, onChange: () => draw() });
  const subjectSel = select([["", "كل المواد"], ...subjects.map((s) => [s.id, s.name])]);
  const specialty = select([["", "كل التخصصات"], ...uniq(list, "specialty").map((x) => [x, x])]);
  const status = select([["active", "نشط"], ["inactive", "موقوف"], ["pending", "لم يفعّل حسابه"], ["all", "كل الحالات"]]);
  const box = h("div", { class: "s-list" });
  const count = h("span", { class: "sub" });

  const norm = (v) => String(v || "").toLowerCase();
  const classIdsFilter = () => (picker.stageId || picker.classId) ? new Set(picker.classIds()) : null;
  const matches = (t, ids) => {
    const term = norm(q.value.trim());
    if (term && ![t.name, t.username, t.employee_no, t.national_id, t.email, t.phone, t.specialty].some((v) => norm(v).includes(term))) return false;
    if (status.value === "active" && !t.is_active) return false;
    if (status.value === "inactive" && t.is_active) return false;
    if (status.value === "pending" && !(t.is_active && ["not_activated", "initial"].includes(t.account_state))) return false;
    if (specialty.value && (t.specialty || "").trim() !== specialty.value) return false;
    if (subjectSel.value && !t.load.some((l) => String(l.subject_id) === subjectSel.value)) return false;
    if (ids && !t.load.some((l) => ids.has(Number(l.class_id)))) return false;
    return true;
  };

  const card = (t) => {
    const pl = placesOf(t);
    const subs = [...new Set(t.load.map((l) => l.subject_name))];
    const open = () => openFile(t);
    return h("div", { class: "s-card", role: "button", tabindex: "0", onclick: open,
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } },
      avatar(t),
      h("div", { class: "s-main" },
        h("b", { class: "s-title" }, t.name),
        h("span", { class: "sub" }, [t.employee_no ? `رقم وظيفي: ${t.employee_no}` : null, `@${t.username}`].filter(Boolean).join(" • ")),
        h("span", { class: "sub" }, [t.specialty, subs.length ? subs.join("، ") : "بدون مواد"].filter(Boolean).join(" • ")),
        h("span", { class: "s-meta" }, [pl.stages.join("، "), pl.grades.length ? `الصفوف: ${pl.grades.join("، ")}` : null,
          pl.sections.length ? `الشعب: ${pl.sections.length}` : null].filter(Boolean).join(" • ") || "بدون إسناد"),
        h("span", { class: "sub" }, t.last_login_at ? `آخر دخول: ${fmtDateTime(t.last_login_at)}` : "لم يدخل بعد")),
      t.is_active ? (["not_activated", "initial"].includes(t.account_state) ? badge("لم يفعّل", "amber") : badge("نشط")) : badge("موقوف", "red"));
  };
  const draw = () => {
    const ids = classIdsFilter();
    const rows = list.filter((t) => matches(t, ids));
    count.textContent = `${rows.length} من ${list.length}`;
    mount(box, rows.length ? rows.map(card) : empty(list.length ? "لا يوجد معلم مطابق." : "لا يوجد معلمون بعد. ابدأ بإضافة معلم."));
  };
  q.addEventListener("input", draw);
  for (const el of [subjectSel, specialty, status]) el.addEventListener("change", draw);
  draw();

  /* ---------- ملف المعلم الكامل ---------- */
  async function openFile(t0) {
    const body = h("div", { class: "teacher-file" }, skeleton(4));
    const d = bigDialog("ملف المعلم", body);
    let data;
    try { data = await api(`${A}/teachers/${t0.id}/file`); } catch (e) { return mount(body, notice(e.message, "err")); }
    const t = data.teacher, acc = data.account;
    const cur = { ...t };
    const done = (msg) => { d.close(); toast(msg); refresh(); };
    const base = () => ({ name: cur.name, phone: cur.phone || null, employee_no: cur.employee_no || null, national_id: cur.national_id || "",
      email: cur.email || "", specialty: cur.specialty || null, department: cur.department || null,
      short_name: cur.short_name || null, gender: cur.gender || "", birth_date: cur.birth_date ? String(cur.birth_date).slice(0, 10) : "",
      job_title: cur.job_title || null, qualification: cur.qualification || null, hire_date: cur.hire_date ? String(cur.hire_date).slice(0, 10) : "",
      employment_type: cur.employment_type || "", address: cur.address || null, emergency_name: cur.emergency_name || null, emergency_phone: cur.emergency_phone || null });
    const save = async (changes) => { if (changes.name !== undefined && !String(changes.name).trim()) throw new Error("اسم المعلم مطلوب");
      await api(`${A}/teachers/${t.id}`, { ...base(), ...changes }, "PATCH"); done("حُفظ الملف"); };

    const tabs = [["overview", "نظرة عامة"], ["data", "البيانات"], ["load", "المواد والصفوف"], ["timetable", "الجدول"],
      ["work", "الاختبارات والواجبات"], ["account", "حساب الدخول"], ["activity", "سجل النشاط"]];
    const nav = h("div", { class: "chips tabs-scroll" });
    const pane = h("div");
    const views = {};
    const show = (key) => { pane.dataset.tab = key; nav.querySelectorAll(".tab-chip").forEach((s) => s.classList.toggle("on", s.dataset.k === key)); mount(pane, views[key]()); };
    mount(nav, tabs.map(([k, label]) => h("span", { "data-k": k, class: "tab-chip", role: "button", tabindex: "0", onclick: () => show(k),
      onkeydown: (e) => { if (e.key === "Enter") show(k); } }, label)));

    const subjectNames = [...new Set(data.load.map((l) => l.subject_name))];
    const pl = placesOf({ load: data.load });

    // بطاقة بيانات الدخول: اسم المستخدم دائمًا، وكلمة المرور المؤقتة ما دام المعلم لم يغيّرها
    let revealed = null;   // تُجلب مرة واحدة عند أول «إظهار» (كل عرض يُسجَّل في سجل النشاط)
    const resetPw = async (tab) => {
      if (!confirmAction(`إنشاء كلمة مرور مؤقتة جديدة لـ ${t.name}؟ ستنتهي جلساته الحالية ويُطلب منه تغييرها عند أول دخول.`)) return;
      try {
        const r = await api(`${A}/teachers/${t.id}/reset-password`, {});
        // تبقى ظاهرة في الملف حتى يغيّرها المعلم
        Object.assign(acc, { initial_password_active: true, initial_password_available: true, state: acc.last_login_at ? "initial" : "not_activated" });
        revealed = r.credentials?.password ?? null;
        show(tab); refresh(); toast("أُنشئت كلمة مرور مؤقتة جديدة");
      } catch (e) { toast(e.message, true); }
    };
    const credCard = () => {
      if (!acc) return notice("لا يوجد حساب دخول لهذا المعلم.", "warn");
      const pwBox = h("div", { class: "cred-pw" });
      const drawPw = () => {
        if (acc.initial_password_available) {
          mount(pwBox, h("code", { class: "ltr cred-val" }, revealed ?? "••••••••••"),
            h("div", { class: "row", style: "flex:none;gap:6px" },
              btn(revealed ? "إخفاء" : "إظهار", async () => {
                if (revealed) { revealed = null; return drawPw(); }
                try { revealed = (await api(`${A}/teachers/${t.id}/initial-credentials`, {})).password; drawPw(); } catch (e) { toast(e.message, true); }
              }, "ghost sm"),
              btn("نسخ", async (ev) => {
                try {
                  revealed ??= (await api(`${A}/teachers/${t.id}/initial-credentials`, {})).password;
                  await navigator.clipboard.writeText(revealed); drawPw(); toast("نُسخت كلمة المرور");
                } catch (e) { toast(e.message, true); }
              }, "ghost sm")));
        } else {
          mount(pwBox, h("span", { class: "sub" }, acc.initial_password_active
            ? "الكلمة المؤقتة الحالية أُنشئت قبل حفظ بيانات الدخول، فلا يمكن عرضها."
            : "غيّرها المعلم، وكلمة المرور الحالية لا تظهر لأحد."),
            btn("كلمة مؤقتة جديدة", () => resetPw(pane.dataset.tab || "overview"), "soft sm"));
        }
      };
      drawPw();
      const copyUser = btn("نسخ", async () => { await navigator.clipboard.writeText(acc.username); toast("نُسخ اسم المستخدم"); }, "ghost sm");
      return h("div", { class: "cred-card" },
        h("div", { class: "cred-head" }, h("b", {}, "بيانات الدخول"), badge(STATE_LABEL[acc.state], STATE_TONE[acc.state])),
        h("div", { class: "cred-row" }, h("span", { class: "sub" }, "اسم المستخدم"), h("div", { class: "cred-line" }, h("code", { class: "ltr cred-val" }, acc.username), copyUser)),
        h("div", { class: "cred-row" }, h("span", { class: "sub" }, "كلمة المرور"), pwBox),
        h("div", { class: "cred-row" }, h("span", { class: "sub" }, "رابط الدخول"), h("a", { class: "ltr small", href: staffLink(me), target: "_blank", rel: "noopener" }, staffLink(me))),
        acc.initial_password_available ? sub("تبقى ظاهرة هنا حتى يغيّرها المعلم عند أول دخول، ثم تختفي تلقائيًا.") : null);
    };

    const infoBlock = (title, rows) => h("div", { class: "info-block" }, h("h4", {}, title), rows.filter((r) => r[1]).length
      ? rows.filter((r) => r[1]).map(([k, v, cls]) => kv(k, v, cls)) : h("p", { class: "sub" }, "لا توجد بيانات بعد."));
    views.overview = () => h("div", {},
      h("div", { class: "kpis-row" },
        h("div", { class: "kpi" }, h("b", {}, data.summary.subjects), "مواد"), h("div", { class: "kpi" }, h("b", {}, data.summary.classes), "فصول"),
        h("div", { class: "kpi" }, h("b", {}, data.summary.periods_per_week), "حصص أسبوعيًا"), h("div", { class: "kpi" }, h("b", {}, data.summary.homework), "واجبات")),
      credCard(),
      h("div", { class: "info-grid" },
        infoBlock("التدريس", [["المواد", subjectNames.join("، ")], ["المراحل", pl.stages.join("، ")], ["الصفوف", pl.grades.join("، ")],
          sectionsOn ? ["الشعب", pl.sections.join("، ")] : [null, null]]),
        infoBlock("الوظيفة", [["الرقم الوظيفي", t.employee_no, "ltr"], ["المسمى الوظيفي", t.job_title], ["التخصص", t.specialty],
          ["المؤهل", t.qualification], ["القسم", t.department], ["نوع التوظيف", EMPLOYMENT[t.employment_type]], ["تاريخ التعيين", t.hire_date ? fmtDate(t.hire_date) : null]]),
        infoBlock("التواصل", [["الجوال", t.phone, "ltr"], ["البريد", t.email, "ltr"], ["العنوان", t.address],
          ["الطوارئ", [t.emergency_name, t.emergency_phone].filter(Boolean).join(" — ")]]),
        infoBlock("شخصي", [["الجنس", GENDER[t.gender]], ["تاريخ الميلاد", t.birth_date ? fmtDate(t.birth_date) : null], ["رقم الهوية", t.national_id, "ltr"],
          ["آخر دخول", acc?.last_login_at ? fmtDateTime(acc.last_login_at) : acc ? "لم يدخل بعد" : null]])),
      h("div", { class: "row spaced", style: "justify-content:flex-start" }, btn("تعديل البيانات", () => show("data"), "soft sm")));

    const dateVal = (v) => (v ? String(v).slice(0, 10) : "");
    // البيانات: شخصية وتواصل ووظيفية في نموذج واحد وحفظ واحد
    views.data = () => {
      const F = {
        name: input({ value: t.name }), short_name: input({ value: t.short_name || "" }),
        gender: select([["", "—"], ["male", "ذكر"], ["female", "أنثى"]], { value: t.gender || "" }),
        birth_date: input({ type: "date", value: dateVal(t.birth_date) }),
        national_id: input({ class: "ltr", inputMode: "numeric", value: t.national_id || "" }),
        phone: input({ class: "ltr", inputMode: "tel", value: t.phone || "" }),
        email: input({ class: "ltr", type: "email", value: t.email || "" }), address: input({ value: t.address || "" }),
        emergency_name: input({ value: t.emergency_name || "" }), emergency_phone: input({ class: "ltr", inputMode: "tel", value: t.emergency_phone || "" }),
        employee_no: input({ class: "ltr", value: t.employee_no || "" }), job_title: input({ value: t.job_title || "" }),
        specialty: input({ value: t.specialty || "" }), qualification: input({ value: t.qualification || "" }),
        department: input({ value: t.department || "" }), hire_date: input({ type: "date", value: dateVal(t.hire_date) }),
        employment_type: select([["", "—"], ...Object.entries(EMPLOYMENT)], { value: t.employment_type || "" }),
      };
      const grid = (...k) => h("div", { class: "form-grid" }, ...k);
      return h("div", { class: "student-form" },
        h("h3", { class: "sec-title first" }, "البيانات الشخصية"),
        grid(field("الاسم الكامل *", F.name), field("الاسم المختصر", F.short_name), field("الجنس", F.gender), field("تاريخ الميلاد", F.birth_date), field("رقم الهوية", F.national_id)),
        h("h3", { class: "sec-title" }, "التواصل"),
        grid(field("الجوال", F.phone), field("البريد الإلكتروني", F.email), field("العنوان", F.address), field("جهة اتصال الطوارئ", F.emergency_name), field("جوال الطوارئ", F.emergency_phone)),
        h("h3", { class: "sec-title" }, "البيانات الوظيفية"),
        grid(field("الرقم الوظيفي", F.employee_no), field("المسمى الوظيفي", F.job_title), field("التخصص", F.specialty), field("المؤهل", F.qualification),
          field("القسم", F.department), field("تاريخ التعيين", F.hire_date), field("نوع التوظيف", F.employment_type)),
        sub("المرحلة والصفوف والمواد من تبويب «المواد والصفوف»."),
        h("div", { class: "row spaced" }, btn("حفظ البيانات", async () => {
          try { await save(Object.fromEntries(Object.entries(F).map(([k, el]) => [k, el.value]))); } catch (e) { toast(e.message, true); }
        })));
    };

    views.load = () => {
      const picker = loadPicker(classes, subjects, data.load);
      return h("div", {}, sub("الفصول والمواد من الهيكل الأكاديمي المركزي. تغيير اسم صف أو مادة ينعكس هنا تلقائيًا، ولا يتكرر الإسناد نفسه."),
        picker.el,
        h("div", { class: "row spaced" }, btn("حفظ الإسناد", async () => {
          await api(`${A}/teachers/${t.id}`, { load: picker.value() }, "PATCH"); done("حُفظ الإسناد"); })));
    };

    views.timetable = () => (data.timetable.length
      ? h("div", {}, sub(`${data.timetable.length} حصة أسبوعيًا`),
        timetableGrid(data.timetable, { cell: (day, p, s) => (s
          ? [h("b", { class: "small" }, s.subject_name), h("div", { class: "small muted" }, s.class_name), s.room ? h("div", { class: "small muted" }, s.room) : null]
          : h("span", { class: "muted" }, "—")) }))
      : empty("لا توجد حصص في الجدول لهذا المعلم بعد."));

    const examsView = () => (data.exams.length
      ? h("div", {}, sub("اختبارات فصوله ومواده المسندة"), data.exams.map((e) => line(
        h("div", {}, h("b", {}, e.title), " ", badge(EXAM[e.status]?.[0] || e.status, EXAM[e.status]?.[1] || "gray"),
          sub(`${e.subject_name} — ${e.class_name}${e.exam_date ? ` — ${fmtDate(e.exam_date)}` : ""}`)),
        h("div", { class: "sub" }, `${e.scored} درجة${e.avg_percent !== null ? ` — متوسط ${e.avg_percent}%` : ""}`))))
      : empty("لا توجد اختبارات لفصوله ومواده بعد."));

    const homeworkView = () => (data.homework.length
      ? h("div", {}, data.homework.map((w) => line(h("div", {}, h("b", {}, w.title),
        sub(`${w.subject_name} — ${w.class_name}${w.due_date ? ` — التسليم ${fmtDate(w.due_date)}` : ""}`)))))
      : empty("لم يضف هذا المعلم واجبات بعد."));

    views.work = () => h("div", {}, h("h3", { class: "sec-title first" }, "الاختبارات والدرجات"), examsView(),
      h("h3", { class: "sec-title" }, "الواجبات"), homeworkView());

    views.activity = () => (data.activity.length
      ? h("div", {}, data.activity.map((a) => line(h("div", {}, h("b", {}, a.text),
        sub(`${fmtDateTime(a.at)} — بواسطة ${a.actor}`),
        a.changes?.length ? sub(a.changes.map((c) => `${c.field}: ${c.from ?? "—"} ← ${c.to ?? "—"}`).join(" | ")) : null))))
      : empty("لا يوجد نشاط مسجّل."));

    views.account = () => {
      if (!acc) return empty("لا يوجد حساب دخول لهذا المعلم.");
      return h("div", {},
        credCard(),
        kv("آخر دخول", acc.last_login_at ? fmtDateTime(acc.last_login_at) : "لم يدخل بعد"),
        kv("تاريخ إنشاء الحساب", fmtDateTime(acc.created_at)),
        acc.password_changed_at && !acc.initial_password_active ? kv("آخر تغيير لكلمة المرور", fmtDateTime(acc.password_changed_at)) : null,
        acc.username_changed_at ? kv("آخر تغيير لاسم المستخدم", fmtDateTime(acc.username_changed_at)) : null,
        acc.locked_until ? kv("مقفل حتى", fmtDateTime(acc.locked_until)) : null,
        h("h3", { class: "sec-title" }, "إجراءات الحساب"),
        h("div", { class: "row", style: "justify-content:flex-start" },
          btn("كلمة مرور مؤقتة جديدة", () => resetPw("account"), "ghost sm"),
          btn("تغيير اسم المستخدم", () => {
            const u = input({ class: "ltr", value: acc.username });
            const dd = dialog("تغيير اسم المستخدم", h("div", {}, field("اسم المستخدم الجديد", u), sub("تنتهي جلسات المعلم الحالية، ويسجَّل التغيير في سجل النشاط.")),
              [btn("حفظ", async () => { try { await api(`${A}/teachers/${t.id}/username`, { username: u.value.trim().toLowerCase() }, "PATCH"); dd.close(); done("تغيّر اسم المستخدم"); } catch (e) { toast(e.message, true); } })]);
          }, "ghost sm"),
          btn(acc.is_active ? "إيقاف الحساب" : "تفعيل الحساب", async () => {
            if (acc.is_active && !confirmAction(`إيقاف حساب ${t.name}؟ لن يستطيع الدخول حتى تعيد تفعيله.`)) return;
            await api(`${A}/teachers/${t.id}/active`, { active: !acc.is_active }, "PATCH"); done(acc.is_active ? "أُوقف الحساب" : "فُعّل الحساب");
          }, acc.is_active ? "danger sm" : "soft sm")));
    };

    // رأس الملف والصورة
    let photoBox = h("div");
    const drawPhoto = (src) => mount(photoBox, src ? h("img", { class: "s-photo lg", src, alt: "" }) : avatar({ ...t, has_photo: false }, true));
    drawPhoto(t.has_photo ? photoUrl({ id: t.id, updated_at: t.updated_at }) : null);
    const file = input({ type: "file", accept: "image/*", hidden: true });
    file.addEventListener("change", async () => {
      try { const url = await resizePhoto(file.files[0]); await api(`${A}/teachers/${t.id}/photo`, { data_url: url }, "PUT"); drawPhoto(url); refresh(); toast("حُفظت الصورة"); }
      catch (e) { toast(e.message, true); }
    });
    mount(body,
      h("div", { class: "file-hero" }, photoBox,
        h("div", { class: "file-hero-text" }, h("h2", {}, t.name),
          h("p", {}, [t.job_title, t.specialty, subjectNames.slice(0, 3).join("، ")].filter(Boolean).join(" · ") || "بدون تخصص"),
          h("div", { class: "file-hero-tags" },
            acc ? badge(STATE_LABEL[acc.state], STATE_TONE[acc.state]) : badge("بدون حساب", "gray"),
            t.phone ? h("a", { class: "btn ghost sm", href: `tel:${t.phone}` }, "اتصال") : null),
          h("div", { class: "row", style: "justify-content:flex-start;gap:6px;margin-top:6px" }, btn(t.has_photo ? "تغيير الصورة" : "إضافة صورة", () => file.click(), "ghost sm"), file,
            t.has_photo ? btn("حذف الصورة", async () => { await api(`${A}/teachers/${t.id}/photo`, null, "DELETE"); drawPhoto(null); refresh(); }, "ghost sm") : null))),
      nav, pane);
    show("overview");
  }

  /* ---------- نافذة إضافة معلم ---------- */
  function addDialog() {
    const f = {
      name: input(), short_name: input(), gender: select([["", "—"], ["male", "ذكر"], ["female", "أنثى"]]), birth_date: input({ type: "date" }),
      user: input({ class: "ltr", placeholder: "حروف إنجليزية صغيرة وأرقام" }),
      phone: input({ class: "ltr", inputMode: "tel" }), email: input({ class: "ltr", type: "email" }), address: input(),
      emergency_name: input(), emergency_phone: input({ class: "ltr", inputMode: "tel" }),
      employee_no: input({ class: "ltr" }), national_id: input({ class: "ltr", inputMode: "numeric" }),
      job_title: input(), qualification: input(), hire_date: input({ type: "date" }),
      employment_type: select([["", "—"], ...Object.entries(EMPLOYMENT)]),
      specialty: input({ placeholder: "مثل: رياضيات" }), department: input(),
    };
    let photoData = null;
    const preview = h("div", { class: "photo-prev" }, h("span", { class: "s-photo lg ph" }, "؟"));
    const file = input({ type: "file", accept: "image/*", hidden: true });
    file.addEventListener("change", async () => {
      try { photoData = await resizePhoto(file.files[0]); mount(preview, h("img", { class: "s-photo lg", src: photoData, alt: "" })); } catch (e) { toast(e.message, true); }
    });
    const picker = loadPicker(classes, subjects);
    const hint = h("div");
    f.specialty.addEventListener("input", () => {
      const term = f.specialty.value.trim();
      if (term.length < 3) return mount(hint);
      const matched = subjects.filter((s2) => s2.name.includes(term) || term.includes(s2.name));
      if (!matched.length) return mount(hint);
      mount(hint, notice(`مواد مقترحة لتخصص «${term}»: ${matched.map((m) => m.name).join("، ")}`, ""),
        h("div", { class: "row spaced" },
          btn("ربطه بها في كل الفصول", () => { picker.setSubjects(matched.map((m) => m.id)); toast("أُضيفت المواد المقترحة — عدّل الفصول كما تريد"); }, "soft sm"),
          btn("تخطي", () => mount(hint), "ghost sm")));
    });
    const grid = (...k) => h("div", { class: "form-grid" }, ...k);
    const d = bigDialog("إضافة معلم", h("div", { class: "student-form" },
      h("h3", { class: "sec-title first" }, "البيانات الأساسية"),
      h("div", { class: "photo-row" }, preview, h("div", {}, btn("إضافة صورة", () => file.click(), "ghost sm"), file)),
      grid(field("الاسم الكامل *", f.name), field("الاسم المختصر", f.short_name), field("الجنس", f.gender), field("تاريخ الميلاد", f.birth_date),
        field("رقم الهوية", f.national_id)),
      h("h3", { class: "sec-title" }, "بيانات التواصل"),
      grid(field("رقم الجوال", f.phone), field("البريد الإلكتروني", f.email), field("العنوان", f.address),
        field("جهة اتصال الطوارئ", f.emergency_name), field("جوال الطوارئ", f.emergency_phone)),
      h("h3", { class: "sec-title" }, "البيانات الوظيفية"),
      grid(field("الرقم الوظيفي", f.employee_no), field("المسمى الوظيفي", f.job_title), field("التخصص", f.specialty), field("المؤهل", f.qualification),
        field("القسم", f.department), field("تاريخ التعيين", f.hire_date), field("نوع التوظيف", f.employment_type)),
      hint,
      h("h3", { class: "sec-title" }, "حساب الدخول"),
      grid(field("اسم المستخدم *", f.user)),
      sub("يُنشأ الحساب تلقائيًا بكلمة مرور مؤقتة تظهر لك الآن فقط، ويُطلب من المعلم تغييرها عند أول دخول."),
      h("h3", { class: "sec-title" }, "المواد والصفوف (اختياري)"),
      sub("من الهيكل الأكاديمي المركزي — يمكن تعديلها لاحقًا."), picker.el),
    [btn("حفظ المعلم", async () => {
      if (!f.name.value.trim() || !f.user.value.trim()) return toast("الاسم واسم المستخدم مطلوبان", true);
      try {
        const r = await api(`${A}/teachers`, {
          name: f.name.value, username: f.user.value.trim().toLowerCase(), phone: f.phone.value || null, email: f.email.value || "",
          employee_no: f.employee_no.value || null, national_id: f.national_id.value || "", specialty: f.specialty.value || null,
          department: f.department.value || null, short_name: f.short_name.value || null, gender: f.gender.value, birth_date: f.birth_date.value,
          job_title: f.job_title.value || null, qualification: f.qualification.value || null, hire_date: f.hire_date.value,
          employment_type: f.employment_type.value, address: f.address.value || null, emergency_name: f.emergency_name.value || null,
          emergency_phone: f.emergency_phone.value || null, load: picker.value() });
        if (photoData) { try { await api(`${A}/teachers/${r.id}/photo`, { data_url: photoData }, "PUT"); } catch (e) { toast(`تم الحفظ لكن تعذر رفع الصورة: ${e.message}`, true); } }
        d.close();
        showCredentials("تمت إضافة المعلم", r.credentials, `يدخل المعلم من: ${staffLink(me)} — وسيُطلب منه تغيير كلمة المرور.`);
        refresh();
      } catch (e) { toast(e.message, true); }
    })]);
  }

  const actions = h("div", { class: "s-actions-top" },
    btn("+ إضافة معلم", addDialog),
    btn("استيراد المعلمين", () => openTeacherImport({ onDone: refresh }), "soft"),
    btn("تصدير", () => exportMenu(list), "ghost"),
    btn("المزيد ⋮", () => moreMenu(setStatus), "ghost"));
  const setStatus = (v) => { status.value = v; draw(); };

  return [
    h("div", { class: "panel s-head" },
      h("div", { class: "section-head" }, h("h2", {}, "المعلمون"), sub(`${active} نشطًا من ${list.length}`)),
      statCards([["إجمالي المعلمين", list.length], ["النشطون", active], ["بدون إسناد", unassigned, unassigned ? "يحتاجون فصولًا ومواد" : ""],
        ["لم يفعّلوا حساباتهم", pending]]),
      actions),
    h("div", { class: "panel" },
      h("div", { class: "search-row" }, q),
      h("div", { class: "filters" }, picker.el, subjectSel, specialty, status),
      h("div", { class: "toolbar" }, count), box),
  ];
}

function exportMenu(list) {
  const d = dialog("تصدير المعلمين", h("div", { class: "more-list" },
    sub("لا تتضمن الملفات كلمات مرور ولا أي بيانات أمنية."),
    btn("Excel (.xlsx)", () => { d.close(); location.href = `${A}/import/teachers/export`; }, ""),
    btn("CSV", () => { d.close(); exportTeachers(list); }, "ghost")));
}

function moreMenu(setStatus) {
  const d = dialog("المزيد", h("div", { class: "more-list" },
    btn("المعلمون الموقوفون", () => { d.close(); setStatus("inactive"); }, "ghost"),
    btn("لم يفعّلوا حساباتهم بعد", () => { d.close(); setStatus("pending"); }, "ghost"),
    btn("كل الحالات", () => { d.close(); setStatus("all"); }, "ghost")));
}

// التصدير لا يتضمن كلمات مرور ولا hash ولا أي سر
function exportTeachers(list) {
  csv("المعلمون.csv", [
    ["الاسم", "اسم المستخدم", "الرقم الوظيفي", "رقم الهوية", "الجوال", "البريد", "التخصص", "المسمى الوظيفي", "القسم", "نوع التوظيف", "الحالة", "الإسناد"],
    ...list.map((t) => [t.name, t.username, t.employee_no || "", t.national_id || "", t.phone || "",
      t.email || "", t.specialty || "", t.job_title || "", t.department || "", EMPLOYMENT[t.employment_type] || "", t.is_active ? "نشط" : "موقوف",
      t.load.map((l) => `${l.subject_name} (${l.class_name})`).join(" | ")]),
  ]);
}

/**
 * أداة الإسناد: قائمة الصفوف فقط.
 * الضغط على صف يفتح مواده لاختيارها، ثم «حفظ الصف» يغلقه ويعرض ما اخترته.
 */
function loadPicker(classes, subjects, current = []) {
  if (!classes.length || !subjects.length) {
    return { el: empty("أضف الصفوف والمواد أولًا من «الهيكل الأكاديمي»."), value: () => [], setSubjects: () => {} };
  }

  // الحالة: صف ← مجموعة المواد المختارة
  const picked = new Map(classes.map((c) => [Number(c.id), new Set()]));
  for (const l of current) picked.get(Number(l.class_id))?.add(Number(l.subject_id));

  const el = h("div", { class: "assign-list" });

  const nameOf = (id) => subjects.find((s2) => Number(s2.id) === Number(id))?.name;
  const summary = (c) => {
    const ids = [...picked.get(Number(c.id))];
    return ids.length ? ids.map(nameOf).filter(Boolean).join("، ") : "لا توجد مواد مسندة";
  };

  const draw = (openId = null) => {
    mount(el, classes.map((c) => {
      const count = picked.get(Number(c.id)).size;
      const head = h("button", { type: "button", class: `assign-head ${count ? "has" : ""}`,
        onclick: () => draw(Number(openId) === Number(c.id) ? null : c.id) },
        h("span", { class: "assign-name" }, c.name),
        h("span", { class: "assign-sum" }, summary(c)),
        count ? badge(`${count}`, "") : null,
        icons.chevronDown({ size: 16 }));

      if (Number(openId) !== Number(c.id)) return h("div", { class: "assign-item" }, head);

      // فتح الصف: مواده فقط
      const boxes = subjects.map((s2) => {
        const cb = input({ type: "checkbox", checked: picked.get(Number(c.id)).has(Number(s2.id)) });
        cb.addEventListener("change", () => {
          const set = picked.get(Number(c.id));
          if (cb.checked) set.add(Number(s2.id)); else set.delete(Number(s2.id));
        });
        return h("label", { class: "assign-subject" }, cb, h("span", {}, s2.name));
      });

      return h("div", { class: "assign-item open" }, head,
        h("div", { class: "assign-body" },
          h("div", { class: "assign-subjects" }, boxes),
          h("div", { class: "row spaced" },
            btn("حفظ الصف", () => draw(null), "soft sm"),
            btn("مسح اختيار الصف", () => { picked.get(Number(c.id)).clear(); draw(c.id); }, "ghost sm"))));
    }));
  };
  draw();

  return {
    el,
    value: () => [...picked.entries()].flatMap(([classId, set]) =>
      [...set].map((subjectId) => ({ class_id: classId, subject_id: subjectId }))),
    // اقتراح التخصص: تحديد مواد معيّنة في كل الصفوف
    setSubjects: (subjectIds) => {
      const wanted = subjectIds.map(Number);
      for (const set of picked.values()) for (const id of wanted) set.add(id);
      draw();
    },
  };
}
