/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, sub, toast, notice, confirmAction, dialog, badge, kpiCard, kpiGrid, showCredentials } from "../../shared/js/ui.js";
import { fmtDate } from "../../shared/js/format.js";
import { partsView } from "../../shared/js/parts.js";
import { uniTranscript, rosterDialog } from "../../shared/js/university-ui.js";

// The registrar's office of a university: structure, terms and sections, admission and registration, grades and records.
const U = "/api/admin/university";
const TERM_TONE = { planned: "gray", registration: "blue", running: "", grading: "amber", closed: "gray" };
let meta = null;
export const loadMeta = async () => (meta = await api(`${U}/meta`));
const table = (head, rows) => h("div", { class: "table-wrap" }, h("table", { class: "grid" },
  h("thead", {}, h("tr", {}, head.map((x) => h("th", {}, x)))), h("tbody", {}, rows)));
const td = (x, cls) => h("td", cls ? { class: cls } : {}, x ?? "—");
const form = (title, fields, save, d0 = null) => {
  const d = dialog(title, h("div", {}, fields), [btn("حفظ", async (e) => {
    const b = e?.currentTarget; if (b) b.disabled = true;
    try { await save(); d.close(); } catch (err) { toast(err.message, true); if (b) b.disabled = false; }
  })]);
  void d0;
  return d;
};

/* ---------- home ---------- */
export async function dashboard({ goTo }) {
  const d = await api(`${U}/dashboard`);
  const c = d.counts;
  return [
    kpiGrid(
      kpiCard({ icon: "users", tone: "teal", label: "الطلاب المنتظمون", value: String(c.students), onClick: () => goTo("ustudents") }),
      kpiCard({ icon: "grid", tone: "navy", label: "البرامج", value: String(c.programs), note: `${c.colleges} كلية`, onClick: () => goTo("ustructure") }),
      kpiCard({ icon: "book", tone: "violet", label: "المقررات", value: String(c.courses), onClick: () => goTo("ustructure") }),
      kpiCard({ icon: "clipboard", tone: "amber", label: "شعب بلا درجات مسلّمة", value: String(d.pending_grades), onClick: () => goTo("uterms") })),
    d.term ? panel(`الفصل الحالي: ${d.term.name}`, null, badge(meta.labels.term_status[d.term.status], TERM_TONE[d.term.status]),
      sub(`${fmtDate(d.term.starts_on)} إلى ${fmtDate(d.term.ends_on)} · ${d.sections} شعبة مطروحة · ${d.registrations} تسجيل · ${d.full} شعبة ممتلئة`))
      : notice("لا يوجد فصل مفتوح. أنشئ الهيكل (الكليات والأقسام والبرامج والمقررات) ثم أنشئ فصلًا واطرح شعبه.", ""),
    panel("ابدأ من هنا", null, h("ol", {},
      h("li", {}, "الهيكل الأكاديمي: الكليات ثم الأقسام ثم البرامج والمقررات وخطة كل برنامج."),
      h("li", {}, "هيئة التدريس: حساب لكل عضو، يدخل منه لرصد درجات شعبه."),
      h("li", {}, "الفصول والشعب: فصل جديد، ثم طرح شعب المقررات بمدرّسها وسعتها، ثم فتح التسجيل."),
      h("li", {}, "الطلاب: القبول في برنامج، ثم تسجيل المقررات (تُطبق المتطلبات السابقة والسعة وحد الساعات)."),
      h("li", {}, "الدرجات: يرصدها المدرّس ويسلّمها، فيظهر المعدل الفصلي والتراكمي في السجل الأكاديمي."))),
  ];
}

/* ---------- structure ---------- */
export function structure() {
  return partsView([["colleges", "الكليات والأقسام"], ["programs", "البرامج"], ["courses", "المقررات"]], async (part, nav) => {
    const s = await api(`${U}/structure`);
    const depName = (id) => s.departments.find((d) => d.id === id)?.name || "—";
    if (part === "colleges") {
      return [h("div", { class: "row", style: "justify-content:flex-end;gap:6px;margin-bottom:8px" },
        btn("+ كلية", () => { const f = { code: input({ class: "ltr" }), name: input(), dean: input() };
          form("كلية جديدة", [h("div", { class: "form-grid" }, field("الرمز", f.code), field("الاسم", f.name)), field("العميد (اختياري)", f.dean)],
            async () => { await api(`${U}/colleges`, { code: f.code.value, name: f.name.value, dean: f.dean.value }); nav.show(); }); }),
        s.colleges.length ? btn("+ قسم", () => { const f = { college: select(s.colleges.map((c) => [c.id, c.name])), code: input({ class: "ltr" }), name: input(), head: input() };
          form("قسم جديد", [field("الكلية", f.college), h("div", { class: "form-grid" }, field("الرمز", f.code), field("الاسم", f.name)), field("رئيس القسم (اختياري)", f.head)],
            async () => { await api(`${U}/departments`, { college_id: Number(f.college.value), code: f.code.value, name: f.name.value, head: f.head.value }); nav.show(); }); }, "soft") : null),
        s.colleges.length ? s.colleges.map((c) => panel(`${c.name} (${c.code})`, null, c.dean ? sub(`العميد: ${c.dean}`) : null,
          s.departments.filter((d) => d.college_id === c.id).map((d) => h("div", { class: "uni-row" }, h("span", {}, h("b", {}, d.name), " ", h("small", { class: "sub ltr" }, d.code)),
            h("small", { class: "sub" }, `${s.programs.filter((p) => p.department_id === d.id).length} برنامج · ${s.courses.filter((x) => x.department_id === d.id).length} مقرر`)))))
          : empty("ابدأ بإضافة كلية.")];
    }
    if (part === "programs") {
      return [s.departments.length ? h("div", { class: "row", style: "justify-content:flex-end;margin-bottom:8px" }, btn("+ برنامج", () => {
        const f = { dep: select(s.departments.map((d) => [d.id, d.name])), code: input({ class: "ltr" }), name: input(), degree: select(Object.entries(s.degrees)),
          credits: input({ type: "number", min: 1, value: 132 }), years: input({ type: "number", min: 1, value: 4 }) };
        f.degree.value = "bachelor";
        form("برنامج جديد", [field("القسم", f.dep), h("div", { class: "form-grid" }, field("الرمز", f.code), field("الاسم", f.name)),
          h("div", { class: "form-grid" }, field("الدرجة", f.degree), field("الساعات المطلوبة للتخرج", f.credits), field("السنوات", f.years))],
        async () => { await api(`${U}/programs`, { department_id: Number(f.dep.value), code: f.code.value, name: f.name.value, degree: f.degree.value, total_credits: f.credits.value, years: f.years.value }); nav.show(); });
      })) : notice("أضف قسمًا أولًا.", "warn"),
      s.programs.length ? table(["الرمز", "البرنامج", "الدرجة", "القسم", "الساعات", "الطلاب", "الخطة", ""], s.programs.map((p) => {
        const plan = s.plan.filter((x) => x.program_id === p.id);
        return h("tr", {}, td(p.code, "ltr"), td(p.name), td(s.degrees[p.degree]), td(depName(p.department_id)), td(String(p.total_credits)), td(String(p.students)),
          td(`${plan.length} مقرر · ${plan.reduce((n, x) => n + (s.courses.find((c) => c.id === x.course_id)?.credits || 0), 0)} ساعة`),
          h("td", {}, btn("الخطة", () => planDialog(p, s, nav), "ghost sm")));
      })) : empty("لا توجد برامج.")];
    }
    return [s.departments.length ? h("div", { class: "row", style: "justify-content:flex-end;margin-bottom:8px" }, btn("+ مقرر", () => courseDialog(null, s, nav))) : notice("أضف قسمًا أولًا.", "warn"),
      s.courses.length ? table(["الرمز", "المقرر", "الساعات", "القسم", "المتطلبات السابقة", ""], s.courses.map((c) => h("tr", {}, td(c.code, "ltr"), td(c.name), td(String(c.credits)),
        td(depName(c.department_id)), td(c.prerequisites.map((p) => s.courses.find((x) => x.id === p)?.code).filter(Boolean).join("، ") || "—"),
        h("td", {}, btn("تعديل", () => courseDialog(c, s, nav), "ghost sm"))))) : empty("لا توجد مقررات.")];
  });
}

function courseDialog(c, s, nav) {
  const f = { dep: select(s.departments.map((d) => [d.id, d.name]), { value: c?.department_id }), code: input({ class: "ltr", value: c?.code || "" }),
    name: input({ value: c?.name || "" }), credits: input({ type: "number", min: 0, max: 12, value: c?.credits ?? 3 }), desc: textarea({ rows: 2, value: c?.description || "" }) };
  const pre = new Set(c?.prerequisites || []);
  const chips = h("div", { class: "qr-pick" }, s.courses.filter((x) => x.id !== c?.id).map((x) => {
    const cb = h("input", { type: "checkbox", checked: pre.has(x.id), onchange: () => (cb.checked ? pre.add(x.id) : pre.delete(x.id)) });
    return h("label", {}, cb, h("span", {}, `${x.code} ${x.name}`));
  }));
  form(c ? `تعديل ${c.code}` : "مقرر جديد", [c ? null : field("القسم", f.dep), h("div", { class: "form-grid" }, c ? null : field("الرمز", f.code), field("الاسم", f.name), field("الساعات المعتمدة", f.credits)),
    field("الوصف (اختياري)", f.desc), h("h3", {}, "المتطلبات السابقة"), sub("لا يسجل الطالب المقرر حتى يجتاز متطلباته."), chips], async () => {
    const b = { name: f.name.value, credits: f.credits.value, prerequisites: [...pre], description: f.desc.value };
    if (c) await api(`${U}/courses/${c.id}`, b, "PATCH"); else await api(`${U}/courses`, { ...b, department_id: Number(f.dep.value), code: f.code.value });
    nav.show();
  });
}

function planDialog(p, s, nav) {
  const cur = new Map(s.plan.filter((x) => x.program_id === p.id).map((x) => [x.course_id, x]));
  const rows = s.courses.map((c) => {
    const on = h("input", { type: "checkbox", checked: cur.has(c.id) });
    const kind = select([["required", "إجباري"], ["elective", "اختياري"]], { value: cur.get(c.id)?.kind || "required" });
    const level = input({ type: "number", min: 1, max: 20, value: cur.get(c.id)?.level ?? "", placeholder: "المستوى", style: "max-width:90px" });
    return { c, on, kind, level, el: h("div", { class: "uni-row" }, h("label", { class: "row", style: "gap:8px;justify-content:flex-start" }, on, h("span", {}, `${c.code} ${c.name} (${c.credits})`)),
      h("div", { class: "row", style: "gap:6px" }, kind, level)) };
  });
  form(`خطة ${p.name}`, [sub(`حدد مقررات البرنامج (${p.total_credits} ساعة للتخرج) ومستوى كل منها.`), rows.map((r) => r.el)], async () => {
    await api(`${U}/programs/${p.id}/plan`, { courses: rows.filter((r) => r.on.checked).map((r) => ({ course_id: r.c.id, kind: r.kind.value, level: r.level.value })) }, "PUT");
    nav.show();
  }).classList.add("xb-wide");
}

/* ---------- terms and sections ---------- */
export async function terms({ refresh }) {
  await loadMeta();
  const termSel = select(meta.terms.map((t) => [t.id, t.name]));
  const box = h("div");
  const load = async () => {
    const t = meta.terms.find((x) => x.id === Number(termSel.value));
    if (!t) return mount(box, empty("لا توجد فصول بعد."));
    const [secs, s, inst] = await Promise.all([api(`${U}/sections?term_id=${t.id}`), api(`${U}/structure`), api(`${U}/instructors`)]);
    const status = select(Object.entries(meta.labels.term_status), { value: t.status });
    status.addEventListener("change", async () => { await api(`${U}/terms/${t.id}`, { status: status.value }, "PATCH"); toast("تغيّرت حالة الفصل"); await loadMeta(); });
    mount(box, panel(t.name, h("div", { class: "row", style: "gap:6px" }, status, btn("+ طرح شعبة", () => {
      const f = { course: select(s.courses.filter((c) => c.status === "active").map((c) => [c.id, `${c.code} ${c.name}`])), code: input({ value: "1" }),
        teacher: select([["", "بلا مدرّس الآن"], ...inst.map((x) => [x.id, x.name])]), capacity: input({ type: "number", min: 1, value: 40 }), schedule: input({ placeholder: "مثال: أحد وثلاثاء 8:00–9:30" }), room: input() };
      form("طرح شعبة", [field("المقرر", f.course), h("div", { class: "form-grid" }, field("رقم الشعبة", f.code), field("السعة", f.capacity)),
        field("المدرّس", f.teacher), h("div", { class: "form-grid" }, field("الموعد", f.schedule), field("القاعة", f.room))], async () => {
        await api(`${U}/sections`, { term_id: t.id, course_id: Number(f.course.value), code: f.code.value, teacher_id: f.teacher.value || null, capacity: f.capacity.value, schedule: f.schedule.value, room: f.room.value });
        load();
      });
    }, "sm")),
    sub(`${fmtDate(t.starts_on)} إلى ${fmtDate(t.ends_on)}. التسجيل يعمل والفصل «التسجيل مفتوح» أو «جارٍ»، ورصد الدرجات بعد بدئه.`),
    secs.length ? table(["المقرر", "الشعبة", "المدرّس", "المسجلون", "الموعد", "الدرجات", ""], secs.map((x) => h("tr", {},
      td(`${x.course_code} ${x.course_name}`), td(x.code), td(x.teacher), td(`${x.registered} / ${x.capacity}`), td(x.schedule),
      h("td", {}, x.grades_submitted_at ? badge("سُلّمت", "") : x.registered ? badge("لم تُسلَّم", "amber") : "—"),
      h("td", {}, btn("الطلاب والدرجات", () => rosterDialog(x.id, load, { base: U, admin: true }), "ghost sm"))))) : empty("لم تُطرح شعب في هذا الفصل.")));
  };
  termSel.addEventListener("change", load);
  load();
  return [h("div", { class: "row", style: "justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap" },
    meta.terms.length ? field("الفصل", termSel) : sub("أنشئ أول فصل جامعي."),
    btn("+ فصل جديد", () => {
      const f = { name: input({ placeholder: "الفصل الأول 2026/2027" }), from: input({ type: "date" }), to: input({ type: "date" }) };
      form("فصل جديد", [field("الاسم", f.name), h("div", { class: "form-grid" }, field("يبدأ", f.from), field("ينتهي", f.to))],
        async () => { await api(`${U}/terms`, { name: f.name.value, starts_on: f.from.value, ends_on: f.to.value }); refresh(); });
    })), box];
}

/* ---------- students ---------- */
export async function students({ refresh }) {
  await loadMeta();
  const s = await api(`${U}/structure`);
  const prog = select([["", "كل البرامج"], ...s.programs.map((p) => [p.id, p.name])]);
  const q = input({ type: "search", placeholder: "ابحث بالاسم أو الرقم الجامعي" });
  const box = h("div");
  let t;
  const load = async () => {
    const list = await api(`${U}/students?program_id=${prog.value}&q=${encodeURIComponent(q.value.trim())}`);
    mount(box, list.length ? table(["الرقم الجامعي", "الطالب", "البرنامج", "الساعات المكتسبة", "المعدل", "الحالة", ""], list.map((x) => h("tr", {},
      td(x.student_no, "ltr"), td(x.name), td(x.program), td(`${x.earned} / ${x.total_credits}`), td(x.cgpa === null ? "—" : x.cgpa.toFixed(2)),
      h("td", {}, badge(meta.labels.student_status[x.status] || x.status, x.status === "active" ? "" : "gray"), x.standing === "probation" ? [" ", badge("إنذار", "red")] : null),
      h("td", {}, btn("الملف", () => studentDialog(x.id, load), "ghost sm"))))) : empty("لا يوجد طلاب."));
  };
  prog.addEventListener("change", load);
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 300); });
  load();
  return [h("div", { class: "row", style: "justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap" },
    h("div", { class: "row", style: "gap:8px;flex-wrap:wrap" }, prog, q),
    s.programs.length ? btn("+ قبول طالب", () => {
      const f = { name: input(), no: input({ class: "ltr", placeholder: "يُولَّد تلقائيًا" }), nid: input({ class: "ltr" }), phone: input({ class: "ltr", inputMode: "tel" }),
        email: input({ type: "email", class: "ltr" }), prog: select(s.programs.map((p) => [p.id, p.name])), term: select([["", "—"], ...meta.terms.map((x) => [x.id, x.name])]) };
      form("قبول طالب", [field("الاسم الكامل", f.name), h("div", { class: "form-grid" }, field("الرقم الجامعي", f.no), field("رقم الهوية", f.nid)),
        h("div", { class: "form-grid" }, field("الجوال", f.phone), field("البريد", f.email)), h("div", { class: "form-grid" }, field("البرنامج", f.prog), field("فصل القبول", f.term))],
      async () => { await api(`${U}/students`, { name: f.name.value, student_no: f.no.value || undefined, national_id: f.nid.value || undefined, student_phone: f.phone.value,
        email: f.email.value, program_id: Number(f.prog.value), admitted_term_id: f.term.value || null }); load(); });
    }) : notice("أنشئ برنامجًا أولًا.", "warn")), box];
}

async function studentDialog(id, reload) {
  const [tr, open] = [await api(`${U}/students/${id}/transcript`), meta.terms.filter((t) => ["registration", "running"].includes(t.status))];
  const secBox = h("div");
  if (open.length) {
    const term = select(open.map((t) => [t.id, t.name]));
    const sec = select([]);
    const override = h("input", { type: "checkbox" });
    const fill = async () => {
      const list = await api(`${U}/sections?term_id=${term.value}`);
      mount(sec, list.map((x) => h("option", { value: x.id }, `${x.course_code} ${x.course_name} — ش${x.code} (${x.registered}/${x.capacity})${x.teacher ? ` — ${x.teacher}` : ""}`)));
    };
    term.addEventListener("change", fill); fill();
    mount(secBox, panel("تسجيل مقرر", null, h("div", { class: "form-grid" }, field("الفصل", term), field("الشعبة", sec)),
      h("label", { class: "row", style: "justify-content:flex-start;gap:8px" }, override, "تجاوز السعة وحد الساعات (صلاحية القبول والتسجيل)"),
      btn("تسجيل", async () => {
        try { const r = await api(`${U}/registrations`, { student_id: id, section_id: Number(sec.value), override: override.checked }); toast(`سُجّل. ساعات الفصل: ${r.credits}`); d.close(); studentDialog(id, reload); }
        catch (e) { toast(e.message, true); }
      })));
  }
  const drops = tr.terms.flatMap((t) => t.courses.filter((c) => c.mark === null).map((c) => h("div", { class: "uni-row" }, h("span", {}, `${t.term}: ${c.code} ${c.name}`),
    h("div", { class: "row", style: "gap:6px" },
      btn("حذف التسجيل", async () => { if (!confirmAction("حذف تسجيل المقرر؟")) return; try { await api(`${U}/registrations/${c.registration_id}`, undefined, "DELETE"); d.close(); studentDialog(id, reload); } catch (e) { toast(e.message, true); } }, "ghost sm"),
      btn("انسحاب", async () => { if (!confirmAction("تسجيل انسحاب من المقرر؟")) return; try { await api(`${U}/registrations/${c.registration_id}?withdraw=1`, undefined, "DELETE"); d.close(); studentDialog(id, reload); } catch (e) { toast(e.message, true); } }, "ghost sm")))));
  const d = dialog(tr.student.name, h("div", {}, secBox, drops.length ? panel("مقررات بلا درجة (يمكن حذفها أو الانسحاب منها)", null, drops) : null, uniTranscript(tr)),
    [btn("طباعة السجل", () => window.print(), "ghost")]);
  d.classList.add("xb-wide");
  d.addEventListener("close", () => reload?.());
}

/* ---------- faculty and settings ---------- */
export async function instructors({ refresh }) {
  const list = await api(`${U}/instructors`);
  return [h("div", { class: "row", style: "justify-content:flex-end;margin-bottom:8px" }, btn("+ عضو هيئة تدريس", () => {
    const f = { name: input(), user: input({ class: "ltr", placeholder: "اسم الدخول بالإنجليزية" }) };
    form("عضو هيئة تدريس", [field("الاسم", f.name), field("اسم المستخدم", f.user)], async () => {
      const r = await api("/api/admin/teachers", { name: f.name.value, username: f.user.value, load: [] });
      showCredentials(`حساب ${f.name.value}`, r.credentials, "يدخل من رابط الجامعة ويرصد درجات شعبه.");
      refresh();
    });
  })), list.length ? table(["الاسم", "اسم الدخول", "الشعب"], list.map((x) => h("tr", {}, td(x.name), td(x.username, "ltr"), td(String(x.sections))))) : empty("لا يوجد أعضاء هيئة تدريس بعد.")];
}

export async function settings() {
  await loadMeta();
  const S = meta.settings;
  const rows = S.grade_scale.map((g) => ({ letter: input({ value: g.letter, style: "max-width:80px" }), min: input({ type: "number", value: g.min, style: "max-width:90px" }), points: input({ type: "number", step: "0.25", value: g.points, style: "max-width:90px" }) }));
  const f = { max: select([["4", "من 4"], ["5", "من 5"]], { value: String(S.max_points) }), maxc: input({ type: "number", value: S.max_credits }), minc: input({ type: "number", value: S.min_credits }),
    prob: input({ type: "number", step: "0.05", value: S.probation_below }) };
  return [panel("سلّم التقديرات", null, sub("الدرجة من 100. كل تقدير يبدأ من حده الأدنى، وأدنى تقدير يبدأ من الصفر. تحدده الجامعة بحسب لائحتها."),
    table(["التقدير", "من درجة", "النقاط"], rows.map((r) => h("tr", {}, h("td", {}, r.letter), h("td", {}, r.min), h("td", {}, r.points))))),
  panel("القواعد", null, h("div", { class: "form-grid" }, field("المعدل", f.max), field("الحد الأعلى للساعات في الفصل", f.maxc), field("الحد الأدنى", f.minc),
    field("الإنذار الأكاديمي إذا قل المعدل التراكمي عن", f.prob))),
  btn("حفظ", async () => {
    try {
      await api(`${U}/settings`, { grade_scale: rows.map((r) => ({ letter: r.letter.value, min: r.min.value, points: r.points.value })), max_points: Number(f.max.value),
        max_credits: f.maxc.value, min_credits: f.minc.value, probation_below: f.prob.value }, "PUT");
      toast("حُفظت الإعدادات");
    } catch (e) { toast(e.message, true); }
  })];
}
