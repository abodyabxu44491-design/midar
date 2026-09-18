// تبويب الحضور (كل الفصول) مع تنبيه واتساب لولي الأمر
import { attendanceBoard } from "/shared/js/attendance-board.js";
import { api } from "/shared/js/api.js";
import { waButton, messageVars } from "/shared/js/whatsapp.js";
import { A, loadClasses } from "./common.js";

export default async function attendance({ me }) {
  const [classes, templates, students] = await Promise.all([
    loadClasses(), api(`${A}/messaging/templates`), api(`${A}/students`)]);
  const byId = new Map(students.map((s) => [s.id, s]));
  const wa = (row) => {
    const s = byId.get(row.id);
    if (!s?.guardian_phone) return null;
    return waButton({
      phone: s.guardian_phone, countryCode: templates.country_code,
      template: row.status === "late" ? templates.late : templates.absence,
      vars: messageVars({ student: s, school: me.school.name }),
      label: row.status === "late" ? "تنبيه تأخر" : "تنبيه غياب",
    });
  };
  return attendanceBoard(`${A}/attendance`, classes, wa);
}
