// لوحة السلوك المشتركة بين الإدارة والمعلم: تسجيل سريع لطالب أو للفصل كله، والملخص، والسجل،
// وللإدارة: بنود السلوك وإعداداته.
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { panel, field, input, select, textarea, btn, empty, line, sub, toast, notice, confirmAction, switchBtn, dialog, badge } from "./ui.js";
import { fmtDate, today } from "./format.js";
import { partsView } from "./parts.js";
import { behaviorBlock } from "./student-file-features.js";

/**
 * @param {{ base: string, classes: Array<{id:number, name:string}>, admin?: boolean }} opts
 */
export function behaviorBoard({ base, classes, admin = false }) {
  if (!classes.length) return notice(admin ? "لا توجد شعب بعد. أنشئ الهيكل الأكاديمي أولًا." : "لا توجد فصول مسندة لك.", "warn");
  const parts = [["record", "تسجيل"], ["summary", "درجات السلوك"], ["log", "السجل"]];
  if (admin) parts.push(["categories", "البنود"], ["settings", "الإعدادات"]);
  let classId = Number(sessionStorage.getItem("midar_beh_class")) || classes[0].id;
  if (!classes.some((c) => c.id === classId)) classId = classes[0].id;
  const classPicker = (onChange) => {
    const sel = select(classes.map((c) => [c.id, c.name]), { value: classId });
    sel.addEventListener("change", () => { classId = Number(sel.value); try { sessionStorage.setItem("midar_beh_class", String(classId)); } catch { /* */ } onChange(); });
    return field("الشعبة", sel);
  };
  return partsView(parts, async (part, nav) => {
    if (part === "record") return recordView(nav);
    if (part === "summary") return summaryView(nav);
    if (part === "log") return logView(nav);
    if (part === "categories") return categoriesView(nav);
    if (part === "settings") return settingsView();
  });

  async function recordView(nav) {
    const [cats, sum] = await Promise.all([api(`${base}/behavior/categories`), api(`${base}/behavior/summary?class_id=${classId}`)]);
    const active = cats.filter((c) => c.is_active);
    let chosen = null;
    const chips = h("div", { class: "beh-cats" });
    const drawChips = () => mount(chips, active.map((c) => h("button", { type: "button", class: `beh-cat ${c.kind}${chosen === c.id ? " on" : ""}`,
      onclick: () => { chosen = chosen === c.id ? null : c.id; drawChips(); } }, c.name, h("b", {}, `${c.kind === "positive" ? "+" : "-"}${c.points}`))));
    drawChips();
    const boxes = sum.students.map((s) => {
      const cb = h("input", { type: "checkbox", value: s.id });
      return { s, cb, el: h("label", {}, cb, h("span", {}, s.name), h("span", { class: `score-pill${s.score < sum.warn_below ? " low" : ""}`, style: "margin-inline-start:auto" }, s.score)) };
    });
    const note = input({ placeholder: "ملاحظة (اختياري)", maxLength: 500 });
    const day = input({ type: "date", value: today(), max: today() });
    const notifyBox = h("input", { type: "checkbox", checked: true });
    const all = btn("تحديد الكل", () => { const on = !boxes.every((b) => b.cb.checked); boxes.forEach((b) => { b.cb.checked = on; }); }, "ghost sm");
    return [
      panel("تسجيل سلوك", null,
        classPicker(() => nav.show()),
        h("h3", { class: "sec-title" }, "1) اختر البند"), chips,
        h("h3", { class: "sec-title" }, "2) اختر الطالب أو الطلاب"),
        sum.students.length ? [h("div", { class: "spaced", style: "justify-content:flex-start" }, all), h("div", { class: "beh-pick" }, boxes.map((b) => b.el))] : empty("لا يوجد طلاب في هذه الشعبة."),
        h("div", { class: "row" }, field("ملاحظة", note), field("التاريخ", day)),
        h("label", { class: "check-line" }, notifyBox, "إشعار ولي الأمر"),
        btn("حفظ", async () => {
          const ids = boxes.filter((b) => b.cb.checked).map((b) => Number(b.s.id));
          if (!chosen) return toast("اختر البند", true);
          if (!ids.length) return toast("اختر طالبًا على الأقل", true);
          const r = await api(`${base}/behavior`, { student_ids: ids, category_id: chosen, note: note.value.trim() || null, day: day.value, notify_parent: notifyBox.checked });
          toast(`سُجّل لـ ${r.created} ${r.created === 1 ? "طالب" : "طلاب"}`);
          nav.show();
        })),
    ];
  }

  async function summaryView(nav) {
    const d = await api(`${base}/behavior/summary?class_id=${classId}`);
    const low = d.students.filter((s) => s.score < d.warn_below).length;
    return panel("درجات السلوك في الفصل الدراسي الحالي", null,
      classPicker(() => nav.show()),
      sub(`الدرجة الأساسية ${d.base_score}. تحت ${d.warn_below} تحتاج متابعة${low ? ` — ${low} طالب حاليًا` : ""}.`),
      d.students.length ? h("div", { class: "table-wrap" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, h("th", {}, "الطالب"), h("th", {}, "إيجابي"), h("th", {}, "مخالفات"), h("th", {}, "الدرجة"), h("th", {}, ""))),
        h("tbody", {}, d.students.map((s) => h("tr", {},
          h("td", {}, s.name), h("td", {}, `+${s.positive}`), h("td", {}, `-${s.negative}`),
          h("td", {}, h("span", { class: `score-pill${s.score < d.warn_below ? " low" : ""}` }, s.score)),
          h("td", {}, btn("التفاصيل", () => studentDialog(s.id, nav), "ghost sm"))))))) : empty("لا يوجد طلاب."),
      h("div", { class: "spaced" }, btn("طباعة", () => window.print(), "ghost sm")));
  }

  async function studentDialog(id, nav) {
    const d = await api(`${base}/behavior/student/${id}`);
    const dd = dialog(`سلوك ${d.student.name}`, h("div", {}, behaviorBlock(d),
      d.records.length ? h("div", { class: "spaced" }, sub("لحذف سجل افتحه من «السجل».")) : null));
    void dd; void nav;
  }

  async function logView(nav) {
    const kind = select([["", "الكل"], ["positive", "إيجابي"], ["negative", "مخالفات"]]);
    const box = h("div");
    const load = async () => {
      const rows = await api(`${base}/behavior?class_id=${classId}${kind.value ? `&kind=${kind.value}` : ""}`);
      mount(box, rows.length ? h("div", { class: "beh-list" }, rows.map((r) => h("div", { class: `beh-row ${r.kind}` },
        h("span", { class: "pts" }, `${r.points > 0 ? "+" : ""}${r.points}`),
        h("div", { style: "flex:1;min-width:0" }, h("b", {}, `${r.student} — ${r.title}`), r.note ? sub(r.note) : null,
          h("small", { class: "muted" }, `${fmtDate(r.day)} — ${r.recorded_by}`)),
        btn("حذف", async () => {
          if (!confirmAction("حذف هذا السجل؟ تتغير درجة الطالب.")) return;
          await api(`${base}/behavior/${r.id}`, undefined, "DELETE"); toast("حُذف"); load();
        }, "ghost sm")))) : empty("لا توجد سجلات."));
    };
    kind.addEventListener("change", load);
    await load();
    return panel("سجل السلوك", null, h("div", { class: "row" }, classPicker(() => nav.show()), field("النوع", kind)), box);
  }

  async function categoriesView(nav) {
    const cats = await api(`${base}/behavior/categories`);
    const name = input({ placeholder: "مثال: المحافظة على الهدوء" });
    const kind = select([["positive", "إيجابي (يضيف نقاطًا)"], ["negative", "مخالفة (تخصم نقاطًا)"]]);
    const pts = input({ type: "number", min: 1, max: 100, value: 2, class: "ltr" });
    const row = (c) => {
      const p = input({ type: "number", min: 1, max: 100, value: c.points, class: "ltr", style: "max-width:80px" });
      p.addEventListener("change", async () => { await api(`${base}/behavior/categories/${c.id}`, { points: Number(p.value) }, "PATCH"); toast("تم الحفظ"); });
      return line(h("div", {}, h("b", {}, c.name), " ", badge(c.kind === "positive" ? "إيجابي" : "مخالفة", c.kind === "positive" ? "" : "red"), c.is_active ? null : badge("موقوف", "gray")),
        h("div", { class: "row", style: "flex:none;gap:6px;align-items:center" }, p,
          switchBtn(c.is_active, `تفعيل ${c.name}`, async (v) => { await api(`${base}/behavior/categories/${c.id}`, { is_active: v }, "PATCH"); return true; }),
          btn("حذف", async () => {
            if (!confirmAction(`حذف «${c.name}»؟ إن كان مستخدمًا يُوقف فقط.`)) return;
            const r = await api(`${base}/behavior/categories/${c.id}`, undefined, "DELETE");
            toast(r.deactivated ? "البند مستخدم، فأُوقف بدل الحذف" : "حُذف"); nav.show();
          }, "ghost sm")));
    };
    return [
      panel("إضافة بند", null,
        h("div", { class: "row" }, field("البند", name), field("النوع", kind), field("النقاط", pts)),
        btn("إضافة", async () => {
          await api(`${base}/behavior/categories`, { name: name.value.trim(), kind: kind.value, points: Number(pts.value) });
          toast("أُضيف"); nav.show();
        })),
      panel("البنود الإيجابية", null, cats.filter((c) => c.kind === "positive").map(row)),
      panel("المخالفات", null, cats.filter((c) => c.kind === "negative").map(row)),
    ];
  }

  async function settingsView() {
    const all = await api(`${base}/communication/features`);
    const s = all.behavior;
    const save = async (patch) => { Object.assign(s, await api(`${base}/communication/features/behavior`, patch, "PUT")); toast("تم الحفظ"); return true; };
    const baseScore = input({ type: "number", value: s.base_score, min: 0, max: 1000, class: "ltr" });
    const warn = input({ type: "number", value: s.warn_below, min: 0, max: 1000, class: "ltr" });
    baseScore.addEventListener("change", () => save({ base_score: Number(baseScore.value) }));
    warn.addEventListener("change", () => save({ warn_below: Number(warn.value) }));
    return panel("إعدادات السلوك", null,
      h("div", { class: "row" }, field("الدرجة الأساسية لكل فصل دراسي", baseScore), field("تنبيه تحت درجة", warn)),
      line(h("div", {}, h("b", {}, "يظهر لولي الأمر"), sub("درجة السلوك وسجله في ملف الطالب، ويصله إشعار بكل تسجيل")),
        switchBtn(s.show_parent, "يظهر لولي الأمر", (v) => save({ show_parent: v }))),
      line(h("div", {}, h("b", {}, "المعلم يسجّل السلوك"), sub("لطلاب فصوله فقط، ويحذف ما سجله هو")),
        switchBtn(s.teacher_can_record, "المعلم يسجّل السلوك", (v) => save({ teacher_can_record: v }))));
  }
}
