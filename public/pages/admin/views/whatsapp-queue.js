// قائمة واتساب (مجانية): تجهيز رسائل لأولياء الأمور بمتغيرات، ثم إرسالها من جوال الإداري واحدة تلو الأخرى.
// المنصة لا ترسل شيئًا ولا تحتاج اشتراكًا: كل ضغطة تفتح محادثة واتساب جاهزة، وتنتقل تلقائيًا للتالية.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, select, textarea, btn, empty, badge, sub, stats, toast, confirmAction } from "../../shared/js/ui.js";
import { A } from "./common.js";

const TARGETS = [["all", "كل أولياء الأمور"], ["class", "شعبة محددة"], ["absent_today", "أولياء أمور الغائبين اليوم"], ["overdue", "من عليهم رسوم متأخرة"]];
const KINDS = { manual: "رسالة يدوية", absence: "غياب", late: "تأخر", grades: "درجات", invoice: "رسوم", payment: "دفعة", announcement: "تعميم" };
const VARS = ["{الطالب}", "{الفصل}", "{المبلغ}", "{التاريخ}"];
const SAMPLES = {
  absent_today: "ولي أمر الطالب {الطالب}: نفيدكم بغياب ابنكم اليوم {التاريخ}. نأمل التواصل مع المدرسة لمعرفة السبب.",
  overdue: "ولي أمر الطالب {الطالب}: نذكّركم بالرسوم المتأخرة وقدرها {المبلغ}. شاكرين تعاونكم.",
};

export default async function whatsappQueue({ nav }) {
  const [d, classes] = await Promise.all([api(`${A}/communication/wa`), api(`${A}/structure/classes`).catch(() => [])]);

  /* ---------- تجهيز الرسائل ---------- */
  const target = select(TARGETS);
  const cls = select(classes.map((c) => [c.id, c.name]));
  const clsField = field("الشعبة", cls);
  clsField.hidden = true;
  const text = textarea({ rows: 3, maxLength: 1200, placeholder: "نص الرسالة… يمكنك استخدام المتغيرات أدناه" });
  target.addEventListener("change", () => {
    clsField.hidden = target.value !== "class";
    if (SAMPLES[target.value] && !text.value.trim()) text.value = SAMPLES[target.value];
  });
  const insertVar = (v) => { const p = text.selectionStart ?? text.value.length; text.value = text.value.slice(0, p) + v + text.value.slice(p); text.focus(); };
  const compose = panel("تجهيز رسائل", null,
    sub("اكتب الرسالة مرة واحدة، وتتجهّز لكل ولي أمر باسم ابنه. الإخوة لهم رقم واحد فتصل رسالة واحدة."),
    h("div", { class: "row" }, field("إلى", target), clsField),
    field("الرسالة", text),
    h("div", { class: "wa-vars" }, VARS.map((v) => h("button", { type: "button", class: "chip", onclick: () => insertVar(v) }, v))),
    btn("أضف إلى قائمة الإرسال", async () => {
      try {
        const r = await api(`${A}/communication/wa/compose`, { target: target.value, class_id: target.value === "class" ? Number(cls.value) : undefined, message: text.value.trim() });
        toast(r.added ? `أُضيفت ${r.added} رسالة للقائمة` : "كل هذه الرسائل موجودة في القائمة مسبقًا");
        text.value = ""; nav.show();
      } catch (e) { toast(e.message, true); }
    }, "primary"));

  /* ---------- الإرسال المتتابع ---------- */
  const queue = d.pending.slice();
  let i = 0, done = 0;
  const stage = h("div", { class: "wa-stage", "aria-live": "polite" });
  const mark = (id, status) => api(`${A}/communication/wa/${id}/done`, { status });
  function show() {
    if (i >= queue.length) {
      return mount(stage, h("div", { class: "wa-done" }, h("b", {}, done ? `أُرسلت ${done} رسالة` : "لا رسائل منتظرة"),
        sub(done ? "انتهت القائمة. أحسنت!" : "جهّز رسائل جديدة من الأعلى، أو فعّل «واتساب» لأحداث مثل الغياب من قسم «الإشعارات».")));
    }
    const m = queue[i];
    const url = `https://wa.me/${m.phone}?text=${encodeURIComponent(m.body)}`;
    const next = async (status) => { try { await mark(m.id, status); if (status === "sent") done++; i++; show(); } catch (e) { toast(e.message, true); } };
    mount(stage,
      h("div", { class: "wa-progress" }, h("span", {}, `${i + 1} من ${queue.length}`), h("div", { class: "bar" }, h("i", { style: `width:${Math.round(100 * i / queue.length)}%` }))),
      h("div", { class: "wa-card" },
        h("div", { class: "row spaced" }, h("b", {}, m.student || "ولي أمر"), badge(KINDS[m.kind] || m.kind, "gray")),
        sub([m.class_name, h("span", { class: "ltr" }, `+${m.phone}`)].filter(Boolean).flatMap((x, k) => (k ? [" — ", x] : [x]))),
        h("p", { class: "wa-body" }, m.body)),
      h("div", { class: "wa-actions" },
        h("a", { class: "btn primary wa-send", href: url, target: "_blank", rel: "noopener", onclick: () => setTimeout(() => next("sent"), 300) }, "إرسال عبر واتساب"),
        btn("تخطي", () => next("skipped"), "ghost")),
      sub("بعد الضغط يفتح واتساب والرسالة جاهزة، اضغط إرسال فيه ثم ارجع هنا وتظهر الرسالة التالية."));
  }
  show();

  return [
    stats([["بانتظار الإرسال", d.counts.pending], ["أُرسلت آخر 7 أيام", d.counts.sent_7d]]),
    panel("الإرسال المتتابع", queue.length ? btn("مسح القائمة", async () => {
      if (!(await confirmAction(`حذف ${queue.length} رسالة منتظرة من القائمة؟`))) return;
      await api(`${A}/communication/wa/clear`, { scope: "pending" }); toast("مُسحت القائمة"); nav.show();
    }, "ghost sm") : null, stage),
    compose,
  ];
}
