// تبويب المعلمين
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, btn, empty, badge, line, sub, toast, dialog, showCredentials, confirmAction } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";
import { A, loadClasses, loadSubjects, staffLink } from "./common.js";

function loadPicker(classes, subjects, current = []) {
  const boxes = [];
  const el = h("div", { class: "spaced" }, classes.length && subjects.length ? classes.map((c) => h("div", { style: "margin-bottom:6px" },
    h("b", { class: "small" }, `${c.name}: `),
    subjects.map((s) => {
      const cb = input({ type: "checkbox", checked: current.some((l) => l.class_id === c.id && l.subject_id === s.id) });
      boxes.push([cb, c.id, s.id]);
      return h("label", { class: "small", style: "margin-inline-end:12px;white-space:nowrap" }, cb, " ", s.name);
    }))) : empty("أضف الفصول والمواد أولًا من تبويب «الفصول والمواد»."));
  return { el, value: () => boxes.filter(([cb]) => cb.checked).map(([, class_id, subject_id]) => ({ class_id, subject_id })) };
}

export default async function teachers({ me, refresh }) {
  const [classes, subjects, list] = await Promise.all([loadClasses(), loadSubjects(), api(`${A}/teachers`)]);
  const f = { name: input(), user: input({ class: "ltr", placeholder: "mona.saeed" }), phone: input({ class: "ltr" }) };
  const picker = loadPicker(classes, subjects);

  return [
    panel("إضافة معلم", null,
      h("div", { class: "row" }, field("الاسم", f.name), field("اسم المستخدم", f.user), field("الجوال", f.phone)),
      sub("الفصول والمواد المسندة (المعلم يرى هذه فقط)"), picker.el,
      btn("إضافة المعلم", async () => {
        const r = await api(`${A}/teachers`, { name: f.name.value, username: f.user.value, phone: f.phone.value || null, load: picker.value() });
        showCredentials("تمت إضافة المعلم", r.credentials, `يدخل المعلم من: ${staffLink(me)} — ويُنصح بتغيير كلمة المرور بعد أول دخول.`);
        refresh();
      })),
    panel("المعلمون", null, list.length ? list.map((t) => line(
      h("div", {}, h("b", {}, t.name), " ", t.is_active ? null : badge("موقوف", "red"),
        sub(t.load.map((l) => `${l.subject_name} (${l.class_name})`).join("، ") || "بدون إسناد"),
        sub(`اسم المستخدم: ${t.username} — آخر دخول: ${t.last_login_at ? fmtDateTime(t.last_login_at) : "لم يدخل بعد"}`)),
      h("div", { class: "row", style: "flex:none" },
        btn("الإسناد", () => {
          const p = loadPicker(classes, subjects, t.load);
          const d = dialog(`إسناد ${t.name}`, p.el, [btn("حفظ", async () => {
            await api(`${A}/teachers/${t.id}/load`, { load: p.value() }, "PUT"); d.close(); toast("تم الحفظ"); refresh();
          })]);
        }, "ghost sm"),
        btn("كلمة مرور جديدة", async () => {
          if (!confirmAction(`إنشاء كلمة مرور جديدة لـ ${t.name}؟`)) return;
          showCredentials("كلمة مرور جديدة", (await api(`${A}/teachers/${t.id}/reset-password`, {})).credentials);
        }, "ghost sm"),
        btn(t.is_active ? "إيقاف" : "تفعيل", async () => {
          await api(`${A}/teachers/${t.id}/active`, { active: !t.is_active }, "PATCH"); refresh();
        }, "ghost sm"),
        btn("حذف", async () => {
          if (!confirmAction(`حذف ${t.name} نهائيًا؟ إن كان له نشاط سابق فاستخدم «إيقاف» بدلًا من الحذف.`)) return;
          await api(`${A}/teachers/${t.id}`, undefined, "DELETE"); toast("تم الحذف"); refresh();
        }, "danger sm")))) : empty("لم يُضف معلمون بعد.")),
  ];
}
