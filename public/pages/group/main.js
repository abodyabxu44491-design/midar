/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { $, h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { topbar, footer, tabs, loginScreen, passwordChangeScreen, panel, field, input, select, btn, notice, sub, badge, dialog, line, keyText,
  toast, kpiCard, kpiGrid, linkRow, copyRow, passwordInput, empty, confirmAction, brandLogo } from "../shared/js/ui.js";
import { money, fmtDate, fmtDateTime } from "../shared/js/format.js";
import { icons } from "../shared/js/icons.js";

const app = $("#app");
const API = "/api/group";
const STATUS = { active: ["تعمل", ""], suspended: ["موقوفة", "red"] };
let me;

async function start() {
  try { me = await api(`${API}/me`); } catch {
    return mount(app, loginScreen({
      role: "group", endpoint: `${API}/login`, onSuccess: start, schoolLabel: "رمز المجموعة", storeKey: "midar_group",
      title: "مركز تحكم المجموعة", subtitle: "الإدارة العامة لمدارسك من مكان واحد",
      points: ["إنشاء مدارس المجموعة ضمن باقتك", "متابعة أرقام كل مدرسة في شاشة واحدة", "لكل مدرسة إدارتها وبياناتها المستقلة"],
      recoveryText: "إذا نسيت كلمة المرور تواصل مع إدارة مدار لإصدار كلمة مرور مؤقتة جديدة.",
    }));
  }
  if (me.must_change_password) {
    return passwordChangeScreen({ endpoint: `${API}/password`, logoutEndpoint: `${API}/logout`, school: me.name, name: "مركز تحكم المجموعة" });
  }
  const ctx = {};
  const t = tabs([["schools", "المدارس"], ["create", "مدرسة جديدة"], ["account", "الحساب"]], { schools, create, account }, ctx,
    { primary: ["schools", "create", "account"] });
  ctx.go = (k) => t.show(k);
  mount(app,
    topbar({ school: me.name, subtitle: "مركز تحكم المجموعة", onLogout: async () => { await api(`${API}/logout`, {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.start("schools");
}

// The manager needs only the school's own link: on first entry they create their account with the email recorded
// here (or Google with the same email). After that, restoring access is a one-time recovery link.
function handover(r, title) {
  const recovery = r.setup?.url;
  const rows = [["اسم المدرسة", r.school?.name || r.school?.id], ["رمز المدرسة", r.school?.id],
    ["رابط دخول المدرسة", r.links.staff.admin],
    recovery ? ["رابط استعادة دخول المدير", recovery] : ["بريد المدير لأول دخول", r.manager_email || "—"],
    ["رابط الطلاب وأولياء الأمور", r.links.public.home]];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  const d = dialog(title, h("div", { class: "handover" },
    h("div", { class: "print-only" }, brandLogo("print-logo", false)),
    recovery
      ? notice("أرسل رابط الاستعادة لمدير المدرسة. يفتحه ويسجّل بحسابه الجديد (البريد أو Google)، فتنتقل المدرسة لحسابه. الرابط صالح 7 أيام ويُستخدم مرة واحدة.", "warn")
      : notice("أرسل لمدير المدرسة رابط دخول المدرسة فقط. في أول دخول يختار «إنشاء حساب المدير» ويسجّل بالبريد المذكور (أو Google بنفس البريد)، ثم يدخل لوحة المدرسة مباشرة.", ""),
    rows.map(([k, v], i) => line(h("span", { class: "sub" }, k), i === 0 ? h("b", {}, v) : keyText(v))),
    sub("لا تُسلَّم كلمة مرور للمدير: هو يختار طريقة دخوله بنفسه.")),
  [btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); }), btn("طباعة", () => window.print(), "ghost")]);
  return d;
}

function editEmail(s, refresh) {
  const mail = input({ type: "email", class: "ltr", value: s.manager_email || "", placeholder: "manager@example.com" });
  const msg = h("div");
  const d = dialog(`بريد مدير ${s.name}`, h("div", {},
    sub("أول دخول للمدرسة يُقبل بهذا البريد فقط (أو بحساب Google بنفس البريد)."), field("بريد مدير المدرسة", mail), msg), [
    btn("حفظ", async () => {
      mount(msg);
      try { const r = await api(`${API}/schools/${s.id}/manager-email`, { email: mail.value.trim() }, "PUT"); d.close(); refresh(); handover(r, "تسليم المدرسة"); }
      catch (e) { mount(msg, notice(e.message, "err")); }
    })]);
}

function schoolCard(s, refresh) {
  const rate = s.recorded_today ? Math.round(((s.recorded_today - s.absent_today) / s.recorded_today) * 100) : null;
  return h("article", { class: "grp-card" },
    h("header", { class: "grp-head" },
      h("span", { class: "grp-ic", "aria-hidden": "true" }, icons.building({ size: 22 })),
      h("div", { class: "grp-title" }, h("b", {}, s.name), h("small", { class: "ltr" }, s.id)),
      badge(...(STATUS[s.status] || [s.status, "gray"]))),
    h("div", { class: "grp-figs" },
      fig("الطلاب", s.students), fig("المعلمون", s.teachers), fig("الشعب", s.classes),
      fig("حضور اليوم", rate === null ? "لم يُسجل" : `${rate}%`)),
    h("div", { class: "grp-money" },
      h("span", {}, "المحصّل ", h("b", {}, money(s.fees_paid, s.currency))),
      h("span", {}, "المتبقي ", h("b", {}, money(s.fees_remaining, s.currency)))),
    sub(s.admin ? `مدير المدرسة: ${s.admin.full_name} — ${s.manager_linked ? (s.admin.last_login_at ? `آخر دخول ${fmtDateTime(s.admin.last_login_at)}` : "ربط حسابه") : `لم يدخل بعد${s.manager_email ? ` (${s.manager_email})` : ""}`}` : "لا يوجد مدير"),
    s.subscription_end ? sub(`الاشتراك حتى ${fmtDate(s.subscription_end)}`) : null,
    h("div", { class: "grp-acts" },
      h("a", { class: "btn sm", href: s.links.staff.admin, target: "_blank", rel: "noopener" }, icons.external({ size: 14 }), "دخول إدارة المدرسة"),
      btn("روابط المدرسة", () => dialog(`روابط ${s.name}`, h("div", {},
        linkRow("دخول المدير والمعلمين", s.links.staff.admin),
        linkRow("صفحة أولياء الأمور والطلاب", s.links.public.home),
        copyRow("رمز المدرسة", s.id))), "ghost sm"),
      s.manager_linked
        ? btn("استعادة دخول المدير", async () => {
          if (!(await confirmAction(`إصدار رابط استعادة لمدير ${s.name}؟ عند استخدامه تنتقل المدرسة لحساب المدير الجديد.`))) return;
          try { handover(await api(`${API}/schools/${s.id}/reset-admin`, {}), "رابط استعادة دخول المدير"); refresh(); }
          catch (e) { toast(e.message, true); }
        }, "ghost sm")
        : [btn("تسليم المدرسة", async () => {
          try { handover(await api(`${API}/schools/${s.id}/reset-admin`, {}), "تسليم المدرسة"); } catch (e) { toast(e.message, true); }
        }, "ghost sm"), btn("تعديل بريد المدير", () => editEmail(s, refresh), "ghost sm")]));
}
const fig = (label, value) => h("div", { class: "grp-fig" }, h("b", {}, String(value)), h("span", {}, label));

async function schools({ refresh, go }) {
  const d = await api(`${API}/schools`);
  const g = d.group;
  const left = Math.max(0, g.max_schools - d.schools.length);
  const absentRatio = d.totals.recorded_today ? d.totals.absent_today / d.totals.recorded_today : null;
  return [
    h("section", { class: "dash-hello" },
      h("span", { class: "dash-logo ph", "aria-hidden": "true" }, icons.building({ size: 26 })),
      h("div", { class: "dash-hello-text" },
        h("h2", {}, g.name),
        h("p", {}, [g.plan_name, `المدير العام: ${g.manager_name}`, g.ends_on ? `الاشتراك حتى ${fmtDate(g.ends_on)}` : null].filter(Boolean).join(" · ")))),
    kpiGrid(
      kpiCard({ icon: "building", tone: "navy", label: "المدارس", value: `${d.schools.length} من ${g.max_schools}`, ratio: d.schools.length / g.max_schools,
        note: left ? `يمكنك إضافة ${left}` : "اكتمل حد الباقة", onClick: left ? () => go("create") : null }),
      kpiCard({ icon: "users", tone: "teal", label: "الطلاب في كل المدارس", value: d.totals.students.toLocaleString("ar-SA-u-nu-latn") }),
      kpiCard({ icon: "user", tone: "violet", label: "المعلمون", value: d.totals.teachers.toLocaleString("ar-SA-u-nu-latn") }),
      kpiCard({ icon: "check", tone: "amber", label: "غياب اليوم", value: d.totals.recorded_today ? String(d.totals.absent_today) : "لم يُسجل",
        ratio: absentRatio, note: d.totals.recorded_today ? `من ${d.totals.recorded_today} سجل حضور` : null })),
    panel(`مدارس المجموعة (${d.schools.length})`, left ? btn("+ مدرسة جديدة", () => go("create"), "sm") : null,
      d.schools.length ? h("div", { class: "grp-cards" }, d.schools.map((s) => schoolCard(s, refresh)))
        : empty("لم تُنشأ مدارس بعد. ابدأ بإنشاء أول مدرسة من «مدرسة جديدة».")),
  ];
}

const slug = (v) => v.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

async function create({ go }) {
  const d = await api(`${API}/schools`);
  const g = d.group;
  if (d.schools.length >= g.max_schools) {
    return panel("مدرسة جديدة", null,
      notice(`وصلت مجموعتك إلى حد الباقة (${g.max_schools} مدارس).${g.extra_school_price != null ? ` كل مدرسة إضافية بـ ${money(g.extra_school_price, g.currency || "SAR")} سنويًا.` : ""}`, "warn"),
      sub("لرفع الحد تواصل مع إدارة مدار على الرقم 0510235422 أو من midarschool.com، وتُضاف المدرسة لمجموعتك مباشرة."));
  }
  const name = input({ placeholder: "مثل: مدارس النخبة - فرع البنات" });
  const code = input({ class: "ltr", placeholder: `${g.id}-2`, autocapitalize: "none", spellcheck: false });
  const admin = input({ placeholder: "الاسم الكامل لمدير المدرسة" });
  const mail = input({ type: "email", class: "ltr", placeholder: "manager@example.com" });
  const currency = select([["YER", "ريال يمني"], ["SAR", "ريال سعودي"], ["USD", "دولار أمريكي"]]);
  // Default to the currency the group's schools already use.
  currency.value = d.schools[0]?.currency || "SAR";
  code.value = `${g.id}-${d.schools.length + 1}`;
  code.addEventListener("input", () => { code.value = slug(code.value); });
  const msg = h("div");
  return panel("إنشاء مدرسة ضمن المجموعة", null,
    notice(`متبقٍ لك ${g.max_schools - d.schools.length} من ${g.max_schools} مدارس في باقتك. كل مدرسة تُنشأ بكل مزايا مدار، ولها مديرها وبياناتها المستقلة.`, ""),
    field("اسم المدرسة", name),
    h("div", { class: "row" },
      field("رمز المدرسة (يظهر في رابطها)", code, "حروف إنجليزية صغيرة وأرقام وشرطة"),
      field("عملة رسوم المدرسة", currency)),
    h("div", { class: "row" },
      field("اسم مدير المدرسة", admin),
      field("بريد مدير المدرسة", mail, "يدخل المدير أول مرة من رابط المدرسة بهذا البريد أو بحساب Google بنفس البريد")),
    msg,
    btn("إنشاء المدرسة", async () => {
      mount(msg);
      try {
        const r = await api(`${API}/schools`, { id: code.value, name: name.value, admin_name: admin.value, manager_email: mail.value.trim(), currency: currency.value });
        handover(r, "بطاقة تسليم المدرسة");
        go("schools");
      } catch (e) { mount(msg, notice(e.message, "err")); }
    }, "wide"));
}

async function account() {
  const cur = passwordInput({ autocomplete: "current-password" });
  const nxt = passwordInput({ autocomplete: "new-password" });
  const msg = h("div");
  return [
    panel("بيانات المجموعة", null,
      line(h("span", { class: "sub" }, "اسم المجموعة"), h("b", {}, me.name)),
      line(h("span", { class: "sub" }, "رمز المجموعة"), keyText(me.id)),
      line(h("span", { class: "sub" }, "اسم المستخدم"), keyText(me.username)),
      line(h("span", { class: "sub" }, "الباقة"), h("b", {}, me.plan_name || "—")),
      line(h("span", { class: "sub" }, "حد المدارس"), h("b", {}, String(me.max_schools))),
      me.ends_on ? line(h("span", { class: "sub" }, "الاشتراك حتى"), h("b", {}, fmtDate(me.ends_on))) : null,
      linkRow("رابط مركز التحكم", `${location.origin}/group`)),
    panel("تغيير كلمة المرور", null,
      field("كلمة المرور الحالية", cur), field("كلمة المرور الجديدة", nxt, "10 أحرف على الأقل، وتحتوي حرفًا إنجليزيًا ورقمًا"), msg,
      btn("حفظ", async () => {
        mount(msg);
        try { await api(`${API}/password`, { current: cur.value, next: nxt.value }); cur.value = ""; nxt.value = ""; mount(msg, notice("تم تغيير كلمة المرور", "")); }
        catch (e) { mount(msg, notice(e.message, "err")); }
      })),
  ];
}

start();
document.documentElement.dataset.app = "مركز تحكم المجموعة";
