// تبويب الإعدادات
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, textarea, select, btn, line, sub, keyText, toast, confirmAction, empty, badge, notice, switchBtn, installButton } from "/shared/js/ui.js";
import { csv } from "/shared/js/format.js";
import { fmtDate } from "/shared/js/format.js";
import { A, directoryLink } from "./common.js";

export default async function settings({ me, refresh }) {
  const pay = await api(`${A}/settings/payment`);
  const acc = { bank: input({ placeholder: "مثال: مصرف الراجحي" }), holder: input(), iban: input({ class: "ltr", placeholder: "SA00 0000 0000 0000 0000 0000" }), number: input({ class: "ltr" }) };
  const note = textarea({ rows: 2, value: pay.payment_note || "", placeholder: "مثال: الدفع النقدي في مكتب المحاسب من الأحد إلى الخميس، 8 صباحًا – 12 ظهرًا" });
  const pub = await api(`${A}/settings/public-page`);
  const tpl = await api(`${A}/messaging/templates`);
  const cur = input({ type: "password", class: "ltr", autocomplete: "current-password" });
  const nxt = input({ type: "password", class: "ltr", autocomplete: "new-password" });
  return [
    publicPagePanel(pub, me, refresh),
    messagesPanel(tpl),
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
    panel("نسخة من بياناتك", null,
      sub("تصدير كل بيانات المدرسة: الطلاب، الحضور، الدرجات، الجدول، الفواتير، المدفوعات. احفظها عندك بشكل دوري."),
      h("div", { class: "row" },
        btn("تصدير Excel (ملفات CSV)", async () => {
          const d = await api(`${A}/export`);
          const table = (name, rows) => rows.length && csv(`${name}.csv`, [Object.keys(rows[0]), ...rows.map((r) => Object.values(r))]);
          for (const [name, rows] of Object.entries(d)) if (Array.isArray(rows)) table(name, rows);
          toast("تم تنزيل الملفات");
        }, "soft"),
        btn("تصدير نسخة كاملة (JSON)", async () => {
          const d = await api(`${A}/export`);
          const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" })),
            download: `midar-${d.school}-${new Date().toISOString().slice(0, 10)}.json` });
          a.click();
        }, "ghost"),
        installButton("تثبيت مِدار كتطبيق"))),
    panel("الاشتراك", null, sub(`حد الطلاب: ${me.school.max_students} — ينتهي: ${me.school.subscription_end ? fmtDate(me.school.subscription_end) : "غير محدد"}`)),
  ];
}


/* ---------- التحكم في صفحة المدرسة العامة ---------- */
const OPTIONS = [
  ["show_classes", "عرض قائمة الصفوف", "الزائر يرى الصفوف ويضغط على الصف ليفتحه"],
  ["show_student_names", "عرض أسماء الطلاب داخل الصف", "عند إيقافه لا تظهر الأسماء، ويبقى البحث فقط"],
  ["show_search", "البحث عن طالب بالاسم", "يعمل حتى لو أخفيت الصفوف والأسماء"],
  ["show_teachers", "جدول معلمي الصف ومواده", "يظهر داخل الصف عند فتحه"],
  ["show_class_counts", "عدد الطلاب في كل صف", null],
  ["show_announcements", "إعلانات المدرسة", null],
  ["show_timetable", "جدول حصص الصف", "يظهر داخل الصف في الصفحة العامة"],
  ["profile_show_grades", "الدرجات داخل ملف الطالب", "الدرجات المعتمدة فقط، ولصاحب المعرّف فقط"],
  ["profile_show_attendance", "الحضور والغياب داخل ملف الطالب", null],
  ["profile_show_teachers", "المعلمون داخل ملف الطالب", null],
  ["profile_show_timetable", "الجدول الدراسي داخل ملف الطالب", null],
];

function publicPagePanel(pub, me, refresh) {
  const state = { ...pub };
  const msg = h("div");

  const save = async (patch) => {
    mount(msg);
    try {
      Object.assign(state, await api(`${A}/settings/public-page`, patch, "PUT"));
      toast("تم الحفظ");
      return true;
    } catch (e) { mount(msg, notice(e.message, "err")); refresh(); return false; }
  };

  const mode = select([["code", "تحتاج رمزًا (أكثر خصوصية)"], ["open", "مفتوحة لمن يعرف الرابط"]], { value: state.access_mode });
  mode.addEventListener("change", () => save({ access_mode: mode.value }));

  const rows = OPTIONS.map(([key, label, hint]) => line(
    h("div", {}, h("b", {}, label), hint ? sub(hint) : null),
    switchBtn(state[key], label, (next) => save({ [key]: next }))));

  const feeRow = line(
    h("div", {}, h("b", {}, "إظهار حالة السداد بجانب أسماء الطلاب"),
      sub("للجميع في القائمة والبحث، وليس لولي الأمر فقط")),
    switchBtn(state.public_fee_badges, "حالة السداد", async (next) => {
      if (next && !confirmAction("سيظهر «لم يسدد» بجانب اسم الطالب لكل من يفتح الصفحة، بما في ذلك بقية الأهالي والطلاب. هل أنت متأكد؟")) return false;
      return save({ public_fee_badges: next });
    }));

  return panel("صفحة المدرسة العامة", btn("معاينة", () => window.open(directoryLink(me), "_blank"), "ghost sm"),
    sub("كل عنصر اختياري. ما توقفه هنا يختفي فورًا عن الزوار."),
    field("طريقة الدخول للصفحة", mode),
    msg,
    ...rows,
    feeRow,
    notice("حالة السداد بيانات مالية عن أسرة الطالب. إظهارها للجميع قد يُحرج الطالب أمام زملائه، وقد يخالف نظام حماية البيانات الشخصية. الأفضل إبقاؤها موقوفة، فولي الأمر يرى رسومه داخل ملف ابنه على أي حال.", "warn"));
}


/* ---------- قوالب رسائل واتساب ---------- */
const TPL = [
  ["absence", "رسالة الغياب"],
  ["late", "رسالة التأخر"],
  ["fees", "رسالة تذكير الرسوم"],
  ["general", "الرسالة العامة"],
];

function messagesPanel(tpl) {
  const code = input({ class: "ltr", value: tpl.country_code, style: "max-width:120px" });
  const fields = Object.fromEntries(TPL.map(([k, label]) => [k, textarea({ rows: 2, value: tpl[k], "aria-label": label })]));
  return panel("رسائل واتساب", null,
    sub("المنصة تجهّز الرسالة وتفتح واتساب من جوالك، بدون أي اشتراك في مزود رسائل."),
    sub("المتغيرات المتاحة: {الطالب} {المدرسة} {الفصل} {التاريخ} {المبلغ} {الرابط}"),
    field("رمز الدولة", code),
    TPL.map(([k, label]) => field(label, fields[k])),
    btn("حفظ القوالب", async () => {
      await api(`${A}/messaging/templates`, {
        country_code: code.value,
        ...Object.fromEntries(TPL.map(([k]) => [k, fields[k].value])),
      }, "PUT");
      toast("تم حفظ القوالب");
    }));
}
