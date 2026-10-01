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
  if (f.transport) {
    const t = f.transport;
    const DIR = { both: "ذهابًا وإيابًا", to_school: "إلى المدرسة", from_school: "من المدرسة" };
    out.push({ key: "transport", name: "النقل", note: t.name, view: () => section("النقل المدرسي",
      line(h("span", { class: "sub" }, "الحافلة"), h("b", {}, [t.name, t.plate].filter(Boolean).join(" — "))),
      t.stop ? line(h("span", { class: "sub" }, "المحطة"), h("b", {}, [t.stop, t.pickup_time].filter(Boolean).join(" — "))) : null,
      line(h("span", { class: "sub" }, "الاتجاه"), h("b", {}, DIR[t.direction] || "")),
      t.driver_name ? line(h("span", { class: "sub" }, "السائق"), h("b", {}, t.driver_name, t.driver_phone ? h("a", { class: "ltr", href: `tel:${t.driver_phone}`, style: "margin-inline-start:8px" }, t.driver_phone) : null)) : null,
      t.supervisor ? line(h("span", { class: "sub" }, "المشرف"), h("b", {}, t.supervisor)) : null,
      h("h3", { class: "sec-title" }, "آخر الحركات"),
      t.events.length ? t.events.map((e) => line(h("span", {}, e.text), h("small", { class: "muted" }, fmtDateTime(e.at)))) : empty("لا توجد حركات مسجلة هذا الأسبوع.")) });
  }
  if (f.health) {
    const p = f.health.profile;
    out.push({ key: "health", name: "الصحة", note: f.health.visits.length ? `${f.health.visits.length} زيارة` : "", view: () => [
      p ? section("الملف الصحي",
        line(h("span", { class: "sub" }, "فصيلة الدم"), h("b", { class: "ltr" }, p.blood_type || "—")),
        line(h("span", { class: "sub" }, "الحساسية"), h("b", {}, p.allergies || "—")),
        line(h("span", { class: "sub" }, "أمراض مزمنة"), h("b", {}, p.chronic || "—")),
        line(h("span", { class: "sub" }, "الأدوية"), h("b", {}, p.medications || "—")),
        sub("لتحديث الملف الصحي تواصل مع المدرسة.")) : null,
      section("زيارات العيادة", f.health.visits.length ? f.health.visits.map((v) => line(
        h("div", {}, h("b", {}, v.complaint), " ", v.sent_home ? badge("غادر للمنزل", "amber") : null,
          sub([fmtDateTime(v.visited_at), v.action, v.temperature ? `الحرارة ${v.temperature}` : null].filter(Boolean).join(" — "))))) : empty("لا توجد زيارات.")),
    ] });
  }
  if (f.library?.length) {
    out.push({ key: "library", name: "المكتبة", note: f.library.some((l) => l.overdue) ? "متأخر" : `${f.library.length}`, view: () => section("الكتب المستعارة",
      f.library.map((l) => line(h("div", {}, h("b", {}, l.title), " ", l.overdue ? badge("تأخر إرجاعه", "red") : l.returned_on ? badge("أُرجع", "gray") : badge("معار")),
        h("small", { class: "muted" }, l.returned_on ? `أُرجع ${fmtDate(l.returned_on)}` : `الإرجاع ${fmtDate(l.due_on)}`)))) });
  }
  if (f.surveys?.length) {
    const open = f.surveys.filter((x) => x.open).length;
    out.push({ key: "surveys", name: "الاستبيانات", note: open ? `${open} بانتظار رأيك` : `${f.surveys.length}`, view: () => {
      const box = h("div");
      return [section("الاستبيانات", f.surveys.map((x) => line(
        h("div", {}, h("b", {}, x.title), " ", x.answered ? badge("أجبت") : x.open ? badge("بانتظار رأيك", "amber") : badge("مغلق", "gray")),
        x.open && actions.api ? btn("أجب", async () => {
          const { surveyForm } = await import("./engagement-ui.js");
          mount(box, section(x.title, surveyForm(x, (answers) => actions.api(`/student/surveys/${x.id}`, { answers }), () => { x.answered = true; x.open = false; mount(box); })));
          box.scrollIntoView({ behavior: "smooth" });
        }, "sm") : null))), box];
    } });
  }
  if (f.meetings && actions.api) {
    const mine = f.meetings.filter((x) => x.mine).length;
    out.push({ key: "meetings", name: "المواعيد", note: mine ? `${mine} محجوز` : `${f.meetings.filter((x) => !x.booking_id).length} متاح`, view: () => {
      const box = h("div");
      const draw = async () => {
        const { meetingsBoard } = await import("./engagement-ui.js");
        mount(box, section("مواعيد مع المعلمين والإدارة", meetingsBoard(f.meetings, {
          book: async (slot, topic) => {
            try { await actions.api("/student/meetings/book", { slot_id: slot.id, topic }); toast("حُجز موعدك ويصلك تذكير قبله بيوم"); f.meetings = await actions.api("/student/meetings"); draw(); }
            catch (e) { toast(e.message, true); }
          },
          cancel: async (slot) => {
            if (!confirm("إلغاء الموعد؟")) return;
            try { await actions.api(`/student/meetings/${slot.id}/cancel`); toast("أُلغي"); f.meetings = await actions.api("/student/meetings"); draw(); }
            catch (e) { toast(e.message, true); }
          },
        })));
      };
      draw();
      return box;
    } });
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
