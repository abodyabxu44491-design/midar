// صفحة المدرسة العامة
// تعرض ما فعّلته الإدارة فقط: الصفوف، أسماء الطلاب، البحث، معلمو الصف، الأعداد، الإعلانات، حالة السداد.
// أي ملف طالب لا يُفتح إلا بمعرّفه السري.
import { h, $, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { topbar, footer, field, input, textarea, btn, empty, notice, dialog, line, sub, badge, brandLogo , showInstallBar} from "/shared/js/ui.js";
import { fmtDate } from "/shared/js/format.js";
import { icons } from "/shared/js/icons.js";
import { timetableGrid } from "/shared/js/timetable.js";

const app = $("#app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();
const P = `/api/public/${encodeURIComponent(school)}`;
const ACCESS = `midar_access_${school}`;
const access = () => sessionStorage.getItem(ACCESS) || undefined;

async function start() {
  try {
    render(await api(`${P}/page`, { access: access() }));
  } catch (e) {
    if (e.status === 404) return mount(app, topbar({}), h("main", {}, notice("المدرسة غير موجودة أو غير متاحة حاليًا.", "err")), footer());
    sessionStorage.removeItem(ACCESS);
    askAccess(e.status === 401 && access() ? e.message : null);
  }
}

/* ---------- شاشة رمز الصفحة (عندما تختار المدرسة وضع الرمز) ---------- */
function askAccess(error) {
  const code = input({ class: "ltr", placeholder: "رمز الصفحة", autocomplete: "off" });
  const msg = h("div", {}, error ? notice(error, "err") : null);
  const go = btn("دخول", async () => {
    try {
      await api(`${P}/open`, { access: code.value });
      sessionStorage.setItem(ACCESS, code.value.trim().toUpperCase());
      start();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "wide");
  code.addEventListener("keydown", (e) => e.key === "Enter" && go.click());
  mount(app,
    h("div", { class: "auth-hero" }, h("div", { class: "in" }, brandLogo("hero-logo", true, "stacked"), h("p", { class: "role" }, "صفحة الطلاب وأولياء الأمور"))),
    h("main", {}, h("div", { class: "auth-card" },
      h("h2", {}, "أدخل رمز صفحة المدرسة"),
      sub("الرمز من إدارة المدرسة."),
      field("رمز الصفحة", code), msg, go)),
    footer());
  code.focus();
}

/* ---------- الصفحة ---------- */
function render(data) {
  const st = data.settings;
  document.title = `مدار — ${data.school.name}`;
  const results = h("div");
  const classesBox = h("div");

  /* البحث */
  const query = input({ type: "search", placeholder: "ابحث باسم الطالب", "aria-label": "ابحث باسم الطالب" });
  let timer;
  const search = async () => {
    const q = query.value.trim();
    if (q.length < 2) return mount(results);
    mount(results, h("p", { class: "empty" }, "جارٍ البحث…"));
    try {
      const r = await api(`${P}/search`, { access: access(), q });
      mount(results, r.results.length
        ? h("section", { class: "panel" }, h("h2", {}, `نتائج البحث (${r.results.length})`),
            r.results.map((s) => line(
              h("button", { class: "linkish", type: "button", onclick: () => askKey(s) }, s.name),
              h("span", { class: "pill" }, s.class_name ? sub(s.class_name) : null, feeBadge(s)))))
        : h("section", { class: "panel" }, empty("لا يوجد طالب بهذا الاسم.")));
    } catch (e) { mount(results, notice(e.message, "err")); }
  };
  query.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 350); });

  /* الصفوف: مطوية، وتُفتح بالضغط */
  const drawClasses = () => {
    const list = [...data.classes];
    if (data.unassigned?.length) list.push({ id: 0, name: "طلاب بدون فصل", students: data.unassigned, count: data.unassigned.length, teachers: null });
    mount(classesBox, list.length ? list.map(classCard) : empty("لم تُضف الصفوف بعد."));
  };

  const classCard = (c) => {
    const body = h("div", { class: "hidden" });
    let loaded = false;
    const head = h("button", { class: "class-head", type: "button", "aria-expanded": "false", onclick: () => {
      const open = body.classList.toggle("hidden") === false;
      head.setAttribute("aria-expanded", String(open));
      head.classList.toggle("open", open);
      if (open && !loaded) { loaded = true; mount(body, classBody(c)); }
    } },
      h("span", { class: "pill" }, icons.chevronDown({ size: 16 }), c.name),
      c.count !== null && c.count !== undefined ? h("span", { class: "small" }, `${c.count} طالب`) : null);
    return h("section", { class: "class-card" }, head, body);
  };

  const classBody = (c) => [
    c.timetable?.length ? h("div", { class: "teachers" }, h("h4", {}, "جدول الحصص"),
      timetableGrid(c.timetable, { cell: (d, p, s) => (s ? h("b", { class: "small" }, s.subject) : h("span", { class: "muted" }, "—")) })) : null,
    c.teachers?.length
      ? h("div", { class: "teachers" }, h("h4", {}, "معلمو الصف"),
          h("table", { class: "grid" },
            h("thead", {}, h("tr", {}, h("th", {}, "المادة"), h("th", {}, "المعلم"))),
            h("tbody", {}, c.teachers.map((t) => h("tr", {}, h("td", {}, t.subject), h("td", {}, t.teacher))))))
      : null,
    c.students === null
      ? h("p", { class: "empty", style: "padding:0 14px" }, "أسماء الطلاب غير معروضة. استخدم البحث بالاسم.")
      : c.students.length
        ? h("ul", { class: "names" }, c.students.map((s) => h("li", {}, h("button", { type: "button", onclick: () => askKey(s) },
            h("span", {}, s.name), feeBadge(s)))))
        : h("p", { class: "empty", style: "padding:0 14px" }, "لا يوجد طلاب في هذا الصف."),
  ];

  mount(app,
    topbar({ school: data.school.name, subtitle: "الطلاب وأولياء الأمور",
      onLogout: st.access_mode === "code" ? () => { sessionStorage.removeItem(ACCESS); location.reload(); } : null }),
    h("main", {},
      data.announcements.length
        ? h("section", { class: "panel" }, h("h2", {}, "تعاميم المدرسة"),
            data.announcements.map((a) => line(h("div", {}, h("b", {}, a.title), h("div", {}, a.body), sub(fmtDate(a.created_at))))))
        : null,
      st.show_search ? h("div", { style: "margin-bottom:12px" }, query) : null,
      data.admissions ? h("div", { class: "toolbar" }, btn("طلب تسجيل طالب جديد", () => admissionForm(), "soft")) : null,
      results,
      classesBox),
    footer());
  drawClasses();
}

// نموذج طلب الالتحاق
function admissionForm() {
  const f = {
    student_name: input(), grade_wanted: input({ placeholder: "الصف المطلوب" }), birth_date: input({ type: "date" }),
    guardian_name: input(), guardian_phone: input({ class: "ltr", inputMode: "tel" }), note: textarea({ rows: 2 }),
  };
  const msg = h("div");
  const send = btn("إرسال الطلب", async () => {
    mount(msg);
    try {
      await api(`${P}/admissions`, { access: access(), ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])) });
      mount(msg, notice("وصل طلبك. ستتواصل معك المدرسة قريبًا.", ""));
      for (const el of Object.values(f)) el.value = "";
    } catch (e) { mount(msg, notice(e.message, "err")); }
  });
  dialog("طلب تسجيل طالب جديد", h("div", {},
    field("اسم الطالب", f.student_name),
    h("div", { class: "row" }, field("الصف المطلوب", f.grade_wanted), field("تاريخ الميلاد", f.birth_date)),
    field("اسم ولي الأمر", f.guardian_name),
    field("رقم الجوال", f.guardian_phone),
    field("ملاحظات", f.note),
    sub("بياناتك تصل لإدارة المدرسة."), msg), [send]);
}

const feeBadge = (s) => (s.fees === "paid" ? badge("مسدد") : s.fees === "unpaid" ? badge("لم يسدد", "red") : null);

/* ---------- فتح ملف الطالب بالمعرّف ---------- */
function askKey(student) {
  const key = input({ class: "ltr", placeholder: "XXXX-XXXX", autocomplete: "off", maxLength: 9 });
  const msg = h("div");
  const open = btn("فتح الملف", async () => {
    try {
      await api(`${P}/student`, { student_id: student.id, key: key.value });
      sessionStorage.setItem(`midar_student_${school}`, JSON.stringify({ id: student.id, key: key.value.trim().toUpperCase() }));
      location.href = `/${encodeURIComponent(school)}/student`;
    } catch (e) { mount(msg, notice(e.message, "err")); }
  });
  key.addEventListener("keydown", (e) => e.key === "Enter" && open.click());
  dialog(student.name, h("div", {},
    sub("المعرّف في البطاقة التي سلّمتها لك المدرسة."),
    field("معرّف الطالب", key), msg), [open]);
  key.focus();
}

start();
showInstallBar();
