// تبويب الحضور (كل الفصول) مع تنبيه واتساب لولي الأمر
import { attendanceBoard } from "../../shared/js/attendance-board.js";
import { api } from "../../shared/js/api.js";
import { waButton, messageVars } from "../../shared/js/whatsapp.js";
import { A, loadClasses, optional } from "./common.js";

export default async function attendance({ me }) {
  // جوال ولي الأمر يأتي مع صفوف حضور الشعبة نفسها (بدل تنزيل قائمة كل طلاب المدرسة)
  const [classes, templates] = await Promise.all([loadClasses(), optional(api(`${A}/messaging/templates`), null)]);
  const wa = (row) => {
    const s = row;
    if (!s?.guardian_phone || !templates) return null;
    return waButton({
      phone: s.guardian_phone, countryCode: templates.country_code,
      template: row.status === "late" ? templates.late : templates.absence,
      vars: messageVars({ student: s, school: me.school.name }),
      label: row.status === "late" ? "تنبيه تأخر" : "تنبيه غياب",
    });
  };
  return attendanceBoard(`${A}/attendance`, classes, wa);
}
