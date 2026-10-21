/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Grades for the administration: every grade the teachers entered, filtered by class and state. The
// administration opens any of them, corrects a score, and publishes or hides it.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, btn, empty, badge, sub, toast, dialog, confirmAction, select, field, input, notice, scoreConflict } from "../../shared/js/ui.js";
import { EXAM, csv, fmtDate } from "../../shared/js/format.js";
import { A } from "./common.js";

export default async function exams({ refresh }) {
  const [list, features] = await Promise.all([api(`${A}/exams`), api(`${A}/communication/features`).catch(() => null)]);
  const selfApprove = features?.teachers?.teacher_publishes !== false;
  const classes = [...new Map(list.map((e) => [e.class_id, e.class_name])).entries()];
  const classSel = select([["", "كل الفصول"], ...classes], { value: "" });
  const stateSel = select([["", "كل الحالات"], ["pending", "بانتظار الاعتماد"], ["published", "منشورة"], ["draft", "مسودة"]],
    { value: list.some((e) => e.status === "pending") ? "pending" : "" });
  const box = h("div", { class: "ax-list" });
  const setStatus = async (e, status, msg, ask) => {
    if (ask && !confirmAction(ask)) return;
    try { await api(`${A}/exams/${e.id}/status`, { status }); toast(msg); refresh(); } catch (err) { toast(err.message, true); }
  };

  const PAGE = 30;
  let shown = PAGE;
  const draw = () => {
    const all = list.filter((e) => (!classSel.value || String(e.class_id) === classSel.value) && (!stateSel.value || e.status === stateSel.value));
    const rows = all.slice(0, shown);
    mount(box, rows.length ? [...rows.map((e) => h("div", { class: "ax-item" },
      h("div", { class: "ax-main" },
        h("b", {}, e.title), " ", badge(...EXAM[e.status]), e.component_name ? [" ", badge(e.component_name, "gray")] : null,
        h("small", {}, `${e.class_name} · ${e.subject_name} · من ${Number(e.max_score)} · ${e.graded} درجة · ${fmtDate(e.exam_date)}`)),
      h("div", { class: "ax-acts" },
        btn("الدرجات", () => sheet(e, refresh), "soft sm"),
        e.status !== "published" ? btn("اعتماد ونشر", () => setStatus(e, "published", "نُشرت الدرجات", `نشر درجات «${e.title}» لأولياء الأمور؟`), "sm") : null,
        e.status === "pending" ? btn("إرجاع للمعلم", () => setStatus(e, "draft", "أُعيدت للمعلم"), "ghost sm") : null,
        e.status === "published" ? btn("إخفاء", () => setStatus(e, "draft", "أُخفيت الدرجات عن أولياء الأمور", "إخفاء هذه الدرجات عن أولياء الأمور؟"), "ghost sm") : null))),
      all.length > shown ? btn(`عرض المزيد (${all.length - shown} متبقية)`, () => { shown += PAGE; draw(); }, "ghost") : null]
      : empty(list.length ? "لا توجد درجات بهذا الاختيار." : "لا توجد درجات بعد. يرصدها المعلمون من بوابتهم."));
  };
  classSel.addEventListener("change", () => { shown = PAGE; draw(); });
  stateSel.addEventListener("change", () => { shown = PAGE; draw(); });
  draw();
  return panel("الدرجات", null,
    sub(selfApprove
      ? "المعلم يعتمد درجاته وتُنشر لأولياء الأمور مباشرة. تستطيع مراجعة أي درجة وتصحيحها أو إخفاءها من هنا. يُغيَّر ذلك من الإعدادات ← المعلمون."
      : "المعلم يرسل الدرجات وتعتمدها الإدارة قبل نشرها. يُغيَّر ذلك من الإعدادات ← المعلمون."),
    h("div", { class: "row" }, field("الفصل", classSel), field("الحالة", stateSel)),
    box);
}

// One grade list: every student with an editable score, saved together.
async function sheet(e, refresh) {
  const rows = await api(`${A}/exams/${e.id}/scores`);
  const base = Object.fromEntries(rows.map((r) => [r.id, r.score ?? null]));
  const max = Number(e.max_score);
  const inputs = rows.map((r) => {
    const el = input({ type: "number", min: 0, max, step: "0.25", value: r.score ?? "", class: "ltr ge-score", inputMode: "decimal", "aria-label": `درجة ${r.name}` });
    el.addEventListener("input", () => el.classList.toggle("bad", el.value !== "" && (Number(el.value) < 0 || Number(el.value) > max)));
    el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); const i = inputs.findIndex(([, x]) => x === el); inputs[i + 1]?.[1].focus(); } });
    return [r.id, el];
  });
  const msg = h("div");
  const body = h("div", {},
    sub(`${e.class_name} · ${e.subject_name} · الدرجة من ${max}`),
    e.status === "published" ? notice("الدرجات منشورة: أي تصحيح يظهر لولي الأمر بعد الحفظ.", "") : null,
    msg,
    rows.length ? h("ol", { class: "ge-sheet ax-sheet" }, rows.map((r, i) => h("li", {},
      h("span", { class: "ge-n" }, String(i + 1)), h("span", { class: "ge-name" }, r.name), inputs[i][1], h("span", { class: "ge-of" }, `/ ${max}`))))
      : empty("لا يوجد طلاب."));
  const d = dialog(e.title, body, [
    btn("حفظ التعديلات", async () => {
      const scores = {};
      for (const [id, el] of inputs) {
        const v = el.value.trim();
        if (v !== "" && (Number.isNaN(Number(v)) || Number(v) < 0 || Number(v) > max)) { el.focus(); return mount(msg, notice(`درجة غير صحيحة: ${v} (الدرجة القصوى ${max})`, "err")); }
        scores[id] = v === "" ? null : Number(v);
      }
      const save = async (base) => {
        try { await api(`${A}/exams/${e.id}/scores`, { scores, ...(base ? { base } : {}) }, "PUT"); toast("حُفظت الدرجات"); d.close(); refresh(); }
        catch (err) {
          if (err.changed?.length) mount(msg, scoreConflict(err.changed, { keepTheirs: () => { d.close(); sheet(e, refresh); }, keepMine: () => save(null) }));
          else mount(msg, notice(err.message, "err"));
        }
      };
      await save(base);
    }),
    btn("تصدير", () => csv(`${e.title}.csv`, [["الطالب", "الدرجة", "من"], ...rows.map((r, i) => [r.name, inputs[i][1].value, max])]), "ghost"),
  ]);
}
