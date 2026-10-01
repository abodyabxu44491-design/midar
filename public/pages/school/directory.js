// موقع المدرسة المصغّر: صفحة الطلاب وأولياء الأمور
//   #/                 الرئيسية: الشعار، الاسم، النبذة، البحث بالمعرّف، التسجيل، الإعلانات، التواصل
//   #/students         الطلاب: المراحل ← الصفوف
//   #/grade/<id>[/<شعبة>]  صفحة الصف: شعبه كتبويبات، وطلاب الشعبة كبطاقات (30 في كل مرة)
// كل عنصر يظهر فقط إذا فعّلته إدارة المدرسة، وبطاقة الطالب لا تحمل إلا ما سمحت بنشره.
import { h, $, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { footer, field, input, textarea, btn, notice, dialog, sub, badge, brandLogo, skeleton, showInstallBar, teacherCards } from "../shared/js/ui.js";
import { fmtDate } from "../shared/js/format.js";
import { icons } from "../shared/js/icons.js";
import { timetableGrid } from "../shared/js/timetable.js";
import { detectPhone } from "../shared/js/phone.js";

const app = $("#app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();
const P = `/api/public/${encodeURIComponent(school)}`;
const PAGE = 30;
let home = null;   // بيانات الرئيسية (تُحمّل مرة واحدة)

/* ======================= الهيكل العام ======================= */
function shell(content, { crumbs = [] } = {}) {
  const logo = home?.school.logo ? h("img", { class: "ss-logo", src: `${P}/logo?v=${home.school.logo_v}&size=thumb`, alt: "", width: 44, height: 44 }) : null;
  mount(app,
    h("header", { class: "ss-top" }, h("div", { class: "in" },
      h("a", { class: "ss-brand", href: "#/" }, logo, h("div", {}, h("b", {}, home?.school.name || ""), h("small", {}, "الطلاب وأولياء الأمور"))))),
    crumbs.length ? h("nav", { class: "ss-crumbs", "aria-label": "المسار" }, h("div", { class: "in" },
      [["الرئيسية", "#/"], ...crumbs].map(([label, href], i, a) => [
        i ? h("span", { class: "sep", "aria-hidden": "true" }, "‹") : null,
        i === a.length - 1 ? h("span", { "aria-current": "page" }, label) : h("a", { href }, label)]))) : null,
    h("main", { class: "ss-main fade-in" }, content),
    footer());
  window.scrollTo({ top: 0 });
}
const emptyState = (icon, title, text) => h("div", { class: "ss-empty" }, icon, h("b", {}, title), text ? h("p", {}, text) : null);

/* ======================= الموجّه ======================= */
async function route() {
  const [, page, a, b] = (location.hash || "#/").split("/");
  try {
    if (!home) home = await api(`${P}/home`, {});
    if (page === "students") return await studentsPage();
    if (page === "grade") return await gradePage(Number(a), b ? Number(b) : null);
    return homePage();
  } catch (e) {
    if (e.status === 404) return mount(app, h("main", { class: "ss-main" }, emptyState(icons.close({ size: 40 }), "المدرسة غير متاحة", "الرابط غير صحيح أو الصفحة غير متاحة حاليًا.")), footer());
    shell(notice(e.message, "err"));
  }
}
window.addEventListener("hashchange", route);

/* ======================= الرئيسية ======================= */
function homePage() {
  const f = home.features;
  document.title = `مدار — ${home.school.name}`;
  // الأقسام: كل واحد مرة واحدة فقط (التواصل له بطاقته الخاصة في الأسفل)
  const tiles = [
    f.directory ? tile(icons.users({ size: 26 }), "الطلاب", "المراحل والصفوف والشعب", () => { location.hash = "#/students"; }) : null,
    f.admissions ? tile(icons.plus({ size: 26 }), "طلب تسجيل طالب", "للطلاب الجدد", admissionForm) : null,
    home.announcements.length ? tile(icons.megaphone({ size: 26 }), "الأخبار والإعلانات", `${home.announcements.length} إعلان`,
      () => document.getElementById("news")?.scrollIntoView({ behavior: "smooth" })) : null,
  ].filter(Boolean);
  shell([
    h("section", { class: "ss-hero" },
      home.school.logo ? h("img", { class: "ss-hero-logo", src: `${P}/logo?v=${home.school.logo_v}`, alt: `شعار ${home.school.name}` }) : brandLogo("ss-hero-logo", false, "row"),
      h("h1", {}, home.school.name),
      home.school.about ? h("p", { class: "ss-about" }, home.school.about) : null),
    h("section", { class: "ss-card ss-keycard" }, h("h2", {}, icons.key({ size: 20 }), "ملف الطالب"),
      sub("أدخل معرّف الطالب من البطاقة التي سلّمتها المدرسة لفتح ملفه مباشرة."), findByKey()),
    tiles.length ? h("section", { class: `ss-tiles n${tiles.length}` }, tiles) : null,
    home.announcements.length ? h("section", { class: "ss-card", id: "news" }, h("h2", {}, icons.megaphone({ size: 20 }), "الأخبار والإعلانات"),
      home.announcements.map((a) => h("article", { class: "ss-news" }, h("b", {}, a.title), h("p", {}, a.body), h("small", {}, fmtDate(a.created_at))))) : null,
    contactCard(home.contact),
  ]);
}

// التواصل: بطاقة واحدة مرتبة — كل وسيلة في سطر بأيقونتها وزر إجرائها
function contactCard(c) {
  if (!c || !(c.phone || c.email || c.address || c.city)) return null;
  const intl = c.phone ? detectPhone(c.phone)?.intl : null;
  const rowOf = (icon, label, value, action) => h("div", { class: "ss-crow" },
    h("span", { class: "ic" }, icon), h("div", { class: "tx" }, h("small", {}, label), h("b", {}, value)), action || null);
  return h("section", { class: "ss-card", id: "contact" }, h("h2", {}, icons.phone({ size: 20 }), "تواصل مع المدرسة"),
    c.phone ? rowOf(icons.phone({ size: 18 }), "الهاتف", h("span", { class: "ltr" }, c.phone),
      h("div", { class: "acts" },
        h("a", { class: "btn contact sm", href: `tel:${c.phone}` }, "اتصال"),
        h("a", { class: "btn whatsapp sm", href: `https://wa.me/${intl}`, target: "_blank", rel: "noopener" }, "واتساب"))) : null,
    c.email ? rowOf(icons.link({ size: 18 }), "البريد الإلكتروني", h("span", { class: "ltr" }, c.email),
      h("a", { class: "btn secondary sm", href: `mailto:${c.email}` }, "مراسلة")) : null,
    c.city || c.address ? rowOf(icons.external({ size: 18 }), "العنوان", [c.city, c.address].filter(Boolean).join(" — "),
      h("a", { class: "btn open sm", href: `https://www.google.com/maps/search/${encodeURIComponent([c.address, c.city].filter(Boolean).join(" "))}`,
        target: "_blank", rel: "noopener" }, "الخريطة")) : null);
}
const tile = (icon, title, note, onclick) => h("button", { class: "ss-tile", type: "button", onclick }, h("span", { class: "ic" }, icon), h("b", {}, title), note ? h("small", {}, note) : null);

// البحث بالمعرّف: يفتح ملف الطالب مباشرة
function findByKey() {
  const key = input({ class: "ltr ss-key", placeholder: "XXXX-XXXX", autocomplete: "off", maxLength: 9, inputMode: "text", "aria-label": "معرّف الطالب" });
  const msg = h("div");
  const go = btn("فتح الملف", async () => {
    mount(msg);
    const k = key.value.trim().toUpperCase();
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(k)) return mount(msg, notice("المعرّف 8 أحرف وأرقام مثل ABCD-2345", "err"));
    try {
      const r = await api(`${P}/find`, { key: k });
      sessionStorage.setItem(`midar_student_${school}`, JSON.stringify({ id: r.student_id, key: k }));
      location.href = `/${encodeURIComponent(school)}/student`;
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "primary");
  // تنسيق تلقائي: شرطة بعد 4 أحرف
  key.addEventListener("input", () => {
    const v = key.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    key.value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v;
  });
  key.addEventListener("keydown", (e) => e.key === "Enter" && go.click());
  return h("div", {}, h("div", { class: "ss-keyrow" }, key, go), msg);
}

/* ======================= الطلاب: المراحل والصفوف ======================= */
async function studentsPage() {
  shell(skeleton(6), { crumbs: [["الطلاب", "#/students"]] });
  const data = await api(`${P}/structure`, {});
  const search = home.features.search ? nameSearch() : null;
  shell([
    h("div", { class: "ss-head" }, h("h1", {}, "الطلاب"), sub("اختر الصف لعرض شعبه وطلابه.")),
    search,
    data.stages.length ? data.stages.map((st) => h("section", { class: "ss-stage" },
      h("h2", {}, st.name, h("small", {}, `${st.grades.length} ${st.grades.length > 2 && st.grades.length < 11 ? "صفوف" : "صف"}`)),
      h("div", { class: "ss-grid" }, st.grades.map((g) => h("a", { class: "ss-grade", href: `#/grade/${g.id}` },
        h("b", {}, g.name),
        h("span", {}, `${g.sections} ${g.sections > 2 && g.sections < 11 ? "شعب" : "شعبة"}${g.students != null ? ` · ${g.students} طالب` : ""}`),
        h("span", { class: "go", "aria-hidden": "true" }, "‹"))))))
      : emptyState(icons.users({ size: 40 }), "لم تُضف الصفوف بعد", "ستظهر المراحل والصفوف هنا بعد إعدادها من إدارة المدرسة."),
  ], { crumbs: [["الطلاب", "#/students"]] });
}

// البحث بالاسم على مستوى المدرسة (إن فعّلته الإدارة)
function nameSearch() {
  const q = input({ type: "search", placeholder: "ابحث باسم الطالب", "aria-label": "ابحث باسم الطالب" });
  const out = h("div");
  let t;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const v = q.value.trim();
      if (v.length < 2) return mount(out);
      mount(out, skeleton(2));
      try {
        const r = await api(`${P}/search`, { q: v });
        mount(out, r.results.length ? h("div", { class: "ss-students" }, r.results.map((s) => studentCard(s, s.class_name)))
          : emptyState(icons.search({ size: 32 }), "لا توجد نتائج", "تأكد من كتابة الاسم."));
      } catch (e) { mount(out, notice(e.message, "err")); }
    }, 350);
  });
  return h("section", { class: "ss-card" }, q, out);
}

/* ======================= صفحة الصف: الشعب والطلاب ======================= */
async function gradePage(gradeId, sectionId) {
  shell(skeleton(6), { crumbs: [["الطلاب", "#/students"], ["…", "#"]] });
  const g = await api(`${P}/grade`, { grade_id: gradeId });
  const crumbs = [["الطلاب", "#/students"], ...(g.grade.stage ? [[g.grade.stage, "#/students"]] : []), [g.grade.name, `#/grade/${gradeId}`]];
  document.title = `${g.grade.name} — ${home.school.name}`;
  if (!g.sections.length) return shell(emptyState(icons.users({ size: 40 }), "لا توجد شعب في هذا الصف"), { crumbs });
  const current = g.sections.find((s) => s.id === sectionId) || g.sections[0];
  const tabs = g.sections.length > 1 ? h("div", { class: "ss-tabs", role: "tablist" }, g.sections.map((s) => h("a", {
    href: `#/grade/${gradeId}/${s.id}`, role: "tab", class: s.id === current.id ? "on" : "", "aria-selected": String(s.id === current.id),
  }, s.name, s.students != null ? h("small", {}, s.students) : null))) : null;
  const body = h("div", {}, skeleton(4));
  shell([h("div", { class: "ss-head" }, h("h1", {}, g.grade.name), g.grade.stage ? sub(g.grade.stage) : null), tabs, body], { crumbs });
  await sectionView(body, current, g.names);
}

async function sectionView(body, section, namesShown) {
  let offset = 0;
  let total = 0;
  const q = input({ type: "search", placeholder: `ابحث في ${section.name}`, "aria-label": "ابحث في الشعبة" });
  const list = h("div", { class: "ss-students" });
  const more = h("div", { class: "ss-more" });
  const info = h("div");
  const count = h("small", { class: "sub" });
  const load = async (reset) => {
    if (reset) { offset = 0; mount(list, skeleton(3)); }
    const r = await api(`${P}/section`, { class_id: section.id, offset, limit: PAGE, q: q.value.trim() || undefined });
    if (offset === 0) {
      mount(info,
        r.teachers?.length ? h("details", { class: "ss-card" }, h("summary", {}, "معلمو الشعبة"),
          teacherCards(r.teachers)) : null,
        r.timetable?.length ? h("details", { class: "ss-card" }, h("summary", {}, "جدول الحصص"),
          timetableGrid(r.timetable, { cell: (d, p, s) => (s ? h("b", { class: "small" }, s.subject) : h("span", { class: "muted" }, "—")) }))
          : null);
    }
    if (r.students === null) {
      mount(list, emptyState(icons.lock({ size: 36 }), "أسماء الطلاب غير معروضة", "استخدم البحث بمعرّف الطالب من الصفحة الرئيسية."));
      return mount(more);
    }
    total = r.total;
    if (reset || offset === 0) mount(list, r.students.length ? r.students.map((s) => studentCard(s)) : emptyState(icons.users({ size: 36 }), q.value.trim() ? "لا توجد نتائج" : "لا يوجد طلاب في هذه الشعبة"));
    else list.append(...r.students.map((s) => studentCard(s)));
    offset += r.students.length;
    count.textContent = total ? `${Math.min(offset, total)} من ${total} طالب` : "";
    mount(more, offset < total ? btn(`عرض المزيد (${total - offset})`, async (e) => { e.currentTarget.disabled = true; await load(false); }, "secondary wide") : null);
  };
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => load(true), 300); });
  mount(body, info, namesShown ? h("div", { class: "ss-toolbar" }, q, count) : null, list, more);
  await load(true);
}

// بطاقة الطالب: الحرف الأول، الاسم، الشعبة، وحالة السداد (إن سمحت المدرسة)
function studentCard(s, className) {
  const initials = String(s.name).trim().charAt(0);   // حرف واحد (حرفان عربيان يتصلان ويصعب قراءتهما)
  return h("button", { class: "ss-student", type: "button", onclick: () => askKey(s) },
    h("span", { class: "av", "aria-hidden": "true" }, initials),
    h("span", { class: "nm" }, h("b", {}, s.name), className ? h("small", {}, className) : null),
    s.fees === "paid" ? badge("مسدد") : s.fees === "unpaid" ? badge("لم يسدد", "red") : null);
}

/* ======================= نماذج ======================= */
function admissionForm() {
  const f = {
    student_name: input(), grade_wanted: input({ placeholder: "الصف المطلوب" }), birth_date: input({ type: "date" }),
    guardian_name: input(), guardian_phone: input({ class: "ltr", inputMode: "tel" }), note: textarea({ rows: 2 }),
  };
  const msg = h("div");
  const send = btn("إرسال الطلب", async () => {
    mount(msg);
    try {
      await api(`${P}/admissions`, { ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])) });
      mount(msg, notice("وصل طلبك. ستتواصل معك المدرسة قريبًا.", ""));
      for (const el of Object.values(f)) el.value = "";
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "primary");
  dialog("طلب تسجيل طالب جديد", h("div", {},
    field("اسم الطالب", f.student_name),
    h("div", { class: "row" }, field("الصف المطلوب", f.grade_wanted), field("تاريخ الميلاد", f.birth_date)),
    field("اسم ولي الأمر", f.guardian_name), field("رقم الجوال", f.guardian_phone), field("ملاحظات", f.note),
    sub("بياناتك تصل لإدارة المدرسة فقط."), msg), [send]);
}

function askKey(student) {
  const key = input({ class: "ltr ss-key", placeholder: "XXXX-XXXX", autocomplete: "off", maxLength: 9 });
  const msg = h("div");
  const open = btn("فتح الملف", async () => {
    try {
      await api(`${P}/student`, { student_id: student.id, key: key.value });
      sessionStorage.setItem(`midar_student_${school}`, JSON.stringify({ id: student.id, key: key.value.trim().toUpperCase() }));
      location.href = `/${encodeURIComponent(school)}/student`;
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "primary");
  key.addEventListener("input", () => {
    const v = key.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    key.value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v;
  });
  key.addEventListener("keydown", (e) => e.key === "Enter" && open.click());
  dialog(student.name, h("div", {}, sub("ملف الطالب لا يُفتح إلا بمعرّفه من البطاقة التي سلّمتها المدرسة."), field("معرّف الطالب", key), msg), [open]);
  key.focus();
}

route();
document.documentElement.dataset.app = "صفحة المدرسة";
showInstallBar();
