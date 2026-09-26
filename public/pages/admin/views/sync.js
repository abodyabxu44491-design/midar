// المزامنة والأجهزة (الإدارة): تعارضات تحتاج مراجعة، الأجهزة المسجلة وإيقافها، ومؤشرات المزامنة
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, btn, badge, sub, empty, toast, confirmAction, stats, line } from "../../shared/js/ui.js";
import { ATTENDANCE, fmtDateTime } from "../../shared/js/format.js";
import { A } from "./common.js";

export default async function syncView({ show }) {
  const [st, conflicts, devices] = await Promise.all([api(`${A}/sync/stats`), api(`${A}/sync/conflicts`), api(`${A}/sync/devices`)]);
  const val = (o, side) => (o.op_type === "attendance.mark" ? (ATTENDANCE[o.result?.[side]?.status]?.[0] || o.result?.[side]?.status || "—")
    : (o.result?.[side]?.score ?? "—"));
  return [
    stats([["عمليات طُبّقت (30 يومًا)", st.applied], ["تعارضات مفتوحة", st.conflicts], ["رُفضت", st.rejected], ["أجهزة فعّالة", st.devices]]),
    st.avg_delay_seconds != null ? sub(`متوسط زمن وصول العمليات من الأجهزة: ${st.avg_delay_seconds} ثانية`) : null,
    panel(`تعارضات تحتاج مراجعة (${conflicts.length})`, null,
      sub("سجلات عُدّلت من جهاز معلم بدون اتصال، وعدّلها شخص آخر في الوقت نفسه. لم يُكتب أي منها فوق الآخر حتى تختار."),
      conflicts.length ? conflicts.map((o) => line(
        h("div", {}, h("b", {}, `${o.student_name || "طالب"} — ${o.class_name || ""}`), " ",
          badge(o.op_type === "attendance.mark" ? `الحضور ${o.payload.day}` : "درجة", "gray"),
          sub(`الحالية: ${val(o, "server")}${o.result?.server?.by ? ` (${o.result.server.by})` : ""} — من جهاز ${o.actor}: ${val(o, "local")} — ${fmtDateTime(o.client_time || o.received_at)}`)),
        h("div", { class: "row", style: "flex:none" },
          btn("اعتماد قيمة الجهاز", async () => { await api(`${A}/sync/conflicts/${o.operation_id}/resolve`, { choice: "local" }); toast("طُبّقت قيمة الجهاز"); show("sync"); }, "primary sm"),
          btn("إبقاء الحالية", async () => { await api(`${A}/sync/conflicts/${o.operation_id}/resolve`, { choice: "server" }); toast("أُبقيت القيمة الحالية"); show("sync"); }, "ghost sm"))))
        : empty("لا توجد تعارضات.")),
    panel("الأجهزة المسجلة", null,
      sub("كل جهاز عمل عليه معلم بدون اتصال. أوقف أي جهاز مفقود أو غير موثوق: لن يستطيع إرسال عمليات بعدها."),
      devices.length ? devices.map((d) => line(
        h("div", { class: d.revoked_at ? "muted-row" : "" }, h("b", {}, d.full_name), " ", d.revoked_at ? badge("موقوف", "red") : null,
          sub(`${(d.user_agent || "").replace(/\s*\(.*?\)\s*/g, " ").slice(0, 60)} — آخر نشاط ${fmtDateTime(d.last_seen)} — ${d.operations} عملية`)),
        d.revoked_at ? null : btn("إيقاف الجهاز", async () => {
          if (!confirmAction(`إيقاف جهاز ${d.full_name}؟ لن يستطيع إرسال أي عمليات بعد الآن.`)) return;
          await api(`${A}/sync/devices/${d.device_id}/revoke`, {}); toast("أُوقف الجهاز"); show("sync");
        }, "danger sm"))) : empty("لم يستخدم أي معلم العمل بدون اتصال بعد.")),
  ];
}
