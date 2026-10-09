// واجهة المحادثة المشتركة (ولي الأمر والمعلم): فقاعات الرسائل وخانة الكتابة، وتحديث تلقائي كل 15 ثانية أثناء فتحها
import { h, mount } from "./dom.js";
import { icons } from "./icons.js";
import { toast } from "./ui.js";

const time = (v) => new Date(v).toLocaleString("ar", { weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * me: "parent" أو "teacher" (رسائلي على جهة، ورسائل الطرف الآخر على الأخرى)
 * load(before) ← { messages, more } ، send(text) ← { message }
 */
export function chatThread({ me, title, subtitle, load, send, onBack, placeholder = "اكتب رسالتك…" }) {
  const list = h("div", { class: "chat-list", role: "log", "aria-live": "polite" });
  const more = h("button", { type: "button", class: "btn ghost sm chat-more", hidden: true }, "رسائل أقدم");
  const box = h("textarea", { rows: 1, maxLength: 1000, placeholder, "aria-label": "نص الرسالة" });
  const go = h("button", { type: "button", class: "chat-send", title: "إرسال", "aria-label": "إرسال" }, icons.chevronLeft({ size: 22, stroke: 2.4 }));
  let msgs = [], busy = false;

  const bubble = (m) => h("div", { class: `chat-msg ${m.sender === me ? "mine" : "theirs"}` },
    h("p", {}, m.body), h("small", {}, time(m.created_at)));
  const draw = (stick) => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    mount(list, msgs.length ? msgs.map(bubble) : h("p", { class: "chat-empty" }, "لا رسائل بعد. اكتب أول رسالة."));
    if (stick || atBottom) list.scrollTop = list.scrollHeight;
  };
  const refresh = async (first = false) => {
    try {
      const r = await load(null);
      const changed = r.messages.length !== msgs.length || r.messages.at(-1)?.id !== msgs.at(-1)?.id;
      if (first) more.hidden = !r.more;
      if (changed || first) { msgs = first ? r.messages : [...msgs.filter((m) => m.id < (r.messages[0]?.id ?? Infinity)), ...r.messages]; draw(first); }
    } catch (e) { if (first) mount(list, h("p", { class: "chat-empty" }, e.message)); }
  };
  more.addEventListener("click", async () => {
    const r = await load(msgs[0]?.id);
    msgs = [...r.messages, ...msgs]; more.hidden = !r.more;
    const h0 = list.scrollHeight; draw(false); list.scrollTop = list.scrollHeight - h0;
  });
  const submit = async () => {
    const text = box.value.trim();
    if (!text || busy) return;
    busy = true; go.disabled = true;
    try {
      const r = await send(text);
      msgs.push(r.message); box.value = ""; box.style.height = ""; draw(true);
    } catch (e) { toast(e.message, true); }
    busy = false; go.disabled = false; box.focus();
  };
  go.addEventListener("click", submit);
  // Enter يرسل على الكمبيوتر، وعلى الجوال سطر جديد (زر الإرسال واضح)
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer: fine)").matches) { e.preventDefault(); submit(); } });
  box.addEventListener("input", () => { box.style.height = ""; box.style.height = `${Math.min(box.scrollHeight, 140)}px`; });

  const el = h("div", { class: "chat" },
    h("div", { class: "chat-head" },
      onBack ? h("button", { type: "button", class: "chat-back", onclick: onBack, "aria-label": "رجوع" }, icons.chevronLeft({ size: 20 })) : null,
      h("div", {}, h("b", {}, title), subtitle ? h("small", {}, subtitle) : null)),
    more, list,
    h("div", { class: "chat-compose" }, box, go));
  refresh(true);
  const timer = setInterval(() => { if (!el.isConnected) return clearInterval(timer); if (!document.hidden) refresh(); }, 15000);
  return el;
}

// صف في قائمة المحادثات
export function chatRow({ title, subtitle, preview, unread, when, onClick }) {
  return h("button", { type: "button", class: `chat-row${unread ? " unread" : ""}`, onclick: onClick },
    h("span", { class: "chat-avatar", "aria-hidden": "true" }, String(title || "؟").replace(/^(أ\.|د\.)\s*/, "").trim().charAt(0)),
    h("span", { class: "chat-row-text" },
      h("b", {}, title), subtitle ? h("small", {}, subtitle) : null,
      preview ? h("span", { class: "chat-preview" }, preview) : null),
    h("span", { class: "chat-row-side" },
      when ? h("small", {}, time(when)) : null,
      unread ? h("span", { class: "chat-badge" }, String(unread)) : null));
}
