// المساعد الذكي (الإدارة): اسأل عن بيانات مدرستك بلغتك. القراءة فقط، والإجابة تُبنى من الأرقام الفعلية
import { h } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, btn, textarea, toast, sub, empty } from "../../shared/js/ui.js";
import { icons } from "../../shared/js/icons.js";
import { A } from "./common.js";

const SUGGESTIONS = [
  "ما نسبة الحضور هذا الفصل؟ وأي الفصول أقل حضورًا؟",
  "من الطلاب الأكثر غيابًا ويحتاجون متابعة؟",
  "ما المواد الأضعف في نتائج الاختبارات؟",
  "كم المتبقي من الرسوم ومن أعلى المتأخرين في السداد؟",
  "من الطلاب المتميزون سلوكيًا هذا الشهر؟",
  "أعطني ملخص المدرسة اليوم",
];

/* تحويل نص الإجابة (Markdown مبسط) إلى عناصر آمنة بلا innerHTML */
function inline(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(text))) { out.push(text.slice(last, m.index), h("b", {}, m[1])); last = re.lastIndex; }
  out.push(text.slice(last));
  return out.filter((x) => x !== "");
}
export function renderAnswer(text) {
  const lines = String(text).split("\n");
  const blocks = [];
  let list = null, table = null;
  const flush = () => { if (list) blocks.push(list); if (table) blocks.push(h("div", { class: "scroll" }, table)); list = null; table = null; };
  for (const raw of lines) {
    const l = raw.trim();
    const cells = /^\|.*\|$/.test(l) ? l.slice(1, -1).split("|").map((c) => c.trim()) : null;
    if (cells) {
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!table) { flush(); table = h("table", { class: "grid ai-tbl" }, h("thead", {}, h("tr", {}, cells.map((c) => h("th", {}, inline(c))))), h("tbody")); }
      else table.tBodies[0].append(h("tr", {}, cells.map((c) => h("td", {}, inline(c)))));
      continue;
    }
    const bullet = l.match(/^[-*•]\s+(.*)$/), num = l.match(/^(\d+)[.)]\s+(.*)$/);
    if (bullet || num) {
      const tag = num ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag) { flush(); list = h(tag); }
      list.append(h("li", {}, inline(num ? num[2] : bullet[1])));
      continue;
    }
    flush();
    if (!l) continue;
    const head = l.match(/^#{1,4}\s+(.*)$/);
    blocks.push(head ? h("h4", {}, inline(head[1])) : h("p", {}, inline(l)));
  }
  flush();
  return h("div", { class: "ai-answer" }, blocks);
}

export default async function ai() {
  const state = await api(`${A}/ai`);
  const history = [];           // أسئلة هذه الجلسة (للمتابعة على السؤال السابق)
  const thread = h("div", { class: "ai-thread", "aria-live": "polite" });
  const box = textarea({ rows: 2, maxLength: 1000, placeholder: "اكتب سؤالك… مثال: من الطلاب الأكثر غيابًا في الصف الخامس؟" });
  const remaining = sub("");

  const bubble = (q, answerEl, when) => h("div", { class: "ai-turn" },
    h("div", { class: "ai-q" }, q),
    h("div", { class: "ai-a" }, h("span", { class: "ai-mark" }, icons.sparkle({ size: 16 })), answerEl,
      when ? h("small", { class: "sub" }, new Date(when).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })) : null));

  async function send(question) {
    question = (question ?? box.value).trim();
    if (question.length < 2) { box.focus(); return; }
    box.value = "";
    const waiting = h("div", { class: "ai-wait" }, h("span", {}), h("span", {}), h("span", {}), " يجمع الأرقام ويحلّلها…");
    emptyNote?.remove();
    thread.prepend(bubble(question, waiting));
    sendBtn.disabled = true;
    try {
      const r = await api(`${A}/ai/ask`, { question, history: history.slice(-4) });
      waiting.replaceWith(renderAnswer(r.answer));
      history.push({ q: question, a: r.answer });
      remaining.textContent = `متبقٍ اليوم للمدرسة: ${r.remaining_today} سؤالًا`;
    } catch (e) {
      waiting.replaceWith(h("p", { class: "err" }, e.message));
      toast(e.message, true);
    } finally { sendBtn.disabled = false; }
  }

  const sendBtn = btn("اسأل", () => send(), "primary");
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });

  for (const x of state.recent.slice(0, 10)) thread.append(bubble(x.question, renderAnswer(x.answer || ""), x.created_at));

  const emptyNote = state.recent.length ? null : empty("لم تسأل بعد. جرّب أحد الاقتراحات أعلاه.");
  return [
    panel("المساعد الذكي", null,
      sub("اسأل عن الحضور والدرجات والرسوم والسلوك وشؤون الموظفين، ويجيبك من بيانات مدرستك الفعلية. المساعد يقرأ فقط ولا يعدّل شيئًا."),
      h("div", { class: "ai-ask" }, box, sendBtn),
      remaining,
      h("div", { class: "ai-suggest" }, SUGGESTIONS.map((s) => h("button", { type: "button", class: "chip", onclick: () => send(s) }, s))),
      h("small", { class: "sub ai-privacy" }, "لمعالجة السؤال تُرسل الأرقام المطلوبة إلى خدمة Claude من Anthropic، بدون أرقام هواتف أو بيانات دخول. يمكن إيقاف المساعد من الإعدادات.")),
    panel("المحادثة", null, emptyNote, thread),
  ];
}
