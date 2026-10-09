// مراسلة أولياء الأمور: محادثات المعلم مع أولياء أمور طلاب فصوله
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, textarea, btn, empty, sub, toast, dialog } from "../../shared/js/ui.js";
import { chatThread, chatRow } from "../../shared/js/chat.js";

const C = "/api/teacher/chat";

export default async function chat({ me }) {
  const body = h("div");
  const list = async () => {
    const d = await api(C);
    mount(body,
      h("div", { class: "row spaced" }, sub("رسائل أولياء أمور طلابك. يصلك إشعار بكل رسالة جديدة."),
        btn("رسالة جديدة", () => compose(me, (r) => open({ id: r.thread_id })), "sm")),
      d.threads.length ? h("div", { class: "chat-rows" }, d.threads.map((t) => chatRow({ title: `ولي أمر ${t.student_name}`, subtitle: t.class_name,
        preview: t.last_preview, unread: t.unread, when: t.last_message_at, onClick: () => open(t) })))
        : empty("لا توجد رسائل بعد. عندما يراسلك ولي أمر تظهر المحادثة هنا."));
  };
  const open = async (t) => {
    let info = t.student_name ? t : null;
    mount(body, chatThread({ me: "teacher", title: info ? `ولي أمر ${info.student_name}` : "المحادثة", subtitle: info?.class_name,
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

// رسالة جديدة لولي أمر طالب من فصول المعلم
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
