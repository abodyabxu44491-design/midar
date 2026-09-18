// طلبات الالتحاق الواردة من صفحة المدرسة
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, empty, badge, line, sub, btn, input, select, dialog, toast, notice, showCredentials, keyText } from "/shared/js/ui.js";
import { fmtDate, fmtDateTime } from "/shared/js/format.js";
import { waLink } from "/shared/js/whatsapp.js";
import { A, loadClasses, classOptions } from "./common.js";

const STATUS = { new: ["جديد", "amber"], contacted: ["تم التواصل", ""], accepted: ["مقبول", ""], rejected: ["مرفوض", "gray"] };

export default async function admissions({ me, refresh }) {
  const [list, classes, settings] = await Promise.all([
    api(`${A}/admissions`), loadClasses(), api(`${A}/settings/public-page`)]);
  const waiting = list.filter((x) => x.status === "new").length;

  return [
    settings.show_admissions
      ? notice("نموذج طلب الالتحاق ظاهر في صفحة المدرسة. لإيقافه: الإعدادات ← صفحة المدرسة العامة.", "")
      : notice("نموذج طلب الالتحاق موقوف. لتفعيله: الإعدادات ← صفحة المدرسة العامة ← «طلب التحاق طالب جديد».", "warn"),
    panel(`طلبات الالتحاق${waiting ? ` (${waiting} جديد)` : ""}`, null,
      list.length ? list.map((x) => row(x, classes, refresh, me)) : empty("لا توجد طلبات بعد.")),
  ];
}

function row(x, classes, refresh, me) {
  const wa = waLink(x.guardian_phone, `السلام عليكم ${x.guardian_name}، بخصوص طلب تسجيل الطالب ${x.student_name} في ${me.school.name}.`);
  const set = (decision) => async () => {
    if (decision === "accepted") return accept(x, classes, refresh);
    const note = input({ placeholder: decision === "rejected" ? "سبب الرفض (اختياري)" : "ملاحظة (اختياري)" });
    const d = dialog(decision === "rejected" ? "رفض الطلب" : "تسجيل تواصل", h("div", {}, note), [
      btn("حفظ", async () => {
        await api(`${A}/admissions/${x.id}/review`, { decision, note: note.value || null });
        d.close(); toast("تم"); refresh();
      }, decision === "rejected" ? "danger" : "primary")]);
  };
  return line(
    h("div", { class: x.status === "new" ? "" : "muted-row" },
      h("b", {}, x.student_name), " ", badge(...STATUS[x.status]),
      sub(`الصف المطلوب: ${x.grade_wanted || "—"}${x.birth_date ? ` — مواليد ${fmtDate(x.birth_date)}` : ""}`),
      sub(`ولي الأمر: ${x.guardian_name} — ${x.guardian_phone} — ${fmtDateTime(x.created_at)}`),
      x.note ? sub(x.note) : null,
      x.review_note ? sub(`ملاحظة: ${x.review_note}`) : null,
      x.access_key ? h("div", { class: "sub pill" }, "معرّف الطالب: ", keyText(x.access_key)) : null),
    h("div", { class: "row", style: "flex:none" },
      wa ? h("a", { class: "btn ghost sm", href: wa, target: "_blank", rel: "noopener" }, "واتساب") : null,
      x.status === "new" ? btn("تم التواصل", set("contacted"), "ghost sm") : null,
      x.status !== "accepted" ? btn("قبول وتسجيل", set("accepted"), "sm") : null,
      x.status !== "accepted" && x.status !== "rejected" ? btn("رفض", set("rejected"), "danger sm") : null));
}

function accept(x, classes, refresh) {
  const cls = select(classOptions(classes, "بدون فصل"));
  const note = input({ placeholder: "ملاحظة (اختياري)" });
  const msg = h("div");
  const d = dialog(`قبول ${x.student_name}`, h("div", {},
    sub("سيُنشأ ملف الطالب مباشرة بمعرّفه الخاص."),
    h("label", { class: "f" }, h("span", {}, "الفصل"), cls), note, msg),
  [btn("قبول وإنشاء الملف", async () => {
    try {
      const r = await api(`${A}/admissions/${x.id}/review`, { decision: "accepted", class_id: cls.value || null, note: note.value || null });
      d.close();
      showCredentials(`تم تسجيل ${r.student.name}`, { access_key: r.student.access_key }, "سلّم المعرّف لولي الأمر ليتابع ابنه ويدفع الرسوم.");
      refresh();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  })]);
}
