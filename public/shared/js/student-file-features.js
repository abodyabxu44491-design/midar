// أقسام ملف الطالب للأقسام الجديدة: كل قسم يظهر فقط إذا أرسل الخادم بياناته (القسم مفعّل ومسموح لولي الأمر)
// كل عنصر: { key, name, note, view() }
import { h } from "./dom.js";
import { empty, sub, btn, line, toast, badge } from "./ui.js";
import { mount } from "./dom.js";
import { certificatesSheet } from "./certificate.js";
import { eventList } from "./calendar-view.js";
import { fmtDate, fmtDateTime } from "./format.js";

const section = (title, ...kids) => h("section", { class: "panel" }, h("h2", {}, title), ...kids);

export function behaviorBlock(b) {
  const low = b.score < b.warn_below;
  return [
    h("div", { class: "kpis inline beh-kpis" },
      h("div", { class: low ? "s-absent" : "s-present" }, h("b", {}, b.score), "درجة السلوك"),
      h("div", { class: "s-present" }, h("b", {}, `+${b.positive}`), "إيجابي"),
      h("div", { class: "s-absent" }, h("b", {}, `-${b.negative}`), "مخالفات")),
    sub(`الدرجة تبدأ من ${b.base_score} في كل فصل دراسي، وتزيد بالإنجازات وتنقص بالمخالفات.`),
    b.records.length ? h("div", { class: "beh-list" }, b.records.map((r) => h("div", { class: `beh-row ${r.kind}` },
      h("span", { class: "pts" }, `${r.points > 0 ? "+" : ""}${r.points}`),
      h("div", {}, h("b", {}, r.title), r.note ? sub(r.note) : null, h("small", { class: "muted" }, fmtDate(r.day)))))) : empty("لا توجد ملاحظات سلوك."),
  ];
}

const OE_STATE = { open: ["متاح الآن", ""], upcoming: ["لم يبدأ", "gray"], in_progress: ["بدأته ولم تسلّمه", "amber"], done: ["سُلّم", ""], missed: ["فات موعده", "red"] };

export function featureSections(d, actions = {}) {
  const f = d.features || {};
  const out = [];
  if (f.online_exams?.length) {
    const open = f.online_exams.filter((x) => x.state === "open" || x.state === "in_progress").length;
    out.push({ key: "online-exams", name: "الاختبارات الإلكترونية", note: open ? `${open} متاح الآن` : `${f.online_exams.length}`, view: ({ reopen } = {}) => {
      const box = h("div");
      const list = section("الاختبارات الإلكترونية",
        f.online_exams.map((x) => line(
          h("div", {}, h("b", {}, x.title), " ", badge(...OE_STATE[x.state]),
            sub(`${x.subject} — ${fmtDateTime(x.opens_at)} إلى ${fmtDateTime(x.closes_at)} — ${x.duration_min} دقيقة — ${x.max_score} درجة`),
            x.score !== null ? sub(`الدرجة: ${x.score} من ${x.max_score}`) : x.pending ? sub("بانتظار تصحيح المعلم") : null),
          actions.api && (x.state === "open" || x.state === "in_progress") ? btn(x.state === "open" ? "ابدأ الاختبار" : "أكمل الاختبار", async () => {
            if (x.state === "open" && !confirm(`ابدأ «${x.title}»؟ يبدأ العدّاد (${x.duration_min} دقيقة) من الآن ولا يتوقف.`)) return;
            const { takeExam } = await import("./online-exam-take.js");
            try {
              mount(box, await takeExam({ call: actions.api, id: x.id, onExit: () => location.reload() }));
              list.hidden = true; box.scrollIntoView({ behavior: "smooth" });
            } catch (e) { toast(e.message, true); }
          }, "sm") : actions.api && x.can_review ? btn("مراجعة الإجابات", async () => {
            try { mount(box, reviewView(await actions.api(`/student/online-exams/${x.id}/review`))); } catch (e) { toast(e.message, true); }
          }, "ghost sm") : null)));
      void reopen;
      return [list, box];
    } });
  }
  if (f.certificates?.length) {
    out.push({ key: "certificates", name: "الشهادات", note: `${f.certificates.length}`, view: () => {
      const box = h("div");
      return [section("الشهادات", f.certificates.map((c) => line(
        h("div", {}, h("b", {}, c.title), sub(`${fmtDate(c.issued_at)}${c.result ? ` — ${c.result}` : ""}`)),
        actions.printCertificate ? btn("عرض وطباعة", async () => {
          try {
            const list = await actions.printCertificate(c.id);
            mount(box, h("div", { class: "toolbar" }, btn("طباعة", () => window.print())), certificatesSheet(list));
            box.scrollIntoView({ behavior: "smooth" });
          } catch (e) { toast(e.message, true); }
        }, "ghost sm") : null))), box];
    } });
  }
  if (f.calendar?.length) {
    out.push({ key: "calendar", name: "التقويم", note: `${f.calendar.length} مناسبة قادمة`,
      view: () => section("المناسبات القادمة", eventList(f.calendar)) });
  }
  if (f.behavior) {
    out.push({ key: "behavior", name: "السلوك", note: `${f.behavior.score} نقطة`,
      view: () => section("السلوك والانضباط", behaviorBlock(f.behavior)) });
  }
  return out;
}



// مراجعة الطالب لإجاباته بعد إغلاق الاختبار (إن سمحت المدرسة)
function reviewView(r) {
  return section(`مراجعة: ${r.title}`,
    r.score !== null ? sub(`درجتك ${r.score} من ${r.max_score}`) : sub("بانتظار التصحيح"),
    r.questions.map((q, i) => {
      const a = q.answer;
      let mine = "—", right = null;
      if (q.type === "mcq" || q.type === "multi") {
        mine = (q.options || []).filter((o) => [].concat(a || []).includes(o.id)).map((o) => o.text).join("، ") || "—";
        right = (q.options || []).filter((o) => (q.correct || []).includes(o.id)).map((o) => o.text).join("، ");
      } else if (q.type === "truefalse") { mine = a === true ? "صح" : a === false ? "خطأ" : "—"; right = q.correct ? "صح" : "خطأ"; }
      else if (q.type === "fill") { mine = [].concat(a || []).join("، ") || "—"; right = (q.answers || []).join("، "); }
      else if (q.type === "match") { mine = (q.left || []).map((l) => `${l.text} ← ${(q.right || []).find((x) => x.id === a?.[l.id])?.text || "—"}`).join(" | ");
        right = (q.left || []).map((l) => `${l.text} ← ${(q.right || []).find((x) => x.id === q.key_pairs?.[l.id])?.text || ""}`).join(" | "); }
      else if (q.type === "order") { mine = [].concat(a || []).map((id) => (q.items || []).find((x) => x.id === id)?.text).join(" ← "); right = (q.items || []).map((x) => x.text).join(" ← "); }
      else mine = a || "—";
      return h("div", { class: "oe-review" }, h("b", {}, `${i + 1}. ${q.text}`), sub(`إجابتك: ${mine}`), right ? sub(`الصحيح: ${right}`) : null,
        sub(`الدرجة: ${q.mark ?? "—"} من ${q.marks}`));
    }));
}
