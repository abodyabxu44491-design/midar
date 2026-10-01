// التقويم (المعلم): فعاليات المدرسة والمنسوبين، واختبارات فصوله، والإجازات
import { api } from "../../shared/js/api.js";
import { toast } from "../../shared/js/ui.js";
import { calendarView } from "../../shared/js/calendar-view.js";

export default async function calendar() {
  return calendarView({ load: (from, to) => api(`/api/teacher/calendar?from=${from}&to=${to}`),
    onOpen: (e) => toast([e.title, e.description].filter(Boolean).join(" — ")) }).el;
}
