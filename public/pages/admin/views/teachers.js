// تبويب المعلمين
import { h, mount } from "../../shared/js/dom.js";
import { icons } from "../../shared/js/icons.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, btn, empty, badge, line, sub, toast, dialog, notice, showCredentials, confirmAction } from "../../shared/js/ui.js";
import { fmtDateTime, csv } from "../../shared/js/format.js";
import { A, loadClasses, loadSubjects, staffLink } from "./common.js";

export default async function teachers({ me, refresh }) {
  const [classes, subjects, list] = await Promise.all([loadClasses(), loadSubjects(), api(`${A}/teachers`)]);
  const f = {
    name: input(), user: input({ class: "ltr", placeholder: "حروف إنجليزية وأرقام" }),
    phone: input({ class: "ltr", inputMode: "tel" }), email: input({ class: "ltr", type: "email" }),
    employee_no: input({ class: "ltr" }), national_id: input({ class: "ltr", inputMode: "numeric" }),
    specialty: input({ placeholder: "مثل: رياضيات" }), department: input(),
  };
  const picker = loadPicker(classes, subjects);
  const hint = h("div");

  // اقتراح المواد حسب التخصص: يقترح ولا يفرض
  f.specialty.addEventListener("input", () => {
    const term = f.specialty.value.trim();
    if (term.length < 3) return mount(hint);
    const matched = subjects.filter((s2) => s2.name.includes(term) || term.includes(s2.name));
    if (!matched.length) return mount(hint);
    mount(hint, notice(`مواد مقترحة لتخصص «${term}»: ${matched.map((m) => m.name).join("، ")}`, ""),
      h("div", { class: "row spaced" },
        btn("ربطه بها في كل الفصول", () => {
          picker.setSubjects(matched.map((m) => m.id));
          toast("أُضيفت المواد المقترحة — عدّل الفصول كما تريد");
        }, "soft sm"),
        btn("تخطي", () => mount(hint), "ghost sm")));
  });

  return [
    panel("إضافة معلم", btn("تصدير المعلمين", () => exportTeachers(list), "ghost sm"),
      h("div", { class: "row" }, field("الاسم", f.name), field("اسم المستخدم", f.user), field("الجوال", f.phone)),
      h("div", { class: "row" }, field("الرقم الوظيفي", f.employee_no), field("رقم الهوية", f.national_id), field("البريد", f.email)),
      h("div", { class: "row" }, field("التخصص", f.specialty), field("القسم", f.department)),
      hint,
      sub("الفصول والمواد التي يراها هذا المعلم"), picker.el,
      btn("إضافة المعلم", async () => {
        const r = await api(`${A}/teachers`, {
          name: f.name.value, username: f.user.value, phone: f.phone.value || null,
          email: f.email.value || "", employee_no: f.employee_no.value || null,
          national_id: f.national_id.value || "", specialty: f.specialty.value || null,
          department: f.department.value || null, load: picker.value(),
        });
        showCredentials("تمت إضافة المعلم", r.credentials, `يدخل المعلم من: ${staffLink(me)} — وسيُطلب منه تغيير كلمة المرور.`);
        refresh();
      })),

    panel("المعلمون", null, list.length ? list.map((t) => line(
      h("div", {}, h("b", {}, t.name), " ", t.is_active ? null : badge("موقوف", "red"),
        t.specialty ? badge(t.specialty, "gray") : null,
        sub(t.load.map((l) => `${l.subject_name} (${l.class_name})`).join("، ") || "بدون إسناد"),
        sub(`اسم المستخدم: ${t.username}${t.employee_no ? ` — الرقم الوظيفي: ${t.employee_no}` : ""}${t.phone ? ` — ${t.phone}` : ""}`),
        sub(`آخر دخول: ${t.last_login_at ? fmtDateTime(t.last_login_at) : "لم يدخل بعد"}`)),
      h("div", { class: "row", style: "flex:none" },
        btn("الملف", () => profileDialog(t, refresh), "ghost sm"),
        btn("الإسناد", () => assignDialog(t, classes, subjects, refresh), "ghost sm"),
        btn("كلمة مرور جديدة", async () => {
          if (!confirmAction(`إنشاء كلمة مرور جديدة لـ ${t.name}؟`)) return;
          showCredentials("كلمة مرور جديدة", (await api(`${A}/teachers/${t.id}/reset-password`, {})).credentials);
        }, "ghost sm"),
        btn(t.is_active ? "إيقاف" : "تفعيل", async () => {
          await api(`${A}/teachers/${t.id}/active`, { active: !t.is_active }, "PATCH"); refresh();
        }, "ghost sm")))) : empty("لا يوجد معلمون بعد.")),
  ];
}

/* ---------- ملف المعلم ---------- */
function profileDialog(t, refresh) {
  const f = {
    name: input({ value: t.name }), phone: input({ class: "ltr", value: t.phone || "" }),
    employee_no: input({ class: "ltr", value: t.employee_no || "" }),
    national_id: input({ class: "ltr", value: t.national_id || "" }),
    email: input({ class: "ltr", type: "email", value: t.email || "" }),
    specialty: input({ value: t.specialty || "" }), department: input({ value: t.department || "" }),
  };
  const d = dialog(`ملف ${t.name}`, h("div", {},
    h("div", { class: "row" }, field("الاسم", f.name), field("الجوال", f.phone)),
    h("div", { class: "row" }, field("الرقم الوظيفي", f.employee_no), field("رقم الهوية", f.national_id)),
    field("البريد", f.email),
    h("div", { class: "row" }, field("التخصص", f.specialty), field("القسم", f.department))),
  [btn("حفظ", async () => {
    await api(`${A}/teachers/${t.id}`, {
      name: f.name.value, phone: f.phone.value || null, employee_no: f.employee_no.value || null,
      national_id: f.national_id.value || "", email: f.email.value || "",
      specialty: f.specialty.value || null, department: f.department.value || null,
    }, "PATCH");
    d.close(); toast("حُفظ الملف"); refresh();
  })]);
}

/* ---------- الإسناد ---------- */
function assignDialog(t, classes, subjects, refresh) {
  const picker = loadPicker(classes, subjects, t.load);
  const d = dialog(`إسناد ${t.name}`, h("div", {}, sub("الفصول والمواد التي يراها هذا المعلم"), picker.el),
    [btn("حفظ الإسناد", async () => {
      await api(`${A}/teachers/${t.id}`, { load: picker.value() }, "PATCH");
      d.close(); toast("حُفظ الإسناد"); refresh();
    })]);
}

function exportTeachers(list) {
  csv("المعلمون.csv", [
    ["الاسم", "اسم المستخدم", "الرقم الوظيفي", "رقم الهوية", "الجوال", "البريد", "التخصص", "القسم", "الإسناد"],
    ...list.map((t) => [t.name, t.username, t.employee_no || "", t.national_id || "", t.phone || "",
      t.email || "", t.specialty || "", t.department || "",
      t.load.map((l) => `${l.subject_name} (${l.class_name})`).join(" | ")]),
  ]);
}

/**
 * أداة الإسناد: قائمة الصفوف فقط.
 * الضغط على صف يفتح مواده لاختيارها، ثم «حفظ الصف» يغلقه ويعرض ما اخترته.
 */
function loadPicker(classes, subjects, current = []) {
  if (!classes.length || !subjects.length) {
    return { el: empty("أضف الصفوف والمواد أولًا من «الهيكل الأكاديمي»."), value: () => [], setSubjects: () => {} };
  }

  // الحالة: صف ← مجموعة المواد المختارة
  const picked = new Map(classes.map((c) => [Number(c.id), new Set()]));
  for (const l of current) picked.get(Number(l.class_id))?.add(Number(l.subject_id));

  const el = h("div", { class: "assign-list" });

  const nameOf = (id) => subjects.find((s2) => Number(s2.id) === Number(id))?.name;
  const summary = (c) => {
    const ids = [...picked.get(Number(c.id))];
    return ids.length ? ids.map(nameOf).filter(Boolean).join("، ") : "لا توجد مواد مسندة";
  };

  const draw = (openId = null) => {
    mount(el, classes.map((c) => {
      const count = picked.get(Number(c.id)).size;
      const head = h("button", { type: "button", class: `assign-head ${count ? "has" : ""}`,
        onclick: () => draw(Number(openId) === Number(c.id) ? null : c.id) },
        h("span", { class: "assign-name" }, c.name),
        h("span", { class: "assign-sum" }, summary(c)),
        count ? badge(`${count}`, "") : null,
        icons.chevronDown({ size: 16 }));

      if (Number(openId) !== Number(c.id)) return h("div", { class: "assign-item" }, head);

      // فتح الصف: مواده فقط
      const boxes = subjects.map((s2) => {
        const cb = input({ type: "checkbox", checked: picked.get(Number(c.id)).has(Number(s2.id)) });
        cb.addEventListener("change", () => {
          const set = picked.get(Number(c.id));
          if (cb.checked) set.add(Number(s2.id)); else set.delete(Number(s2.id));
        });
        return h("label", { class: "assign-subject" }, cb, h("span", {}, s2.name));
      });

      return h("div", { class: "assign-item open" }, head,
        h("div", { class: "assign-body" },
          h("div", { class: "assign-subjects" }, boxes),
          h("div", { class: "row spaced" },
            btn("حفظ الصف", () => draw(null), "soft sm"),
            btn("مسح اختيار الصف", () => { picked.get(Number(c.id)).clear(); draw(c.id); }, "ghost sm"))));
    }));
  };
  draw();

  return {
    el,
    value: () => [...picked.entries()].flatMap(([classId, set]) =>
      [...set].map((subjectId) => ({ class_id: classId, subject_id: subjectId }))),
    // اقتراح التخصص: تحديد مواد معيّنة في كل الصفوف
    setSubjects: (subjectIds) => {
      const wanted = subjectIds.map(Number);
      for (const set of picked.values()) for (const id of wanted) set.add(id);
      draw();
    },
  };
}
