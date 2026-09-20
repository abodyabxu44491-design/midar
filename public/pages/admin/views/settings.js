// الإعدادات — مقسّمة إلى أقسام قصيرة بدل صفحة واحدة طويلة
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, textarea, select, btn, line, sub, keyText, toast, confirmAction,
  empty, badge, notice, switchBtn, dialog, showCredentials, showInstallBar } from "/shared/js/ui.js";
import { csv, CURRENCIES, setCurrency } from "/shared/js/format.js";
import { A, directoryLink } from "./common.js";

const SECTIONS = [
  ["modules", "أقسام المنصة"],
  ["page", "صفحة المدرسة العامة"],
  ["payment", "طرق السداد"],
  ["messages", "رسائل واتساب"],
  ["users", "المستخدمون والصلاحيات"],
  ["money", "العملة"],
  ["access", "الدخول والأمان"],
  ["data", "البيانات والاشتراك"],
];

export default async function settings(ctx) {
  const section = select(SECTIONS);
  const box = h("div");
  const views = { modules: modulesView, page: pageView, payment: paymentView, messages: messagesView,
    users: usersView, money: moneyView, access: accessView, data: dataView };

  const show = async () => {
    mount(box, empty("جارٍ التحميل…"));
    try { mount(box, await views[section.value]({ ...ctx, show })); }
    catch (e) { mount(box, notice(e.message, "err")); }
  };
  section.addEventListener("change", show);
  await show();

  return [panel("الإعدادات", null, field("اختر القسم", section)), box];
}

/* ===================== 1) أقسام المنصة ===================== */
const MODULE_GROUPS = [
  ["الأكاديمي", [
    ["attendance", "الحضور والغياب", "تسجيل الحضور اليومي وتقاريره"],
    ["timetable", "الجدول الدراسي", "جدول حصص لكل صف وجدول لكل معلم"],
    ["exams", "الاختبارات والدرجات", "إدخال الدرجات واعتمادها ونشرها"],
    ["reports", "كشوف الدرجات", "يحتاج تشغيل الاختبارات"],
    ["homework", "الواجبات", "ينشرها المعلم ويتابعها ولي الأمر"],
  ]],
  ["التواصل والتسجيل", [
    ["announcements", "التعاميم", "رسائل المدرسة لأولياء الأمور"],
    ["messaging", "رسائل واتساب", "أزرار تنبيه ولي الأمر بالغياب والرسوم"],
    ["admissions", "طلبات التسجيل", "طلبات التحاق الطلاب الجدد"],
    ["analytics", "التحليلات", "نسب الحضور ومتوسطات الدرجات"],
  ]],
  ["المالية", [
    ["fees", "الرسوم والفواتير", "فواتير الطلاب والسداد والإيصالات"],
    ["finance", "النظام المالي", "الحسابات والصناديق وسجل الحركات"],
    ["donations", "التبرعات", "يحتاج تشغيل النظام المالي"],
    ["payroll", "الرواتب", "الموظفون ومسير الرواتب — يحتاج النظام المالي"],
    ["transfers", "التحويل بين الحسابات", "يحتاج تشغيل النظام المالي"],
  ]],
];

async function modulesView() {
  const mods = await api(`${A}/settings/modules`);
  const msg = h("div");
  const save = async (patch) => {
    mount(msg);
    try {
      Object.assign(mods, await api(`${A}/settings/modules`, patch, "PUT"));
      toast("تم الحفظ. حدّث الصفحة لتظهر التبويبات الجديدة.");
      return true;
    } catch (e) { mount(msg, notice(e.message, "err")); return false; }
  };

  return [
    notice("ما توقفه هنا يختفي من التبويبات ويرفضه الخادم. البيانات المسجّلة تبقى محفوظة وتعود عند التشغيل.", ""),
    msg,
    ...MODULE_GROUPS.map(([title, items]) => panel(title, null,
      items.map(([key, name, note]) => line(
        h("div", {}, h("b", {}, name), note ? sub(note) : null),
        switchBtn(mods[key], name, (next) => save({ [key]: next })))))),
  ];
}

/* ===================== 2) صفحة المدرسة العامة ===================== */
const PAGE_OPTIONS = [
  ["show_classes", "عرض قائمة الصفوف", "الزائر يرى الصفوف ويضغط على الصف ليفتحه"],
  ["show_student_names", "عرض أسماء الطلاب داخل الصف", "عند إيقافه لا تظهر الأسماء، ويبقى البحث فقط"],
  ["show_search", "البحث عن طالب بالاسم", "يعمل حتى لو أخفيت الصفوف والأسماء"],
  ["show_teachers", "جدول معلمي الصف ومواده", "يظهر داخل الصف عند فتحه"],
  ["show_timetable", "جدول حصص الصف", "يظهر داخل الصف في الصفحة العامة"],
  ["show_admissions", "طلب التحاق طالب جديد", "النموذج يصل لتبويب «طلبات التسجيل»"],
  ["show_class_counts", "عدد الطلاب في كل صف", null],
  ["show_announcements", "تعاميم المدرسة", "تظهر لأولياء الأمور في صفحة المدرسة"],
  ["profile_show_grades", "الدرجات داخل ملف الطالب", "الدرجات المعتمدة فقط، ولصاحب المعرّف فقط"],
  ["profile_show_attendance", "الحضور والغياب داخل ملف الطالب", null],
  ["profile_show_teachers", "المعلمون داخل ملف الطالب", null],
  ["profile_show_timetable", "الجدول الدراسي داخل ملف الطالب", null],
  ["profile_show_homework", "الواجبات داخل ملف الطالب", null],
];

async function pageView({ me }) {
  const pub = await api(`${A}/settings/public-page`);
  const msg = h("div");
  const save = async (patch) => {
    mount(msg);
    try { Object.assign(pub, await api(`${A}/settings/public-page`, patch, "PUT")); toast("تم الحفظ"); return true; }
    catch (e) { mount(msg, notice(e.message, "err")); return false; }
  };

  const mode = select([["code", "تحتاج رمزًا (أكثر خصوصية)"], ["open", "مفتوحة لمن يعرف الرابط"]], { value: pub.access_mode });
  mode.addEventListener("change", () => save({ access_mode: mode.value }));

  return [
    panel("طريقة الدخول", btn("معاينة", () => window.open(directoryLink(me), "_blank"), "ghost sm"),
      field("دخول صفحة المدرسة", mode), msg),

    panel("ما يظهر للزوار", null,
      sub("ما توقفه هنا يختفي فورًا عن الزوار."),
      PAGE_OPTIONS.map(([key, label, hint]) => line(
        h("div", {}, h("b", {}, label), hint ? sub(hint) : null),
        switchBtn(pub[key], label, (next) => save({ [key]: next }))))),

    panel("حالة السداد", null,
      line(h("div", {}, h("b", {}, "إظهار حالة السداد بجانب أسماء الطلاب"),
        sub("للجميع في القائمة والبحث، وليس لولي الأمر فقط")),
        switchBtn(pub.public_fee_badges, "حالة السداد", async (next) => {
          if (next && !confirmAction("سيظهر «لم يسدد» بجانب اسم الطالب لكل من يفتح الصفحة. هل أنت متأكد؟")) return false;
          return save({ public_fee_badges: next });
        })),
      notice("إظهارها للجميع يكشف وضع الأسرة المالي وقد يُحرج الطالب. ولي الأمر يرى رسومه داخل ملف ابنه على أي حال.", "warn")),
  ];
}

/* ===================== 3) طرق السداد ===================== */
async function paymentView({ show }) {
  const pay = await api(`${A}/settings/payment`);
  const acc = { bank: input({ placeholder: "اسم البنك" }), holder: input(),
    iban: input({ class: "ltr", placeholder: "SA00 0000 0000 0000 0000 0000" }), number: input({ class: "ltr" }) };
  const note = textarea({ rows: 2, value: pay.payment_note || "", placeholder: "مواعيد استلام الدفع النقدي ومكانه" });

  return [
    panel("الحسابات البنكية", null,
      sub("تظهر لولي الأمر عند الضغط على «ادفع»."),
      pay.accounts.length ? pay.accounts.map((a) => line(
        h("div", { class: a.is_active ? "" : "muted-row" }, h("b", {}, a.bank_name), " ", a.is_active ? null : badge("موقوف", "gray"),
          sub(`${a.account_holder} — `, keyText(a.iban), a.account_number ? ` — ${a.account_number}` : "")),
        btn(a.is_active ? "إيقاف" : "تفعيل", async () => {
          await api(`${A}/settings/payment/accounts/${a.id}`, { active: !a.is_active }, "PATCH"); show();
        }, "ghost sm"))) : empty("لا توجد حسابات بنكية بعد."),
      h("h3", { class: "sec-title" }, "إضافة حساب بنكي"),
      h("div", { class: "row" }, field("اسم البنك", acc.bank), field("اسم صاحب الحساب", acc.holder)),
      h("div", { class: "row" }, field("الآيبان (IBAN)", acc.iban), field("رقم الحساب (اختياري)", acc.number)),
      btn("إضافة الحساب", async () => {
        await api(`${A}/settings/payment/accounts`, { bank_name: acc.bank.value, account_holder: acc.holder.value,
          iban: acc.iban.value, account_number: acc.number.value });
        toast("تمت إضافة الحساب"); show();
      })),

    panel("الدفع النقدي", null,
      sub("تظهر لولي الأمر في نافذة السداد."),
      note,
      h("div", { class: "spaced" }, btn("حفظ التعليمات", async () => {
        await api(`${A}/settings/payment/note`, { payment_note: note.value }, "PUT"); toast("تم الحفظ");
      }, "soft"))),
  ];
}

/* ===================== 4) رسائل واتساب ===================== */
const TPL = [["absence", "رسالة الغياب"], ["late", "رسالة التأخر"], ["fees", "رسالة تذكير الرسوم"], ["general", "الرسالة العامة"]];

async function messagesView({ me }) {
  if (me.modules && me.modules.messaging === false) return notice("قسم رسائل واتساب موقوف. فعّله من «أقسام المنصة».", "warn");
  const tpl = await api(`${A}/messaging/templates`);
  const code = input({ class: "ltr", value: tpl.country_code, style: "max-width:120px" });
  const fields = Object.fromEntries(TPL.map(([k, label]) => [k, textarea({ rows: 2, value: tpl[k], "aria-label": label })]));
  return panel("قوالب الرسائل", null,
    sub("تُفتح الرسالة جاهزة في واتساب من جهازك."),
    sub("المتغيرات: {الطالب} {المدرسة} {الفصل} {التاريخ} {المبلغ} {الرابط}"),
    field("رمز الدولة", code),
    TPL.map(([k, label]) => field(label, fields[k])),
    btn("حفظ القوالب", async () => {
      await api(`${A}/messaging/templates`, { country_code: code.value,
        ...Object.fromEntries(TPL.map(([k]) => [k, fields[k].value])) }, "PUT");
      toast("تم حفظ القوالب");
    }));
}

/* ===================== 5) المستخدمون والصلاحيات ===================== */
async function usersView({ show }) {
  const list = await api(`${A}/users`);
  const f = { name: input(), username: input({ class: "ltr", placeholder: "حروف إنجليزية وأرقام" }),
    approve: input({ type: "checkbox" }), payroll: input({ type: "checkbox" }), accounts: input({ type: "checkbox" }),
    manager: input({ type: "checkbox" }) };
  f.manager.addEventListener("change", () => {
    for (const el of [f.approve, f.payroll, f.accounts]) { el.checked = f.manager.checked; el.disabled = f.manager.checked; }
  });

  const row = (u) => line(
    h("div", { class: u.is_active ? "" : "muted-row" },
      h("b", {}, u.name), " ", u.is_active ? null : badge("موقوف", "gray"),
      sub(`اسم المستخدم: ${u.username}`),
      sub(u.can_approve_finance && u.can_manage_payroll && u.can_manage_accounts
        ? "مدير مالي — كل صلاحيات المالية"
        : `اعتماد الحركات: ${u.can_approve_finance ? "نعم" : "لا"} — الرواتب: ${u.can_manage_payroll ? "نعم" : "لا"} — الحسابات: ${u.can_manage_accounts ? "نعم" : "لا"}`)),
    h("div", { class: "row", style: "flex:none" },
      btn("الصلاحيات", () => permsDialog(u, show), "ghost sm"),
      btn("كلمة مرور جديدة", async () => {
        if (!confirmAction(`إنشاء كلمة مرور جديدة لـ ${u.name}؟`)) return;
        showCredentials("كلمة مرور جديدة", (await api(`${A}/users/${u.id}/reset-password`, {})).credentials);
      }, "ghost sm"),
      btn(u.is_active ? "إيقاف" : "تفعيل", async () => {
        await api(`${A}/users/${u.id}/active`, { active: !u.is_active }, "PATCH"); show();
      }, "ghost sm")));

  return [
    panel("حسابات المحاسبين", null,
      sub("المحاسب يرى المالية والرسوم فقط، ولا يرى الطلاب ولا الدرجات ولا الإعدادات."),
      list.length ? list.map(row) : empty("لا توجد حسابات محاسبين.")),

    panel("إضافة محاسب", null,
      h("div", { class: "row" }, field("الاسم", f.name), field("اسم المستخدم", f.username)),
      h("label", { class: "f pill" }, f.manager, h("b", {}, "مدير مالي (كل صلاحيات المالية)")),
      h("label", { class: "f pill" }, f.approve, "يعتمد الحركات المالية"),
      h("label", { class: "f pill" }, f.payroll, "يدير الرواتب"),
      h("label", { class: "f pill" }, f.accounts, "يدير الحسابات والتصنيفات"),
      btn("إضافة الحساب", async () => {
        const all = f.manager.checked;
        const r = await api(`${A}/users`, { name: f.name.value, username: f.username.value,
          can_approve_finance: all || f.approve.checked, can_manage_payroll: all || f.payroll.checked,
          can_manage_accounts: all || f.accounts.checked });
        showCredentials("تمت إضافة المحاسب", r.credentials, "يدخل من رابط دخول المنسوبين، وسيُطلب منه تغيير كلمة المرور.");
        show();
      })),
  ];
}

function permsDialog(u, refresh) {
  const approve = input({ type: "checkbox", checked: u.can_approve_finance });
  const payroll = input({ type: "checkbox", checked: u.can_manage_payroll });
  const accounts = input({ type: "checkbox", checked: u.can_manage_accounts });
  const d = dialog(`صلاحيات ${u.name}`, h("div", {},
    h("label", { class: "f pill" }, approve, "اعتماد ورفض وإلغاء الحركات المالية"),
    h("label", { class: "f pill" }, payroll, "إنشاء مسير الرواتب واعتماده وصرفه"),
    h("label", { class: "f pill" }, accounts, "إدارة الحسابات والصناديق والتصنيفات"),
    h("div", { class: "spaced" }, btn("منحه كل الصلاحيات (مدير مالي)", () => {
      for (const el of [approve, payroll, accounts]) el.checked = true;
    }, "ghost sm"))),
  [btn("حفظ", async () => {
    await api(`${A}/users/${u.id}/permissions`, { can_approve_finance: approve.checked,
      can_manage_payroll: payroll.checked, can_manage_accounts: accounts.checked }, "PATCH");
    d.close(); toast("حُفظت الصلاحيات"); refresh();
  })]);
}

/* ===================== 6) العملة ===================== */
async function moneyView({ show }) {
  const cur = await api(`${A}/settings/currency`);
  const pick = select(Object.entries(CURRENCIES).map(([k, v]) => [k, v.name]), { value: cur.currency });
  const msg = h("div");
  return panel("عملة المدرسة", null,
    sub("تظهر بها الرسوم والتقارير. يمكن إنشاء حسابات بعملات أخرى من تبويب المالية."),
    h("div", { class: "row" }, field("العملة الأساسية", pick),
      btn("حفظ", async () => {
        mount(msg);
        try { await api(`${A}/settings/currency`, { currency: pick.value }, "PUT"); setCurrency(pick.value); toast("تم حفظ العملة"); show(); }
        catch (e) { mount(msg, notice(e.message, "err")); }
      }, "soft")),
    msg);
}

/* ===================== 7) الدخول والأمان ===================== */
async function accessView({ me, refresh }) {
  const cur = input({ type: "password", class: "ltr", autocomplete: "current-password" });
  const nxt = input({ type: "password", class: "ltr", autocomplete: "new-password" });
  return [
    panel("رمز صفحة الطلاب", null,
      line(h("span", {}, "الرمز الحالي"), keyText(me.school.directory_code)),
      sub("إنشاء رمز جديد يوقف الرمز الحالي فورًا."),
      h("div", { class: "spaced" }, btn("إنشاء رمز جديد", async () => {
        if (!confirmAction("إنشاء رمز جديد لصفحة الطلاب؟")) return;
        const r = await api(`${A}/settings/directory-code`, {});
        toast(`الرمز الجديد: ${r.directory_code}`);
        refresh();
      }, "soft"))),

    panel("تغيير كلمة المرور", null,
      field("كلمة المرور الحالية", cur),
      field("الجديدة", nxt, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"),
      btn("حفظ كلمة المرور", async () => {
        await api(`${A}/password`, { current: cur.value, next: nxt.value });
        cur.value = nxt.value = ""; toast("تم تغيير كلمة المرور");
      })),

    panel("الأمان", null,
      sub("ينهي جلسات بقية المستخدمين ويطلب دخولهم من جديد."),
      h("div", { class: "spaced" }, btn("إنهاء جميع الجلسات الأخرى", async () => {
        if (!confirmAction("إنهاء جلسات جميع المستخدمين الآخرين؟")) return;
        await api(`${A}/settings/sign-out-all`, {});
        toast("أُنهيت الجلسات الأخرى");
      }, "danger"))),
  ];
}

/* ===================== 8) البيانات والاشتراك ===================== */
async function dataView({ me }) {
  return [
    panel("نسخة من بياناتك", null,
      sub("نسخة كاملة من بيانات مدرستك. احفظها عندك بشكل دوري."),
      h("div", { class: "row" },
        btn("تصدير Excel (ملفات CSV)", async () => {
          const d = await api(`${A}/export`);
          for (const [name, rows] of Object.entries(d)) {
            if (Array.isArray(rows) && rows.length) csv(`${name}.csv`, [Object.keys(rows[0]), ...rows.map((r) => Object.values(r))]);
          }
          toast("تم تنزيل الملفات");
        }, "soft"),
        btn("تصدير نسخة كاملة (JSON)", async () => {
          const d = await api(`${A}/export`);
          const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" })),
            download: `midar-${d.school}-${new Date().toISOString().slice(0, 10)}.json` });
          a.click();
        }, "ghost"),
        btn("تثبيت مِدار كتطبيق", () => showInstallBar(), "ghost"))),

    panel("الاشتراك", null,
      line(h("span", {}, "حد الطلاب"), h("b", {}, me.school.max_students)),
      me.school.subscription_end ? line(h("span", {}, "ينتهي في"), h("b", {}, me.school.subscription_end)) : null,
      sub("للتجديد أو رفع الحد، تواصل مع إدارة المنصة.")),
  ];
}
