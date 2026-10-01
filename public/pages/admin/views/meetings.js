// مواعيد أولياء الأمور (الإدارة): فترات للإدارة أو لأي معلم، والحجوزات
import { h } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast } from "../../shared/js/ui.js";
import { fmtDay, today } from "../../shared/js/format.js";
import { A } from "./common.js";

export const BST = { booked: ["محجوز", ""], done: ["تم", "gray"], no_show: ["لم يحضر", "red"] };
export function slotForm(base, { teachers = null, classes = [] } = {}, after) {
  const dayI = input({ type: "date", value: today(), min: today() }), from = input({ type: "time", value: "09:00", class: "ltr" }), to = input({ type: "time", value: "11:00", class: "ltr" });
  const minutes = input({ type: "number", min: 5, max: 180, value: 15, class: "ltr" });
  const mode = select([["in_person", "حضوري"], ["phone", "اتصال هاتفي"], ["video", "مكالمة مرئية"]]);
  const loc = input({ placeholder: "المكان" });
  const host = teachers ? select([["", "إدارة المدرسة"], ...teachers.map((t) => [t.id, t.full_name || t.name])]) : null;
  const cls = select([["", "كل أولياء الأمور"], ...classes.map((c) => [c.id, c.name])]);
  return panel("إضافة مواعيد", null,
    host ? field("المواعيد مع", host) : null,
    h("div", { class: "row" }, field("اليوم", dayI), field("من", from), field("إلى", to), field("مدة الموعد (دقيقة)", minutes)),
    h("div", { class: "row" }, field("الطريقة", mode), field("المكان", loc), field("متاحة لـ", cls)),
    btn("إنشاء المواعيد", async () => {
      const r = await api(base, { day: dayI.value, from: from.value, to: to.value, minutes: Number(minutes.value), mode: mode.value, location: loc.value.trim() || null,
        class_id: cls.value ? Number(cls.value) : null, ...(host && host.value ? { teacher_id: Number(host.value) } : {}) });
      toast(`أُنشئ ${r.created} موعد`); after();
    }));
}
export function slotsList(base, slots, after) {
  if (!slots.length) return empty("لا توجد مواعيد.");
  return slots.map((s) => line(
    h("div", {}, h("b", {}, `${fmtDay(s.day)} — ${s.start_time.slice(0, 5)}`), " ", s.booking_id ? badge(...(BST[s.booking_status] || ["محجوز", ""])) : badge("متاح", "gray"),
      sub([s.host_name, s.student ? `ولي أمر ${s.student}${s.student_class ? ` (${s.student_class})` : ""}` : null, s.topic, s.location].filter(Boolean).join(" — "))),
    h("div", { class: "row", style: "flex:none;gap:6px" },
      s.booking_id && s.booking_status === "booked" ? [btn("تم", async () => { await api(`${base}/bookings/${s.booking_id}`, { status: "done" }); after(); }, "sm"),
        btn("لم يحضر", async () => { await api(`${base}/bookings/${s.booking_id}`, { status: "no_show" }); after(); }, "ghost sm"),
        btn("إلغاء", async () => { await api(`${base}/bookings/${s.booking_id}`, { status: "cancelled" }); toast("أُلغي وأُشعر ولي الأمر"); after(); }, "ghost sm")]
        : !s.booking_id ? btn("حذف", async () => { await api(`${base}/${s.id}`, undefined, "DELETE"); after(); }, "ghost sm") : null)));
}

export default async function meetings({ nav }) {
  const base = `${A}/engagement/meetings`;
  const [slots, teachers, classes] = await Promise.all([api(base), api(`${A}/teachers/`), api(`${A}/structure/classes`)]);
  const booked = slots.filter((s) => s.booking_id && s.booking_status === "booked").length;
  return [slotForm(base, { teachers, classes }, () => nav.show()),
    panel(`المواعيد (${booked} محجوز)`, null, sub("ولي الأمر يحجز من ملف ابنه: مواعيد الإدارة، ومعلمي شعبة ابنه. ويصله تذكير قبل الموعد بيوم."),
      slotsList(base, slots, () => nav.show()))];
}
