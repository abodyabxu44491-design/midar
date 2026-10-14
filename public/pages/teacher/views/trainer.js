/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, btn, empty, badge, sub, dialog, notice, kpiCard, kpiGrid, skeleton } from "../../shared/js/ui.js";
import { fmtDate, today } from "../../shared/js/format.js";
import { inst, T, courseBadge, enrollBadge, num, pct, bar, attendanceDialog, scoresDialog, progressBlock } from "../../shared/js/institute-ui.js";

const I = () => inst.base;
const LABEL = { planned: ["مخططة", "blue"], held: ["منفذة", ""], canceled: ["ملغاة", "red"], rescheduled: ["أعيدت جدولتها", "amber"] };
const sessionItem = (s, again) => h("div", { class: "in-item" },
  h("div", { style: "flex:1;min-width:0" }, h("b", {}, `${fmtDate(s.day)}${s.starts_at ? ` · ${s.starts_at.slice(0, 5)}` : ""} · ${s.course}`),
    sub([s.group_name, `${num(s.hours)} ساعة`, s.topic, s.status === "held" ? `حضور ${s.recorded}` : null].filter(Boolean).join(" · "))),
  badge(...LABEL[s.status]),
  ["planned", "held"].includes(s.status) && String(s.day).slice(0, 10) <= today() ? btn(s.status === "held" ? "تعديل الحضور" : "تسجيل الحضور", () => attendanceDialog(s.id, { onSaved: again }), "sm") : null);

export async function home({ goTo, refresh }) {
  const [sessions, courses] = await Promise.all([api(`${I()}/sessions`), api(`${I()}/courses`)]);
  const todays = sessions.filter((s) => String(s.day).slice(0, 10) === today());
  const pending = sessions.filter((s) => String(s.day).slice(0, 10) < today() && s.status === "planned");
  return [
    kpiGrid(
      kpiCard({ icon: "calendar", label: `${T("sessions")} اليوم`, value: num(todays.length) }),
      kpiCard({ icon: "alert", tone: pending.length ? "amber" : "teal", label: "بانتظار التحضير", value: num(pending.length) }),
      kpiCard({ icon: "clipboard", tone: "violet", label: `${T("courses")}ي`, value: num(courses.filter((c) => ["open", "running", "planned"].includes(c.status)).length), onClick: () => goTo("mycourses") })),
    panel(`${T("sessions")} اليوم`, null, todays.length ? h("div", { class: "in-list" }, todays.map((s) => sessionItem(s, refresh))) : empty(`لا توجد ${T("sessions")} اليوم.`)),
    pending.length ? panel("جلسات سابقة لم يُسجل حضورها", null, h("div", { class: "in-list" }, pending.map((s) => sessionItem(s, refresh)))) : null,
  ];
}

export async function sessions({ refresh }) {
  const rows = await api(`${I()}/sessions`);
  return panel(T("sessions"), null, sub("آخر أسبوعين والأسابيع الثلاثة القادمة."),
    rows.length ? h("div", { class: "in-list" }, rows.map((s) => sessionItem(s, refresh))) : empty(`لا توجد ${T("sessions")}.`));
}

export async function courses() {
  const list = await api(`${I()}/courses`);
  return panel(`${T("courses")}ي`, null, list.length ? h("div", { class: "in-cards" }, list.map((c) => h("article", { class: "in-card", role: "button", tabindex: "0",
    onclick: () => courseFile(c.id), onkeydown: (e) => e.key === "Enter" && courseFile(c.id) },
    h("header", {}, h("div", { class: "in-id" }, h("b", {}, c.name), h("small", { dir: "ltr" }, c.code)), courseBadge(c.status)),
    h("div", { class: "in-mini" }, h("div", {}, h("small", {}, "الساعات المنفذة"), h("b", {}, `${num(c.held_hours)} من ${num(c.hours)}`), bar(c.held_hours, c.hours)),
      h("div", {}, h("small", {}, T("trainees")), h("b", {}, num(c.enrolled)))))))
    : empty(`لا توجد ${T("courses")} مسندة إليك.`));
}

async function courseFile(id) {
  const holder = h("div", {}, skeleton(5));
  const dd = dialog(T("course"), holder);
  dd.classList.add("dialog-lg");
  const draw = async () => {
    const d = await api(`${I()}/courses/${id}`);
    const c = d.course;
    mount(holder, h("div", { class: "in-file" },
      h("header", { class: "in-file-head" }, h("div", {}, h("h2", {}, c.name), sub(`${num(c.hours)} ساعة · ${c.grading === "score" ? "درجات موزونة" : "اجتياز / عدم اجتياز"}`)), courseBadge(c.status)),
      panel("التقييمات", null, d.assessments.length ? h("div", { class: "in-list" }, d.assessments.map((a) => h("div", { class: "in-item" },
        h("div", {}, h("b", {}, a.name), sub(c.grading === "score" ? `من ${num(a.max_score)} · الوزن ${num(a.weight)}%` : "اجتياز / عدم اجتياز")),
        btn("رصد", () => scoresDialog(a, d.enrollments, { grading: c.grading, onSaved: draw }), "sm")))) : empty("لم تحدد الإدارة تقييمات لهذه الدورة بعد.")),
      panel(T("trainees"), null, d.enrollments.length ? h("div", { class: "in-roster" }, d.enrollments.map((e) => h("button", { type: "button", class: "in-ros",
        onclick: () => dialog(e.full_name, progressBlock(e.progress)) },
        h("div", { class: "in-ros-id" }, h("b", {}, e.full_name), sub(e.group_name || "")),
        h("div", { class: "in-ros-m" }, h("small", {}, "الحضور"), h("b", { class: e.progress.low_attendance ? "danger-text" : "" }, pct(e.progress.attendance_pct))),
        h("div", { class: "in-ros-m" }, h("small", {}, "النتيجة"), h("b", {}, c.grading === "score" ? pct(e.progress.final_score) : `${e.progress.items.filter((x) => x.passed).length}/${e.progress.items.length}`)),
        enrollBadge(e.status)))) : empty(`لا يوجد ${T("trainees")} في مجموعاتك.`)),
      panel(T("sessions"), null, d.sessions.length ? h("div", { class: "in-list" }, d.sessions.map((s) => sessionItem({ ...s, course: c.name }, draw))) : empty("لا توجد جلسات."))));
  };
  draw().catch((e) => mount(holder, notice(e.message, "err")));
}
