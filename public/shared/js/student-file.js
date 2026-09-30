// عرض «ملف الطالب» الكامل: مصدر واحد تستخدمه صفحة ولي الأمر ونافذة الإدارة.
// الفرق الوحيد: الإدارة ترى كل الأقسام بلا معرّف دخول، وولي الأمر يرى ما تفعّله المدرسة ويستطيع الدفع.
import { h, mount } from "./dom.js";
import { empty, badge, line, sub } from "./ui.js";
import { money, fmtDate, ATTENDANCE } from "./format.js";
import { timetableGrid } from "./timetable.js";

export const section = (title, ...kids) => h("section", { class: "panel" }, h("h2", {}, title), ...kids);
export const info = (label, value, cls = "") => line(h("span", { class: "sub" }, label), h("b", { class: cls }, value || "—"));
export const gradeLine = (g) => line(
  h("div", {}, h("b", {}, g.subject), sub(`${g.title}${g.exam_date ? ` — ${fmtDate(g.exam_date)}` : ""}`)),
  h("b", {}, `${g.score} / ${g.max_score}`));
const GENDER = { male: "ذكر", female: "أنثى" };

/** عرض الرسوم للقراءة فقط (الإدارة). ولي الأمر يمرّر دالته الخاصة التي فيها زر الدفع. */
export function feesReadOnly(f, compact = false) {
  const open = f.invoices.filter((i) => i.status === "open");
  return section("الرسوم والسداد",
    line(h("span", {}, "الحالة"), f.status === "paid" ? badge("مسدد الرسوم") : f.status === "unpaid" ? badge("لم يسدد بعد", "red") : badge("لا توجد رسوم", "gray")),
    line(h("span", {}, "الإجمالي"), h("b", {}, money(f.total))),
    line(h("span", {}, "المدفوع"), h("b", {}, money(f.paid))),
    line(h("span", {}, "المتبقي"), h("b", { class: f.remaining > 0 ? "danger-text" : "" }, money(f.remaining))),
    compact ? null : [h("h3", { class: "sec-title" }, "الفواتير"),
      open.length ? open.map((i) => line(h("div", {}, h("b", {}, i.title),
        sub(`فاتورة #${i.id} — ${money(i.amount)} — المتبقي ${money(Math.round((i.amount - i.paid) * 100) / 100)}${i.due_date ? ` — تستحق ${fmtDate(i.due_date)}` : ""}`))))
        : empty("لا توجد فواتير.")]);
}

/**
 * @param {object} d بيانات الملف من الخادم
 * @param {{fees?: (f, compact) => Node, toolbar?: Node|Node[], photo?: string|null}} opts
 * @returns {{ el: HTMLElement, open: (key:string)=>void }}
 */
export function studentFile(d, { fees = feesReadOnly, toolbar = null, photo = null, scrollTop = false } = {}) {
  const s = d.student, f = d.fees;
  const avg = d.grades.length ? Math.round(d.grades.reduce((a, g) => a + (g.score / g.max_score) * 100, 0) / d.grades.length) : null;
  const count = (st) => d.attendance.filter((a) => a.status === st).length;

  const sections = [
    { key: "overview", name: "نظرة عامة", note: "البيانات والملخص" },
    ...(d.settings.profile_show_grades ? [{ key: "grades", name: "الدرجات", note: d.academic?.term_name || "" }] : []),
    ...(d.settings.profile_show_attendance ? [{ key: "attendance", name: "الحضور والغياب", note: `${count("absent")} غياب` }] : []),
    ...(d.homework?.length ? [{ key: "homework", name: "الواجبات", note: `${d.homework.length} واجب` }] : []),
    ...(d.timetable?.length ? [{ key: "timetable", name: "الجدول الدراسي", note: "حصص الأسبوع" }] : []),
    ...(f ? [{ key: "fees", name: "الرسوم والسداد", note: f.status === "unpaid" ? money(f.remaining) : "مسدد" }] : []),
    ...(d.settings.profile_show_teachers && d.teachers.length ? [{ key: "teachers", name: "المعلمون والمواد", note: "" }] : []),
    ...(d.announcements.length ? [{ key: "news", name: "التعاميم", note: `${d.announcements.length}` }] : []),
  ];

  const views = {
    overview: () => [
      section("البيانات الأساسية",
        info("اسم الطالب", s.name),
        d.admin ? info("رقم الطالب", s.student_no) : null,
        info("الفصل", s.class_name),
        d.admin ? [info("تاريخ الميلاد", s.birth_date ? fmtDate(s.birth_date) : ""), info("الجنس", GENDER[s.gender]), info("جوال الطالب", s.student_phone, "ltr")] : null,
        info("ولي الأمر", s.guardian_name), info("جوال ولي الأمر", s.guardian_phone, "ltr"), info("تاريخ التسجيل", fmtDate(s.since)),
        ...(d.custom || []).map((c) => info(c.label, c.value))),
      d.settings.profile_show_grades && d.grades.length ? section("آخر الدرجات", d.grades.slice(0, 4).map(gradeLine)) : null,
      f ? fees(f, true) : null,
    ],
    grades: () => section(d.academic?.term_name ? `الدرجات — ${d.academic.term_name}` : "الدرجات",
      d.grades.length ? d.grades.map(gradeLine) : empty("لم تُنشر درجات بعد.")),
    attendance: () => section("الحضور والغياب",
      h("div", { class: "kpis inline" },
        h("div", {}, h("b", {}, count("present")), "حاضر"), h("div", {}, h("b", {}, count("absent")), "غائب"),
        h("div", {}, h("b", {}, count("late")), "متأخر"), h("div", {}, h("b", {}, count("excused")), "بعذر")),
      d.attendance.length ? d.attendance.map((a) => line(h("span", {}, fmtDate(a.day)), badge(ATTENDANCE[a.status].label, ATTENDANCE[a.status].tone)))
        : empty("لا توجد سجلات.")),
    homework: () => section("الواجبات", d.homework.map((w) => line(
      h("div", {}, h("b", {}, w.title), " ", w.submitted ? badge("سُلّم") : badge("لم يُسلّم", "amber"),
        sub(`${w.subject}${w.teacher ? ` — ${w.teacher}` : ""}${w.due_date ? ` — التسليم ${fmtDate(w.due_date)}` : ""}`),
        w.details ? sub(w.details) : null)))),
    timetable: () => section("الجدول الدراسي",
      timetableGrid(d.timetable, { cell: (day, p2, sl) => (sl
        ? [h("b", { class: "small" }, sl.subject), sl.teacher ? h("div", { class: "small muted" }, sl.teacher) : null]
        : h("span", { class: "muted" }, "—")) })),
    fees: () => fees(f, false),
    teachers: () => section("المعلمون والمواد", d.teachers.map((t) => line(h("span", {}, t.subject), h("b", {}, t.teacher)))),
    news: () => section("التعاميم", d.announcements.map((a) => line(
      h("div", {}, h("b", {}, a.title), sub(fmtDate(a.created_at)), a.body ? sub(a.body) : null)))),
  };

  const body = h("div", { class: "profile-body" });
  const nav = h("nav", { class: "profile-nav" });
  const open = (key) => {
    nav.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === key));
    mount(body, views[key]());
    if (scrollTop) window.scrollTo({ top: 0, behavior: "smooth" });
  };
  mount(nav, sections.map((sec) => h("button", { type: "button", "data-k": sec.key, onclick: () => open(sec.key) },
    h("span", {}, sec.name), sec.note ? h("small", {}, sec.note) : null)));

  const avatar = d.admin
    ? (photo ? h("img", { class: "s-photo lg", src: photo, alt: "" }) : h("span", { class: "s-photo lg ph", "aria-hidden": "true" }, [...s.name][0] || "؟"))
    : null;
  const el = h("div", { class: "student-file" },
    toolbar,
    h("div", { class: "profile-head" },
      h("div", { class: "ph-row" }, avatar, h("div", {},
        h("h1", {}, s.name),
        h("div", { style: "opacity:.85" }, [s.class_name, d.admin && s.student_no ? `رقم ${s.student_no}` : null].filter(Boolean).join(" — ")))),
      h("div", { class: "kpis" },
        d.settings.profile_show_grades ? h("div", {}, h("b", {}, avg === null ? "—" : `${avg}%`), "متوسط الدرجات") : null,
        d.settings.profile_show_attendance ? h("div", {}, h("b", {}, count("absent")), "أيام الغياب") : null,
        d.settings.profile_show_attendance ? h("div", {}, h("b", {}, count("late")), "مرات التأخر") : null,
        f ? h("div", {}, h("b", {}, f.status === "paid" ? "مسدد" : f.status === "unpaid" ? money(f.remaining) : "—"),
          f.status === "unpaid" ? "رسوم متبقية" : "حالة الرسوم") : null)),
    h("div", { class: "profile-layout" }, nav, body));
  const first = scrollTop;
  open("overview");
  void first;
  return { el, open };
}
