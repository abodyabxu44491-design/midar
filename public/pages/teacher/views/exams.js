/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Grade entry in one simple flow: tap the class, tap the grade type, enter the scores (saved automatically,
// Enter moves to the next student), then send them to the administration.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { input, btn, empty, badge, sub, toast, notice, confirmAction } from "../../shared/js/ui.js";
import { EXAM, fmtDate, today } from "../../shared/js/format.js";
import { getSync } from "../../shared/js/offline/sync.js";
import { localExam, localScoreRows, saveScoresLocal, examSynced } from "../offline.js";

const T = "/api/teacher/exams";
const QUICK = ["اختبار قصير", "اختبار شهري", "مشاركة", "واجبات", "مشروع", "اختبار نهائي"];
const MAXES = [5, 10, 20, 30, 50, 100];
const KEY = "midar_grades_pair";

export default async function exams({ me, refresh }) {
  if (!me.load.length) return empty("لا توجد مواد مسندة لك.");
  let list, offline = false;
  try { list = await api(T); } catch (e) {
    if (e.code !== "network" && e.code !== "timeout") throw e;
    const sy = getSync();
    const load = sy ? await sy.db.all("load") : [];
    const nameOf = (c, s2) => load.find((l) => Number(l.class_id) === Number(c) && Number(l.subject_id) === Number(s2)) || {};
    list = sy ? (await sy.db.all("exams")).map((e) => ({ ...e, class_name: nameOf(e.class_id, e.subject_id).class_name, subject_name: nameOf(e.class_id, e.subject_id).subject_name, graded: "—" })) : [];
    offline = true;
  }
  const pairs = me.load.map((l) => ({ key: `${l.class_id}:${l.subject_id}`, class_id: l.class_id, subject_id: l.subject_id, label: `${l.class_name} — ${l.subject_name}` }));
  let pair = (() => { try { return sessionStorage.getItem(KEY); } catch { return null; } })();
  if (!pairs.some((p) => p.key === pair)) pair = pairs[0].key;
  const root = h("div", { class: "ge" });
  const keyOf = (e) => `${e.class_id}:${e.subject_id}`;

  const draw = () => {
    const cur = pairs.find((p) => p.key === pair);
    const mine = list.filter((e) => keyOf(e) === pair);
    mount(root,
      offline ? notice("غير متصل: تظهر الدرجات المحفوظة على جهازك. أدخل الدرجات الآن وتُرسل تلقائيًا عند عودة الاتصال.", "warn") : null,
      h("div", { class: "ge-step" }, h("b", {}, "١. اختر الفصل والمادة")),
      h("div", { class: "ge-pairs" }, pairs.map((p) => {
        const open = list.filter((e) => keyOf(e) === p.key && e.status === "draft").length;
        return h("button", { type: "button", class: `ge-pair${p.key === pair ? " on" : ""}`, onclick: () => {
          pair = p.key; try { sessionStorage.setItem(KEY, pair); } catch { /* storage unavailable */ } draw();
        } }, p.label, open ? h("small", {}, `${open} مسودة`) : null);
      })),
      h("div", { class: "ge-step" }, h("b", {}, "٢. ابدأ رصدًا جديدًا أو افتح رصدًا سابقًا")),
      offline ? null : newCard(cur),
      mine.length ? h("div", { class: "ge-list" }, mine.map((e) => h("button", { type: "button", class: "ge-item", onclick: () => openSheet(e) },
        h("div", {}, h("b", {}, e.title), h("small", {}, `${fmtDate(e.exam_date)} · من ${Number(e.max_score)} · أُدخلت ${e.graded}`)),
        h("span", { class: "ge-item-s" }, e.component_name ? badge(e.component_name, "gray") : null, badge(...EXAM[e.status]),
          h("span", { class: "ge-go" }, e.status === "draft" ? "إدخال" : "عرض"))))) : empty("لا توجد درجات مرصودة لهذا الفصل بعد."));
  };

  // A new grade: its type (the school's grade components, or common names), the maximum, then straight to entry.
  function newCard(cur) {
    const box = h("div", { class: "ge-new" });
    let comps = [], compId = null, title = "", max = 20, date = today(), customTitle = false;
    const titleIn = input({ placeholder: "اسم الرصد، مثل: اختبار شهري", value: title });
    titleIn.addEventListener("input", () => { title = titleIn.value; customTitle = true; });
    const maxIn = input({ type: "number", min: 0.25, step: "0.25", value: max, class: "ltr ge-max-in", "aria-label": "الدرجة القصوى" });
    maxIn.addEventListener("input", () => { max = Number(maxIn.value); paint(); });
    const dateIn = input({ type: "date", value: date, class: "ltr" });
    dateIn.addEventListener("change", () => { date = dateIn.value; });
    const types = h("div", { class: "ge-chips" });
    const maxes = h("div", { class: "ge-chips" });
    const paint = () => {
      const opts = comps.length ? comps.map((c) => [c.id, c.name, `${Number(c.weight)}%`]) : QUICK.map((q) => [q, q, null]);
      mount(types, opts.map(([id, name, w]) => h("button", { type: "button", class: `ge-chip${(comps.length ? compId === id : title === name) ? " on" : ""}`, onclick: () => {
        if (comps.length) compId = id;
        if (!customTitle || !title) { title = name; titleIn.value = name; customTitle = false; }
        paint();
      } }, name, w ? h("small", {}, w) : null)));
      mount(maxes, MAXES.map((m) => h("button", { type: "button", class: `ge-chip${max === m ? " on" : ""}`, onclick: () => { max = m; maxIn.value = m; paint(); } }, `من ${m}`)), maxIn);
    };
    (async () => {
      try { comps = await api(`${T}/components?class_id=${cur.class_id}`); } catch { comps = []; }
      const def = comps.find((c) => c.is_default) || comps[0];
      if (def) { compId = def.id; title = def.name; titleIn.value = def.name; }
      else if (!title) { title = QUICK[1]; titleIn.value = title; }
      paint();
    })();
    paint();
    const go = btn("ابدأ إدخال الدرجات", async () => {
      if (!titleIn.value.trim()) { titleIn.focus(); return toast("اكتب اسم الرصد أو اختر نوعه", true); }
      if (!(max > 0)) { maxIn.focus(); return toast("حدد الدرجة القصوى", true); }
      go.disabled = true;
      try {
        const row = await api(T, { class_id: cur.class_id, subject_id: cur.subject_id, title: titleIn.value.trim(), exam_date: date || null, max_score: max,
          component_id: comps.length && compId ? Number(compId) : undefined });
        list = await api(T);
        const e = list.find((x) => Number(x.id) === Number(row.id));
        if (e) openSheet(e); else draw();
      } catch (err) { go.disabled = false; toast(err.message, true); }
    });
    mount(box,
      h("div", { class: "ge-field" }, h("span", {}, "نوع الدرجة"), types),
      h("div", { class: "ge-field" }, h("span", {}, "الدرجة من"), maxes),
      h("div", { class: "ge-row" }, h("label", { class: "ge-field" }, h("span", {}, "الاسم"), titleIn), h("label", { class: "ge-field" }, h("span", {}, "التاريخ"), dateIn)),
      go);
    return box;
  }

  // The entry sheet: one row per student, saved automatically, sent to the administration in one tap.
  async function openSheet(e) {
    mount(root, h("p", { class: "empty loading" }, "جارٍ فتح الكشف…"));
    const local = await localExam(e.id);
    const rows = local ? await localScoreRows(local) : await api(`${T}/${e.id}/scores`);
    const locked = e.status !== "draft";
    const max = Number(e.max_score);
    const state = h("small", { class: "ge-state" });
    const progress = h("b", {});
    let timer = null, saving = Promise.resolve();
    const inputs = rows.map((r) => {
      const el = input({ type: "number", min: 0, max, step: "0.25", value: r.score ?? "", inputMode: "decimal", class: "ltr ge-score",
        disabled: locked, "aria-label": `درجة ${r.name}` });
      el.addEventListener("input", () => { check(el); count(); if (!locked) schedule(); });
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === "ArrowDown") { ev.preventDefault(); next(el, 1); }
        if (ev.key === "ArrowUp") { ev.preventDefault(); next(el, -1); }
      });
      return [r.id, el];
    });
    const next = (el, d) => { const i = inputs.findIndex(([, x]) => x === el); const t = inputs[i + d]?.[1]; if (t) { t.focus(); t.select(); } };
    const bad = (v) => v !== "" && (Number.isNaN(Number(v)) || Number(v) < 0 || Number(v) > max);
    const check = (el) => el.classList.toggle("bad", bad(el.value.trim()));
    const count = () => {
      const done = inputs.filter(([, el]) => el.value.trim() !== "").length;
      progress.textContent = `أُدخلت ${done} من ${inputs.length}`;
    };
    const collect = () => {
      const out = {};
      for (const [id, el] of inputs) {
        const v = el.value.trim();
        if (bad(v)) { el.focus(); throw new Error(`درجة غير صحيحة: ${v} (الدرجة القصوى ${max})`); }
        out[id] = v === "" ? null : Number(v);
      }
      return out;
    };
    const save = async () => {
      let scores;
      try { scores = collect(); } catch (err) { state.textContent = err.message; state.className = "ge-state err"; return false; }
      state.textContent = "جارٍ الحفظ…"; state.className = "ge-state";
      try {
        if (local) await saveScoresLocal(local, scores);
        else await api(`${T}/${e.id}/scores`, { scores }, "PUT");
        state.textContent = local && !navigator.onLine ? "محفوظ على جهازك — يُرسل عند عودة الاتصال" : "محفوظ تلقائيًا";
        state.className = "ge-state ok";
        return true;
      } catch (err) { state.textContent = `لم يُحفظ: ${err.message}`; state.className = "ge-state err"; return false; }
    };
    const schedule = () => { clearTimeout(timer); state.textContent = "تعديلات جديدة…"; state.className = "ge-state"; timer = setTimeout(() => { saving = save(); }, 900); };
    const back = async () => { clearTimeout(timer); if (!locked) await save(); try { list = await api(T); } catch { /* offline: keep the list */ } draw(); };
    const fillFull = () => { for (const [, el] of inputs) if (el.value.trim() === "") el.value = max; count(); schedule(); };
    const send = btn("إرسال للإدارة", async () => {
      clearTimeout(timer); await saving;
      let scores;
      try { scores = collect(); } catch (err) { return toast(err.message, true); }
      const missing = Object.values(scores).filter((v) => v === null).length;
      if (!confirmAction(missing ? `${missing} طالب بدون درجة. إرسال الدرجات للإدارة؟ لن تستطيع تعديلها بعد ذلك.` : "إرسال الدرجات للإدارة؟ لن تستطيع تعديلها بعد ذلك.")) return;
      if (!navigator.onLine) return toast("الإرسال يحتاج اتصالًا. درجاتك محفوظة على الجهاز، أرسلها عند عودة الاتصال.", true);
      send.disabled = true;
      try {
        if (local) {
          await saveScoresLocal(local, scores);
          if (!(await examSynced(e.id))) { send.disabled = false; return toast("لم تكتمل مزامنة الدرجات بعد. انتظر قليلًا ثم أعد المحاولة.", true); }
        } else await api(`${T}/${e.id}/scores`, { scores }, "PUT");
        await api(`${T}/${e.id}/submit`, {});
        toast("أُرسلت الدرجات للإدارة"); refresh();
      } catch (err) { send.disabled = false; toast(err.message, true); }
    });
    count();
    mount(root,
      h("div", { class: "ge-head" },
        h("button", { type: "button", class: "ge-back", onclick: back }, "→ كل الدرجات"),
        h("div", {}, h("h2", {}, e.title), sub(`${e.class_name} — ${e.subject_name} · الدرجة من ${max} · ${fmtDate(e.exam_date)}`)),
        badge(...EXAM[e.status])),
      locked ? notice(e.status === "published" ? "الدرجات منشورة لأولياء الأمور." : "أُرسلت الدرجات للإدارة، ولا تُعدَّل حتى تُرجعها الإدارة.", "") : h("div", { class: "ge-tools" },
        sub("اكتب الدرجة واضغط Enter للانتقال للطالب التالي. يُحفظ كل شيء تلقائيًا، واترك خانة الغائب فارغة."),
        btn(`تعبئة الفارغ بـ ${max}`, fillFull, "ghost sm")),
      rows.length ? h("ol", { class: "ge-sheet" }, rows.map((r, i) => h("li", {},
        h("span", { class: "ge-n" }, String(i + 1)), h("span", { class: "ge-name" }, r.name, r.pending ? h("span", { class: "pending-dot" }, "بانتظار المزامنة") : null),
        inputs[i][1], h("span", { class: "ge-of" }, `/ ${max}`)))) : empty("لا يوجد طلاب في الفصل."),
      locked ? null : h("div", { class: "ge-bar" }, h("div", {}, progress, state), send));
    if (!locked) inputs[0]?.[1].focus();
  }

  draw();
  return root;
}
