// تبويب الاختبارات: مراجعة الدرجات واعتمادها
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, btn, empty, badge, line, sub, toast, dialog, confirmAction } from "/shared/js/ui.js";
import { EXAM, csv, fmtDate } from "/shared/js/format.js";
import { A } from "./common.js";

export default async function exams({ refresh }) {
  const list = await api(`${A}/exams`);
  const setStatus = (e, status, msg, ask) => async () => {
    if (ask && !confirmAction(ask)) return;
    await api(`${A}/exams/${e.id}/status`, { status });
    toast(msg); refresh();
  };
  return panel("الاختبارات", null,
    sub("الدرجات لا تظهر لأولياء الأمور قبل اعتمادها."),
    list.length ? list.map((e) => line(
      h("div", {}, h("b", {}, e.title), " ", badge(...EXAM[e.status]),
        sub(`${e.class_name} — ${e.subject_name} — ${fmtDate(e.exam_date)} — من ${e.max_score} — أُدخلت ${e.graded} درجة — ${e.created_by}`)),
      h("div", { class: "row", style: "flex:none" },
        btn("الدرجات", async () => {
          const rows = await api(`${A}/exams/${e.id}/scores`);
          dialog(e.title, h("div", {}, rows.map((r) => line(h("span", {}, r.name), h("b", {}, r.score ?? "—")))),
            [btn("تصدير", () => csv(`${e.title}.csv`, [["الطالب", "الدرجة", "من"], ...rows.map((r) => [r.name, r.score ?? "", e.max_score])]), "ghost")]);
        }, "ghost sm"),
        e.status !== "published" && btn("اعتماد ونشر", setStatus(e, "published", "تم نشر الدرجات", `نشر درجات «${e.title}» للطلاب وأولياء الأمور؟`), "sm"),
        e.status === "pending" && btn("إرجاع للمعلم", setStatus(e, "draft", "أُعيد للمعلم"), "ghost sm"),
        e.status === "published" && btn("إلغاء النشر", setStatus(e, "draft", "تم إلغاء النشر", "إخفاء الدرجات وإعادتها للتعديل؟"), "ghost sm"),
      ))) : empty("لا توجد اختبارات. ينشئها المعلمون من بوابتهم."));
}
