/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { api } from "../../shared/js/api.js";
import { toast } from "../../shared/js/ui.js";
import { calendarView } from "../../shared/js/calendar-view.js";

export default async function calendar() {
  return calendarView({ load: (from, to) => api(`/api/teacher/calendar?from=${from}&to=${to}`),
    onOpen: (e) => toast([e.title, e.description].filter(Boolean).join(" — ")) }).el;
}
