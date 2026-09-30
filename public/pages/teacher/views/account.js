// حسابي: كل بيانات المعلم في مكان واحد — الصورة والاسم، بيانات الدخول، تغيير كلمة المرور،
// البيانات الشخصية والوظيفية (تعدّلها الإدارة)، وبيانات التواصل (يعدّلها المعلم بنفسه).
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, btn, toast, passwordInput, notice, line, sub, copyRow, stats } from "../../shared/js/ui.js";
import { fmtDate, fmtDateTime } from "../../shared/js/format.js";

const GENDER = { male: "ذكر", female: "أنثى" };
const EMPLOYMENT = { full_time: "دوام كامل", part_time: "دوام جزئي", contract: "عقد", volunteer: "تطوع" };
const kv = (label, value, cls = "") => line(h("span", { class: "sub" }, label), h("b", { class: cls }, value || "—"));

export default async function account({ me }) {
  let data;
  try { data = await api("/api/teacher/profile"); } catch (e) {
    return [hero(me, null), notice(e.code === "network" || e.code === "timeout"
      ? "أنت غير متصل بالإنترنت. تظهر بيانات حسابك وتغيير كلمة المرور عند عودة الاتصال." : e.message, "warn")];
  }
  const p = data.profile, acc = data.account;
  const loginLink = `${location.origin}/${data.school.id}/idara`;

  return [
    hero(me, p),
    stats([["فصولي", data.summary.classes], ["موادي", data.summary.subjects], ["طلابي", data.summary.students], ["حصص أسبوعيًا", data.summary.periods_per_week]]),

    panel("بيانات الدخول", null,
      h("div", { class: "links-list" },
        copyRow("رمز المدرسة", data.school.id),
        copyRow("اسم المستخدم", acc.username),
        copyRow("رابط الدخول", loginLink)),
      h("div", { class: "cred-row" }, h("span", { class: "sub" }, "كلمة المرور"),
        h("div", { class: "cred-pw" }, h("code", { class: "ltr cred-val" }, "••••••••••"),
          btn("تغييرها", () => document.getElementById("pw-change")?.scrollIntoView({ behavior: "smooth", block: "start" }), "ghost sm"))),
      sub("كلمة المرور محفوظة بتشفير لا يُعكس، فلا تظهر لك ولا للإدارة. احفظها في مكان آمن، وإن نسيتها تطلب من الإدارة كلمة مؤقتة جديدة."),
      kv("آخر دخول", acc.last_login_at ? fmtDateTime(acc.last_login_at) : "—"),
      kv("آخر تغيير لكلمة المرور", acc.password_changed_at ? fmtDateTime(acc.password_changed_at) : "—"),
      kv("تاريخ إنشاء الحساب", fmtDate(acc.created_at))),

    passwordPanel(),

    h("div", { class: "info-grid" },
      block("البيانات الشخصية", [["الاسم الكامل", p.name], ["الاسم المختصر", p.short_name], ["الجنس", GENDER[p.gender]],
        ["تاريخ الميلاد", p.birth_date ? fmtDate(p.birth_date) : null], ["رقم الهوية", p.national_id, "ltr"]]),
      block("البيانات الوظيفية", [["الرقم الوظيفي", p.employee_no, "ltr"], ["المسمى الوظيفي", p.job_title], ["التخصص", p.specialty],
        ["المؤهل", p.qualification], ["القسم", p.department], ["نوع التوظيف", EMPLOYMENT[p.employment_type]],
        ["تاريخ التعيين", p.hire_date ? fmtDate(p.hire_date) : null]])),
    sub("لتصحيح البيانات الشخصية أو الوظيفية تواصل مع إدارة المدرسة."),

    contactPanel(p),
  ];
}

function hero(me, p) {
  const initial = String(me.name || "؟").replace(/^(أ\.|د\.|م\.)\s*/, "").trim().charAt(0);
  return h("div", { class: "file-hero" },
    me.photo ? h("img", { class: "s-photo lg", src: me.photo, alt: "" }) : h("span", { class: "s-photo lg ph", "aria-hidden": "true" }, initial),
    h("div", { class: "file-hero-text" }, h("h2", {}, p?.name || me.name),
      h("p", {}, [p?.job_title, p?.specialty].filter(Boolean).join(" · ") || "معلم"),
      h("div", { class: "file-hero-tags" }, h("span", { class: "badge" }, me.school.name))));
}

function block(title, rows) {
  const shown = rows.filter((r) => r[1]);
  return h("div", { class: "info-block" }, h("h4", {}, title),
    shown.length ? shown.map(([k, v, cls]) => kv(k, v, cls)) : h("p", { class: "sub" }, "لم تُدخل الإدارة بيانات بعد."));
}

function passwordPanel() {
  const cur = passwordInput({ autocomplete: "current-password" });
  const nxt = passwordInput({ autocomplete: "new-password" });
  const again = passwordInput({ autocomplete: "new-password" });
  const hint = h("div", { class: "pw-rules" });
  const rules = [["10 أحرف على الأقل", (v) => v.length >= 10], ["حرف إنجليزي", (v) => /[A-Za-z]/.test(v)], ["رقم", (v) => /[0-9]/.test(v)]];
  const paint = () => mount(hint, rules.map(([label, ok]) => h("span", { class: ok(nxt.value) ? "ok" : "" }, `${ok(nxt.value) ? "✓" : "•"} ${label}`)),
    again.value && again.value !== nxt.value ? h("span", { class: "bad" }, "× التأكيد غير مطابق") : null);
  nxt.addEventListener("input", paint); again.addEventListener("input", paint); paint();
  const el = panel("تغيير كلمة المرور", null,
    field("كلمة المرور الحالية", cur),
    h("div", { class: "form-grid" }, field("كلمة المرور الجديدة", nxt), field("تأكيد الجديدة", again)),
    hint,
    btn("حفظ كلمة المرور", async () => {
      if (!cur.value) return toast("اكتب كلمة المرور الحالية", true);
      if (!rules.every(([, ok]) => ok(nxt.value))) return toast("كلمة المرور الجديدة لا تحقق الشروط", true);
      if (nxt.value !== again.value) return toast("تأكيد كلمة المرور غير مطابق", true);
      try {
        await api("/api/teacher/password", { current: cur.value, next: nxt.value });
        cur.value = nxt.value = again.value = ""; paint(); toast("تم تغيير كلمة المرور");
      } catch (e) { toast(e.message, true); }
    }));
  el.id = "pw-change";
  return el;
}

function contactPanel(p) {
  const f = {
    phone: input({ class: "ltr", inputMode: "tel", value: p.phone || "", placeholder: "05xxxxxxxx" }),
    email: input({ class: "ltr", type: "email", value: p.email || "" }),
    address: input({ value: p.address || "" }),
    emergency_name: input({ value: p.emergency_name || "" }),
    emergency_phone: input({ class: "ltr", inputMode: "tel", value: p.emergency_phone || "" }),
  };
  return panel("بيانات التواصل", null,
    sub("تستطيع تحديثها بنفسك، وتصل للإدارة مباشرة."),
    h("div", { class: "form-grid" }, field("الجوال", f.phone), field("البريد الإلكتروني", f.email), field("العنوان", f.address),
      field("جهة اتصال الطوارئ", f.emergency_name), field("جوال الطوارئ", f.emergency_phone)),
    btn("حفظ بيانات التواصل", async () => {
      try {
        await api("/api/teacher/profile", Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()])), "PATCH");
        toast("حُفظت بيانات التواصل");
      } catch (e) { toast(e.message, true); }
    }));
}
