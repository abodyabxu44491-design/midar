// «ابدأ هنا»: خطوات واضحة للمدير في مدرسة جديدة، كل خطوة تُشطب تلقائيًا من بيانات المدرسة الفعلية،
// والضغط على الخطوة ينقله للقسم المناسب. تختفي القائمة عند اكتمالها أو إذا أخفاها المدير.
import { h, mount } from "../../shared/js/dom.js";
import { icons } from "../../shared/js/icons.js";
import { toast } from "../../shared/js/ui.js";
import { directoryLink } from "./common.js";

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* تخزين غير متاح */ } },
};

export function startHere({ me, d, goTo }) {
  const key = (s) => `midar_start_${me.school.id}_${s}`;
  // للمدارس الجديدة فقط (أول 60 يومًا): المدارس القائمة لا تحتاجها
  if (!d.new_school || store.get(key("hidden"))) return null;
  const shared = () => Boolean(store.get(key("shared")));
  const link = me.links?.public?.home || directoryLink(me);
  const on = (m) => me.modules?.[m] !== false;

  const steps = [
    { done: d.classes > 0, title: "الصفوف والشعب", hint: "المراحل والصفوف والشعب والمواد", tab: "academic" },
    { done: d.teachers > 0, title: "أضف المعلمين", hint: "واحدًا واحدًا أو من ملف Excel", tab: "teachers" },
    { done: d.students > 0, title: "أضف الطلاب", hint: "استيراد مئات الطلاب من ملف Excel دفعة واحدة", tab: "students" },
    { done: d.assignments > 0, title: "وزّع المواد على المعلمين", hint: "كل معلم ومواده وفصوله، فيرى طلابه فقط", tab: "teachers" },
    { done: Boolean(me.school.logo), title: "شعار المدرسة", hint: "يظهر في الصفحات والشهادات والأوراق المطبوعة", tab: "settings" },
    on("attendance") ? { done: Boolean(d.attendance_any), title: "سجّل أول حضور", hint: "من جوال المعلم أو من هنا", tab: "attendance" } : null,
    { done: shared(), title: "أرسل رابط المدرسة لأولياء الأمور", hint: "يتابعون منه أبناءهم ويصلهم كل جديد", share: true },
  ].filter(Boolean);
  const left = steps.filter((s) => !s.done).length;
  if (!left) return null;

  const markShared = () => { store.set(key("shared"), "1"); };
  const share = (s) => s.share ? h("div", { class: "sh-acts" },
    h("a", { class: "btn sm", href: `https://wa.me/?text=${encodeURIComponent(`رابط ${me.school.name} لمتابعة أبنائكم: ${link}`)}`,
      target: "_blank", rel: "noopener", onclick: markShared }, "مشاركة في واتساب"),
    h("button", { type: "button", class: "btn ghost sm", onclick: async () => {
      try { await navigator.clipboard.writeText(link); toast("نُسخ الرابط"); markShared(); } catch { toast(link); }
    } }, "نسخ الرابط")) : null;

  const done = steps.length - left;
  const card = h("section", { class: "start-here", "aria-label": "ابدأ هنا" },
    h("div", { class: "sh-head" },
      h("div", {}, h("h3", {}, "ابدأ هنا"), h("p", {}, `${done} من ${steps.length} خطوات — جهّز مدرستك وابدأ العمل`)),
      h("button", { type: "button", class: "sh-close", title: "إخفاء القائمة", "aria-label": "إخفاء القائمة",
        onclick: () => { store.set(key("hidden"), "1"); mount(card); card.remove(); } }, icons.close({ size: 18 }))),
    h("div", { class: "sh-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": steps.length, "aria-valuenow": done },
      h("span", { style: `width:${Math.round((done / steps.length) * 100)}%` })),
    h("ol", { class: "sh-list" }, steps.map((s, i) => h("li", { class: s.done ? "done" : "" },
      h("span", { class: "sh-mark", "aria-hidden": "true" }, s.done ? icons.check({ size: 16, stroke: 3 }) : String(i + 1)),
      h("div", { class: "sh-text" },
        s.tab && !s.done ? h("button", { type: "button", class: "sh-go", onclick: () => goTo?.(s.tab) }, s.title, icons.chevronLeft({ size: 16 }))
          : h("b", {}, s.title),
        s.done ? null : h("small", {}, s.hint),
        s.done ? null : share(s))))));
  return card;
}
