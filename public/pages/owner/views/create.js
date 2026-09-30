import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, dialog, line, sub, keyText, notice, toast, brandLogo } from "/shared/js/ui.js";
import { h } from "/shared/js/dom.js";
import { loadRefs, subForm } from "./sub-form.js";
import { runJob } from "/shared/js/job.js";

export default async function create({ refresh }) {
  const refs = await loadRefs();
  const f = { name: input(), id: input({ class: "ltr", placeholder: "حروف إنجليزية صغيرة" }), admin: input({ value: "مدير المدرسة" }) };
  const form = subForm(refs, { kind: "trial" });
  return [panel("إضافة مدرسة جديدة", null,
    field("اسم المدرسة", f.name),
    field("رمز المدرسة", f.id, "حروف إنجليزية صغيرة وأرقام. يظهر في رابط صفحة الطلاب ولا يمكن تغييره."),
    field("اسم مدير المدرسة", f.admin),
    h("h3", {}, "الاشتراك"), form.el,
    btn("إنشاء المدرسة", async () => {
      const r = await api("/api/owner/tenants", { name: f.name.value, id: f.id.value, admin_name: f.admin.value, subscription: form.value() });
      handoverCard(r);
      refresh();
    })), showcasePanel(refresh)];
}

// مدرسة عرض جاهزة: مجمع بنين كامل (ابتدائي ومتوسط وثانوي) ببيانات فصل دراسي حتى اليوم
function showcasePanel(refresh) {
  const f = { name: input({ value: "مجمع مدارس الرواد الأهلية للبنين" }), id: input({ class: "ltr", value: "alrowad" }) };
  return panel("مدرسة عرض كاملة", null,
    sub("تُنشأ مدرسة بنين شاملة كأنها تعمل منذ بداية الفصل: 24 شعبة بالمراحل الثلاث، قرابة 50 معلمًا بجداولهم، قرابة 570 طالبًا بأولياء أمورهم، "
      + "الحضور اليومي، الاختبارات والدرجات، الواجبات، الرسوم والسداد، والتعاميم. تعمل في الخلفية مع شريط تقدم."),
    h("div", { class: "form-grid" }, field("اسم المدرسة", f.name), field("رمز المدرسة", f.id)),
    btn("إنشاء مدرسة العرض", async () => {
      const { secret: r } = await runJob("/api/owner/tenants/showcase", { name: f.name.value, id: f.id.value },
        { title: "إنشاء مدرسة العرض", jobsBase: "/api/owner/jobs" });
      if (!r) { toast("اكتملت المدرسة، لكن انتهت صلاحية عرض بيانات الدخول. أصدر كلمة مرور جديدة للمدير من صفحة المدرسة.", true); refresh(); return; }
      const s = r.summary;
      handoverCard(r, [
        ["الطلاب", s.students], ["المعلمون", s.teachers], ["الشعب", s.structure.sections], ["أيام الدوام المسجلة", s.school_days],
        ...s.teacher_samples.map((t) => [`معلم (${t.subject}) — ${t.username}`, t.password]),
        ...s.parent_samples.map((p) => [`ولي أمر: ${p.name}`, p.access_key]),
      ]);
      refresh();
    }));
}

// بطاقة تسليم: كل ما تحتاجه المدرسة في صفحة واحدة قابلة للطباعة
export function handoverCard(r, extra = []) {
  const site = location.origin;
  const publicLink = `${site}/${r.credentials.school}`;
  const staffLink = `${publicLink}/idara`;
  const rows = [
    ["اسم المدرسة", r.school.name],
    ["رابط الطلاب وأولياء الأمور", publicLink],
    ["رمز صفحة الطلاب", r.credentials.directory_code],
    ["رابط دخول المدير والمعلمين", staffLink],
    ["اسم المستخدم", r.credentials.username],
    ["كلمة المرور المؤقتة", r.credentials.password],
    ...extra.map(([k, v]) => [k, String(v)]),
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  dialog("بطاقة تسليم المدرسة", h("div", { class: "handover" },
    h("div", { class: "print-only" }, brandLogo("print-logo", false)),
    notice("انسخ البطاقة أو اطبعها الآن. كلمة المرور لن تظهر مرة أخرى.", "warn"),
    rows.map(([k, v]) => line(h("span", { class: "sub" }, k), keyText(v))),
    sub("يغيّر المدير كلمة المرور بعد أول دخول من: الإعدادات ← تغيير كلمة المرور.")),
  [
    btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); }),
    btn("طباعة", () => window.print(), "ghost"),
  ]);
}
