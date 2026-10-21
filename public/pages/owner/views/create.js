/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, dialog, line, sub, keyText, notice, toast, brandLogo } from "/shared/js/ui.js";
import { h } from "/shared/js/dom.js";
import { loadRefs, subForm } from "./sub-form.js";
import { runJob } from "/shared/js/job.js";

export default async function create({ refresh, go }) {
  const refs = await loadRefs();
  const f = { name: input(), id: input({ class: "ltr", placeholder: "حروف إنجليزية صغيرة" }), admin: input({ value: "مدير المدرسة" }),
    email: input({ type: "email", class: "ltr", placeholder: "manager@example.com" }),
    org: select([["school", "مدرسة"], ["institute", "معهد تدريبي"]]) };
  const form = subForm(refs, { kind: "trial" });
  return [panel("إضافة مدرسة جديدة", null,
    field("نوع المؤسسة", f.org, "المعهد يحصل على البرامج والدورات والمتدربين والشهادات بدل الصفوف والفصول"),
    field("اسم المدرسة", f.name),
    field("رمز المدرسة", f.id, "حروف إنجليزية صغيرة وأرقام. يظهر في رابط صفحة الطلاب ولا يمكن تغييره."),
    field("اسم مدير المدرسة", f.admin),
    field("بريد مدير المدرسة", f.email, "يدخل المدير أول مرة من رابط المدرسة بهذا البريد (أو بحساب Google بنفس البريد). لا يوجد رابط تفعيل ولا كلمة مرور."),
    h("h3", {}, "الاشتراك"), form.el,
    btn("إنشاء المدرسة", async () => {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim())) return toast("اكتب بريد مدير المدرسة", true);
      const r = await api("/api/owner/tenants", { name: f.name.value, id: f.id.value, admin_name: f.admin.value, manager_email: f.email.value.trim(), subscription: form.value(), org_type: f.org.value });
      // One handover screen for every school: the new school's file opens directly on it.
      history.pushState(null, "", `#/schools?school=${encodeURIComponent(r.school.id)}&handover=1`);
      if (go) go("schools"); else dispatchEvent(new PopStateEvent("popstate"));
    })), showcasePanel(refresh)];
}

function showcasePanel(refresh) {
  const f = { name: input({ value: "مدارس الرواد الأهلية للبنين" }), id: input({ class: "ltr", value: "alrowad-aden" }) };
  return panel("مدرسة عرض كاملة", null,
    sub("مدرسة بنين في عدن أنهت عامًا دراسيًا كاملًا بفصليه، وكل أقسام المنصة فيها بيانات: 24 شعبة من الأول إلى ثالث ثانوي، قرابة 50 معلمًا و15 موظفًا برواتب عشرة أشهر، "
      + "قرابة 570 طالبًا، الحضور اليومي والأعذار، الاختبارات والنتائج النهائية، الواجبات، الرسوم والسداد وإشعارات التحويل، المصروفات والتبرعات، التعاميم وطلبات التسجيل. "
      + "السنة منتهية، فتقدر تجرّب «بدء سنة جديدة» وترفيع الطلاب. تعمل في الخلفية مع شريط تقدم (دقيقة تقريبًا)."),
    h("div", { class: "form-grid" }, field("اسم المدرسة", f.name), field("رمز المدرسة", f.id)),
    btn("إنشاء مدرسة العرض", async () => {
      const { secret: r } = await runJob("/api/owner/tenants/showcase", { name: f.name.value, id: f.id.value },
        { title: "إنشاء مدرسة العرض", jobsBase: "/api/owner/jobs" });
      if (!r) { toast("اكتملت المدرسة. افتح ملفها لإرسال رابطها للمدير.", true); refresh(); return; }
      const s = r.summary;
      handoverCard(r, [
        ["الطلاب", s.students], ["المعلمون", s.teachers], ["الشعب", s.structure.sections], ["العام الدراسي", s.year.name], ["أيام الدوام المسجلة", s.school_days],
        ...s.teacher_samples.map((t) => [`معلم (${t.subject}) — ${t.username}`, t.password]),
        ...s.parent_samples.map((p) => [`ولي أمر: ${p.name}`, p.access_key]),
      ]);
      refresh();
    }));
}

export function handoverCard(r, extra = []) {
  const site = location.origin;
  const publicLink = `${site}/${r.school.id}`;
  const staffLink = `${publicLink}/idara`;
  const rows = [
    ["اسم المدرسة", r.school.name],
    ["رابط دخول المدرسة", staffLink],
    r.manager_email ? ["بريد المدير لأول دخول", r.manager_email] : null,
    ["رابط الطلاب وأولياء الأمور", publicLink],
    ...extra.map(([k, v]) => [k, String(v)]),
  ].filter(Boolean);
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  dialog("بطاقة تسليم المدرسة", h("div", { class: "handover" },
    h("div", { class: "print-only" }, brandLogo("print-logo", false)),
    notice("أرسل لمدير المدرسة رابط دخول المدرسة فقط. في أول دخول يختار «إنشاء حساب المدير» ويسجّل ببريده المسجل (أو Google بنفس البريد)، ثم يدخل لوحة المدرسة مباشرة. رسالة الترحيب الجاهزة في ملف المدرسة ← «تسليم».", ""),
    rows.map(([k, v]) => line(h("span", { class: "sub" }, k), keyText(v))),
    sub("لا تُسلَّم كلمة مرور للمدير: هو يختار طريقة دخوله بنفسه.")),
  [
    btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); }),
    btn("طباعة", () => window.print(), "ghost"),
  ]);
}
