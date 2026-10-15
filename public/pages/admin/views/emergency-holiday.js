/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// A sudden holiday (weather, an emergency, an official decision): from which day to which day, why, and whether to
// tell parents and teachers. Attendance already recorded on those days stops counting (the days are a holiday) and
// comes back as it was if the holiday is removed or shortened.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { field, input, btn, toast, dialog, notice, sub } from "../../shared/js/ui.js";
import { today, fmtDate } from "../../shared/js/format.js";
import { A } from "./common.js";

export function emergencyHoliday(onDone) {
  const name = input({ value: "إجازة طارئة", maxLength: 80 });
  const from = input({ type: "date", class: "ltr", value: today() });
  const to = input({ type: "date", class: "ltr", value: today() });
  const notes = input({ placeholder: "السبب (اختياري) — مثال: أمطار غزيرة", maxLength: 300 });
  const tell = h("input", { type: "checkbox", checked: true });
  const impact = h("div", { class: "eh-impact" });
  const msg = h("div");
  let timer;
  const preview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!from.value || !to.value || to.value < from.value) return mount(impact);
      try {
        const r = await api(`${A}/academic/holidays/impact?from=${from.value}&to=${to.value}`);
        mount(impact, r.records
          ? notice(`سُجّل حضور ${r.records} سجلًا في هذه الأيام (منها ${r.absent} غياب). لن تُحسب حضورًا ولا غيابًا، وتُعرض الأيام إجازة. إذا حذفت الإجازة لاحقًا تعود السجلات كما كانت.`, "warn")
          : sub("لا يوجد حضور مسجّل في هذه الأيام."));
      } catch { mount(impact); }
    }, 250);
  };
  for (const el of [from, to]) el.addEventListener("change", () => { if (to.value < from.value) to.value = from.value; preview(); });
  preview();
  const d = dialog("إعلان إجازة طارئة", h("div", { class: "eh" },
    sub("تتوقف البوابة وتسجيل الحضور في هذه الأيام، ولا يُحسب أي طالب غائبًا."),
    field("الاسم", name),
    h("div", { class: "row" }, field("من يوم", from), field("إلى يوم", to)),
    field("السبب", notes),
    h("label", { class: "check" }, tell, h("span", {}, "إرسال إشعار لأولياء الأمور والمعلمين")),
    impact, msg), [
    btn("إعلان الإجازة", async () => {
      mount(msg);
      if (!name.value.trim()) return mount(msg, notice("اكتب اسم الإجازة.", "err"));
      if (!from.value || !to.value) return mount(msg, notice("حدد تاريخ البداية والنهاية.", "err"));
      try {
        const r = await api(`${A}/academic/holidays`, { name: name.value.trim(), kind: "emergency", start_date: from.value, end_date: to.value,
          notes: notes.value.trim() || undefined, affects_attendance: true, show_in_calendar: true, notify: tell.checked });
        d.close();
        toast(`أُعلنت الإجازة ${from.value === to.value ? `يوم ${fmtDate(from.value)}` : `من ${fmtDate(from.value)} إلى ${fmtDate(to.value)}`}${r.set_aside ? ` — ${r.set_aside} سجل حضور لم يعد يُحسب` : ""}`);
        onDone?.();
      } catch (e) { mount(msg, notice(e.message, "err")); }
    }, "danger"),
  ]);
}
