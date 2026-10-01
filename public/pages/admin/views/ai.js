// المساعد الذكي (الإدارة):
//   1) تقارير ذكية فورية ومجانية للجميع (بلا ذكاء اصطناعي ولا تكلفة)
//   2) أسئلة حرة بلغتك عبر Claude — تعمل بمفتاح Anthropic الخاص بالمدرسة (التكلفة على المدرسة) أو مفتاح المنصة إن وُجد
// القراءة فقط، والإجابات تُبنى من الأرقام الفعلية
import { h } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, btn, textarea, toast, sub, empty, select, input, field, passwordInput, confirmAction, badge, notice } from "../../shared/js/ui.js";
import { mount } from "../../shared/js/dom.js";
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
  let state = await api(`${A}/ai`);
  const root = h("div", { class: "ai-page" });

  /* ---------- 1) التقارير الذكية المجانية ---------- */
  const reportOut = h("div", { class: "ai-report-out", "aria-live": "polite" });
  const classSel = select([["", "كل الفصول"], ...state.classes.map((c) => [c, c])]);
  const nameIn = input({ placeholder: "اسم الطالب", maxLength: 80 });
  let current = null;
  async function run(rep) {
    current = rep;
    for (const b of cards.querySelectorAll(".ai-card")) b.classList.toggle("on", b.dataset.k === rep.key);
    const params = h("div", { class: "row ai-params" },
      rep.params.includes("class") ? field("الفصل", classSel) : null,
      rep.params.includes("name") ? field("اسم الطالب", nameIn) : null,
      rep.params.length ? btn("عرض", () => load(rep), "primary") : null);
    mount(reportOut, rep.params.length ? params : null, h("div", { class: "ai-report-body" }));
    if (!rep.params.includes("name")) await load(rep);
    else nameIn.focus();
  }
  async function load(rep) {
    const out = reportOut.querySelector(".ai-report-body");
    mount(out, h("div", { class: "ai-wait" }, h("span", {}), h("span", {}), h("span", {}), " يجهّز التقرير…"));
    try {
      const r = await api(`${A}/ai/report/${rep.key}`, { class_name: classSel.value || undefined, name: nameIn.value.trim() || undefined });
      mount(out, renderReport(r));
    } catch (e) { mount(out, h("p", { class: "err" }, e.message)); }
  }
  nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter" && current) load(current); });
  const cards = h("div", { class: "ai-cards" }, state.reports.map((rep) => h("button", { type: "button", class: "ai-card", "data-k": rep.key, onclick: () => run(rep) },
    h("span", { class: "ai-card-icon" }, (icons[rep.icon] || icons.sparkle)({ size: 20 })),
    h("span", {}, h("b", {}, rep.title), h("small", {}, rep.hint)))));

  /* ---------- 2) الأسئلة الحرة ---------- */
  function askPanel() {
    if (!state.ready) return null;
    const history = [];
    const thread = h("div", { class: "ai-thread", "aria-live": "polite" });
    const box = textarea({ rows: 2, maxLength: 1000, placeholder: "اكتب سؤالك… مثال: قارن حضور الصف الخامس بالسادس هذا الشهر" });
    const remaining = sub("");
    const bubble = (q, answerEl, when) => h("div", { class: "ai-turn" },
      h("div", { class: "ai-q" }, q),
      h("div", { class: "ai-a" }, h("span", { class: "ai-mark" }, icons.sparkle({ size: 16 })), answerEl,
        when ? h("small", { class: "sub" }, new Date(when).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })) : null));
    let emptyNote = state.recent.length ? null : empty("لم تسأل بعد.");
    const sendBtn = btn("اسأل", () => send(), "primary");
    async function send(question) {
      question = (question ?? box.value).trim();
      if (question.length < 2) { box.focus(); return; }
      box.value = "";
      const waiting = h("div", { class: "ai-wait" }, h("span", {}), h("span", {}), h("span", {}), " يجمع الأرقام ويحلّلها…");
      emptyNote?.remove(); emptyNote = null;
      thread.prepend(bubble(question, waiting));
      sendBtn.disabled = true;
      try {
        const r = await api(`${A}/ai/ask`, { question, history: history.slice(-4) });
        waiting.replaceWith(renderAnswer(r.answer));
        history.push({ q: question, a: r.answer });
        remaining.textContent = `متبقٍ اليوم: ${r.remaining_today} سؤالًا`;
      } catch (e) {
        waiting.replaceWith(h("p", { class: "err" }, e.message));
        toast(e.message, true);
      } finally { sendBtn.disabled = false; }
    }
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    for (const x of state.recent.slice(0, 10)) thread.append(bubble(x.question, renderAnswer(x.answer || ""), x.created_at));
    return panel("اسأل بحرية", badge(state.source === "school" ? "بمفتاح المدرسة" : "بمفتاح المنصة"),
      sub("أي سؤال عن بيانات مدرستك بلغتك، ويجيبك Claude من الأرقام الفعلية. يقرأ فقط ولا يعدّل شيئًا."),
      h("div", { class: "ai-ask" }, box, sendBtn), remaining,
      h("div", { class: "ai-suggest" }, SUGGESTIONS.map((q) => h("button", { type: "button", class: "chip", onclick: () => send(q) }, q))),
      emptyNote, thread,
      h("small", { class: "sub ai-privacy" }, "لمعالجة السؤال تُرسل الأرقام المطلوبة إلى خدمة Claude من Anthropic، بدون أرقام هواتف أو بيانات دخول."));
  }

  /* ---------- 3) مفتاح المدرسة ---------- */
  function keyPanel() {
    const keyIn = passwordInput({ placeholder: "sk-ant-…", autocomplete: "off" });
    const has = state.source === "school";
    return panel("مفتاح المساعد الخاص بالمدرسة", has ? badge(`محفوظ ينتهي بـ ${state.key_hint}`, "ok") : null,
      sub(has ? "الأسئلة الحرة تعمل بمفتاح مدرستك، وتكلفتها تُحسب على حساب مدرستك في Anthropic."
        : state.source === "platform" ? "الأسئلة الحرة تعمل الآن بمفتاح المنصة. يمكنك إضافة مفتاح مدرستك ليُستخدم بدلًا منه."
        : "التقارير أعلاه مجانية ولا تحتاج شيئًا. للأسئلة الحرة بلغتك أضف مفتاح Anthropic الخاص بمدرستك؛ التكلفة على حساب المدرسة حسب الاستخدام."),
      state.can_store ? [
        field(has ? "استبدال المفتاح" : "المفتاح", keyIn, "من console.anthropic.com ← API Keys. يُحفظ مشفّرًا ولا يظهر لأحد بعد الحفظ."),
        h("div", { class: "row" },
          btn(has ? "استبدال" : "حفظ وتفعيل", async () => {
            try { await api(`${A}/ai/key`, { key: keyIn.value }, "PUT"); state = await api(`${A}/ai`); toast("تم حفظ المفتاح والتحقق منه"); draw(); }
            catch (e) { toast(e.message, true); }
          }, "primary"),
          has ? btn("حذف المفتاح", async () => {
            if (!(await confirmAction("حذف مفتاح المدرسة؟ تتوقف الأسئلة الحرة (إلا إذا كان للمنصة مفتاح)، وتبقى التقارير المجانية."))) return;
            try { await api(`${A}/ai/key`, null, "DELETE"); state = await api(`${A}/ai`); toast("حُذف المفتاح"); draw(); } catch (e) { toast(e.message, true); }
          }, "ghost") : null),
      ] : notice("حفظ المفاتيح غير متاح على هذا الخادم بعد (مفتاح التشفير غير مضبوط).", "warn"));
  }

  function draw() {
    mount(root,
      panel("تقارير ذكية فورية", badge("مجانية", "ok"),
        sub("اختر تقريرًا ويُبنى لك فورًا من بيانات مدرستك مع نصائح عملية. بلا تكلفة وبلا انتظار."),
        cards, reportOut),
      askPanel(),
      keyPanel());
  }
  draw();
  return root;
}

/** عرض تقرير ذكي: جمل ثم جداول ثم نصائح */
export function renderReport(r) {
  return h("div", { class: "ai-answer ai-report" },
    h("h3", { class: "sec-title" }, r.title),
    r.lines.map((l) => h("p", {}, inline(l))),
    r.tables.map((t) => [h("h4", {}, t.title), h("div", { class: "scroll" }, h("table", { class: "grid ai-tbl" },
      h("thead", {}, h("tr", {}, t.head.map((c) => h("th", {}, c)))),
      h("tbody", {}, t.rows.map((row) => h("tr", {}, row.map((c) => h("td", {}, c))))))) ]),
    r.tips.length ? h("div", { class: "ai-tips" }, h("b", {}, "اقتراحات"), h("ul", {}, r.tips.map((t) => h("li", {}, t)))) : null);
}
