import { api } from "/shared/js/api.js";
import { stats, panel, notice, line, keyText, sub } from "/shared/js/ui.js";
import { h } from "/shared/js/dom.js";
import { money } from "/shared/js/format.js";
import { A, directoryLink, staffLink } from "./common.js";

export default async function dashboard({ me }) {
  const d = await api(`${A}/dashboard`);
  return [
    stats([
      ["طالب", d.students, `حد الباقة ${me.school.max_students}`], ["معلم", d.teachers], ["فصل", d.classes],
      ["غائب اليوم", d.absent_today, d.recorded_today ? `سُجل ${d.recorded_today} طالب` : "لم يُسجل الحضور بعد"],
      ["اختبار ينتظر اعتمادك", d.pending_exams],
      ["تحويل بنكي بانتظار التأكيد", d.pending_claims],
      ["رسوم غير محصّلة", money(d.fees_remaining), `المحصّل ${money(d.fees_paid)}`],
    ]),
    d.pending_claims ? notice(`لديك ${d.pending_claims} إشعار تحويل بانتظار التأكيد في تبويب «الرسوم».`, "warn") : null,
    d.pending_exams ? notice(`لديك ${d.pending_exams} اختبار بانتظار الاعتماد. الدرجات لا تظهر للأهالي قبل النشر.`, "warn") : null,
    panel("روابط مدرستك", null,
      line(h("span", {}, "صفحة الطلاب وأولياء الأمور"), keyText(directoryLink(me))),
      line(h("span", {}, "رمز فتح صفحة الطلاب"), keyText(me.school.directory_code)),
      line(h("span", {}, "دخول المدير والمعلمين"), keyText(staffLink(me))),
      sub("وزّع رابط صفحة الطلاب ورمزها على الأهالي. كل طالب يفتح ملفه بمعرّفه الخاص (من تبويب الطلاب).")),
  ];
}
