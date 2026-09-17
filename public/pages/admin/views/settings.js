// تبويب الإعدادات
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, textarea, btn, line, sub, keyText, toast, confirmAction, empty, badge } from "/shared/js/ui.js";
import { fmtDate } from "/shared/js/format.js";
import { A } from "./common.js";

export default async function settings({ me, refresh }) {
  const pay = await api(`${A}/settings/payment`);
  const acc = { bank: input({ placeholder: "مثال: مصرف الراجحي" }), holder: input(), iban: input({ class: "ltr", placeholder: "SA00 0000 0000 0000 0000 0000" }), number: input({ class: "ltr" }) };
  const note = textarea({ rows: 2, value: pay.payment_note || "", placeholder: "مثال: الدفع النقدي في مكتب المحاسب من الأحد إلى الخميس، 8 صباحًا – 12 ظهرًا" });
  const cur = input({ type: "password", class: "ltr", autocomplete: "current-password" });
  const nxt = input({ type: "password", class: "ltr", autocomplete: "new-password" });
  return [
    panel("طرق السداد", null,
      sub("الحسابات المفعّلة تظهر لولي الأمر عند الضغط على «ادفع» في صفحة الطالب."),
      pay.accounts.length ? pay.accounts.map((a) => line(
        h("div", { class: a.is_active ? "" : "muted-row" }, h("b", {}, a.bank_name), " ", a.is_active ? null : badge("موقوف", "gray"),
          sub(`${a.account_holder} — `, keyText(a.iban), a.account_number ? ` — ${a.account_number}` : "")),
        btn(a.is_active ? "إيقاف" : "تفعيل", async () => {
          await api(`${A}/settings/payment/accounts/${a.id}`, { active: !a.is_active }, "PATCH"); refresh();
        }, "ghost sm"))) : empty("لا توجد حسابات بنكية بعد."),
      h("h3", { class: "sec-title" }, "إضافة حساب بنكي"),
      h("div", { class: "row" }, field("اسم البنك", acc.bank), field("اسم صاحب الحساب", acc.holder)),
      h("div", { class: "row" }, field("الآيبان (IBAN)", acc.iban), field("رقم الحساب (اختياري)", acc.number)),
      btn("إضافة الحساب", async () => {
        await api(`${A}/settings/payment/accounts`, { bank_name: acc.bank.value, account_holder: acc.holder.value, iban: acc.iban.value, account_number: acc.number.value });
        toast("تمت إضافة الحساب"); refresh();
      }),
      h("h3", { class: "sec-title" }, "تعليمات الدفع النقدي"),
      note,
      h("div", { class: "spaced" }, btn("حفظ التعليمات", async () => {
        await api(`${A}/settings/payment/note`, { payment_note: note.value }, "PUT"); toast("تم الحفظ");
      }, "soft"))),
    panel("رمز صفحة الطلاب", null,
      line(h("span", {}, "الرمز الحالي"), keyText(me.school.directory_code)),
      sub("غيّر الرمز إذا انتشر خارج أولياء أمور المدرسة. الرمز القديم يتوقف فورًا."),
      h("div", { class: "spaced" }, btn("إنشاء رمز جديد", async () => {
        if (!confirmAction("سيتوقف الرمز الحالي. متابعة؟")) return;
        const r = await api(`${A}/settings/directory-code`, {});
        me.school.directory_code = r.directory_code; toast("تم تغيير الرمز"); refresh();
      }, "soft"))),
    panel("تغيير كلمة المرور", null,
      field("كلمة المرور الحالية", cur),
      field("الجديدة", nxt, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
      btn("حفظ كلمة المرور", async () => {
        await api(`${A}/password`, { current: cur.value, next: nxt.value });
        cur.value = nxt.value = ""; toast("تم تغيير كلمة المرور");
      })),
    panel("الأمان", null,
      sub("إذا اشتبهت أن أحدًا دخل بحساب معلم، أنهِ كل الجلسات. سيحتاج الجميع لتسجيل الدخول من جديد."),
      h("div", { class: "spaced" }, btn("إنهاء جميع الجلسات الأخرى", async () => {
        if (!confirmAction("إنهاء جلسات جميع المستخدمين الآخرين؟")) return;
        await api(`${A}/settings/sign-out-all`, {}); toast("تم");
      }, "danger"))),
    panel("الاشتراك", null, sub(`حد الطلاب: ${me.school.max_students} — ينتهي: ${me.school.subscription_end ? fmtDate(me.school.subscription_end) : "غير محدد"}`)),
  ];
}
