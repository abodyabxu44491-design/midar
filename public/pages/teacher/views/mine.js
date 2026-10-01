// حضوري وإجازاتي: تسجيل الحضور والانصراف بضغطة، ملخص الشهر، طلب إجازة، وحصص الانتظار المسندة لي
import { h } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, stats, toast, notice } from "../../shared/js/ui.js";
import { fmtDate, fmtDay } from "../../shared/js/format.js";

const LEAVE = { sick: "مرضية", annual: "سنوية", emergency: "اضطرارية", unpaid: "بدون راتب", official: "مهمة رسمية", other: "أخرى" };
const LSTATE = { pending: ["بانتظار القرار", "amber"], approved: ["معتمدة", ""], rejected: ["مرفوضة", "red"], cancelled: ["ملغاة", "gray"] };
const ST = { present: "حاضر", late: "متأخر", absent: "غائب", leave: "إجازة", excused: "بعذر" };

export default async function mine({ refresh }) {
  const d = await api("/api/teacher/me-staff");
  const t = d.today;
  const kind = select(Object.entries(LEAVE));
  const from = input({ type: "date" }), to = input({ type: "date" });
  const reason = input({ placeholder: "السبب", maxLength: 500 });
  return [
    panel("حضور اليوم", null,
      t ? line(h("div", {}, h("b", {}, ST[t.status] || t.status), sub([t.check_in ? `الحضور ${t.check_in.slice(0, 5)}` : null, t.check_out ? `الانصراف ${t.check_out.slice(0, 5)}` : null,
        t.late_min ? `تأخر ${t.late_min} دقيقة` : null].filter(Boolean).join(" — ")))) : sub(`لم تسجّل حضورك اليوم. بداية الدوام ${d.work_start}.`),
      d.self_checkin ? h("div", { class: "row", style: "gap:8px" },
        !t?.check_in && t?.status !== "leave" ? btn("سجّل حضوري الآن", async () => { const r = await api("/api/teacher/me-staff/check-in", {}); toast(r.status === "late" ? `سُجّل حضورك متأخرًا ${r.late_min} دقيقة` : "سُجّل حضورك"); refresh(); }, "primary") : null,
        t?.check_in && !t?.check_out ? btn("سجّل انصرافي", async () => { await api("/api/teacher/me-staff/check-out", {}); toast("سُجّل انصرافك"); refresh(); }, "ghost") : null)
        : notice("الحضور تسجله الإدارة في مدرستك.", "")),
    panel("هذا الشهر", null, stats([["أيام الحضور", d.month.present], ["التأخر", d.month.late], ["دقائق التأخر", d.month.late_minutes], ["الغياب", d.month.absent], ["الإجازة", d.month.leave]])),
    d.substitutions?.length ? panel("حصص الانتظار المسندة لك", null, d.substitutions.map((x) => line(
      h("div", {}, h("b", {}, `${fmtDay(x.day)} — الحصة ${x.period}`), sub([x.class_name, x.subject, x.absent_teacher ? `بدل ${x.absent_teacher}` : null].filter(Boolean).join(" — ")))))) : null,
    panel("طلب إجازة", null,
      h("div", { class: "row" }, field("النوع", kind), field("من", from), field("إلى", to)), field("السبب", reason),
      btn("إرسال الطلب", async () => {
        if (!from.value || !to.value) return toast("حدد التاريخين", true);
        await api("/api/teacher/me-staff/leaves", { kind: kind.value, from_day: from.value, to_day: to.value, reason: reason.value.trim() || null });
        toast("أُرسل الطلب للإدارة"); refresh();
      })),
    panel("طلباتي", null, d.leaves.length ? d.leaves.map((l) => line(
      h("div", {}, h("b", {}, `${LEAVE[l.kind]} — ${fmtDate(l.from_day)}${l.to_day !== l.from_day ? ` إلى ${fmtDate(l.to_day)}` : ""}`), " ", badge(...LSTATE[l.status]),
        l.reason ? sub(l.reason) : null, l.decision_note ? sub(`رد الإدارة: ${l.decision_note}`) : null),
      l.status === "pending" ? btn("إلغاء", async () => { await api(`/api/teacher/me-staff/leaves/${l.id}/cancel`, {}); refresh(); }, "ghost sm") : null)) : empty("لا توجد طلبات.")),
  ];
}
