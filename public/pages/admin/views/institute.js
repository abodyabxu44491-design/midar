/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Institute administration: dashboard, trainees and their academic record, programs, courses (groups, trainees,
// sessions, assessments, results), trainers, schedule, certificates, fees, reports, staff and settings.
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, sub, toast, dialog, notice, kpiCard, kpiGrid, skeleton, confirmAction, copyRow, passwordInput } from "../../shared/js/ui.js";
import { icons } from "../../shared/js/icons.js";
import { money, fmtDate, fmtDateTime, today, METHODS } from "../../shared/js/format.js";
import { inst, T, L, has, courseBadge, enrollBadge, num, pct, bar, progressBlock, attendanceDialog, scoresDialog, printCertificates,
  reportTable, printReport, textareaField } from "../../shared/js/institute-ui.js";

const I = () => inst.base;
const opt = (obj, first) => [...(first ? [["", first]] : []), ...Object.entries(obj)];
const fields = (pairs) => h("div", { class: "form-grid" }, pairs.filter(Boolean).map(([label, el, hint]) => field(label, el, hint)));
const val = (el) => (el.type === "checkbox" ? el.checked : el.value.trim());
const collect = (obj) => Object.fromEntries(Object.entries(obj).map(([k, el]) => [k, val(el)]));
const tabbed = (tabs, views, start = tabs[0][0]) => {
  const nav = h("nav", { class: "in-tabs", role: "tablist" });
  const body = h("div");
  const show = (k) => { mount(nav, tabs.map(([key, label]) => h("button", { type: "button", role: "tab", class: key === k ? "on" : "", "aria-selected": String(key === k), onclick: () => show(key) }, label)));
    mount(body, skeleton(4)); Promise.resolve(views[k]()).then((x) => mount(body, x)).catch((e) => mount(body, notice(e.message, "err"))); };
  show(start);
  return { el: h("div", {}, nav, body), show };
};
const kv = (rows) => h("dl", { class: "in-kv" }, rows.filter(([, v]) => v != null && v !== "" && v !== "—").map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
const big = (title, body, actions = []) => { const d = dialog(title, body, actions); d.classList.add("dialog-lg"); return d; };

// ---------- Dashboard ----------
export async function dashboard({ goTo }) {
  const d = await api(`${I()}/dashboard`);
  return [
    h("section", { class: "in-hero" }, h("div", {}, h("h2", {}, `مرحبًا بك في لوحة المعهد`), sub(`${fmtDate(today())} · ${d.sessions_today} ${T("session")} اليوم`))),
    kpiGrid(
      kpiCard({ icon: "users", label: `إجمالي ${T("trainees")}`, value: num(d.trainees), note: `النشطون ${num(d.active_trainees)}`, onClick: () => goTo("trainees") }),
      kpiCard({ icon: "clipboard", tone: "violet", label: `${T("courses")} الجارية`, value: num(d.running), note: `القادمة ${num(d.upcoming)} · المكتملة ${num(d.completed)}`, onClick: () => goTo("courses") }),
      kpiCard({ icon: "check", tone: d.low_attendance ? "amber" : "teal", label: "متوسط الحضور", value: pct(d.attendance_avg), ratio: (d.attendance_avg ?? 0) / 100,
        note: d.low_attendance ? `${d.low_attendance} دون الحد المطلوب` : "لا أحد دون الحد" }),
      kpiCard({ icon: "award", tone: "navy", label: "الشهادات الصادرة", value: num(d.certificates), note: `اجتاز ${num(d.passed)} · لم يجتز ${num(d.failed)}`, onClick: () => goTo("icerts") }),
      d.finance ? kpiCard({ icon: "wallet", tone: d.finance.outstanding > 0 ? "amber" : "teal", label: "المتبقي من الرسوم", value: money(d.finance.outstanding),
        note: `المحصّل ${money(d.finance.collected)} من ${money(d.finance.billed)}`, onClick: () => goTo("ifees") }) : null),
    h("div", { class: "cols-2" },
      panel(`${T("sessions")} اليوم`, btn("الجدول", () => goTo("sessions"), "ghost sm"),
        d.today.length ? h("div", { class: "in-list" }, d.today.map((s) => h("button", { type: "button", class: "in-item", onclick: () => attendanceDialog(s.id) },
          h("div", {}, h("b", {}, s.course), sub([s.group_name, s.trainer, s.starts_at ? s.starts_at.slice(0, 5) : null, `${num(s.hours)} س`].filter(Boolean).join(" · "))),
          badge(s.status === "held" ? "سُجل الحضور" : "تسجيل الحضور", s.status === "held" ? "" : "blue")))) : empty(`لا توجد ${T("sessions")} اليوم.`)),
      panel(`${T("courses")} الجارية`, btn("الكل", () => goTo("courses"), "ghost sm"),
        d.running_courses.length ? h("div", { class: "in-list" }, d.running_courses.map((c) => h("button", { type: "button", class: "in-item", onclick: () => courseFile(c.id) },
          h("div", { style: "flex:1;min-width:0" }, h("b", {}, c.name), sub(`${c.trainer || "بلا مدرب"} · ${num(c.held_hours)} من ${num(c.hours)} ساعة`), bar(c.held_hours, c.hours)),
          h("small", { class: "in-count" }, `${c.enrolled}${c.seats ? `/${c.seats}` : ""}`)))) : empty(`لا توجد ${T("courses")} جارية.`))),
  ];
}

// ---------- Trainees ----------
export async function trainees({ refresh }) {
  const q = input({ type: "search", placeholder: "ابحث بالاسم أو الرقم أو الهوية أو الجوال…", "aria-label": "بحث" });
  const status = select(opt(inst.meta.labels.trainee_status, "كل الحالات"));
  const box = h("div", { class: "in-cards" });
  let timer;
  const load = async () => {
    mount(box, skeleton(4));
    const rows = await api(`${I()}/trainees?${new URLSearchParams({ ...(q.value.trim() ? { q: q.value.trim() } : {}), ...(status.value ? { status: status.value } : {}) })}`);
    mount(box, rows.length ? rows.map((s) => h("article", { class: "in-card", role: "button", tabindex: "0", onclick: () => traineeFile(s.id, refresh),
      onkeydown: (e) => e.key === "Enter" && traineeFile(s.id, refresh) },
      h("header", {}, h("span", { class: "in-av" }, icons.user({ size: 18 })), h("div", { class: "in-id" }, h("b", {}, s.full_name),
        h("small", { dir: "ltr" }, [s.student_no, s.student_phone].filter(Boolean).join(" · "))), badge(L("trainee_status", s.status), s.status === "active" ? "" : "gray")),
      h("p", { class: "in-line" }, s.current_courses || `لا ${T("courses")} حالية`),
      h("footer", {}, h("span", {}, `${s.courses} ${T("course")} · أكمل ${s.completed}`), h("span", {}, `منذ ${fmtDate(s.enrolled_on || s.created_at)}`))))
      : empty(`لا يوجد ${T("trainees")} مطابقون.`));
  };
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  status.addEventListener("change", load);
  load();
  return panel(T("trainees"), has("trainees") ? btn(`+ ${T("trainee")} جديد`, () => traineeForm(null, () => load()), "sm") : null,
    h("div", { class: "row", style: "gap:8px;margin-bottom:12px" }, h("div", { style: "flex:2;min-width:200px" }, q), h("div", { style: "flex:1;min-width:140px" }, status)), box);
}

function traineeForm(s, onSaved) {
  const req = new Set(inst.meta.settings.required_fields || []);
  const mark = (k, label) => `${label}${req.has(k) ? " *" : ""}`;
  const f = {
    name: input({ value: s?.full_name || "" }), student_no: input({ value: s?.student_no || "", dir: "ltr", placeholder: "تلقائي" }),
    national_id: input({ value: s?.national_id || "", dir: "ltr" }), student_phone: input({ value: s?.student_phone || "", type: "tel", dir: "ltr" }),
    email: input({ value: s?.email || "", type: "email", dir: "ltr" }), birth_date: input({ type: "date", value: s?.birth_date ? String(s.birth_date).slice(0, 10) : "" }),
    gender: select([["", "—"], ["male", "ذكر"], ["female", "أنثى"]], { value: s?.gender || "" }),
    qualification: input({ value: s?.qualification || "", placeholder: "مثل: بكالوريوس، دبلوم، ثانوية" }), prior_specialty: input({ value: s?.prior_specialty || "" }),
    area: input({ value: s?.area || "" }), guardian_name: input({ value: s?.guardian_name || "" }), guardian_phone: input({ value: s?.guardian_phone || "", type: "tel", dir: "ltr" }),
    enrolled_on: input({ type: "date", value: s?.enrolled_on ? String(s.enrolled_on).slice(0, 10) : today() }),
  };
  const dd = big(s ? `تعديل بيانات ${T("trainee")}` : `${T("trainee")} جديد`, h("div", {},
    h("h4", { class: "in-h" }, "البيانات الأساسية"),
    fields([["الاسم الكامل *", f.name], ["الرقم التعريفي", f.student_no, "يُنشأ تلقائيًا إن تُرك فارغًا"], [mark("national_id", "رقم الهوية أو الإقامة"), f.national_id],
      [mark("student_phone", "رقم الجوال"), f.student_phone], [mark("email", "البريد الإلكتروني"), f.email], [mark("birth_date", "تاريخ الميلاد"), f.birth_date],
      [mark("gender", "الجنس"), f.gender], ["تاريخ التسجيل", f.enrolled_on]]),
    h("h4", { class: "in-h" }, "المؤهل والتواصل الإضافي"),
    fields([[mark("qualification", "المؤهل العلمي السابق"), f.qualification], [mark("prior_specialty", "التخصص السابق"), f.prior_specialty], ["المنطقة", f.area],
      ["جهة اتصال للطوارئ", f.guardian_name], ["جوال الطوارئ", f.guardian_phone]]),
    sub("الحقول المعلّمة بـ * مطلوبة حسب إعدادات المعهد. لا تجمع إلا ما تحتاجه فعلًا.")), [
    btn("حفظ", async () => {
      const b = collect(f);
      try {
        const r = await api(s ? `${I()}/trainees/${s.id}` : `${I()}/trainees`, b, s ? "PUT" : "POST");
        dd.close(); toast("حُفظ"); onSaved?.(r);
      } catch (e) { toast(e.message, true); }
    })]);
}

export async function traineeFile(id, refresh) {
  const holder = h("div", {}, skeleton(6));
  const dd = big(`ملف ${T("trainee")}`, holder);
  const draw = async (tab) => {
    let r;
    try { r = await api(`${I()}/trainees/${id}/record`); } catch (e) { return mount(holder, notice(e.message, "err")); }
    const s = r.trainee, m = r.summary;
    const again = (k) => () => { draw(k); refresh?.(); };
    const views = {
      overview: () => [
        kpiGrid(
          kpiCard({ icon: "clipboard", label: T("courses"), value: num(m.courses), note: `جارية ${m.in_progress} · غير مكتملة ${m.incomplete}` }),
          kpiCard({ icon: "check", tone: "violet", label: "مكتملة", value: num(m.completed), note: `الساعات المكتسبة ${num(m.earned_hours)}` }),
          kpiCard({ icon: "clock", tone: "navy", label: "ساعات الحضور", value: num(m.attended_hours) }),
          kpiCard({ icon: "award", tone: "teal", label: "الشهادات", value: num(m.certificates) }),
          m.balance !== undefined ? kpiCard({ icon: "wallet", tone: m.balance > 0 ? "amber" : "teal", label: "المتبقي", value: money(m.balance), note: `مدفوع ${money(m.fees_paid)}` }) : null),
        panel("البيانات الأساسية", has("trainees") ? btn("تعديل", () => traineeForm(s, () => again("overview")()), "ghost sm") : null,
          kv([["الرقم التعريفي", h("bdi", { dir: "ltr" }, s.student_no)], ["الاسم الكامل", s.full_name], ["رقم الهوية", s.national_id], ["الجوال", s.student_phone ? h("bdi", { dir: "ltr" }, s.student_phone) : null],
            ["البريد", s.email], ["تاريخ الميلاد", s.birth_date ? fmtDate(s.birth_date) : null], ["المؤهل السابق", s.qualification], ["التخصص السابق", s.prior_specialty],
            ["المنطقة", s.area], ["جهة الطوارئ", [s.guardian_name, s.guardian_phone].filter(Boolean).join(" — ")], ["تاريخ التسجيل", fmtDate(s.enrolled_on || s.created_at)],
            ["الحالة", L("trainee_status", s.status)], ["ملاحظة الحالة", s.status_note]])),
        m.programs_completed?.length ? panel(`${T("programs")} المجتازة`, null, h("div", { class: "chips" }, m.programs_completed.map((p) => badge(p.name, "violet")))) : null,
        has("enroll") ? h("div", { class: "row", style: "justify-content:flex-start;gap:8px" },
          btn(`تسجيل في ${T("course")}`, () => enrollDialog({ student: s, onDone: again("courses") })),
          btn("تغيير الحالة", () => traineeStatus(s, again("overview")), "ghost")) : null,
      ],
      courses: () => r.enrollments.length ? r.enrollments.map((e) => enrollmentCard(e, again("courses"))) : [empty(`لم يُسجل في أي ${T("course")} بعد.`),
        has("enroll") ? btn(`تسجيل في ${T("course")}`, () => enrollDialog({ student: s, onDone: again("courses") })) : null],
      attendance: () => {
        const all = r.enrollments.flatMap((e) => e.attendance.map((a) => ({ ...a, course: e.course })));
        return all.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["التاريخ", T("course"), "الموضوع", "الساعات", "الحالة"].map((x) => h("th", {}, x)))),
          h("tbody", {}, all.map((a) => h("tr", {}, h("td", {}, fmtDate(a.day)), h("td", {}, a.course), h("td", {}, a.topic || "—"), h("td", {}, num(a.hours)),
            h("td", {}, badge({ present: "حاضر", late: `متأخر${a.late_minutes ? ` ${a.late_minutes} د` : ""}`, absent: "غائب", excused: "بعذر" }[a.status],
              { present: "", late: "amber", absent: "red", excused: "blue" }[a.status]))))))) : empty("لا توجد سجلات حضور بعد.");
      },
      results: () => r.enrollments.filter((e) => e.progress.items.length).map((e) => panel(e.course, enrollBadge(e.status),
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["التقييم", "النوع", e.grading === "score" ? "الدرجة" : "النتيجة", "الوزن"].map((x) => h("th", {}, x)))),
          h("tbody", {}, e.progress.items.map((x) => h("tr", {}, h("td", {}, x.name), h("td", {}, L("assess_kind", x.kind)),
            h("td", {}, e.grading === "score" ? (x.score == null ? "—" : `${num(x.score)} من ${num(x.max)}`) : x.passed == null ? "—" : x.passed ? "اجتاز" : "لم يجتز"),
            h("td", {}, e.grading === "score" ? `${num(x.weight)}%` : "—")))))),
        e.grading === "score" ? sub(`النتيجة النهائية: ${pct(e.progress.final_score)} · درجة النجاح ${pct(e.progress.pass_mark)}`) : null,
        e.score_changes.length ? h("details", { class: "in-changes" }, h("summary", {}, `سجل تعديل الدرجات (${e.score_changes.length})`),
          e.score_changes.map((c) => sub(`${fmtDateTime(c.created_at)} — ${c.assessment}: ${c.old_score ?? (c.old_passed == null ? "—" : c.old_passed ? "اجتاز" : "لم يجتز")} ← ${c.new_score ?? (c.new_passed == null ? "—" : c.new_passed ? "اجتاز" : "لم يجتز")} · ${c.actor}${c.reason ? ` · ${c.reason}` : ""}`))) : null))
        .concat(r.enrollments.some((e) => e.progress.items.length) ? [] : [empty("لا توجد تقييمات مرصودة بعد.")]),
      certificates: () => r.certificates.length ? h("div", { class: "in-list" }, r.certificates.map((c) => h("div", { class: "in-item" },
        h("div", {}, h("b", {}, c.title), sub(`رقم ${c.code} · ${fmtDate(c.issued_at)}${c.hours ? ` · ${num(c.hours)} ساعة` : ""}`)),
        c.revoked_at ? badge("ملغاة", "red") : h("div", { class: "row", style: "flex:none;gap:6px" },
          btn([icons.print({ size: 14 }), "طباعة"], () => printCertificates([c.id]), "ghost sm"),
          has("certificates") ? btn("إلغاء", async () => {
            const reason = prompt("سبب إلغاء الشهادة"); if (!reason) return;
            try { await api(`${I()}/certificates/${c.id}/revoke`, { reason }); toast("أُلغيت"); again("certificates")(); } catch (e) { toast(e.message, true); }
          }, "ghost sm danger") : null)))) : empty("لا توجد شهادات صادرة."),
      fees: () => r.invoices ? feesBlock(r, again("fees")) : notice("الرسوم متاحة لأصحاب الصلاحية المالية فقط."),
      history: () => {
        const all = r.enrollments.flatMap((e) => e.history.map((x) => ({ ...x, course: e.course })));
        return all.length ? h("div", { class: "in-timeline" }, all.map((x) => h("div", { class: "in-tl" }, h("b", {}, `${x.course}: ${{ enrolled: "تسجيل", status: "تغيير الحالة", transfer: "نقل مجموعة", fee: "الرسوم", result: "اعتماد النتيجة", trainer: "المدرب" }[x.kind]}`),
          sub([x.from_value && `${x.from_value} ←`, x.to_value].filter(Boolean).join(" ")), x.reason ? sub(`السبب: ${x.reason}`) : null, h("small", {}, `${fmtDateTime(x.created_at)} · ${x.actor}`))))
          : empty("لا توجد أحداث بعد.");
      },
    };
    const t = tabbed([["overview", "نظرة عامة"], ["courses", T("courses")], ["attendance", "الحضور"], ["results", "التقييمات"], ["certificates", "الشهادات"],
      ...(r.invoices ? [["fees", "الرسوم"]] : []), ["history", "السجل"]], views, tab || "overview");
    mount(holder, h("div", { class: "in-file" },
      h("header", { class: "in-file-head" }, h("span", { class: "in-av lg" }, icons.user({ size: 26 })),
        h("div", {}, h("h2", {}, s.full_name), sub(h("bdi", { dir: "ltr" }, s.student_no), ` · ${L("trainee_status", s.status)}`)),
        btn([icons.print({ size: 15 }), "طباعة السجل"], async () => printReport(await api(`${I()}/reports/record?student_id=${s.id}`), inst.school), "ghost sm")),
      t.el));
  };
  draw();
  dd.addEventListener("close", () => refresh?.());
}

function enrollmentCard(e, again) {
  const open = ["new", "active"].includes(e.status);
  const acts = [
    open && has("enroll") ? btn("نقل مجموعة", () => transferDialog(e, again), "ghost sm") : null,
    has("enroll") && !["completed"].includes(e.status) ? btn("تغيير الحالة", () => enrollStatus(e, again), "ghost sm") : null,
    open && has("teach") ? btn(e.progress.eligible ? "اعتماد الاجتياز" : "اعتماد النتيجة", () => finalizeDialog(e, again), e.progress.eligible ? "sm" : "ghost sm") : null,
    e.status === "completed" && has("certificates") ? btn([icons.award({ size: 14 }), "إصدار الشهادة"], () => issueCert(e.id, "course", again), "sm") : null,
    !["withdrawn"].includes(e.status) && e.progress.attended_hours > 0 && has("certificates") ? btn("إفادة حضور", () => issueCert(e.id, "attendance", again), "ghost sm") : null,
    has("finance") ? btn("خصم", () => discountDialog(e, again), "ghost sm") : null,
  ].filter(Boolean);
  return h("article", { class: "in-enroll" },
    h("header", {}, h("div", {}, h("b", {}, e.course), sub([e.program, e.group_name, e.trainer, L("modes", e.mode)].filter(Boolean).join(" · "))), enrollBadge(e.status)),
    progressBlock(e.progress),
    kv([["تاريخ الالتحاق", fmtDate(e.enrolled_on)], ["الرسوم المتفق عليها", has("finance") || has("enroll") ? money(Number(e.fee) - Number(e.discount)) : null],
      ["سبب الحالة", e.status_reason], ["تاريخ الإكمال", e.completed_on ? fmtDate(e.completed_on) : null]]),
    acts.length ? h("div", { class: "in-acts" }, acts) : null);
}

async function enrollDialog({ student = null, course = null, onDone }) {
  const [courses, list] = await Promise.all([course ? [course] : api(`${I()}/courses`), student ? [student] : api(`${I()}/trainees?status=active`)]);
  const open = courses.filter((c) => !["completed", "canceled"].includes(c.status));
  const cSel = select(open.map((c) => [c.id, `${c.name} (${c.code})${c.seats ? ` — ${c.enrolled ?? 0}/${c.seats}` : ""}`]));
  const sSel = select(list.map((s) => [s.id, `${s.full_name}${s.student_no ? ` — ${s.student_no}` : ""}`]));
  const gSel = select([["", "بدون مجموعة"]]);
  const discount = input({ type: "number", min: 0, value: 0, inputmode: "decimal" });
  const feeNote = sub("");
  const syncGroups = async () => {
    if (!cSel.value) return;
    const d = await api(`${I()}/courses/${cSel.value}`);
    mount(gSel, [h("option", { value: "" }, "بدون مجموعة"), ...d.groups.map((g) => h("option", { value: g.id }, `${g.name}${g.trainer ? ` — ${g.trainer}` : ""}${g.seats ? ` (${g.enrolled}/${g.seats})` : ""}`))]);
    feeNote.textContent = `رسوم ${T("course")}: ${money(d.course.fee)} — تُحفظ للمتدرب كما هي ولا تتأثر بتعديلها لاحقًا.`;
  };
  cSel.addEventListener("change", syncGroups);
  if (!open.length) return toast(`لا توجد ${T("courses")} مفتوحة للتسجيل`, true);
  syncGroups();
  const dd = dialog(`تسجيل في ${T("course")}`, h("div", {},
    student ? sub(`${T("trainee")}: ${student.full_name}`) : field(T("trainee"), sSel),
    course ? sub(`${T("course")}: ${course.name}`) : field(T("course"), cSel),
    field(T("group"), gSel), feeNote, has("finance") ? field("خصم (اختياري)", discount) : null), [
    btn("تسجيل", async () => {
      try {
        await api(`${I()}/enrollments`, { student_id: Number(student ? student.id : sSel.value), course_id: Number(course ? course.id : cSel.value),
          group_id: gSel.value ? Number(gSel.value) : null, discount: has("finance") ? Number(discount.value || 0) : 0 });
        dd.close(); toast("تم التسجيل"); onDone?.();
      } catch (e) { toast(e.message, true); }
    })]);
}

async function transferDialog(e, again) {
  const d = await api(`${I()}/courses/${e.course_id}`);
  const g = select([["", "بدون مجموعة"], ...d.groups.filter((x) => Number(x.id) !== Number(e.group_id)).map((x) => [x.id, `${x.name}${x.seats ? ` (${x.enrolled}/${x.seats})` : ""}`])]);
  const reason = input({ placeholder: "سبب النقل" });
  const dd = dialog("نقل إلى مجموعة أخرى", h("div", {}, sub(`الحالية: ${e.group_name || "بدون مجموعة"}`), field(`${T("group")} الجديدة`, g), field("السبب", reason)), [
    btn("نقل", async () => {
      try { await api(`${I()}/enrollments/${e.id}/transfer`, { group_id: g.value ? Number(g.value) : null, reason: reason.value.trim() }); dd.close(); toast("نُقل وحُفظ سجل النقل"); again(); }
      catch (err) { toast(err.message, true); }
    })]);
}
function enrollStatus(e, again) {
  const s = select([["active", "مستمر"], ["deferred", "مؤجل"], ["suspended", "موقوف"], ["withdrawn", "منسحب"], ["new", "مستجد"]], { value: e.status });
  const reason = input({ placeholder: "مطلوب للانسحاب والتأجيل والإيقاف" });
  const dd = dialog("حالة التسجيل", h("div", {}, field("الحالة", s), field("السبب", reason), sub("تبقى الدرجات والحضور والسجل محفوظة مهما تغيرت الحالة.")), [
    btn("حفظ", async () => {
      try { await api(`${I()}/enrollments/${e.id}/status`, { status: s.value, reason: reason.value.trim() || null }); dd.close(); toast("حُدّثت الحالة"); again(); }
      catch (err) { toast(err.message, true); }
    })]);
}
function traineeStatus(s, again) {
  const st = select(Object.entries(inst.meta.labels.trainee_status), { value: s.status });
  const reason = input();
  const dd = dialog(`حالة ${T("trainee")}`, h("div", {}, field("الحالة", st), field("السبب", reason)), [
    btn("حفظ", async () => {
      try { await api(`${I()}/trainees/${s.id}/status`, { status: st.value, reason: reason.value.trim() || null }); dd.close(); toast("حُدّثت"); again(); }
      catch (e) { toast(e.message, true); }
    })]);
}
function finalizeDialog(e, again) {
  const p = e.progress;
  const force = h("input", { type: "checkbox" });
  const reason = input({ placeholder: "سبب الاعتماد رغم النقص" });
  const incomplete = p.reasons.some((r) => /غير مرصودة|لم تُحدد|لم تُعقد/.test(r));
  const dd = dialog("اعتماد النتيجة", h("div", {},
    progressBlock(p),
    notice(p.eligible ? "استوفى شروط الإكمال: سيُعتمد «اجتاز» ويمكن إصدار الشهادة." : "لم يستوفِ الشروط: سيُعتمد «لم يجتز».", p.eligible ? "" : "warn"),
    incomplete ? h("div", {}, h("label", { class: "chk" }, force, "اعتماد رغم عدم اكتمال الرصد"), field("السبب", reason)) : null), [
    btn("اعتماد", async () => {
      try {
        const r = await api(`${I()}/enrollments/${e.id}/finalize`, { force: force.checked, reason: reason.value.trim() || null });
        dd.close(); toast(r.status === "completed" ? "اعتُمد الاجتياز" : "اعتُمد: لم يجتز"); again();
      } catch (err) { toast(err.message, true); }
    })]);
}
async function issueCert(enrollmentId, kind, again) {
  try {
    const c = await api(`${I()}/enrollments/${enrollmentId}/certificate`, { kind });
    toast(`صدرت ${c.title} برقم ${c.code}`); again?.();
    printCertificates([c.id]);
  } catch (e) { toast(e.message, true); }
}
function discountDialog(e, again) {
  const amount = input({ type: "number", min: 0, value: Number(e.discount) || 0, inputmode: "decimal" });
  const reason = input();
  const dd = dialog("خصم على الرسوم", h("div", {}, sub(`الرسوم المتفق عليها ${money(e.fee)}`), field("مبلغ الخصم", amount), field("السبب", reason),
    sub("يُعدّل مبلغ فاتورة هذا التسجيل ويُحفظ في السجل. الدفعات السابقة لا تتغير.")), [
    btn("حفظ", async () => {
      try { await api(`${I()}/enrollments/${e.id}/discount`, { amount: Number(amount.value || 0), reason: reason.value.trim() }); dd.close(); toast("حُفظ الخصم"); again(); }
      catch (err) { toast(err.message, true); }
    })]);
}

// Fees of one trainee: invoices, partial payments, refunds and receipts.
function feesBlock(r, again) {
  const name = r.trainee.full_name;
  return [
    kpiGrid(kpiCard({ icon: "wallet", label: "المستحق", value: money(r.summary.fees_due) }), kpiCard({ icon: "check", tone: "teal", label: "المدفوع", value: money(r.summary.fees_paid) }),
      kpiCard({ icon: "alert", tone: r.summary.balance > 0 ? "amber" : "teal", label: "المتبقي", value: money(r.summary.balance) })),
    panel("الفواتير", null, r.invoices.length ? h("div", { class: "in-list" }, r.invoices.map((i) => h("div", { class: "in-item" },
      h("div", {}, h("b", {}, i.title), sub(`${money(i.amount)} · مدفوع ${money(i.paid)} · ${fmtDate(i.created_at)}`)),
      i.status === "void" ? badge("ملغاة", "gray") : Number(i.paid) >= Number(i.amount) ? badge("مسددة") : has("finance")
        ? h("div", { class: "row", style: "flex:none;gap:6px" }, btn("تسجيل دفعة", () => payDialog(i, name, again), "sm"),
          Number(i.paid) > 0 ? btn("استرداد", () => payDialog(i, name, again, true), "ghost sm") : null) : badge("غير مسددة", "amber")))) : empty("لا توجد فواتير.")),
    panel("الدفعات والإيصالات", null, r.payments.length ? h("div", { class: "in-list" }, r.payments.map((p) => h("div", { class: "in-item" },
      h("div", {}, h("b", {}, `${p.kind === "refund" ? "استرداد" : "دفعة"} ${money(p.amount)}`), sub(`${p.title} · ${METHODS[p.method] || p.method} · ${fmtDateTime(p.created_at)} · إيصال ${p.receipt_no}`)),
      btn([icons.print({ size: 14 }), "الإيصال"], () => printReceipt(p, name), "ghost sm")))) : empty("لا توجد دفعات.")),
  ];
}
export function payDialog(inv, name, again, refund = false) {
  const remaining = Math.max(0, Number(inv.amount) - Number(inv.paid));
  const amount = input({ type: "number", min: 0.01, step: "0.01", value: refund ? "" : remaining, inputmode: "decimal" });
  const method = select(Object.entries(METHODS).filter(([k]) => k !== "online"));
  const note = input({ placeholder: refund ? "سبب الاسترداد" : "ملاحظة (اختياري)" });
  const dd = dialog(refund ? "تسجيل استرداد" : "تسجيل دفعة", h("div", {}, sub(`${name} — ${inv.title}`), sub(refund ? `المدفوع ${money(inv.paid)}` : `المتبقي ${money(remaining)} (يمكن الدفع جزئيًا)`),
    field("المبلغ", amount), field("طريقة الدفع", method), field(refund ? "السبب" : "ملاحظة", note)), [
    btn("حفظ", async () => {
      const key = `${refund ? "rf" : "pay"}-${inv.invoice_id || inv.id}-${Date.now()}`;
      try {
        const base = inst.base.replace(/\/institute$/, "");
        const r = await api(`${base}/finance/invoices/${inv.invoice_id || inv.id}/${refund ? "refunds" : "payments"}`,
          { amount: Number(amount.value), method: method.value, note: note.value.trim() || null, reason: note.value.trim() || undefined, idempotency_key: key });
        dd.close(); toast(`سُجلت — إيصال ${r.receipt}`); again?.();
      } catch (e) { toast(e.message, true); }
    })]);
}
function printReceipt(p, name) {
  printReport({ title: `إيصال ${p.kind === "refund" ? "استرداد" : "دفع"} رقم ${p.receipt_no}`, columns: [{ key: "k", label: "البيان" }, { key: "v", label: "القيمة" }],
    rows: [{ k: T("trainee"), v: name }, { k: "البند", v: p.title }, { k: "المبلغ", v: money(p.amount) }, { k: "طريقة الدفع", v: METHODS[p.method] || p.method },
      { k: "التاريخ", v: fmtDateTime(p.created_at) }, { k: "سجّله", v: p.created_by || "" }] }, inst.school);
}

// ---------- Programs ----------
export async function programs({ refresh }) {
  const list = await api(`${I()}/programs`);
  return panel(T("programs"), has("catalog") ? btn(`+ ${T("program")}`, () => programForm(null, refresh), "sm") : null,
    list.length ? h("div", { class: "in-cards" }, list.map((p) => h("article", { class: `in-card${p.status === "archived" ? " off" : ""}` },
      h("header", {}, h("span", { class: "in-av" }, icons.book({ size: 18 })), h("div", { class: "in-id" }, h("b", {}, p.name), h("small", { dir: "ltr" }, p.code)),
        p.status === "archived" ? badge("مؤرشف", "gray") : null),
      p.description ? h("p", { class: "in-line" }, p.description) : null,
      h("footer", {}, h("span", {}, `${p.courses} ${T("course")} · ${num(p.hours)} ساعة`), h("span", {}, p.department || "")),
      has("catalog") ? h("div", { class: "in-acts" }, btn("تعديل", () => programForm(p, refresh), "ghost sm")) : null)))
      : empty(`لا توجد ${T("programs")} بعد. البرنامج يجمع عدة ${T("courses")} تحت مسار واحد.`));
}
function programForm(p, refresh) {
  const f = { code: input({ value: p?.code || "", dir: "ltr", placeholder: "WEB" }), name: input({ value: p?.name || "" }), department: input({ value: p?.department || "" }),
    status: select([["active", "نشط"], ["archived", "مؤرشف"]], { value: p?.status || "active" }) };
  const [desc, descField] = textareaField("الوصف", p?.description, 2000);
  const dd = dialog(p ? `تعديل ${T("program")}` : T("program"), h("div", {}, fields([["الرمز", f.code], ["الاسم", f.name], ["القسم أو التخصص", f.department], p ? ["الحالة", f.status] : null]), descField), [
    btn("حفظ", async () => {
      try { await api(p ? `${I()}/programs/${p.id}` : `${I()}/programs`, { ...collect(f), description: desc.value.trim() || null }, p ? "PUT" : "POST"); dd.close(); toast("حُفظ"); refresh(); }
      catch (e) { toast(e.message, true); }
    })]);
}

// ---------- Courses ----------
export async function courses({ refresh }) {
  const [list, progs] = await Promise.all([api(`${I()}/courses`), api(`${I()}/programs`)]);
  const st = select(opt(inst.meta.labels.course_status, "كل الحالات"));
  const pr = select([["", `كل ${T("programs")}`], ...progs.map((p) => [p.id, p.name])]);
  const q = input({ type: "search", placeholder: "ابحث بالاسم أو الرمز…" });
  const box = h("div", { class: "in-cards" });
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const rows = list.filter((c) => (!st.value || c.status === st.value) && (!pr.value || String(c.program_id) === pr.value)
      && (!term || c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term)));
    mount(box, rows.length ? rows.map((c) => h("article", { class: "in-card", role: "button", tabindex: "0", onclick: () => courseFile(c.id, refresh),
      onkeydown: (e) => e.key === "Enter" && courseFile(c.id, refresh) },
      h("header", {}, h("span", { class: "in-av" }, icons.clipboard({ size: 18 })), h("div", { class: "in-id" }, h("b", {}, c.name), h("small", { dir: "ltr" }, c.code)), courseBadge(c.status)),
      h("p", { class: "in-line" }, [c.program, c.trainer || "بلا مدرب", L("modes", c.mode)].filter(Boolean).join(" · ")),
      h("div", { class: "in-mini" },
        h("div", {}, h("small", {}, "المقاعد"), h("b", {}, c.seats ? `${c.enrolled} من ${c.seats}` : `${c.enrolled}`), c.seats ? bar(c.enrolled, c.seats, c.enrolled >= c.seats ? "warn" : "") : null),
        h("div", {}, h("small", {}, "الساعات المنفذة"), h("b", {}, `${num(c.held_hours)} من ${num(c.hours)}`), bar(c.held_hours, c.hours))),
      h("footer", {}, h("span", {}, c.starts_on ? `${fmtDate(c.starts_on)}${c.ends_on ? ` ← ${fmtDate(c.ends_on)}` : ""}` : "بدون موعد"), h("span", {}, Number(c.fee) ? money(c.fee) : "مجانية"))))
      : empty(list.length ? `لا توجد ${T("courses")} مطابقة.` : `لا توجد ${T("courses")} بعد. أنشئ أول ${T("course")}.`));
  };
  for (const el of [st, pr]) el.addEventListener("change", draw);
  q.addEventListener("input", draw);
  draw();
  return panel(T("courses"), has("catalog") ? btn(`+ ${T("course")}`, () => courseForm(null, progs, refresh), "sm") : null,
    h("div", { class: "row", style: "gap:8px;margin-bottom:12px" }, h("div", { style: "flex:2;min-width:180px" }, q), h("div", { style: "flex:1;min-width:130px" }, st), h("div", { style: "flex:1;min-width:130px" }, pr)), box);
}

async function trainerOptions(first = "بدون مدرب") {
  const list = await api(`${I()}/trainers`);
  return [["", first], ...list.map((t) => [t.id, t.full_name])];
}

async function courseForm(c, progs, onSaved) {
  progs ||= await api(`${I()}/programs`);
  const trainers = await trainerOptions();
  const S = inst.meta.settings;
  const f = {
    code: input({ value: c?.code || "", dir: "ltr", placeholder: "WEB101" }), name: input({ value: c?.name || "" }),
    program_id: select([["", "بدون برنامج"], ...progs.map((p) => [p.id, p.name])], { value: c?.program_id || "" }),
    department: input({ value: c?.department || "" }), trainer_id: select(trainers, { value: c?.trainer_id || "" }),
    hours: input({ type: "number", min: 1, value: c?.hours ?? "", inputmode: "decimal" }), seats: input({ type: "number", min: 1, value: c?.seats ?? "", placeholder: "بلا حد" }),
    starts_on: input({ type: "date", value: c?.starts_on ? String(c.starts_on).slice(0, 10) : "" }), ends_on: input({ type: "date", value: c?.ends_on ? String(c.ends_on).slice(0, 10) : "" }),
    schedule: input({ value: c?.schedule || "", placeholder: "مثل: الأحد والثلاثاء 4–7 مساءً" }), fee: input({ type: "number", min: 0, value: c?.fee ?? 0, inputmode: "decimal" }),
    mode: select(Object.entries(inst.meta.labels.modes), { value: c?.mode || "onsite" }), status: select(Object.entries(inst.meta.labels.course_status), { value: c?.status || "planned" }),
    grading: select([["score", "درجات رقمية موزونة"], ["pass_fail", "اجتياز / عدم اجتياز"]], { value: c?.grading || "score" }),
    pass_mark: input({ type: "number", min: 0, max: 100, value: c?.pass_mark ?? "", placeholder: `افتراضي المعهد ${S.pass_mark}%` }),
    min_attendance: input({ type: "number", min: 0, max: 100, value: c?.min_attendance ?? "", placeholder: `افتراضي المعهد ${S.min_attendance}%` }),
    reason: input({ placeholder: "سبب تغيير المدرب أو الحالة (يُحفظ في السجل)" }),
  };
  const [desc, descF] = textareaField("الوصف", c?.description, 2000);
  const [obj, objF] = textareaField("الأهداف", c?.objectives, 2000);
  const [pre, preF] = textareaField("المتطلبات السابقة للالتحاق", c?.prerequisites, 1000);
  const dd = big(c ? `تعديل ${T("course")}` : `${T("course")} جديدة`, h("div", {},
    h("h4", { class: "in-h" }, "الأساسيات"),
    fields([["الرمز", f.code], ["الاسم", f.name], [T("program"), f.program_id], ["القسم أو التخصص", f.department], [`${T("trainer")} المسؤول`, f.trainer_id], ["الحالة", f.status]]),
    h("h4", { class: "in-h" }, "الموعد والمقاعد"),
    fields([["عدد الساعات", f.hours], ["عدد المقاعد", f.seats], ["تاريخ البداية", f.starts_on], ["تاريخ النهاية", f.ends_on], ["نظام التدريب", f.mode], ["الجدول التدريبي", f.schedule]]),
    h("h4", { class: "in-h" }, "الرسوم والتقييم"),
    fields([["الرسوم", f.fee, c ? "تعديلها لا يغيّر رسوم المسجلين سابقًا" : null], ["نظام التقييم", f.grading], ["درجة النجاح %", f.pass_mark], ["الحد الأدنى للحضور %", f.min_attendance]]),
    descF, objF, preF, c ? field("سبب التعديل", f.reason) : null), [
    btn("حفظ", async () => {
      const b = { ...collect(f), description: desc.value.trim() || null, objectives: obj.value.trim() || null, prerequisites: pre.value.trim() || null };
      try { const r = await api(c ? `${I()}/courses/${c.id}` : `${I()}/courses`, b, c ? "PUT" : "POST"); dd.close(); toast("حُفظ"); onSaved?.(r); }
      catch (e) { toast(e.message, true); }
    })]);
}

export async function courseFile(id, refresh) {
  const holder = h("div", {}, skeleton(6));
  const dd = big(T("course"), holder);
  dd.addEventListener("close", () => refresh?.());
  const draw = async (tab) => {
    let d;
    try { d = await api(`${I()}/courses/${id}`); } catch (e) { return mount(holder, notice(e.message, "err")); }
    const c = d.course;
    const again = (k) => () => draw(k);
    const roster = d.enrollments;
    const views = {
      overview: () => [
        kpiGrid(
          kpiCard({ icon: "users", label: T("trainees"), value: c.seats ? `${d.seats_used} من ${c.seats}` : num(d.seats_used), ratio: c.seats ? d.seats_used / c.seats : null }),
          kpiCard({ icon: "clock", tone: "violet", label: "الساعات المنفذة", value: `${num(d.sessions.filter((s) => s.status === "held").reduce((t, s) => t + Number(s.hours), 0))} من ${num(c.hours)}` }),
          kpiCard({ icon: "calendar", tone: "navy", label: T("sessions"), value: num(d.sessions.length), note: `منفذة ${d.sessions.filter((s) => s.status === "held").length}` }),
          kpiCard({ icon: "award", tone: "teal", label: "اجتازوا", value: num(roster.filter((e) => e.status === "completed").length), note: `مستوفون للشروط ${roster.filter((e) => e.progress.eligible && ["new", "active"].includes(e.status)).length}` })),
        panel("بيانات الدورة", has("catalog") ? btn("تعديل", () => courseForm(c, null, again("overview")), "ghost sm") : null,
          kv([["الرمز", h("bdi", { dir: "ltr" }, c.code)], [T("program"), c.program], ["القسم", c.department], [`${T("trainer")} المسؤول`, c.trainer], ["الساعات", num(c.hours)],
            ["المقاعد", c.seats ? num(c.seats) : "بلا حد"], ["البداية", c.starts_on ? fmtDate(c.starts_on) : null], ["النهاية", c.ends_on ? fmtDate(c.ends_on) : null],
            ["الجدول", c.schedule], ["النظام", L("modes", c.mode)], ["الرسوم", money(c.fee)], ["التقييم", c.grading === "score" ? "درجات رقمية موزونة" : "اجتياز / عدم اجتياز"],
            ["درجة النجاح", pct(c.effective_pass_mark)], ["الحد الأدنى للحضور", pct(c.effective_min_attendance)]]),
          c.description ? h("p", { class: "in-text" }, c.description) : null,
          c.objectives ? [h("h4", { class: "in-h" }, "الأهداف"), h("p", { class: "in-text" }, c.objectives)] : null,
          c.prerequisites ? [h("h4", { class: "in-h" }, "المتطلبات السابقة"), h("p", { class: "in-text" }, c.prerequisites)] : null),
      ],
      groups: () => [
        d.groups.length ? h("div", { class: "in-list" }, d.groups.map((g) => h("div", { class: "in-item" },
          h("div", { style: "flex:1;min-width:0" }, h("b", {}, g.name), sub([g.trainer || "بلا مدرب", g.schedule, `${g.enrolled}${g.seats ? `/${g.seats}` : ""} ${T("trainee")}`].filter(Boolean).join(" · ")),
            g.seats ? bar(g.enrolled, g.seats, g.enrolled >= g.seats ? "warn" : "") : null),
          has("catalog") ? h("div", { class: "row", style: "flex:none;gap:6px" }, btn("تعديل", () => groupForm(c, g, again("groups")), "ghost sm"),
            btn("حذف", async () => { if (!confirmAction(`حذف ${g.name}؟`)) return; try { await api(`${I()}/courses/${c.id}/groups/${g.id}`, undefined, "DELETE"); again("groups")(); } catch (e) { toast(e.message, true); } }, "ghost sm danger")) : null)))
          : empty(`لا توجد ${T("groups")}. يمكن تقسيم ${T("trainees")} إلى ${T("groups")} لكل منها ${T("trainer")} وجدول.`),
        has("catalog") ? btn(`+ ${T("group")}`, () => groupForm(c, null, again("groups"))) : null],
      trainees: () => [
        has("enroll") ? h("div", { class: "row", style: "justify-content:flex-start;gap:8px;margin-bottom:10px" },
          btn(`تسجيل ${T("trainee")}`, () => enrollDialog({ course: { ...c, enrolled: d.seats_used }, onDone: again("trainees") }))) : null,
        roster.length ? h("div", { class: "in-roster" }, roster.map((e) => h("button", { type: "button", class: `in-ros${e.status === "withdrawn" ? " off" : ""}`, onclick: () => traineeFile(e.student_id, again("trainees")) },
          h("div", { class: "in-ros-id" }, h("b", {}, e.full_name), sub([e.student_no, e.group_name].filter(Boolean).join(" · "))),
          h("div", { class: "in-ros-m" }, h("small", {}, "الحضور"), h("b", { class: e.progress.low_attendance ? "danger-text" : "" }, pct(e.progress.attendance_pct))),
          h("div", { class: "in-ros-m" }, h("small", {}, c.grading === "score" ? "النتيجة" : "التقييمات"), h("b", {}, c.grading === "score" ? pct(e.progress.final_score)
            : `${e.progress.items.filter((x) => x.passed).length}/${e.progress.items.length}`)),
          enrollBadge(e.status)))) : empty(`لا يوجد ${T("trainees")} مسجلون.`)],
      sessions: () => [
        has("teach") ? btn(`+ ${T("session")}`, () => sessionForm(c, d.groups, again("sessions"))) : null,
        d.sessions.length ? h("div", { class: "in-list" }, d.sessions.map((s) => sessionRow(s, again("sessions")))) : empty(`لا توجد ${T("sessions")} بعد.`)],
      assessments: () => [
        sub(c.grading === "score" ? `مجموع الأوزان ${num(d.assessments.reduce((t, a) => t + Number(a.weight), 0))}% من 100%` : "كل تقييم يُرصد باجتياز أو عدم اجتياز."),
        d.assessments.length ? h("div", { class: "in-list" }, d.assessments.map((a) => h("div", { class: "in-item" },
          h("div", {}, h("b", {}, a.name), sub([L("assess_kind", a.kind), c.grading === "score" ? `من ${num(a.max_score)} · الوزن ${num(a.weight)}%` : null].filter(Boolean).join(" · "))),
          h("div", { class: "row", style: "flex:none;gap:6px" },
            has("teach") ? btn("رصد", () => scoresDialog(a, roster, { grading: c.grading, onSaved: again("assessments") }), "sm") : null,
            has("catalog") ? btn("تعديل", () => assessmentForm(c, a, again("assessments")), "ghost sm") : null))))
          : empty("لم تُحدد تقييمات. أضف الاختبارات والتقييمات العملية والمشاريع وأوزانها."),
        has("catalog") ? btn("+ تقييم", () => assessmentForm(c, null, again("assessments"))) : null],
      results: () => {
        const live = roster.filter((e) => ["new", "active"].includes(e.status));
        const ready = live.filter((e) => e.progress.eligible);
        return [
          h("div", { class: "row", style: "justify-content:flex-start;gap:8px;margin-bottom:10px" },
            has("teach") && ready.length ? btn(`اعتماد اجتياز المستوفين (${ready.length})`, async () => {
              if (!confirmAction(`اعتماد اجتياز ${ready.length} ${T("trainee")}؟`)) return;
              for (const e of ready) { try { await api(`${I()}/enrollments/${e.id}/finalize`, {}); } catch (err) { toast(`${e.full_name}: ${err.message}`, true); } }
              toast("اعتُمدت النتائج"); again("results")();
            }) : null,
            btn([icons.print({ size: 15 }), "طباعة النتائج"], async () => printReport(await api(`${I()}/reports/results?course_id=${c.id}`), inst.school), "ghost")),
          roster.filter((e) => e.status !== "withdrawn").map((e) => enrollmentCard({ ...e, course: e.full_name, course_id: c.id, grading: c.grading, mode: null, program: e.group_name, trainer: null }, again("results"))),
        ];
      },
      history: () => d.history.length ? h("div", { class: "in-timeline" }, d.history.map((x) => h("div", { class: "in-tl" },
        h("b", {}, { trainer: `تغيير ${T("trainer")}`, status: "تغيير الحالة", fee: "تعديل الرسوم" }[x.kind] || x.kind), sub(`${x.from_value || "—"} ← ${x.to_value || "—"}`),
        x.reason ? sub(x.reason) : null, h("small", {}, `${fmtDateTime(x.created_at)} · ${x.actor}`)))) : empty("لا توجد تغييرات مسجلة."),
    };
    const t = tabbed([["overview", "نظرة عامة"], ["groups", T("groups")], ["trainees", T("trainees")], ["sessions", T("sessions")], ["assessments", "التقييمات"],
      ["results", "النتائج"], ["history", "السجل"]], views, tab || "overview");
    mount(holder, h("div", { class: "in-file" },
      h("header", { class: "in-file-head" }, h("span", { class: "in-av lg" }, icons.clipboard({ size: 26 })),
        h("div", {}, h("h2", {}, c.name), sub(h("bdi", { dir: "ltr" }, c.code), ` · ${c.program || `بدون ${T("program")}`}`)), courseBadge(c.status)),
      t.el));
  };
  draw();
}

async function groupForm(c, g, again) {
  const trainers = await trainerOptions(`${T("trainer")} ${T("course")}`);
  const f = { name: input({ value: g?.name || "", placeholder: "المجموعة 1" }), trainer_id: select(trainers, { value: g?.trainer_id || "" }),
    seats: input({ type: "number", min: 1, value: g?.seats ?? "", placeholder: "بلا حد" }), schedule: input({ value: g?.schedule || "" }),
    reason: input({ placeholder: "سبب تغيير المدرب" }) };
  const dd = dialog(g ? `تعديل ${T("group")}` : T("group"), fields([["الاسم أو الرقم", f.name], [T("trainer"), f.trainer_id], ["المقاعد", f.seats], ["الجدول", f.schedule], g ? ["السبب", f.reason] : null]), [
    btn("حفظ", async () => {
      try { await api(g ? `${I()}/courses/${c.id}/groups/${g.id}` : `${I()}/courses/${c.id}/groups`, collect(f), g ? "PUT" : "POST"); dd.close(); toast("حُفظ"); again(); }
      catch (e) { toast(e.message, true); }
    })]);
}
function assessmentForm(c, a, again) {
  const f = { name: input({ value: a?.name || "" }), kind: select(Object.entries(inst.meta.labels.assess_kind), { value: a?.kind || "theory" }),
    max_score: input({ type: "number", min: 1, value: a?.max_score ?? 100 }), weight: input({ type: "number", min: 0, max: 100, value: a?.weight ?? 0 }),
    sort: input({ type: "number", min: 0, value: a?.sort ?? 0 }) };
  const dd = dialog(a ? "تعديل التقييم" : "تقييم جديد", fields([["الاسم", f.name], ["النوع", f.kind], c.grading === "score" ? ["الدرجة القصوى", f.max_score] : null,
    c.grading === "score" ? ["الوزن في النتيجة %", f.weight] : null, ["الترتيب", f.sort]]), [
    a ? btn("حذف", async () => { if (!confirmAction("حذف التقييم؟")) return; try { await api(`${I()}/courses/${c.id}/assessments/${a.id}`, undefined, "DELETE"); dd.close(); again(); } catch (e) { toast(e.message, true); } }, "ghost danger") : null,
    btn("حفظ", async () => {
      try { await api(a ? `${I()}/courses/${c.id}/assessments/${a.id}` : `${I()}/courses/${c.id}/assessments`, collect(f), a ? "PUT" : "POST"); dd.close(); toast("حُفظ"); again(); }
      catch (e) { toast(e.message, true); }
    })].filter(Boolean));
}

const SESSION_TONE = { planned: "blue", held: "", canceled: "red", rescheduled: "amber" };
const SESSION_LABEL = { planned: "مخططة", held: "منفذة", canceled: "ملغاة", rescheduled: "أعيدت جدولتها" };
export function sessionRow(s, again, { withCourse = false } = {}) {
  return h("div", { class: "in-item" },
    h("div", { style: "flex:1;min-width:0" }, h("b", {}, `${fmtDate(s.day)}${s.starts_at ? ` · ${s.starts_at.slice(0, 5)}` : ""}${withCourse ? ` · ${s.course}` : ""}`),
      sub([s.group_name, s.trainer, `${num(s.hours)} ساعة`, s.mode === "remote" ? "عن بُعد" : null, s.topic, s.status === "held" ? `حضور ${s.recorded}` : null, s.note].filter(Boolean).join(" · "))),
    badge(SESSION_LABEL[s.status], SESSION_TONE[s.status]),
    h("div", { class: "row", style: "flex:none;gap:6px" },
      ["planned", "held"].includes(s.status) && s.day <= today() ? btn("الحضور", () => attendanceDialog(s.id, { onSaved: again }), "sm") : null,
      has("teach") && s.status === "planned" ? btn("…", () => sessionActions(s, again), "ghost sm") : null));
}
function sessionActions(s, again) {
  const status = select([["canceled", "إلغاء الجلسة"], ["rescheduled", "إعادة جدولة"]]);
  const to = input({ type: "date" });
  const note = input({ placeholder: "السبب" });
  const dd = dialog("الجلسة", h("div", {}, field("الإجراء", status), field("التاريخ الجديد (لإعادة الجدولة)", to), field("السبب", note)), [
    s.recorded ? null : btn("حذف", async () => { if (!confirmAction("حذف الجلسة نهائيًا؟")) return; try { await api(`${I()}/sessions/${s.id}`, undefined, "DELETE"); dd.close(); again(); } catch (e) { toast(e.message, true); } }, "ghost danger"),
    btn("تنفيذ", async () => {
      try { await api(`${I()}/sessions/${s.id}`, { status: status.value, rescheduled_to: to.value || null, note: note.value.trim() || null }, "PATCH"); dd.close(); toast("حُدّثت"); again(); }
      catch (e) { toast(e.message, true); }
    })].filter(Boolean));
}
async function sessionForm(c, groups, again) {
  const trainers = await trainerOptions(`حسب ${T("group")} أو ${T("course")}`);
  const f = { group_id: select([["", `كل ${T("trainees")}`], ...groups.map((g) => [g.id, g.name])]), trainer_id: select(trainers),
    day: input({ type: "date", value: today() }), starts_at: input({ type: "time" }), hours: input({ type: "number", min: 0.5, step: 0.5, value: 2 }),
    mode: select([["onsite", "حضوري"], ["remote", "عن بُعد"]], { value: c.mode === "remote" ? "remote" : "onsite" }), topic: input(),
    repeat_weeks: input({ type: "number", min: 1, max: 52, value: 1 }) };
  const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"].map((n, i) => {
    const cb = h("input", { type: "checkbox", value: i });
    return { cb, el: h("label", { class: "chk" }, cb, n) };
  });
  const dd = dialog(`${T("session")} جديدة`, h("div", {}, fields([[T("group"), f.group_id], [T("trainer"), f.trainer_id], ["التاريخ", f.day], ["الوقت", f.starts_at],
    ["المدة بالساعات", f.hours], ["النظام", f.mode], ["الموضوع", f.topic], ["تكرار لعدد أسابيع", f.repeat_weeks]]),
    h("div", { class: "in-days" }, sub("أيام التكرار (اختياري؛ إن لم تحدد يتكرر في نفس اليوم)"), days.map((x) => x.el))), [
    btn("إضافة", async () => {
      const b = collect(f);
      b.repeat_weeks = Number(b.repeat_weeks || 1);
      b.weekdays = days.filter((x) => x.cb.checked).map((x) => Number(x.cb.value));
      try { const r = await api(`${I()}/courses/${c.id}/sessions`, b); dd.close(); toast(`أُضيفت ${r.length} ${T("session")}`); again(); }
      catch (e) { toast(e.message, true); }
    })]);
}

// ---------- Trainers ----------
export async function trainers({ refresh }) {
  const list = await api(`${I()}/trainers`);
  return panel(T("trainers"), has("catalog") ? btn(`+ ${T("trainer")}`, () => trainerForm(refresh), "sm") : null,
    list.length ? h("div", { class: "in-cards" }, list.map((t) => h("article", { class: `in-card${t.is_active === false ? " off" : ""}`, role: "button", tabindex: "0",
      onclick: () => trainerFile(t), onkeydown: (e) => e.key === "Enter" && trainerFile(t) },
      h("header", {}, h("span", { class: "in-av" }, icons.briefcase({ size: 18 })), h("div", { class: "in-id" }, h("b", {}, t.full_name), h("small", {}, t.specialty || "—")),
        t.is_active === false ? badge("موقوف", "gray") : null),
      h("div", { class: "in-mini" }, h("div", {}, h("small", {}, `${T("courses")} الحالية`), h("b", {}, num(t.active_courses))),
        h("div", {}, h("small", {}, "ساعات منفذة"), h("b", {}, num(t.held_hours))), h("div", {}, h("small", {}, "قادمة"), h("b", {}, num(t.upcoming)))),
      h("footer", {}, h("span", { dir: "ltr" }, t.username ? `@${t.username}` : "بلا حساب"), h("span", { dir: "ltr" }, t.phone || "")))))
      : empty(`لا يوجد ${T("trainers")}. أضف ${T("trainer")} لتسند له ${T("courses")} و${T("groups")}.`));
}
function trainerForm(refresh) {
  const f = { name: input(), username: input({ dir: "ltr", placeholder: "sami" }), phone: input({ type: "tel", dir: "ltr" }), specialty: input(), qualification: input(), email: input({ type: "email", dir: "ltr" }) };
  const dd = dialog(`${T("trainer")} جديد`, h("div", {}, fields([["الاسم", f.name], ["اسم المستخدم للدخول", f.username], ["الجوال", f.phone], ["التخصصات", f.specialty],
    ["المؤهلات والخبرات", f.qualification], ["البريد", f.email]]), sub(`يدخل ${T("trainer")} بحسابه ليسجل الحضور ويرصد التقييمات لدوراته فقط.`)), [
    btn("إضافة", async () => {
      const b = collect(f);
      try {
        const r = await api("/api/admin/teachers", { name: b.name, username: b.username, phone: b.phone || null, specialty: b.specialty || null,
          qualification: b.qualification || null, email: b.email || null, load: [] });
        dd.close();
        dialog(`حساب ${T("trainer")}`, h("div", {}, notice("كلمة مرور مؤقتة، يغيّرها عند أول دخول.", "warn"),
          copyRow("رابط الدخول", `${location.origin}/${r.credentials.school}/idara?role=teacher`), copyRow("اسم المستخدم", r.credentials.username),
          copyRow("كلمة المرور", r.credentials.password, { secret: true })));
        refresh();
      } catch (e) { toast(e.message, true); }
    })]);
}
async function trainerFile(t) {
  const d = await api(`${I()}/trainers/${t.id}`);
  big(t.full_name, h("div", {},
    kv([["التخصصات", t.specialty], ["المؤهلات", t.qualification], ["الجوال", t.phone ? h("bdi", { dir: "ltr" }, t.phone) : null], ["البريد", t.email], ["اسم المستخدم", t.username]]),
    panel(T("courses"), null, d.courses.length ? h("div", { class: "in-list" }, d.courses.map((c) => h("button", { type: "button", class: "in-item", onclick: () => courseFile(c.id) },
      h("div", {}, h("b", {}, c.name), sub(`${num(c.held_hours)} من ${num(c.hours)} ساعة · ${c.enrolled} ${T("trainee")}`)), courseBadge(c.status)))) : empty("لا توجد.")),
    panel(`سجل ${T("sessions")}`, null, d.sessions.length ? h("div", { class: "in-list" }, d.sessions.slice(0, 40).map((s) => h("div", { class: "in-item" },
      h("div", {}, h("b", {}, `${fmtDate(s.day)} · ${s.course}`), sub([s.group_name, `${num(s.hours)} ساعة`, s.topic].filter(Boolean).join(" · "))),
      badge(SESSION_LABEL[s.status], SESSION_TONE[s.status])))) : empty("لا توجد.")),
    d.history.length ? panel(`سجل تغيير ${T("trainer")}`, null, d.history.map((x) => sub(`${fmtDateTime(x.created_at)} · ${x.course || ""}: ${x.from_value} ← ${x.to_value}${x.reason ? ` (${x.reason})` : ""}`))) : null));
}

// ---------- Schedule ----------
export async function sessions({ refresh }) {
  const from = input({ type: "date", value: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) });
  const to = input({ type: "date", value: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) });
  const box = h("div");
  const load = async () => {
    mount(box, skeleton(5));
    const rows = await api(`${I()}/sessions?from=${from.value}&to=${to.value}`);
    const days = [...new Set(rows.map((s) => String(s.day).slice(0, 10)))];
    mount(box, days.length ? days.map((d) => h("section", { class: `in-day${d === today() ? " now" : ""}` },
      h("h4", {}, new Date(`${d}T12:00:00`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" }), d === today() ? badge("اليوم", "blue") : null),
      h("div", { class: "in-list" }, rows.filter((s) => String(s.day).slice(0, 10) === d).map((s) => sessionRow({ ...s, day: d }, load, { withCourse: true })))))
      : empty(`لا توجد ${T("sessions")} في هذه الفترة. أضفها من ملف ${T("course")}.`));
  };
  for (const el of [from, to]) el.addEventListener("change", load);
  load();
  return panel(`الجدول و${T("sessions")}`, null, h("div", { class: "row", style: "gap:8px;margin-bottom:12px" }, field("من", from), field("إلى", to)), box);
}

// ---------- Certificates ----------
export async function certificates() {
  const r = await api(`${I()}/reports/certificates`);
  return panel("الشهادات والإفادات", btn([icons.print({ size: 15 }), "طباعة القائمة"], () => printReport(r, inst.school), "ghost sm"),
    sub(`تصدر الشهادة من ملف ${T("trainee")} بعد اعتماد اجتيازه، وإفادة الحضور متاحة لأي ساعات محضورة. يتحقق أي شخص من الشهادة برقمها أو برمز QR.`),
    r.rows.length ? h("div", { class: "in-list" }, r.rows.map((x) => h("div", { class: "in-item" },
      h("div", {}, h("b", {}, `${x.name} — ${x.course}`), sub(`${x.kind} · ${x.date} · ${x.hours !== "—" ? `${x.hours} ساعة · ` : ""}أصدرها ${x.by}`)),
      h("div", { class: "row", style: "flex:none;gap:6px" }, x.state === "ملغاة" ? badge("ملغاة", "red") : badge("سارية"),
        h("a", { class: "btn ghost sm", href: `/verify/${x.code}`, target: "_blank", rel: "noopener", dir: "ltr" }, x.code))))) : empty("لا توجد شهادات صادرة بعد."));
}

// ---------- Fees ----------
export async function fees({ refresh }) {
  const [rows, list] = await Promise.all([api(`${I()}/fees`), api(`${I()}/courses`)]);
  const course = select([["", `كل ${T("courses")}`], ...list.map((c) => [c.id, c.name])]);
  const st = select([["", "الكل"], ["due", "عليها متبقٍ"], ["paid", "مسددة"]]);
  const box = h("div");
  const draw = () => {
    const f = rows.filter((x) => x.status === "open" && (!course.value || list.find((c) => String(c.id) === course.value)?.name === x.course)
      && (!st.value || (st.value === "due" ? Number(x.paid) < Number(x.amount) : Number(x.paid) >= Number(x.amount))));
    const billed = f.reduce((t, x) => t + Number(x.amount), 0), paid = f.reduce((t, x) => t + Number(x.paid), 0);
    mount(box, kpiGrid(kpiCard({ icon: "wallet", label: "المستحق", value: money(billed) }), kpiCard({ icon: "check", tone: "teal", label: "المحصّل", value: money(paid), ratio: billed ? paid / billed : null }),
      kpiCard({ icon: "alert", tone: billed - paid > 0 ? "amber" : "teal", label: "المتبقي", value: money(billed - paid) })),
    f.length ? h("div", { class: "in-list" }, f.map((x) => h("div", { class: "in-item" },
      h("div", { style: "flex:1;min-width:0" }, h("b", {}, x.full_name), sub(`${x.title}${Number(x.discount) ? ` · خصم ${money(x.discount)}` : ""} · ${fmtDate(x.created_at)}`),
        bar(x.paid, x.amount, Number(x.paid) >= Number(x.amount) ? "" : "warn")),
      h("div", { class: "in-money" }, h("b", {}, money(Number(x.amount) - Number(x.paid))), h("small", {}, `من ${money(x.amount)}`)),
      h("div", { class: "row", style: "flex:none;gap:6px" },
        Number(x.paid) < Number(x.amount) ? btn("دفعة", () => payDialog(x, x.full_name, refresh), "sm") : badge("مسددة"),
        btn("الملف", () => traineeFile(x.student_id), "ghost sm"))))) : empty("لا توجد فواتير مطابقة."));
  };
  for (const el of [course, st]) el.addEventListener("change", draw);
  draw();
  return panel(`رسوم ${T("courses")}`, null, h("div", { class: "row", style: "gap:8px;margin-bottom:12px" }, field(T("course"), course), field("الحالة", st)),
    sub("كل تسجيل يحفظ رسومه المتفق عليها؛ الدفع الجزئي والاسترداد والإيصالات من هنا أو من ملف المتدرب، وتُقيد تلقائيًا في المالية."), box);
}

// ---------- Reports ----------
export async function reports() {
  const [list, people] = await Promise.all([api(`${I()}/courses`), api(`${I()}/trainees`)]);
  const R = inst.meta.reports;
  const pick = select(R.map((r) => [r.key, r.label]), { value: R.some((r) => r.key === "enrollments") ? "enrollments" : R[0]?.key });
  const course = select([["", `كل ${T("courses")}`], ...list.map((c) => [c.id, c.name])]);
  const student = select([["", `اختر ${T("trainee")}`], ...people.map((s) => [s.id, `${s.full_name} — ${s.student_no || ""}`])]);
  const from = input({ type: "date" }), to = input({ type: "date" });
  const out = h("div");
  let last = null;
  const qs = () => new URLSearchParams(Object.fromEntries(Object.entries({ course_id: course.value, student_id: student.value, from: from.value, to: to.value }).filter(([, v]) => v)));
  const run = async () => {
    mount(out, skeleton(5));
    try { last = await api(`${I()}/reports/${pick.value}?${qs()}`); mount(out, h("h3", { class: "in-h" }, last.title), reportTable(last)); }
    catch (e) { last = null; mount(out, notice(e.message, "warn")); }
  };
  const sync = () => {
    const needs = R.find((r) => r.key === pick.value)?.needs;
    student.closest("label").hidden = needs !== "student";
    course.closest("label").hidden = needs === "student";
  };
  pick.addEventListener("change", () => { sync(); run(); });
  const form = h("div", { class: "form-grid" }, field("التقرير", pick), field(T("course"), course), field(T("trainee"), student), field("من تاريخ", from), field("إلى تاريخ", to));
  setTimeout(() => { sync(); run(); });
  return panel("التقارير", null, form,
    h("div", { class: "row", style: "justify-content:flex-start;gap:8px;margin:10px 0" }, btn("عرض", run),
      btn([icons.print({ size: 15 }), "طباعة / PDF"], () => (last ? printReport(last, inst.school) : toast("اعرض التقرير أولًا", true)), "ghost"),
      btn("تصدير Excel (CSV)", () => { location.href = `${I()}/reports/${pick.value}?${qs()}&format=csv`; }, "ghost")),
    out);
}

// ---------- Staff and roles ----------
export async function staff({ refresh }) {
  const list = await api(`${I()}/staff`);
  const ROLES = inst.meta.labels.staff_roles;
  return panel("الموظفون والصلاحيات", btn("+ موظف", () => staffForm(refresh), "sm"),
    h("div", { class: "in-roles" }, Object.entries({ director: "كل الأقسام والإعدادات", academic: `${T("programs")} و${T("courses")} و${T("trainees")} والنتائج والشهادات`,
      registrar: `تسجيل ${T("trainees")} وإدارة الالتحاق`, reception: `الاطلاع وإضافة ${T("trainees")}` }).map(([k, v]) => h("div", {}, h("b", {}, ROLES[k]), h("small", {}, v))),
    h("div", {}, h("b", {}, "المحاسب"), h("small", {}, "الرسوم والمدفوعات والإيصالات والتقارير المالية")), h("div", {}, h("b", {}, T("trainer")), h("small", {}, `حضور وتقييمات ${T("courses")} المسندة إليه فقط`))),
    h("div", { class: "in-list" }, list.map((u) => h("div", { class: "in-item" },
      h("div", {}, h("b", {}, u.full_name), sub(`@${u.username} · ${u.role === "accountant" ? "المحاسب" : ROLES[u.staff_role || "director"]}${u.is_active ? "" : " · موقوف"}`)),
      u.role === "admin" ? select(Object.entries(ROLES), { value: u.staff_role || "director", "aria-label": "الدور",
        onchange: async (e) => { try { await api(`${I()}/staff/${u.id}/role`, { staff_role: e.target.value }, "PUT"); toast("حُدّث الدور"); } catch (err) { toast(err.message, true); refresh(); } } }) : null))),
    sub("المحاسب يُضاف من «الإعدادات ← الحسابات»، والمدربون من قسم المدربين."));
}
function staffForm(refresh) {
  const f = { name: input(), username: input({ dir: "ltr" }), staff_role: select(Object.entries(inst.meta.labels.staff_roles).filter(([k]) => k !== "director"), { value: "registrar" }) };
  const dd = dialog("موظف جديد", fields([["الاسم", f.name], ["اسم المستخدم", f.username], ["الدور", f.staff_role]]), [
    btn("إضافة", async () => {
      try {
        const r = await api(`${I()}/staff`, collect(f));
        dd.close();
        dialog("حساب الموظف", h("div", {}, notice("كلمة مرور مؤقتة، يغيّرها عند أول دخول.", "warn"), copyRow("رابط الدخول", `${location.origin}/${r.credentials.school}/idara`),
          copyRow("اسم المستخدم", r.credentials.username), copyRow("كلمة المرور", r.credentials.password, { secret: true })));
        refresh();
      } catch (e) { toast(e.message, true); }
    })]);
}

// ---------- Settings ----------
export async function settings({ refresh }) {
  const S = inst.meta.settings;
  const termInputs = Object.fromEntries(Object.entries(S.terms).map(([k, v]) => [k, input({ value: v })]));
  const TL = { trainee: "المفرد: متدرب", trainees: "الجمع: المتدربون", course: "المفرد: دورة", courses: "الجمع: الدورات", program: "المفرد: برنامج", programs: "الجمع: البرامج",
    trainer: "المفرد: مدرب", trainers: "الجمع: المدربون", group: "المفرد: مجموعة", groups: "الجمع: المجموعات", session: "المفرد: جلسة", sessions: "الجمع: الجلسات" };
  const req = Object.entries(inst.meta.labels.trainee_fields).map(([k, label]) => { const cb = h("input", { type: "checkbox", value: k, checked: S.required_fields.includes(k) }); return { k, cb, el: h("label", { class: "chk" }, cb, label) }; });
  const f = { min_attendance: input({ type: "number", min: 0, max: 100, value: S.min_attendance }), pass_mark: input({ type: "number", min: 0, max: 100, value: S.pass_mark }),
    late_counts_as: select([["1", "يُحتسب حضورًا كاملًا"], ["0.5", "نصف حضور"], ["0", "لا يُحتسب"]], { value: String(S.late_counts_as) }),
    registration_fee: input({ type: "number", min: 0, value: S.registration_fee }), signer_title: input({ value: S.signer_title || "", placeholder: "مدير المعهد" }),
    signer_name: input({ value: S.signer_name || "" }), certificate_note: input({ value: S.certificate_note || "" }) };
  return [
    panel("المصطلحات", null, sub("غيّر التسميات لتناسب معهدك: «طالب» بدل «متدرب»، أو «مقرر» بدل «دورة»…"),
      h("div", { class: "form-grid" }, Object.entries(termInputs).map(([k, el]) => field(TL[k] || k, el)))),
    panel(`بيانات ${T("trainee")} المطلوبة`, null, sub("اختر ما يلزم فقط؛ الباقي اختياري. لا تجمع بيانات لا تحتاجها."), h("div", { class: "in-checks" }, req.map((x) => x.el))),
    panel("قواعد الإكمال والرسوم", null, fields([["الحد الأدنى للحضور %", f.min_attendance, `افتراضي لكل ${T("course")}، ويمكن تغييره في كل ${T("course")}`],
      ["درجة النجاح %", f.pass_mark], ["التأخر", f.late_counts_as], ["رسوم التسجيل (مرة واحدة)", f.registration_fee]])),
    panel("الشهادات", null, fields([["صفة الموقّع", f.signer_title], ["اسم الموقّع", f.signer_name], ["ملاحظة أسفل الشهادة", f.certificate_note, "لا تصف الشهادة بأنها معتمدة من جهة خارجية دون تفويض فعلي"]])),
    btn("حفظ الإعدادات", async () => {
      try {
        const b = { terms: Object.fromEntries(Object.entries(termInputs).map(([k, el]) => [k, el.value.trim()])), required_fields: req.filter((x) => x.cb.checked).map((x) => x.k),
          ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()])) };
        for (const k of ["signer_title", "signer_name", "certificate_note"]) b[k] ||= null;
        inst.meta.settings = await api(`${I()}/settings`, b, "PUT");
        toast("حُفظت الإعدادات"); refresh();
      } catch (e) { toast(e.message, true); }
    }),
  ];
}
