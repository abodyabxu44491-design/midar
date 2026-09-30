// الرئيسية للمعلم: ترحيب، حصص اليوم، وبطاقة لكل فصل فيها مواده واختصارات الحضور والطلاب.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { stats, panel, empty, notice, btn, sub } from "../../shared/js/ui.js";

export const myClasses = (me) => [...new Map(me.load.map((l) => [l.class_id, { id: l.class_id, name: l.class_name }])).values()];

export default function home({ me, goTo }) {
  // بطاقة الترحيب: صورة المعلم (يرفعها المدير من ملف المعلم) أو أول حرف من اسمه
  const initial = String(me.name || "؟").replace(/^(أ\.|د\.|م\.)\s*/, "").trim().charAt(0);
  const classes = myClasses(me);
  const go = (key, params) => goTo?.(key, params);
  const dateLabel = new Date().toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });

  // حصص اليوم: من الجدول إن كانت الميزة مفعّلة والاتصال متاح، ولا تعطل الصفحة إن فشلت
  const todayBox = h("div", { class: "today-list" }, sub("جارٍ تحميل حصص اليوم…"));
  if (me.modules?.timetable && navigator.onLine) {
    api("/api/teacher/timetable").then(({ today, holiday }) => mount(todayBox,
      holiday ? notice(`اليوم إجازة: ${holiday.name}`, "warn")
        : today.length ? today.map((s) => h("div", { class: "today-item" },
          h("span", { class: "today-no" }, s.period),
          h("div", { class: "stu-main" }, h("b", {}, s.subject), h("small", {}, [s.class_name, s.room].filter(Boolean).join(" · "))),
          me.modules?.attendance ? btn("الحضور", () => go("attendance", { classId: s.class_id }), "soft sm") : null))
          : sub("لا توجد حصص لك اليوم.")))
      .catch(() => mount(todayBox, sub("تعذر تحميل الجدول الآن.")));
  } else mount(todayBox, sub(me.modules?.timetable ? "حصص اليوم تظهر عند الاتصال بالإنترنت." : "الجدول غير مفعّل في مدرستك."));

  return [
    h("div", { class: "welcome-card" },
      me.photo ? h("img", { class: "t-avatar lg", src: me.photo, alt: "" }) : h("span", { class: "t-avatar lg ph", "aria-hidden": "true" }, initial),
      h("div", { class: "t-info" }, h("b", {}, `أهلًا، ${me.name}`),
        h("small", {}, [dateLabel, me.academic ? `${me.academic.year_name} — ${me.academic.term_name || "لم يُحدد فصل دراسي"}` : null].filter(Boolean).join(" · ")))),
    stats([["فصولي", classes.length], ["موادي", new Set(me.load.map((l) => l.subject_id)).size]]),
    panel("حصص اليوم", null, todayBox),
    panel("فصولي", null, classes.length
      ? h("div", { class: "class-cards" }, classes.map((c) => h("div", { class: "class-card" },
        h("b", {}, c.name),
        h("div", { class: "cc-subjects" }, me.load.filter((l) => l.class_id === c.id).map((l) => h("span", { class: "badge" }, l.subject_name))),
        h("div", { class: "cc-acts" },
          me.modules?.attendance ? btn("تسجيل الحضور", () => go("attendance", { classId: c.id }), "sm") : null,
          btn("الطلاب", () => go("students", { classId: c.id }), "ghost sm")))))
      : empty("لم تُسند لك فصول بعد. تواصل مع إدارة المدرسة.")),
  ];
}
