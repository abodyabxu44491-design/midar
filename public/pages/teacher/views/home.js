/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, empty, notice, btn, sub } from "../../shared/js/ui.js";
import { icons } from "../../shared/js/icons.js";
import { shows } from "../prefs.js";

export const myClasses = (me) => [...new Map(me.load.map((l) => [l.class_id, { id: l.class_id, name: l.class_name }])).values()];

export default function home({ me, goTo }) {
  const initial = String(me.name || "؟").replace(/^(أ\.|د\.|م\.)\s*/, "").trim().charAt(0);
  const firstName = String(me.name || "").replace(/^(أ\.|د\.|م\.)\s*/, "").split(" ")[0];
  const classes = myClasses(me);
  const go = (key, params) => goTo?.(key, params);
  const dateLabel = new Date().toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });
  const subjects = new Set(me.load.map((l) => l.subject_id)).size;

  const hero = h("div", { class: "t-hero" }, h("span", { class: "t-hero-k" }, "حصص اليوم"), h("b", {}, "جارٍ التحميل…"));
  const todayBox = h("div", { class: "today-list" }, sub("جارٍ تحميل حصص اليوم…"));
  const todayPanel = panel("حصص اليوم", null, todayBox);
  const unread = h("span", { class: "qa-badge", hidden: true });
  if (me.modules?.timetable && navigator.onLine) {
    api("/api/teacher/timetable").then(({ today, holiday }) => {
      if (holiday) { todayPanel.hidden = true; mount(hero, h("span", { class: "t-hero-k" }, "اليوم"), h("b", {}, `إجازة: ${holiday.name}`)); mount(todayBox, notice(`اليوم إجازة: ${holiday.name}`, "warn")); return; }
      const first = today[0];
      mount(hero,
        h("span", { class: "t-hero-k" }, today.length ? `لديك ${today.length} ${today.length === 1 ? "حصة" : today.length <= 10 ? "حصص" : "حصة"} اليوم` : "اليوم"),
        h("b", {}, first ? `الحصة ${first.period}: ${first.subject} · ${first.class_name}` : "لا توجد حصص لك اليوم"),
        first?.room ? h("small", {}, first.room) : null,
        first && shows(me, "attendance") ? btn("سجّل الحضور الآن", () => go("attendance", { classId: first.class_id }), "light") : null);
      mount(todayBox, today.length ? today.map((s) => h("div", { class: "today-item" },
        h("span", { class: "today-no" }, s.period),
        h("div", { class: "stu-main" }, h("b", {}, s.subject), h("small", {}, [s.class_name, s.room].filter(Boolean).join(" · "))),
        shows(me, "attendance") ? btn("الحضور", () => go("attendance", { classId: s.class_id }), "soft sm") : null))
        : sub("لا توجد حصص لك اليوم."));
      todayPanel.hidden = !today.length;
    }).catch(() => { mount(hero, h("span", { class: "t-hero-k" }, "حصص اليوم"), h("b", {}, "تعذر تحميل الجدول الآن")); mount(todayBox, sub("تعذر تحميل الجدول الآن.")); });
  } else {
    mount(hero, h("span", { class: "t-hero-k" }, dateLabel), h("b", {}, `${classes.length} ${classes.length === 1 ? "فصل" : "فصول"} · ${subjects} ${subjects === 1 ? "مادة" : "مواد"}`));
    mount(todayBox, sub(me.modules?.timetable ? "حصص اليوم تظهر عند الاتصال بالإنترنت." : "الجدول غير مفعّل في مدرستك."));
  }
  if (shows(me, "chat") && navigator.onLine) {
    api("/api/teacher/chat").then((c) => { if (c.unread) { unread.textContent = String(c.unread); unread.hidden = false; } }).catch(() => {});
  }

  return [
    h("section", { class: "dash-hello" },
      me.photo ? h("img", { class: "dash-logo", src: me.photo, alt: "" }) : h("span", { class: "dash-logo ph", "aria-hidden": "true" }, initial),
      h("div", { class: "dash-hello-text" }, h("h2", {}, `أهلًا، أ. ${firstName}`),
        h("p", {}, [dateLabel, me.academic ? `${me.academic.year_name} — ${me.academic.term_name || "لم يُحدد فصل دراسي"}` : null].filter(Boolean).join(" · ")))),
    hero,
    quickActs(me, go, unread),
    todayPanel,
    panel("فصولي", null, classes.length
      ? h("div", { class: "class-tiles" }, classes.map((c) => h("div", { class: "class-tile" },
        h("button", { type: "button", class: "ct-main", onclick: () => go("students", { classId: c.id }) },
          h("b", {}, c.name),
          h("small", {}, me.load.filter((l) => l.class_id === c.id).map((l) => l.subject_name).join("، "))),
        shows(me, "attendance") ? h("button", { type: "button", class: "ct-att", title: "تسجيل الحضور", "aria-label": `تسجيل حضور ${c.name}`,
          onclick: () => go("attendance", { classId: c.id }) }, icons.check({ size: 18 })) : null)))
      : empty("لم تُسند لك فصول بعد. تواصل مع إدارة المدرسة.")),
  ];
}

// The daily work as four large buttons, so a teacher never has to look for it in the menu.
function quickActs(me, go, unread) {
  const act = (icon, text, tone, key, extra = null) => h("button", { type: "button", class: `quick-act ${tone}`, onclick: () => go(key) },
    h("span", { class: "qa-ic" }, icons[icon]({ size: 20 }), extra), text);
  const list = [
    shows(me, "attendance") ? act("check", "تسجيل الحضور", "teal", "attendance") : null,
    shows(me, "exams") ? act("edit", "رصد الدرجات", "navy", "exams") : null,
    shows(me, "homework") ? act("book", "الواجبات", "violet", "homework") : null,
    shows(me, "chat") ? act("message", "الرسائل", "red", "chat", unread) : null,
    shows(me, "students", null) ? act("users", "طلابي", "teal", "students") : null,
    shows(me, "timetable") ? act("calendar", "جدولي", "navy", "timetable") : null,
  ].filter(Boolean).slice(0, 4);
  return h("div", { class: "quick-acts t-acts" }, list);
}
