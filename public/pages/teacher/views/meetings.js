// مواعيدي مع أولياء الأمور (المعلم)
import { api } from "../../shared/js/api.js";
import { panel, sub } from "../../shared/js/ui.js";
import { slotForm, slotsList } from "../../admin/views/meetings.js";

export default async function meetings({ me, refresh }) {
  const base = "/api/teacher/meetings";
  const slots = await api(base);
  const classes = [...new Map((me.load || []).map((l) => [l.class_id, { id: l.class_id, name: l.class_name }])).values()];
  return [slotForm(base, { classes }, refresh),
    panel("مواعيدي", null, sub("يحجزها أولياء أمور طلابك من ملف الطالب، ويصلك إشعار بكل حجز."), slotsList(base, slots, refresh))];
}
