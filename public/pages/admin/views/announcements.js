// الإعلانات والرسائل الجماعية: الفئة المستهدفة، ثم معاينة عدد المستلمين، ثم تأكيد قبل الإرسال
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, textarea, select, btn, empty, line, sub, toast, confirmAction, badge, notice } from "../../shared/js/ui.js";
import { fmtDate } from "../../shared/js/format.js";
import { A } from "./common.js";

const TYPES = [["all", "كل أولياء الأمور"], ["stage", "مرحلة"], ["grade", "صف"], ["class", "شعبة"], ["students", "طلاب محددون"],
  ["teachers", "كل المعلمين"], ["staff", "كل المنسوبين"]];
const TYPE_NAME = Object.fromEntries(TYPES);

export default async function announcements({ refresh }) {
  const [list, tg] = await Promise.all([api(`${A}/announcements`), api(`${A}/announcements/targets`)]);
  const title = input({ maxLength: 120 }), body = textarea({ rows: 3, maxLength: 2000 });
  const kind = select([["announcement", "إعلان (يبقى في صفحة الإعلانات ويصل إشعارًا)"], ["message", "رسالة (إشعار فقط)"]]);
  const type = select(TYPES);
  const picker = h("div");
  const count = h("div", { class: "sub" });
  let chosen = new Set();

  const checklist = (items, label) => h("div", { class: "check-grid" }, items.map((it) => h("label", { class: "check" },
    h("input", { type: "checkbox", checked: chosen.has(it.id), onchange: (e) => { e.target.checked ? chosen.add(it.id) : chosen.delete(it.id); preview(); } }),
    h("span", {}, label(it)))));
  const drawPicker = () => {
    chosen = new Set();
    const t = type.value;
    if (t === "stage") mount(picker, field("المراحل", checklist(tg.stages, (x) => x.name)));
    else if (t === "grade") mount(picker, field("الصفوف", checklist(tg.grades, (x) => `${x.name} — ${x.stage}`)));
    else if (t === "class") mount(picker, field("الشعب", checklist(tg.classes, (x) => x.name)));
    else if (t === "students") {
      const cls = select([["", "اختر الشعبة"], ...tg.classes.map((c) => [c.id, c.name])]);
      const box = h("div");
      cls.addEventListener("change", () => mount(box, checklist(tg.students.filter((s) => String(s.class_id) === cls.value), (x) => x.name)));
      mount(picker, field("الشعبة", cls), box, sub("يمكنك اختيار طلاب من أكثر من شعبة: غيّر الشعبة واختر، ويبقى اختيارك."));
    } else mount(picker);
    preview();
  };
  const payload = () => ({ title: title.value.trim(), body: body.value.trim() || null, kind: kind.value,
    target: { type: type.value, ids: [...chosen] } });
  let last = null;
  const preview = async () => {
    last = null;
    const needsIds = !["all", "teachers", "staff"].includes(type.value);
    if (needsIds && !chosen.size) return mount(count, "اختر من يصله الإرسال.");
    try {
      const r = await api(`${A}/announcements`, { ...payload(), title: payload().title || "معاينة", dry_run: true });
      last = r.recipients.total;
      mount(count, r.recipients.total ? `يصل إلى ${[r.recipients.parents ? `${r.recipients.parents} ولي أمر` : null, r.recipients.staff ? `${r.recipients.staff} منسوب` : null].filter(Boolean).join(" و")}.`
        : "لا يوجد مستلمون في هذه الفئة.");
    } catch (e) { mount(count, e.message); }
  };
  type.addEventListener("change", drawPicker);
  drawPicker();

  return [
    panel("إرسال إعلان أو رسالة", null,
      field("النوع", kind), field("العنوان", title), field("التفاصيل", body),
      field("إلى", type), picker, count,
      btn("إرسال", async () => {
        const b = payload();
        if (!b.title) return toast("اكتب العنوان", true);
        await preview();
        if (!last) return toast("لا يوجد مستلمون", true);
        if (!confirmAction(`سيصل ${kind.value === "message" ? "هذه الرسالة" : "هذا الإعلان"} إلى ${last} مستلم. تأكيد الإرسال؟`)) return;
        const r = await api(`${A}/announcements`, { ...b, expected: last });
        toast(`أُرسل إلى ${r.recipients.total} مستلم`);
        refresh();
      })),
    panel("الإعلانات المرسلة", null,
      notice("الرسائل (إشعار فقط) تظهر في «التواصل ← سجل الإشعارات».", ""),
      list.length ? list.map((a) => line(
        h("div", {}, h("b", {}, a.title), " ", a.recipients ? badge(`${a.recipients} مستلم`, "gray") : null, h("div", {}, a.body),
          sub(`${a.target ? TYPE_NAME[a.target.type] : a.class_name || "كل المدرسة"} — ${a.created_by} — ${fmtDate(a.created_at)}`)),
        btn("حذف", async () => { if (confirmAction("حذف الإعلان من صفحة الإعلانات؟ (لا يلغي الإشعارات التي وصلت)")) { await api(`${A}/announcements/${a.id}`, undefined, "DELETE"); refresh(); } }, "danger sm")))
        : empty("لا توجد إعلانات.")),
  ];
}
