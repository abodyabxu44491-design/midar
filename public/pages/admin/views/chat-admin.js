/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, btn, empty, notice, sub, badge, switchBtn, toast, input, dialog, field, textarea, confirmAction } from "../../shared/js/ui.js";
import { A } from "./common.js";

const C = `${A}/chat`;
const when = (t) => new Date(t).toLocaleString("ar", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function chatAdmin() {
  const box = h("div");
  const home = async () => mount(box, await overview(openThread));
  const openThread = async (id) => mount(box, await threadView(id, home));
  const reload = () => { if (!box.isConnected) return document.removeEventListener("chat-admin-reload", reload); home(); };
  document.addEventListener("chat-admin-reload", reload);
  await home();
  return box;
}

async function overview(openThread) {
  const [teachers, threads] = await Promise.all([api(`${C}/teachers`), api(`${C}/threads`)]);
  const enabled = teachers.filter((t) => t.chat_enabled).length;
  const flagged = threads.filter((t) => t.flagged_at).length;
  let filter = flagged ? "flagged" : "all", term = "";
  const list = h("div", { class: "ca-threads" });
  const chips = h("div", { class: "seg-tabs ca-filter", role: "tablist" });
  const search = input({ type: "search", placeholder: "ابحث باسم المعلم أو الطالب" });
  const drawList = () => {
    mount(chips, [["all", `كل المحادثات (${threads.length})`], ["flagged", `تحتاج مراجعة (${flagged})`], ["closed", "المغلقة"]].map(([k, label]) =>
      h("button", { type: "button", role: "tab", class: k === filter ? "on" : "", onclick: () => { filter = k; drawList(); } }, label)));
    const rows = threads.filter((t) => (filter === "flagged" ? t.flagged_at : filter === "closed" ? t.closed_at : true)
      && (!term || `${t.teacher_name} ${t.student_name}`.includes(term)));
    mount(list, rows.length ? rows.map((t) => h("button", { type: "button", class: `ca-row${t.flagged_at ? " flag" : ""}`, onclick: () => openThread(t.id) },
      h("span", { class: "ca-main" },
        h("b", {}, `${t.teacher_name} ↔ ولي أمر ${t.student_name}`),
        h("small", {}, [t.class_name, `${t.messages} رسالة`, when(t.last_message_at)].filter(Boolean).join(" · ")),
        t.last_preview ? h("span", { class: "ca-prev" }, t.last_preview) : null),
      h("span", { class: "ca-side" },
        t.flagged_at ? badge("تحتاج مراجعة", "red") : null,
        t.closed_at ? badge("مغلقة", "gray") : null)))
      : empty(filter === "flagged" ? "لا توجد رسائل تحتاج مراجعة." : "لا توجد محادثات بعد."));
  };
  search.addEventListener("input", () => { term = search.value.trim(); drawList(); });
  drawList();

  const teacherRows = h("div", { class: "ca-teachers" }, teachers.map((t) => h("div", { class: "ca-teacher" },
    h("div", { class: "ca-main" }, h("b", {}, t.name),
      h("small", {}, [t.threads ? `${t.threads} محادثة` : "لا محادثات", t.flagged ? `${t.flagged} تحتاج مراجعة` : null].filter(Boolean).join(" · "))),
    switchBtn(t.chat_enabled, `مراسلة ${t.name}`, async (v) => {
      await api(`${C}/teachers/${t.id}`, { enabled: v }, "PUT");
      toast(v ? `فُعّلت المراسلة لـ ${t.name}` : `أُوقفت المراسلة لـ ${t.name}`);
    }))));
  const bulk = (v) => btn(v ? "تفعيل للجميع" : "إيقاف للجميع", async () => {
    if (!v && !(await confirmAction("إيقاف المراسلة لكل المعلمين؟ تبقى المحادثات السابقة محفوظة ويمكنك الاطلاع عليها."))) return;
    const r = await api(`${C}/teachers`, { enabled: v }, "PUT");
    toast(`تم (${r.changed} معلم)`);
    document.dispatchEvent(new CustomEvent("chat-admin-reload"));
  }, v ? "soft sm" : "ghost sm");

  return [
    h("div", { class: "ca-rules" },
      h("b", {}, "ضوابط المراسلة"),
      h("ul", {},
        h("li", {}, "لا يراسل أي معلم أولياء الأمور إلا بعد أن تفعّل له المراسلة هنا."),
        h("li", {}, "يظهر للمعلم وولي الأمر أن المحادثات محفوظة ويمكن للإدارة الاطلاع عليها."),
        h("li", {}, "الرسائل التي تذكر مالًا أو تحويلًا أو هدية أو دروسًا خصوصية أو أرقام تواصل خارج المنصة تُعلَّم «تحتاج مراجعة» ويصلك إشعار بها."),
        h("li", {}, "لا يمكن تعديل الرسائل ولا حذفها، وكل اطلاع أو إغلاق يُسجَّل في سجل المدرسة."))),
    panel(h("span", {}, "المحادثات ", flagged ? badge(`${flagged} تحتاج مراجعة`, "red") : null), null, chips, search, list),
    panel(h("span", {}, "المعلمون المسموح لهم بالمراسلة ", badge(`${enabled} من ${teachers.length}`, "gray")),
      h("div", { class: "row", style: "flex:none;gap:6px" }, bulk(true), bulk(false)),
      teachers.length ? teacherRows : empty("لا يوجد معلمون بعد.")),
  ];
}

async function threadView(id, back) {
  const d = await api(`${C}/threads/${id}`);
  let msgs = d.messages, more = d.more;
  const th = d.thread;
  const list = h("div", { class: "ca-msgs" });
  const draw = () => mount(list,
    more ? btn("رسائل أقدم", async () => {
      const r = await api(`${C}/threads/${id}?before=${msgs[0].id}`);
      msgs = [...r.messages, ...msgs]; more = r.more; draw();
    }, "ghost sm") : null,
    msgs.length ? msgs.map((m) => h("div", { class: `ca-msg ${m.sender}${m.flagged ? " flag" : ""}` },
      h("small", {}, `${m.sender === "teacher" ? th.teacher_name : m.sender_name || "ولي الأمر"} · ${when(m.created_at)}`),
      h("p", {}, m.body),
      m.flagged ? h("small", { class: "ca-flag" }, "تحتاج مراجعة") : null)) : empty("لا رسائل."));
  draw();
  const closeDialog = () => {
    const reason = textarea({ rows: 2, maxLength: 200, placeholder: "مثال: طلب مالي خارج إطار المدرسة" });
    const dd = dialog("إغلاق المحادثة", h("div", {}, field("السبب (يظهر للطرفين)", reason),
      sub("بعد الإغلاق لا يستطيع المعلم ولا ولي الأمر إرسال رسائل في هذه المحادثة، وتبقى محفوظة.")), [
      btn("إغلاق المحادثة", async () => {
        await api(`${C}/threads/${id}/close`, { closed: true, reason: reason.value.trim() || null });
        dd.close(); toast("أُغلقت المحادثة"); back();
      }, "danger")]);
  };
  return panel(h("span", {}, `${th.teacher_name} ↔ ولي أمر ${th.student_name}`),
    btn("رجوع", back, "ghost sm"),
    sub([th.class_name, "عرض للقراءة فقط، وتم تسجيل اطلاعك في سجل المدرسة."].filter(Boolean).join(" · ")),
    th.closed_at ? notice(`المحادثة مغلقة منذ ${when(th.closed_at)}${th.closed_by ? ` بواسطة ${th.closed_by}` : ""}${th.close_reason ? `: ${th.close_reason}` : ""}`, "warn") : null,
    th.flagged_at ? notice("في هذه المحادثة رسائل تحتاج مراجعة (مظللة بالأحمر).", "err") : null,
    list,
    h("div", { class: "row spaced ca-acts" },
      th.flagged_at ? btn("تمت المراجعة، لا مخالفة", async () => { await api(`${C}/threads/${id}/reviewed`, {}); toast("تمت المراجعة"); back(); }, "soft") : null,
      th.closed_at ? btn("إعادة فتح المحادثة", async () => { await api(`${C}/threads/${id}/close`, { closed: false }); toast("فُتحت المحادثة"); back(); }, "ghost")
        : btn("إغلاق المحادثة", closeDialog, "danger")));
}
