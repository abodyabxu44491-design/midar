// واجهات مشتركة: نموذج الإجابة عن استبيان، وقائمة المواعيد المتاحة للحجز
import { h } from "./dom.js";
import { btn, sub, toast, textarea, empty, line, badge, input, field } from "./ui.js";
import { fmtDay } from "./format.js";

/** نموذج استبيان. send(answers) يرسل الإجابات */
export function surveyForm(s, send, onDone) {
  const answers = {};
  const qEl = (q) => {
    let control;
    if (q.type === "rating") control = h("div", { class: "sv-rating" }, [1, 2, 3, 4, 5].map((n) => h("label", {},
      h("input", { type: "radio", name: q.id, onchange: () => { answers[q.id] = n; } }), h("span", {}, String(n)))));
    else if (q.type === "yesno") control = h("div", { class: "oe-choices tf" }, [[true, "نعم"], [false, "لا"]].map(([v, l]) => h("label", {},
      h("input", { type: "radio", name: q.id, onchange: () => { answers[q.id] = v; } }), h("span", {}, l))));
    else if (q.type === "choice") control = h("div", { class: "oe-choices" }, q.options.map((o, i) => h("label", {},
      h("input", { type: "radio", name: q.id, onchange: () => { answers[q.id] = i; } }), h("span", {}, o))));
    else if (q.type === "multi") control = h("div", { class: "oe-choices" }, q.options.map((o, i) => h("label", {},
      h("input", { type: "checkbox", onchange: (e) => { const set = new Set(answers[q.id] || []); e.target.checked ? set.add(i) : set.delete(i); answers[q.id] = [...set]; } }), h("span", {}, o))));
    else { control = textarea({ rows: 3, maxLength: 2000 }); control.addEventListener("input", () => { answers[q.id] = control.value; }); }
    return h("div", { class: "oe-question" }, h("b", {}, q.text, q.required ? null : h("small", { class: "muted" }, " (اختياري)")), control);
  };
  return h("div", { class: "oe-take" },
    s.description ? sub(s.description) : null,
    s.anonymous ? sub("الإجابات بلا أسماء.") : sub("تظهر إجابتك للإدارة باسمك."),
    s.questions.map(qEl),
    btn("إرسال", async () => {
      try { await send(answers); toast("شكرًا، وصلت إجاباتك"); onDone?.(); } catch (e) { toast(e.message, true); }
    }, "primary wide"));
}

/** المواعيد المتاحة لولي الأمر: مجمعة حسب الجهة واليوم */
export function meetingsBoard(slots, { book, cancel }) {
  if (!slots.length) return empty("لا توجد مواعيد متاحة حاليًا.");
  const mine = slots.filter((s) => s.mine);
  const free = slots.filter((s) => !s.booking_id);
  const groups = new Map();
  for (const s of free) { const k = `${s.host_name}|${s.day}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const topic = input({ placeholder: "موضوع الموعد (اختياري)", maxLength: 300 });
  const MODE = { in_person: "حضوري", phone: "اتصال", video: "مرئي" };
  return [
    mine.length ? h("div", {}, h("h3", { class: "sec-title" }, "مواعيدي"), mine.map((s) => line(
      h("div", {}, h("b", {}, `${s.host_name} — ${fmtDay(s.day)} الساعة ${s.start_time.slice(0, 5)}`), " ", badge(MODE[s.mode] || ""),
        sub([s.location, s.topic].filter(Boolean).join(" — "))),
      cancel ? btn("إلغاء", () => cancel(s), "ghost sm") : null))) : null,
    free.length ? [h("h3", { class: "sec-title" }, "احجز موعدًا"), field("الموضوع", topic),
      [...groups.entries()].map(([k, list]) => {
        const [host, d] = k.split("|");
        return h("div", { class: "mt-group" }, h("b", {}, `${host} — ${fmtDay(d)}`), list[0].location ? sub(list[0].location) : null,
          h("div", { class: "mt-slots" }, list.map((s) => h("button", { type: "button", class: "mt-slot", onclick: () => book(s, topic.value.trim() || null) }, s.start_time.slice(0, 5)))));
      })] : null,
  ];
}


