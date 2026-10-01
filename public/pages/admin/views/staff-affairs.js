// شؤون الموظفين: حضور اليوم، الإجازات، حصص الانتظار، تحضير الدروس، والإعدادات
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, line, sub, stats, toast, notice, switchBtn, dialog } from "../../shared/js/ui.js";
import { fmtDate, today } from "../../shared/js/format.js";
import { partsView } from "../../shared/js/parts.js";
import { A } from "./common.js";

const ST = { present: ["حاضر", ""], late: ["متأخر", "amber"], absent: ["غائب", "red"], leave: ["إجازة", "gray"], excused: ["بعذر", "gray"] };
const LEAVE = { sick: "مرضية", annual: "سنوية", emergency: "اضطرارية", unpaid: "بدون راتب", official: "مهمة رسمية", other: "أخرى" };
const LSTATE = { pending: ["بانتظار القرار", "amber"], approved: ["معتمدة", ""], rejected: ["مرفوضة", "red"], cancelled: ["ملغاة", "gray"] };
const PSTATE = { draft: ["مسودة", "gray"], submitted: ["بانتظار المراجعة", "amber"], approved: ["معتمد", ""], returned: ["معاد للتعديل", "red"] };
const CAT = { teacher: "معلم", admin: "إداري", accountant: "محاسب", supervisor: "مشرف", guard: "حارس", driver: "سائق", cleaner: "عامل نظافة", worker: "عامل", other: "أخرى" };

export default async function staffAffairs({ me }) {
  const m = me.modules || {};
  const parts = [];
  if (m.staff_attendance) parts.push(["attendance", "حضور اليوم"], ["leaves", "الإجازات"], ["report", "التقرير"]);
  if (m.substitutes) parts.push(["substitutes", "حصص الانتظار"]);
  if (m.lesson_plans) parts.push(["plans", "تحضير الدروس"]);
  if (m.staff_attendance) parts.push(["settings", "الإعدادات"]);
  return partsView(parts, (p, nav) => ({ attendance, leaves, report, substitutes, plans, settings })[p](nav));
}

async function attendance(nav) {
  const dayInput = input({ type: "date", value: sessionStorage.getItem("midar_sa_day") || today(), max: today() });
  dayInput.addEventListener("change", () => { sessionStorage.setItem("midar_sa_day", dayInput.value); nav.show(); });
  const d = await api(`${A}/staff-affairs/attendance?day=${dayInput.value}`);
  const state = new Map(d.staff.map((s) => [s.staff_id, { status: s.status || (s.leave_kind ? "leave" : null), check_in: s.check_in?.slice(0, 5) || "" }]));
  const count = (k) => [...state.values()].filter((v) => v.status === k).length;
  const kpis = h("div");
  const drawKpis = () => mount(kpis, stats([["حاضر", count("present")], ["متأخر", count("late")], ["غائب", count("absent")], ["إجازة", count("leave")], ["لم يُسجّل", [...state.values()].filter((v) => !v.status).length]]));
  drawKpis();
  const rows = d.staff.map((s) => {
    const v = state.get(s.staff_id);
    const time = input({ type: "time", value: v.check_in, style: "max-width:110px", class: "ltr", "aria-label": `وقت حضور ${s.full_name}` });
    time.addEventListener("change", () => { v.check_in = time.value; });
    const btns = h("div", { class: "sa-btns" });
    const draw = () => mount(btns, Object.entries(ST).map(([k, [label]]) => h("button", { type: "button", class: `sa-st s-${k}${v.status === k ? " on" : ""}`,
      onclick: () => { v.status = k; draw(); drawKpis(); } }, label)));
    draw();
    return { draw, el: h("div", { class: "sa-row" },
      h("div", {}, h("b", {}, s.full_name), sub([CAT[s.category], s.leave_kind ? `إجازة ${LEAVE[s.leave_kind]} معتمدة` : null, s.source === "self" ? "سجّل بنفسه" : null].filter(Boolean).join(" — "))),
      btns, time) };
  });
  return panel("حضور الموظفين", null,
    h("div", { class: "row" }, field("اليوم", dayInput), h("div", { style: "align-self:end" },
      btn("غير المسجلين حاضرون", () => {
        for (const v of state.values()) if (!v.status) v.status = "present";
        rows.forEach((r) => r.draw()); drawKpis(); toast("اضغط «حفظ الحضور» لتثبيته");
      }, "ghost sm"))),
    kpis,
    d.staff.length ? h("div", { class: "sa-list" }, rows.map((r) => r.el)) : empty("لا يوجد موظفون نشطون. أضفهم من المالية ← الموظفون."),
    btn("حفظ الحضور", async () => {
      const entries = [...state.entries()].filter(([, v]) => v.status).map(([id, v]) => ({ staff_id: id, status: v.status, check_in: v.check_in || null }));
      if (!entries.length) return toast("حدد حالة موظف واحد على الأقل", true);
      await api(`${A}/staff-affairs/attendance`, { day: dayInput.value, entries });
      toast("حُفظ الحضور"); nav.show();
    }));
}

async function leaves(nav) {
  const status = select([["", "الكل"], ["pending", "بانتظار القرار"], ["approved", "المعتمدة"], ["rejected", "المرفوضة"]], { value: sessionStorage.getItem("midar_sa_lv") || "pending" });
  status.addEventListener("change", () => { sessionStorage.setItem("midar_sa_lv", status.value); nav.show(); });
  const [rows, staff] = await Promise.all([api(`${A}/staff-affairs/attendance/leaves${status.value ? `?status=${status.value}` : ""}`), api(`${A}/staff-affairs/attendance`)]);
  const who = select(staff.staff.map((s) => [s.staff_id, s.full_name]));
  const kind = select(Object.entries(LEAVE));
  const from = input({ type: "date", value: today() }), to = input({ type: "date", value: today() });
  const reason = input({ placeholder: "السبب (اختياري)", maxLength: 500 });
  return [
    panel("تسجيل إجازة لموظف", null, sub("الإجازة التي تسجلها الإدارة تُعتمد مباشرة. والمعلم يطلب إجازته من بوابته وتصلك هنا."),
      h("div", { class: "row" }, field("الموظف", who), field("النوع", kind)), h("div", { class: "row" }, field("من", from), field("إلى", to)), field("السبب", reason),
      btn("تسجيل واعتماد", async () => {
        await api(`${A}/staff-affairs/attendance/leaves`, { staff_id: Number(who.value), kind: kind.value, from_day: from.value, to_day: to.value, reason: reason.value.trim() || null });
        toast("سُجّلت الإجازة"); nav.show();
      })),
    panel("طلبات الإجازة", null, field("الحالة", status),
      rows.length ? rows.map((l) => line(
        h("div", {}, h("b", {}, l.full_name), " ", badge(...LSTATE[l.status]),
          sub(`${LEAVE[l.kind]} — من ${fmtDate(l.from_day)} إلى ${fmtDate(l.to_day)}${l.reason ? ` — ${l.reason}` : ""}`),
          l.decision_note ? sub(`ملاحظة: ${l.decision_note}`) : null),
        l.status === "pending" ? h("div", { class: "row", style: "flex:none;gap:6px" },
          btn("اعتماد", async () => { await api(`${A}/staff-affairs/attendance/leaves/${l.id}/decide`, { approve: true }); toast("اعتُمدت"); nav.show(); }, "sm"),
          btn("رفض", () => {
            const note = textarea({ rows: 2, maxLength: 300, placeholder: "سبب الرفض" });
            const dd = dialog("رفض الإجازة", field("السبب", note), [btn("رفض", async () => {
              await api(`${A}/staff-affairs/attendance/leaves/${l.id}/decide`, { approve: false, note: note.value.trim() || null }); dd.close(); nav.show(); }, "danger")]);
          }, "ghost sm")) : null)) : empty("لا توجد طلبات.")),
  ];
}

async function report(nav) {
  const first = `${today().slice(0, 7)}-01`;
  const from = input({ type: "date", value: sessionStorage.getItem("midar_sa_from") || first }), to = input({ type: "date", value: sessionStorage.getItem("midar_sa_to") || today() });
  for (const [k, el] of [["from", from], ["to", to]]) el.addEventListener("change", () => { sessionStorage.setItem(`midar_sa_${k}`, el.value); nav.show(); });
  const rows = await api(`${A}/staff-affairs/attendance/report?from=${from.value}&to=${to.value}`);
  return panel("تقرير حضور الموظفين", btn("طباعة", () => window.print(), "ghost sm"),
    h("div", { class: "row" }, field("من", from), field("إلى", to)),
    sub("الغياب بلا إجازة والإجازة بدون راتب يُخصمان تلقائيًا عند إنشاء مسير الرواتب (إن كان الخصم مفعّلًا في الإعدادات)."),
    h("div", { class: "table-wrap" }, h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, ["الموظف", "حضور", "تأخر", "دقائق التأخر", "غياب", "إجازة"].map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, r.full_name), h("td", {}, r.present), h("td", {}, r.late), h("td", {}, r.late_minutes),
        h("td", { class: r.absent ? "danger-text" : "" }, r.absent), h("td", {}, r.leave)))))));
}

async function substitutes(nav) {
  const dayInput = input({ type: "date", value: sessionStorage.getItem("midar_sub_day") || today() });
  dayInput.addEventListener("change", () => { sessionStorage.setItem("midar_sub_day", dayInput.value); nav.show(); });
  const d = await api(`${A}/staff-affairs/substitutes?day=${dayInput.value}`);
  return panel("حصص الانتظار", null, field("اليوم", dayInput),
    sub("المعلمون الغائبون أو في إجازة في هذا اليوم، وحصصهم من الجدول. المقترحون هم الفارغون في الحصة نفسها، والأقل انتظارًا هذا الأسبوع أولًا."),
    d.absent.length ? sub(`الغائبون: ${d.absent.map((a) => a.full_name).join("، ")}`) : null,
    d.slots.length ? h("div", { class: "table-wrap" }, h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, ["الحصة", "الشعبة", "المادة", "المعلم الغائب", "البديل"].map((x) => h("th", {}, x)))),
      h("tbody", {}, d.slots.map((s) => {
        const pick = select([["", "اختر بديلًا…"], ...s.candidates.map((c) => [c.id, `${c.name}${c.load ? ` (${c.load} هذا الأسبوع)` : ""}`])], { value: s.substitute_teacher_id || "" });
        pick.addEventListener("change", async () => {
          try {
            if (!pick.value) await api(`${A}/staff-affairs/substitutes?slot_id=${s.slot_id}&day=${d.day}`, undefined, "DELETE");
            else await api(`${A}/staff-affairs/substitutes`, { day: d.day, slot_id: s.slot_id, substitute_teacher_id: Number(pick.value) });
            toast(pick.value ? "عُيّن البديل وأُشعر" : "أُلغي التعيين");
          } catch (e) { toast(e.message, true); nav.show(); }
        });
        return h("tr", {}, h("td", {}, s.period), h("td", {}, s.class_name), h("td", {}, s.subject || "—"), h("td", {}, s.teacher), h("td", {}, pick));
      })))) : empty(d.absent.length ? "لا حصص للغائبين في هذا اليوم." : "لا يوجد معلمون غائبون في هذا اليوم. سجّل الغياب أو الإجازة أولًا."));
}

async function plans(nav) {
  const weekInput = input({ type: "date", value: sessionStorage.getItem("midar_lp_week") || today() });
  weekInput.addEventListener("change", () => { sessionStorage.setItem("midar_lp_week", weekInput.value); nav.show(); });
  const cov = await api(`${A}/staff-affairs/lesson-plans/coverage?week=${weekInput.value}`);
  const list = await api(`${A}/staff-affairs/lesson-plans?week=${cov.week}`);
  const byId = new Map(list.map((p) => [p.id, p]));
  const done = cov.rows.filter((r) => r.plan_id).length;
  return panel(`تحضير أسبوع ${fmtDate(cov.week)}`, null, field("أي يوم في الأسبوع", weekInput),
    stats([["مطلوب", cov.rows.length], ["سُلّم", done], ["بانتظار مراجعتك", list.filter((p) => p.status === "submitted").length], ["لم يُحضّر", cov.rows.length - done]]),
    cov.rows.length ? cov.rows.map((r) => {
      const p = r.plan_id ? byId.get(r.plan_id) : null;
      return line(h("div", {}, h("b", {}, `${r.teacher} — ${r.class_name} — ${r.subject}`), " ", p ? badge(...PSTATE[p.status]) : badge("لم يُحضّر", "red"),
        p ? sub(p.topic) : null),
        p ? btn(p.status === "submitted" ? "مراجعة" : "عرض", () => planDialog(p, nav), "ghost sm") : null);
    }) : empty("لا يوجد إسناد للمعلمين بعد."));
}

function planDialog(p, nav) {
  const note = textarea({ rows: 2, maxLength: 1000, placeholder: "ملاحظة للمعلم (مطلوبة عند الإعادة)" });
  const rowOf = (label, v) => (v ? h("div", { class: "lp-block" }, h("b", {}, label), h("p", {}, v)) : null);
  const dd = dialog(`${p.topic}`, h("div", { class: "lp-view" },
    sub(`${p.teacher} — ${p.class_name} — ${p.subject} — أسبوع ${fmtDate(p.week_start)}`),
    rowOf("الأهداف", p.objectives), rowOf("المحتوى", p.content), rowOf("الأنشطة", p.activities), rowOf("التقويم", p.assessment),
    rowOf("الواجب", p.homework), rowOf("الوسائل", p.resources), p.review_note ? notice(`ملاحظة سابقة: ${p.review_note}`, "") : null,
    p.status === "submitted" ? field("ملاحظتك", note) : null),
  p.status === "submitted" ? [
    btn("اعتماد", async () => { await api(`${A}/staff-affairs/lesson-plans/${p.id}/review`, { approve: true, note: note.value.trim() || null }); dd.close(); toast("اعتُمد"); nav.show(); }),
    btn("إعادة للتعديل", async () => { await api(`${A}/staff-affairs/lesson-plans/${p.id}/review`, { approve: false, note: note.value.trim() || null }); dd.close(); toast("أُعيد للمعلم"); nav.show(); }, "ghost"),
  ] : []);
}

async function settings() {
  const s = (await api(`${A}/communication/features`)).staff;
  const save = async (patch) => { Object.assign(s, await api(`${A}/communication/features/staff`, patch, "PUT")); toast("تم الحفظ"); return true; };
  const f = (key, el) => { el.addEventListener("change", () => save({ [key]: el.type === "number" ? Number(el.value) : el.value })); return el; };
  return panel("إعدادات الدوام", null,
    h("div", { class: "row" }, field("بداية الدوام", f("work_start", input({ type: "time", value: s.work_start, class: "ltr" }))),
      field("نهاية الدوام", f("work_end", input({ type: "time", value: s.work_end, class: "ltr" }))),
      field("يُحسب متأخرًا بعد (دقيقة)", f("late_after_min", input({ type: "number", min: 0, max: 180, value: s.late_after_min, class: "ltr" })))),
    line(h("div", {}, h("b", {}, "المعلم يسجل حضوره من بوابته"), sub("بضغطة عند الوصول والانصراف، ويُحسب التأخر تلقائيًا")), switchBtn(s.self_checkin, "الحضور الذاتي", (v) => save({ self_checkin: v }))),
    line(h("div", {}, h("b", {}, "خصم الغياب من الراتب"), sub("الغياب بلا إجازة والإجازة بدون راتب، عند إنشاء المسير")), switchBtn(s.deduct_absence, "خصم الغياب", (v) => save({ deduct_absence: v }))),
    field("أيام العمل في الشهر (لحساب سعر اليوم)", f("working_days", input({ type: "number", min: 20, max: 31, value: s.working_days, class: "ltr" }))));
}

