// الإعدادات — مقسّمة إلى أقسام قصيرة بدل صفحة واحدة طويلة
import { h, mount } from "../../shared/js/dom.js";
import { mySubscription } from "./my-subscription.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, textarea, select, btn, line, sub, keyText, toast, confirmAction, sectionMenu,
  empty, badge, notice, switchBtn, dialog, showCredentials, showInstallBar , passwordInput} from "../../shared/js/ui.js";
import { csv, parseCsv, CURRENCIES, setCurrency, money, fmtDate } from "../../shared/js/format.js";
import { A, directoryLink } from "./common.js";

const SECTIONS = [
  { key: "modules", name: "أقسام المنصة", note: "شغّل وأوقف أقسام اللوحة" },
  { key: "import", name: "استيراد البيانات", note: "قوالب جاهزة للطلاب والمعلمين والفصول" },
  { key: "fields", name: "الحقول المخصصة", note: "أضف أي معلومة تحتاجها مدرستك" },
  { key: "page", name: "صفحة المدرسة العامة", note: "ما يراه أولياء الأمور" },
  { key: "payment", name: "طرق السداد", note: "الحسابات البنكية والدفع النقدي" },
  { key: "messages", name: "رسائل واتساب", note: "قوالب التنبيه ورمز الدولة" },
  { key: "users", name: "المستخدمون والصلاحيات", note: "حسابات المحاسبين" },
  { key: "passwords", name: "طلبات كلمات المرور", note: "تحقق من هوية الطالب ثم أحِل الطلب" },
  { key: "money", name: "العملة", note: "عملة المدرسة الأساسية" },
  { key: "access", name: "الدخول والأمان", note: "رمز الصفحة وكلمة المرور والجلسات" },
  { key: "data", name: "نسخة من بياناتك", note: "تصدير Excel أو نسخة كاملة" },
  { key: "subscription", name: "اشتراكي", note: "الباقة والمميزات والتجديد والترقية" },
];

export default function settings(ctx) {
  const views = { modules: modulesView, import: importView, fields: customFieldsView, page: pageView, payment: paymentView,
    messages: messagesView, users: usersView, passwords: passwordRequestsView, money: moneyView,
    access: accessView, data: dataView,
    subscription: mySubscription };
  return sectionMenu({
    title: "الإعدادات",
    items: SECTIONS,
    render: (key, { reload }) => views[key]({ ...ctx, show: reload }),
  });
}

/* ===================== 1) أقسام المنصة ===================== */
const MODULE_GROUPS = [
  ["الأكاديمي", [
    ["attendance", "الحضور والغياب", "تسجيل الحضور اليومي وتقاريره"],
    ["timetable", "الجدول الدراسي", "جدول حصص لكل صف وجدول لكل معلم"],
    ["exams", "الاختبارات والدرجات", "إدخال الدرجات واعتمادها ونشرها"],
    ["reports", "كشوف الدرجات", "يحتاج تشغيل الاختبارات"],
    ["exam_papers", "مصمم الاختبارات الورقية", "بنك الأسئلة وإنشاء أوراق الاختبارات وطباعتها"],
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
  const [mods, subInfo] = await Promise.all([api(`${A}/settings/modules`), api(`${A}/subscription`).catch(() => null)]);
  // القسم غير المشمول في الباقة يظهر مقفلًا (والخادم يرفضه حتى لو فُعّل)
  const locked = new Set((subInfo?.features || []).filter((f) => !f.included).map((f) => f.key));
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
    msg,
    ...MODULE_GROUPS.map(([title, items]) => panel(title, null,
      items.map(([key, name, note]) => line(
        h("div", {}, h("b", {}, name), locked.has(key) ? badge("غير متاحة في باقتك", "gray") : null, note ? sub(note) : null),
        locked.has(key) ? h("span", { class: "sub", style: "flex:none" }, "اطلبها من «اشتراكي»")
          : switchBtn(mods[key], name, (next) => save({ [key]: next })))))),
  ];
}

/* ===================== استيراد البيانات من ملف ===================== */
async function importView({ show }) {
  const kinds = await api(`${A}/import/kinds`);
  const pick = select(kinds.map((k) => [k.key, k.name]));
  const file = input({ type: "file", accept: ".csv,text/csv" });
  const preview = h("div");
  const msg = h("div");
  let parsed = null;

  const current = () => kinds.find((k) => k.key === pick.value);

  const describe = () => {
    const k = current();
    mount(cols,
      sub(k.note),
      h("div", { class: "pill" }, "الأعمدة: ",
        ...k.columns.map((c) => badge(c.header + (c.required ? " (مطلوب)" : ""), c.required ? "" : "gray"))));
  };
  const cols = h("div");
  pick.addEventListener("change", () => { parsed = null; mount(preview); mount(msg); describe(); });

  file.addEventListener("change", async () => {
    mount(msg); mount(preview);
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return mount(msg, notice("حجم الملف أكبر من 2 ميجابايت", "err"));
    const text = await f.text();
    const data = parseCsv(text);
    if (!data.rows.length) return mount(msg, notice("الملف فارغ أو غير مقروء. استخدم القالب.", "err"));
    parsed = data.rows;
    const headers = data.headers;
    mount(preview,
      notice(`الملف فيه ${data.rows.length} سطر. راجعها قبل الاستيراد.`, ""),
      h("div", { class: "scroll" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, headers.map((x) => h("th", {}, x)))),
        h("tbody", {}, data.rows.slice(0, 10).map((row) => h("tr", {}, headers.map((x) => h("td", {}, row[x] || "—"))))))),
      data.rows.length > 10 ? sub(`تُعرض أول 10 أسطر من ${data.rows.length}.`) : null);
  });

  describe();

  return panel("استيراد من ملف", null,
    sub("نزّل القالب، عبّئه في Excel، احفظه CSV، ثم ارفعه."),
    field("نوع البيانات", pick),
    cols,
    h("div", { class: "row" },
      btn("تنزيل القالب", () => { location.href = `${A}/import/template/${pick.value}`; }, "soft"),
      field("اختر الملف", file)),
    preview, msg,
    btn("استيراد", async () => {
      mount(msg);
      if (!parsed) return mount(msg, notice("اختر ملفًا أولًا", "err"));
      try {
        const r = await api(`${A}/import/${pick.value}`, { rows: parsed, dry_run: false });
        mount(preview);
        file.value = ""; parsed = null;
        if (pick.value === "teachers" && r.rows?.length) {
          showCredentialsList(r.rows);
        } else {
          toast(`تم استيراد ${r.created} سطرًا`);
        }
        mount(msg, notice(`تم استيراد ${r.created} سطرًا بنجاح.`, ""));
      } catch (e) {
        const rows = e.errors || [];
        mount(msg, notice(e.message, "err"),
          rows.length ? h("ul", { class: "small" }, rows.slice(0, 20).map((x) => h("li", {},
            x.row ? `السطر ${x.row}: ${x.message}` : x.message))) : null);
      }
    }));
}

// بيانات دخول المعلمين المستوردين: تُعرض مرة واحدة وتُنسخ أو تُطبع
function showCredentialsList(rows) {
  const text = rows.map((r) => `${r.name} — المستخدم: ${r.username} — كلمة المرور: ${r.password}`).join("\n");
  dialog(`بيانات دخول ${rows.length} معلمًا`, h("div", {},
    notice("كلمات المرور لن تظهر مرة أخرى. انسخها أو اطبعها وسلّمها لكل معلم.", "warn"),
    h("div", { class: "report" }, rows.map((r) => line(
      h("div", {}, h("b", {}, r.name), sub(`المستخدم: ${r.username}`)), keyText(r.password))))),
  [btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); }),
   btn("طباعة", () => window.print(), "ghost")]);
}

/* ===================== الحقول المخصصة ===================== */
const FIELD_TYPES = { text: "نص", number: "رقم", date: "تاريخ", select: "قائمة", boolean: "نعم / لا" };

async function customFieldsView({ show }) {
  const list = await api(`${A}/custom-fields?entity=student`);
  const f = {
    label: input({ placeholder: "اسم الحقل" }),
    type: select(Object.entries(FIELD_TYPES)),
    options: input({ placeholder: "خيارات القائمة مفصولة بفاصلة" }),
    required: input({ type: "checkbox" }),
    show_parent: input({ type: "checkbox" }),
  };
  const optionsRow = h("div", { class: "hidden" }, field("الخيارات", f.options));
  f.type.addEventListener("change", () => optionsRow.classList.toggle("hidden", f.type.value !== "select"));

  const row = (x) => line(
    h("div", { class: x.is_active ? "" : "muted-row" },
      h("b", {}, x.label), " ", badge(FIELD_TYPES[x.type], "gray"),
      x.required ? badge("مطلوب", "amber") : null,
      x.show_parent ? badge("يظهر لولي الأمر", "") : null,
      x.type === "select" ? sub(`الخيارات: ${(x.options || []).join("، ")}`) : null),
    h("div", { class: "row", style: "flex:none" },
      btn(x.show_parent ? "إخفاء عن ولي الأمر" : "إظهار لولي الأمر", async () => {
        await api(`${A}/custom-fields/${x.id}`, { show_parent: !x.show_parent }, "PATCH"); show();
      }, "ghost sm"),
      btn(x.required ? "اجعله اختياريًا" : "اجعله مطلوبًا", async () => {
        await api(`${A}/custom-fields/${x.id}`, { required: !x.required }, "PATCH"); show();
      }, "ghost sm"),
      btn("حذف", async () => {
        if (!confirmAction(`حذف «${x.label}» وقيمه لدى كل الطلاب؟`)) return;
        await api(`${A}/custom-fields/${x.id}`, undefined, "DELETE"); toast("حُذف الحقل"); show();
      }, "danger sm")));

  return [
    panel("حقول الطلاب المخصصة", null,
      sub("تظهر في بطاقة الطالب داخل اللوحة، وما تفعّله منها يظهر أيضًا لولي الأمر."),
      list.length ? list.map(row) : empty("لا توجد حقول مخصصة.")),

    panel("إضافة حقل", null,
      h("div", { class: "row" }, field("اسم الحقل", f.label), field("النوع", f.type)),
      optionsRow,
      h("label", { class: "f pill" }, f.required, "حقل مطلوب"),
      h("label", { class: "f pill" }, f.show_parent, "يظهر لولي الأمر في ملف الطالب"),
      btn("إضافة الحقل", async () => {
        await api(`${A}/custom-fields`, {
          entity: "student", label: f.label.value, type: f.type.value,
          options: f.type.value === "select" ? f.options.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean) : undefined,
          required: f.required.checked, show_parent: f.show_parent.checked,
        });
        toast("أُضيف الحقل"); show();
      })),
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
  const COUNTRIES = [["966", "السعودية (+966)"], ["967", "اليمن (+967)"], ["971", "الإمارات (+971)"],
    ["968", "عُمان (+968)"], ["965", "الكويت (+965)"], ["973", "البحرين (+973)"], ["974", "قطر (+974)"],
    ["20", "مصر (+20)"], ["962", "الأردن (+962)"], ["249", "السودان (+249)"], ["90", "تركيا (+90)"]];
  const known = COUNTRIES.some(([c]) => c === String(tpl.country_code));
  const code = select([...COUNTRIES, ["other", "رمز آخر…"]], { value: known ? tpl.country_code : "other" });
  const custom = input({ class: "ltr", value: known ? "" : tpl.country_code, placeholder: "رمز الدولة بالأرقام",
    style: `max-width:160px;${known ? "display:none" : ""}` });
  code.addEventListener("change", () => { custom.style.display = code.value === "other" ? "" : "none"; });
  const countryCode = () => (code.value === "other" ? custom.value.replace(/\D/g, "") : code.value);
  const fields = Object.fromEntries(TPL.map(([k, label]) => [k, textarea({ rows: 2, value: tpl[k], "aria-label": label })]));
  return panel("قوالب الرسائل", null,
    sub("تُفتح الرسالة جاهزة في واتساب من جهازك."),
    sub("المتغيرات: {الطالب} {المدرسة} {الفصل} {التاريخ} {المبلغ} {الرابط}"),
    h("div", { class: "row" }, field("دولة المدرسة", code), custom),
    sub("يُستخدم لإكمال الأرقام المحلية (05…) عند فتح واتساب. الأرقام المكتوبة بصيغة دولية (+…) تُستخدم كما هي."),
    TPL.map(([k, label]) => field(label, fields[k])),
    btn("حفظ القوالب", async () => {
      await api(`${A}/messaging/templates`, { country_code: countryCode(),
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

/* ===================== طلبات كلمات المرور ===================== */
const PR_JOBS = { admin: "إداري", accountant: "محاسب", teacher: "معلم" };
const PR_CONTACT = { phone: "اتصال هاتفي", whatsapp: "واتساب", email: "بريد إلكتروني" };
const PR_STATUS = {
  new: ["بانتظار مراجعتك", "amber"], referred: ["محال إلى مالك المنصة", ""],
  approved: ["اعتُمد — أُرسل الرابط", ""], used: ["تم التغيير", ""],
  rejected: ["مرفوض", "gray"], expired: ["انتهى الرابط", "gray"],
};

async function passwordRequestsView({ show }) {
  const list = await api(`${A}/password-requests`);
  const waiting = list.filter((x) => x.status === "new").length;

  const row = (r) => line(
    h("div", { class: r.status === "new" ? "" : "muted-row" },
      h("b", {}, r.full_name), " ", badge(...(PR_STATUS[r.status] || [r.status, "gray"])),
      sub(`طلب ${r.ref} — ${PR_JOBS[r.job_title]} — الحساب: ${r.username}`),
      sub(`${r.phone} — التواصل المفضل: ${PR_CONTACT[r.contact_pref]}${r.branch ? ` — ${r.branch}` : ""}`),
      sub(`السبب: ${r.description}`),
      r.admin_note ? sub(`ملاحظتك: ${r.admin_note}`) : null,
      r.owner_note ? sub(`رد المنصة: ${r.owner_note}`) : null),
    h("div", { class: "row", style: "flex:none" },
      r.status === "new" ? btn("تحققت — أحِل للمنصة", () => reviewDialog(r, "refer", show), "sm") : null,
      r.status === "new" ? btn("رفض", () => reviewDialog(r, "reject", show), "danger sm") : null));

  return panel(`طلبات تغيير كلمات المرور${waiting ? ` (${waiting} بانتظارك)` : ""}`, null,
    sub("تحقق من هوية صاحب الطلب هاتفيًا، ثم أحِله لمالك المنصة لإصدار الرابط. لا يمكنك إصدار الرابط بنفسك."),
    list.length ? list.map(row) : empty("لا توجد طلبات."));
}

function reviewDialog(r, decision, show) {
  const note = input({ placeholder: decision === "refer" ? "كيف تحققت من هويته؟" : "سبب الرفض" });
  const msg = h("div");
  const d = dialog(decision === "refer" ? `إحالة طلب ${r.ref}` : `رفض طلب ${r.ref}`, h("div", {},
    sub(`${r.full_name} — ${PR_JOBS[r.job_title]} — ${r.phone}`),
    decision === "refer" ? notice("بعد الإحالة يعتمد مالك المنصة الطلب ويصدر رابطًا مؤقتًا لصاحب الحساب.", "") : null,
    note, msg),
  [btn(decision === "refer" ? "إحالة" : "رفض", async () => {
    mount(msg);
    try {
      await api(`${A}/password-requests/${r.id}/review`, { decision, note: note.value || null });
      d.close(); toast(decision === "refer" ? "أُحيل الطلب" : "رُفض الطلب"); show();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, decision === "reject" ? "danger" : "primary")]);
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
  const cur = passwordInput({ autocomplete: "current-password" });
  const nxt = passwordInput({ autocomplete: "new-password" });
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
        btn("تثبيت مدار كتطبيق", () => showInstallBar(), "ghost"))),

  ];
}
