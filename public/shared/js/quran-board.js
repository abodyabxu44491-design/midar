/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { panel, field, input, select, textarea, btn, empty, sub, toast, notice, confirmAction, dialog, badge } from "./ui.js";
import { fmtDate, today } from "./format.js";
import { partsView } from "./parts.js";

// Quran circles, shared by the administration (everything) and the teacher's app (their own circles and students).
const KIND_TONE = { new: "", review: "blue", test: "violet", absent: "red", excused: "amber" };
const GRADE_TONE = { excellent: "", very_good: "", good: "blue", acceptable: "amber", weak: "red", repeat: "red" };

export function quranBoard({ base, admin = false }) {
  const Q = `${base}/quran`;
  let meta = null;
  const loadMeta = async () => (meta = await api(`${Q}/meta`));
  const parts = admin ? [["halaqat", "الحلقات"], ["levels", "المستويات"], ["reports", "التقارير"]] : [["halaqat", "حلقاتي"]];
  return partsView(parts, async (part, nav) => {
    await loadMeta();
    if (part === "halaqat") return halaqatView(nav);
    if (part === "levels") return levelsView(nav);
    if (part === "reports") return reportsView();
  });

  /* ---------- circles ---------- */
  function halaqatView(nav) {
    const box = h("div");
    const list = () => {
      const active = meta.halaqat.filter((x) => x.status === "active");
      const archived = meta.halaqat.filter((x) => x.status !== "active");
      mount(box,
        admin ? h("div", { class: "row", style: "justify-content:flex-end;margin-bottom:8px" }, btn("+ حلقة جديدة", () => halaqaDialog(null, nav))) : null,
        active.length ? h("div", { class: "qr-cards" }, active.map((x) => h("button", { type: "button", class: "qr-card", onclick: () => openCircle(x.id) },
          h("b", {}, x.name),
          h("span", { class: "sub" }, [x.teacher || "بلا معلم", x.level, x.schedule].filter(Boolean).join(" · ")),
          h("span", { class: "qr-count" }, `${x.students}${x.capacity ? ` / ${x.capacity}` : ""} طالب`))))
          : empty(admin ? "لا توجد حلقات بعد. أنشئ أول حلقة وحدد معلمها." : "لا توجد حلقات مسندة لك. تواصل مع الإدارة."),
        admin && archived.length ? h("details", { style: "margin-top:12px" }, h("summary", {}, `حلقات مؤرشفة (${archived.length})`),
          archived.map((x) => h("div", { class: "row spaced", style: "padding:6px 0" }, h("span", {}, x.name),
            btn("إعادة تفعيل", async () => { await api(`${Q}/halaqat/${x.id}`, { status: "active" }, "PATCH"); nav.show(); }, "ghost sm")))) : null);
    };
    const openCircle = async (id) => {
      mount(box, empty("جارٍ التحميل…"));
      try { mount(box, await circleView(id, () => { list(); }, () => openCircle(id))); } catch (e) { mount(box, notice(e.message, "err")); }
    };
    list();
    return box;
  }

  function halaqaDialog(x, nav) {
    const f = {
      name: input({ value: x?.name || "" }),
      teacher: select([["", "بدون معلم الآن"], ...meta.teachers.map((t) => [t.id, t.name])], { value: x?.teacher_id ?? "" }),
      level: select([["", "بدون مستوى"], ...meta.levels.map((l) => [l.id, l.name])], { value: x?.level_id ?? "" }),
      schedule: input({ value: x?.schedule || "", placeholder: "مثال: يوميًا بعد العصر" }),
      capacity: input({ type: "number", min: 1, value: x?.capacity ?? "" }),
      notes: textarea({ rows: 2, value: x?.notes || "" }),
    };
    const d = dialog(x ? `تعديل «${x.name}»` : "حلقة جديدة", h("div", {},
      field("اسم الحلقة", f.name), h("div", { class: "form-grid" }, field("المعلم", f.teacher), field("المستوى", f.level)),
      h("div", { class: "form-grid" }, field("الموعد", f.schedule), field("السعة (اختياري)", f.capacity)), field("ملاحظات", f.notes)),
    [btn("حفظ", async () => {
      const b = { name: f.name.value, teacher_id: f.teacher.value || null, level_id: f.level.value || null, schedule: f.schedule.value,
        capacity: f.capacity.value, notes: f.notes.value };
      try {
        if (x) await api(`${Q}/halaqat/${x.id}`, b, "PATCH"); else await api(`${Q}/halaqat`, b);
        d.close(); toast("حُفظت الحلقة"); nav.show();
      } catch (e) { toast(e.message, true); }
    }), x ? btn("أرشفة الحلقة", async () => {
      if (!confirmAction("أرشفة الحلقة؟ تنتهي عضوية طلابها فيها، وتبقى كل سجلاتهم.")) return;
      await api(`${Q}/halaqat/${x.id}`, { status: "archived" }, "PATCH"); d.close(); nav.show();
    }, "danger") : null].filter(Boolean));
  }

  async function circleView(id, back, reload) {
    const d = await api(`${Q}/halaqat/${id}`);
    const x = d.halaqa;
    const rows = d.members.map((m) => {
      const p = m.progress;
      const act = (kind, label, cls = "soft sm") => btn(label, () => recordDialog(m, kind, reload), cls);
      return h("div", { class: `qr-row${p.behind ? " behind" : ""}` },
        h("button", { type: "button", class: "qr-who", onclick: () => studentDialog(m.student_id, reload) },
          h("b", {}, m.name), h("span", { class: "sub" }, [m.level, m.class_name].filter(Boolean).join(" · ")),
          h("span", { class: "qr-bar", title: `${p.percent}%` }, h("i", { style: `width:${Math.min(100, p.percent)}%` })),
          h("span", { class: "sub" }, `${p.memorised} آية (${p.percent}%) · هذا الأسبوع ${p.week.new_ayat}${p.week.target ? ` من ${p.week.target}` : ""} آية جديدة`),
          p.behind ? badge("متأخر عن خطته", "amber") : null),
        h("div", { class: "qr-today" }, m.today.map((r) => badge(`${r.kind_name}${r.passage ? `: ${r.passage}` : ""}${r.grade_name ? ` (${r.grade_name})` : ""}`, KIND_TONE[r.kind]))),
        h("div", { class: "qr-acts" }, act("new", "حفظ"), act("review", "مراجعة"), act("test", "تسميع"), act("absent", "غائب", "ghost sm")));
    });
    const memberIds = d.members.map((m) => m.student_id);
    return [
      h("div", { class: "row spaced", style: "margin-bottom:8px;flex-wrap:wrap;gap:8px" },
        btn("رجوع للحلقات", back, "ghost sm"),
        h("div", { class: "row", style: "gap:6px;flex-wrap:wrap" },
          memberIds.length ? btn("غياب جماعي", () => absenceDialog(d.members, reload), "ghost sm") : null,
          btn("تقرير الحلقة", () => circleReport(x), "ghost sm"),
          admin ? btn("إضافة طلاب", () => addStudents(x, reload), "sm") : null,
          admin ? btn("تعديل الحلقة", () => halaqaDialog(x, { show: reload }), "ghost sm") : null)),
      panel(x.name, null, sub([x.teacher ? `المعلم: ${x.teacher}` : "بلا معلم", x.level, x.schedule].filter(Boolean).join(" · ")),
        rows.length ? h("div", { class: "qr-list" }, rows) : empty(admin ? "لا يوجد طلاب في الحلقة. أضفهم من «إضافة طلاب»." : "لا يوجد طلاب في الحلقة بعد.")),
      admin && d.members.length ? h("details", {}, h("summary", {}, "إدارة الأعضاء (الهدف اليومي، المستوى، الإخراج من الحلقة)"),
        d.members.map((m) => memberLine(m, reload))) : null,
    ];
  }

  function memberLine(m, reload) {
    const target = input({ type: "number", min: 1, value: m.daily_target ?? "", placeholder: "آيات/يوم", style: "max-width:110px" });
    const level = select([["", "بدون مستوى"], ...meta.levels.map((l) => [l.id, l.name])], { value: m.level_id ?? "" });
    return h("div", { class: "row spaced", style: "padding:6px 0;border-bottom:1px solid var(--line);gap:8px;flex-wrap:wrap" },
      h("b", { style: "min-width:140px" }, m.name), level, target,
      btn("حفظ", async () => { await api(`${Q}/members/${m.id}`, { daily_target: target.value, level_id: level.value || null }, "PATCH"); toast("حُفظ"); reload(); }, "soft sm"),
      btn("إخراج من الحلقة", async () => { if (!confirmAction(`إخراج ${m.name} من الحلقة؟ تبقى سجلاته.`)) return; await api(`${Q}/members/${m.id}`, undefined, "DELETE"); reload(); }, "danger sm"));
  }

  async function addStudents(x, reload) {
    const list = await api(`${Q}/unassigned`);
    const chosen = new Set();
    const target = input({ type: "number", min: 1, placeholder: "اختياري" });
    const q = input({ type: "search", placeholder: "ابحث بالاسم أو الشعبة" });
    const box = h("div", { class: "qr-pick" });
    const draw = () => mount(box, list.filter((s) => !q.value || `${s.name} ${s.class_name || ""}`.includes(q.value.trim())).slice(0, 300).map((s) => {
      const cb = h("input", { type: "checkbox", checked: chosen.has(s.id), onchange: () => (cb.checked ? chosen.add(s.id) : chosen.delete(s.id)) });
      return h("label", {}, cb, h("span", {}, s.name), h("small", { class: "sub" }, s.class_name || ""));
    }));
    q.addEventListener("input", draw); draw();
    const d = dialog(`إضافة طلاب إلى «${x.name}»`, h("div", {},
      list.length ? [sub("الطلاب الذين ليسوا في أي حلقة. لنقل طالب من حلقة أخرى افتح حلقته وأخرجه أولًا، أو أضفه من هنا بعد إخراجه."), q, box,
        field("الهدف اليومي للحفظ الجديد (آيات)", target)] : notice("كل الطلاب في حلقات. أخرج طالبًا من حلقته لتنقله.", "")),
    [btn("إضافة", async () => {
      if (!chosen.size) return toast("اختر طالبًا واحدًا على الأقل", true);
      try {
        const r = await api(`${Q}/halaqat/${x.id}/members`, { student_ids: [...chosen], daily_target: target.value });
        d.close(); toast(`أُضيف ${r.added} طالب`); reload();
      } catch (e) { toast(e.message, true); }
    })]);
  }

  /* ---------- recording ---------- */
  function passagePicker(start) {
    const surahOpts = meta.surahs.map((s) => [s.n, `${s.n}. ${s.name}`]);
    const mode = select([["ayat", "سورة وآيات"], ["surah", "سورة كاملة"], ["juz", "جزء كامل"]]);
    const fs = select(surahOpts, { value: start?.surah ?? 1 }), ts = select(surahOpts, { value: start?.surah ?? 1 });
    const fa = input({ type: "number", min: 1, value: start?.ayah ?? 1, inputMode: "numeric" });
    const ta = input({ type: "number", min: 1, inputMode: "numeric" });
    const juz = select(meta.juz.map((j) => [j.juz, `الجزء ${j.juz}`]), { value: 30 });
    const hint = h("small", { class: "sub" });
    const max = (s) => meta.surahs[Number(s) - 1]?.ayat || 1;
    const sync = () => {
      fa.max = max(fs.value); ta.max = max(ts.value);
      if (!ta.value || Number(ta.value) > max(ts.value)) ta.value = Math.min(max(ts.value), Number(fa.value || 1) + 4);
      hint.textContent = `سورة ${meta.surahs[Number(ts.value) - 1].name}: ${max(ts.value)} آية`;
    };
    fs.addEventListener("change", () => { ts.value = fs.value; fa.value = 1; ta.value = ""; sync(); });
    ts.addEventListener("change", sync); fa.addEventListener("input", sync);
    const box = h("div");
    const draw = () => mount(box, mode.value === "juz" ? field("الجزء", juz)
      : mode.value === "surah" ? field("السورة", fs)
      : [h("div", { class: "form-grid" }, field("من سورة", fs), field("من آية", fa)), h("div", { class: "form-grid" }, field("إلى سورة", ts), field("إلى آية", ta)), hint]);
    mode.addEventListener("change", draw); sync(); draw();
    return {
      el: h("div", {}, field("المقطع", mode), box),
      value: () => (mode.value === "juz" ? { juz: Number(juz.value) }
        : mode.value === "surah" ? { from_surah: Number(fs.value), from_ayah: 1, to_surah: Number(fs.value), to_ayah: max(fs.value) }
        : { from_surah: Number(fs.value), from_ayah: Number(fa.value), to_surah: Number(ts.value), to_ayah: Number(ta.value) }),
    };
  }

  function recordDialog(m, kind, reload) {
    const absence = kind === "absent" || kind === "excused";
    const day = input({ type: "date", value: today(), max: today() });
    const notes = input({ placeholder: "ملاحظة المعلم (اختياري)" });
    if (absence) {
      const k = select([["absent", "غائب"], ["excused", "غائب بعذر"]]);
      const d = dialog(`غياب: ${m.name}`, h("div", {}, field("النوع", k), field("اليوم", day), field("ملاحظة", notes)),
        [btn("حفظ", async () => {
          try { await api(`${Q}/records`, { student_id: m.student_id, kind: k.value, on_date: day.value, notes: notes.value }); d.close(); toast("سُجّل"); reload(); }
          catch (e) { toast(e.message, true); }
        })]);
      return;
    }
    const start = kind === "new" ? m.progress.next : null;
    const picker = passagePicker(start);
    let grade = null;
    const gradeBox = h("div", { class: "xb-chips" });
    const drawGrades = () => mount(gradeBox, Object.entries(meta.grades).map(([k, label]) =>
      h("button", { type: "button", class: `xb-chip${grade === k ? " on" : ""}`, onclick: () => { grade = grade === k ? null : k; drawGrades(); } }, label)));
    drawGrades();
    const mistakes = input({ type: "number", min: 0, value: 0, inputMode: "numeric", style: "max-width:120px" });
    const title = { new: "حفظ جديد", review: "مراجعة", test: "تسميع" }[kind];
    const d = dialog(`${title}: ${m.name}`, h("div", {},
      kind === "new" && start ? sub(`يكمل من ${meta.surahs[start.surah - 1].name} آية ${start.ayah} بعد آخر مقطع محفوظ.`) : null,
      picker.el, field("التقدير", gradeBox), h("div", { class: "form-grid" }, field("عدد الأخطاء", mistakes), field("اليوم", day)), field("ملاحظة", notes),
      kind === "new" ? sub("التقدير «يُعاد» لا يُحسب حفظًا حتى يُسمَّع المقطع مرة أخرى.") : null),
    [btn("حفظ", async (e) => {
      const b = e?.currentTarget; if (b) b.disabled = true;
      try {
        const r = await api(`${Q}/records`, { student_id: m.student_id, kind, ...picker.value(), grade, mistakes: mistakes.value, on_date: day.value, notes: notes.value });
        d.close(); toast(`سُجّل: ${r.passage} (${r.ayat} آية)`); reload();
      } catch (err) { toast(err.message, true); if (b) b.disabled = false; }
    })]);
  }

  function absenceDialog(members, reload) {
    const chosen = new Set();
    const k = select([["absent", "غائب"], ["excused", "غائب بعذر"]]);
    const day = input({ type: "date", value: today(), max: today() });
    const d = dialog("غياب جماعي", h("div", {}, h("div", { class: "form-grid" }, field("النوع", k), field("اليوم", day)),
      h("div", { class: "qr-pick" }, members.map((m) => {
        const cb = h("input", { type: "checkbox", onchange: () => (cb.checked ? chosen.add(m.student_id) : chosen.delete(m.student_id)) });
        return h("label", {}, cb, h("span", {}, m.name));
      }))),
    [btn("حفظ", async () => {
      if (!chosen.size) return toast("اختر الغائبين", true);
      try { const r = await api(`${Q}/absences`, { student_ids: [...chosen], kind: k.value, on_date: day.value }); d.close(); toast(`سُجّل غياب ${r.saved}`); reload(); }
      catch (e) { toast(e.message, true); }
    })]);
  }

  /* ---------- a student's progress ---------- */
  async function studentDialog(studentId, reload) {
    const p = await api(`${Q}/students/${studentId}`);
    const body = h("div", {}, progressBlock(p.progress, meta.total, p.membership),
      admin && (p.eligible.juz.length || p.eligible.khatm) ? panel("إنجازات تستحق شهادة", null,
        sub("تظهر هنا حين يُظهر سجل الحفظ اكتمال الجزء. تصدر الشهادة برمز تحقق، وتظهر لولي الأمر."),
        h("div", { class: "row", style: "flex-wrap:wrap;gap:6px" },
          p.eligible.juz.map((j) => btn(`شهادة إتمام الجزء ${j}`, () => achieve({ kind: "juz", juz: j }), "sm")),
          p.eligible.khatm ? btn("شهادة ختم القرآن الكريم", () => achieve({ kind: "khatm" }), "sm") : null)) : null,
      p.achievements.length ? panel("الإنجازات", null, p.achievements.map((a) => h("div", { class: "row spaced", style: "padding:4px 0" },
        h("span", {}, a.title), h("small", { class: "sub" }, `${fmtDate(a.achieved_on)}${a.serial ? ` · ${a.serial}` : ""}`)))) : null,
      panel("السجل", null, p.records.length ? p.records.map((r) => h("div", { class: "row spaced", style: "padding:6px 0;border-bottom:1px solid var(--line);gap:8px" },
        h("div", {}, badge(r.kind_name, KIND_TONE[r.kind]), " ", h("span", {}, r.passage || ""), r.grade_name ? [" ", badge(r.grade_name, GRADE_TONE[r.grade])] : null,
          h("div", { class: "sub" }, [fmtDate(r.on_date), r.ayat ? `${r.ayat} آية` : null, r.mistakes ? `${r.mistakes} أخطاء` : null, r.teacher, r.notes].filter(Boolean).join(" · "))),
        btn("حذف", async () => {
          if (!confirmAction("حذف هذا السجل؟")) return;
          try { await api(`${Q}/records/${r.id}`, undefined, "DELETE"); d.close(); studentDialog(studentId, reload); reload(); } catch (e) { toast(e.message, true); }
        }, "ghost sm"))) : empty("لا يوجد سجل بعد.")));
    const d = dialog(p.student.name, body, []);
    d.classList.add("xb-wide");
    async function achieve(b) {
      if (!confirmAction("إصدار الشهادة؟ تُسجَّل في شهادات الطالب برمز تحقق.")) return;
      try { await api(`${Q}/achievements`, { student_id: studentId, ...b }); toast("صدرت الشهادة"); d.close(); studentDialog(studentId, reload); }
      catch (e) { toast(e.message, true); }
    }
  }

  /* ---------- levels and reports (administration) ---------- */
  function levelsView(nav) {
    const name = input({ placeholder: "مثال: المستوى الأول (جزء عمّ)" });
    return [panel("مستويات الحفظ", null,
      sub("المستويات تحددها المؤسسة بحسب منهجها. يُختار مستوى للحلقة، ويمكن تخصيص مستوى لكل طالب."),
      meta.levels.length ? meta.levels.map((l) => h("div", { class: "row spaced", style: "padding:6px 0;border-bottom:1px solid var(--line)" },
        h("span", {}, h("b", {}, l.name), " ", h("small", { class: "sub" }, `${l.students} طالب`)),
        h("div", { class: "row", style: "gap:6px" },
          btn("تعديل", () => {
            const v = input({ value: l.name });
            const d = dialog("تعديل المستوى", field("اسم المستوى", v), [btn("حفظ", async () => {
              try { await api(`${Q}/levels/${l.id}`, { name: v.value }, "PATCH"); d.close(); nav.show(); } catch (e) { toast(e.message, true); }
            })]);
          }, "ghost sm"),
          btn("حذف", async () => { if (!confirmAction(`حذف «${l.name}»؟ يبقى الطلاب في حلقاتهم بلا مستوى.`)) return; await api(`${Q}/levels/${l.id}`, undefined, "DELETE"); nav.show(); }, "danger sm"))))
        : empty("لا توجد مستويات بعد."),
      h("div", { class: "row", style: "margin-top:10px;gap:8px" }, name,
        btn("إضافة", async () => { try { await api(`${Q}/levels`, { name: name.value, sort: meta.levels.length + 1 }); nav.show(); } catch (e) { toast(e.message, true); } })))];
  }

  function reportsView() {
    const from = input({ type: "date", value: new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10) });
    const to = input({ type: "date", value: today() });
    const box = h("div");
    const load = async () => {
      mount(box, empty("جارٍ التحميل…"));
      const r = await api(`${Q}/reports/teachers?from=${from.value}&to=${to.value}`);
      mount(box, panel(`المعلمون من ${fmtDate(r.from)} إلى ${fmtDate(r.to)}`, btn("طباعة", () => window.print(), "ghost sm"),
        r.teachers.length ? table(["المعلم", "الحلقات", "الطلاب", "أيام التسجيل", "السجلات", "حفظ جديد (آية)", "مراجعة (آية)"],
          r.teachers.map((x) => [x.teacher, x.halaqat, x.students, x.days, x.entries, x.new_ayat, x.review_ayat])) : empty("لا توجد بيانات في هذه الفترة.")),
      panel("تقرير حلقة", null, sub("افتح الحلقة من «الحلقات» ثم «تقرير الحلقة» لتقرير كل طالب فيها.")));
    };
    from.addEventListener("change", load); to.addEventListener("change", load);
    load();
    return [h("div", { class: "form-grid no-print" }, field("من", from), field("إلى", to)), box];
  }

  async function circleReport(x) {
    const from = input({ type: "date", value: new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10) });
    const to = input({ type: "date", value: today() });
    const box = h("div");
    const load = async () => {
      try {
        const r = await api(`${Q}/halaqat/${x.id}/report?from=${from.value}&to=${to.value}`);
        mount(box, sub(`${r.totals.students} طالب · حفظ جديد ${r.totals.new_ayat} آية · مراجعة ${r.totals.review_ayat} آية · غياب ${r.totals.absences} · متأخرون ${r.totals.behind}`),
          table(["الطالب", "المستوى", "المحفوظ كله", "حفظ جديد", "مراجعة", "تسميع", "أيام الحضور", "غياب", "بعذر", "متوسط التقدير"],
            r.students.map((s) => [s.name, s.level || "—", `${s.memorised_total} (${s.percent}%)`, s.new_ayat, s.review_ayat, s.tests, s.days, s.absences, s.excused,
              s.average === null ? "—" : `${s.average} من 5`])));
      } catch (e) { mount(box, notice(e.message, "err")); }
    };
    from.addEventListener("change", load); to.addEventListener("change", load);
    const d = dialog(`تقرير ${x.name}`, h("div", {}, h("div", { class: "form-grid no-print" }, field("من", from), field("إلى", to)), box),
      [btn("طباعة", () => window.print(), "ghost")]);
    d.classList.add("xb-wide");
    load();
  }
}

const table = (head, rows) => h("div", { class: "table-wrap" }, h("table", { class: "grid" },
  h("thead", {}, h("tr", {}, head.map((x) => h("th", {}, x)))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, String(c ?? "—"))))))));

// The progress card: share of the Quran memorised and a 30-juz grid. Used by staff and by the parent page.
export function progressBlock(p, total, membership = null) {
  return panel("التقدم في الحفظ", null,
    membership ? sub([`الحلقة: ${membership.halaqa}`, membership.level ? `المستوى: ${membership.level}` : null,
      membership.daily_target ? `الهدف اليومي: ${membership.daily_target} آية` : null].filter(Boolean).join(" · ")) : null,
    h("div", { class: "qr-big" }, h("b", {}, `${p.percent}%`), h("span", {}, `${p.memorised} آية من ${total}`)),
    h("span", { class: "qr-bar big" }, h("i", { style: `width:${Math.min(100, p.percent)}%` })),
    p.week ? sub(`آخر 7 أيام: حفظ جديد ${p.week.new_ayat} آية، مراجعة ${p.week.review_ayat} آية${p.week.absences ? `، غياب ${p.week.absences}` : ""}`) : null,
    h("div", { class: "qr-juz", role: "list", "aria-label": "الأجزاء" }, p.coverage.map((c) => {
      const pct = Math.round((c.done / c.total) * 100);
      return h("span", { role: "listitem", class: c.complete ? "done" : pct ? "part" : "", title: `الجزء ${c.juz}: ${pct}%`, style: pct && !c.complete ? `--p:${pct}%` : null },
        h("b", {}, c.juz), h("small", {}, c.complete ? "مكتمل" : pct ? `${pct}%` : ""));
    })));
}
