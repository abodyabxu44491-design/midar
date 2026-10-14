/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, textarea, btn, empty, sub, toast, dialog, notice } from "../../shared/js/ui.js";
import { chatThread, chatRow, CHAT_NOTE } from "../../shared/js/chat.js";

const C = "/api/teacher/chat";

export default async function chat({ me }) {
  const body = h("div");
  const list = async () => {
    const d = await api(C);
    enabled = d.enabled !== false;
    mount(body,
      d.enabled ? h("div", { class: "row spaced" }, sub("رسائل أولياء أمور طلابك. يصلك إشعار بكل رسالة جديدة."),
        btn("رسالة جديدة", () => compose(me, (r) => open({ id: r.thread_id })), "sm"))
        : notice("لم تفعّل إدارة المدرسة المراسلة لك بعد. تستطيع قراءة المحادثات السابقة فقط.", "warn"),
      d.enabled ? h("div", { class: "chat-hours" },
        h("div", {}, h("b", {}, "أوقات استقبال رسائل أولياء الأمور"),
          h("small", {}, d.hours_label || "كل الأوقات. حدّد أوقاتًا حتى لا تصلك رسائل خارج الدوام.")),
        btn(d.hours ? "تعديل" : "تحديد الأوقات", () => hoursDialog(d.hours, list), "ghost sm")) : null,
      h("p", { class: "chat-note" }, CHAT_NOTE),
      d.threads.length ? h("div", { class: "chat-rows" }, d.threads.map((t) => chatRow({ title: `ولي أمر ${t.student_name}`, subtitle: t.class_name,
        preview: t.last_preview, unread: t.unread, when: t.last_message_at, onClick: () => open(t) })))
        : empty("لا توجد رسائل بعد. عندما يراسلك ولي أمر تظهر المحادثة هنا."));
  };
  let enabled = true;
  const open = async (t) => {
    let info = t.student_name ? t : null;
    const ro = !enabled ? "لم تفعّل الإدارة المراسلة لك." : t.closed ? "أغلقت إدارة المدرسة هذه المحادثة." : null;
    mount(body, chatThread({ me: "teacher", title: info ? `ولي أمر ${info.student_name}` : "المحادثة", subtitle: info?.class_name, readOnly: ro,
      load: async (before) => {
        const r = await api(`${C}/${t.id}${before ? `?before=${before}` : ""}`);
        if (!info) { info = r.thread; body.querySelector(".chat-head b").textContent = `ولي أمر ${info.student_name}`; }
        return r;
      },
      send: (text) => api(`${C}/${t.id}`, { text }),
      onBack: list }));
  };
  await list();
  return panel("مراسلة أولياء الأمور", null, body);
}

async function compose(me, done) {
  const classes = [...new Map(me.load.map((l) => [l.class_id, l.class_name])).entries()];
  if (!classes.length) return toast("لا توجد فصول مسندة لك", true);
  const cls = select(classes);
  const student = select([]);
  const text = textarea({ rows: 3, maxLength: 1000, placeholder: "نص الرسالة" });
  const fill = async () => {
    const rows = await api(`/api/teacher/students?class_id=${cls.value}`).catch(() => []);
    mount(student, rows.map((s) => h("option", { value: s.id }, s.name)));
  };
  cls.addEventListener("change", fill);
  await fill();
  const d = dialog("رسالة لولي أمر", [field("الفصل", cls), field("الطالب", student), field("الرسالة", text)], [
    btn("إرسال", async () => {
      try {
        const r = await api(`${C}/start`, { student_id: Number(student.value), text: text.value });
        d.close(); toast("أُرسلت الرسالة"); done(r);
      } catch (e) { toast(e.message, true); }
    })]);
}

const DAYS = [[0, "الأحد"], [1, "الإثنين"], [2, "الثلاثاء"], [3, "الأربعاء"], [4, "الخميس"], [5, "الجمعة"], [6, "السبت"]];
function hoursDialog(cur, done) {
  const v = cur || { days: [0, 1, 2, 3, 4], from: "07:00", to: "14:00" };
  const always = h("input", { type: "checkbox", checked: !cur });
  const days = DAYS.map(([k, name]) => { const c = h("input", { type: "checkbox", value: k, checked: v.days.includes(k) }); return [c, h("label", { class: "chk day-chk" }, c, name)]; });
  const from = h("input", { type: "time", value: v.from }), to = h("input", { type: "time", value: v.to });
  const box = h("div", { class: "hours-box" }, h("div", { class: "day-grid" }, days.map((x) => x[1])),
    h("div", { class: "row" }, field("من الساعة", from), field("إلى الساعة", to)));
  const sync = () => { box.hidden = always.checked; };
  always.addEventListener("change", sync); sync();
  const d = dialog("أوقات استقبال الرسائل", h("div", {},
    sub("لا يستطيع ولي الأمر إرسال رسالة لك خارج هذه الأوقات، ويرى الأوقات بجانب اسمك. تستطيع أنت الرد في أي وقت."),
    h("label", { class: "chk" }, always, "أستقبل الرسائل في كل الأوقات"), box), [
    btn("حفظ", async () => {
      const hours = always.checked ? null : { days: days.filter(([c]) => c.checked).map(([c]) => Number(c.value)), from: from.value, to: to.value };
      try { await api(`${C}/hours`, { hours }, "PUT"); d.close(); toast("حُفظت أوقات المراسلة"); done(); }
      catch (e) { toast(e.message, true); }
    })]);
}
