/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Owner settings for school managers' sign-in: outgoing email (any SMTP provider), Google and Apple.
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, textarea, btn, sub, badge, notice, toast, copyRow, passwordInput } from "/shared/js/ui.js";
import { fmtDateTime } from "/shared/js/format.js";

const A = "/api/owner/auth-settings";
const PRESETS = [
  ["Gmail / Google Workspace", { host: "smtp.gmail.com", port: 587, secure: false }, "اسم المستخدم: بريدك كاملًا. كلمة المرور: «كلمة مرور التطبيقات» من إعدادات حساب Google (بعد تفعيل التحقق بخطوتين)."],
  ["Zoho Mail", { host: "smtp.zoho.com", port: 465, secure: true }, "اسم المستخدم: بريدك في Zoho. كلمة المرور: كلمة مرور التطبيق من إعدادات الأمان."],
  ["Brevo", { host: "smtp-relay.brevo.com", port: 587, secure: false }, "من Brevo: SMTP & API ← SMTP. اسم المستخدم وكلمة المرور (SMTP key) يظهران هناك."],
  ["Resend", { host: "smtp.resend.com", port: 465, secure: true }, "اسم المستخدم: resend. كلمة المرور: مفتاح API من Resend. وثّق دومينك عندهم أولًا."],
];
const steps = (...items) => h("ol", { class: "si-steps" }, items.map((x) => h("li", {}, x)));
const ext = (href, text) => h("a", { href, target: "_blank", rel: "noopener", class: "ltr" }, text);

export default async function signinSettings({ refresh }) {
  const d = await api(A);
  return [
    sub(`طرق دخول مديري المدارس بحساب مدار. الحسابات المنشأة حتى الآن: ${d.accounts}.`),
    mailPanel(d, refresh),
    googlePanel(d, refresh),
    applePanel(d, refresh),
  ];
}

function mailPanel(d, refresh) {
  const m = d.mail;
  const f = {
    host: input({ class: "ltr", value: m.host, placeholder: "smtp.example.com" }),
    port: input({ class: "ltr", type: "number", value: m.port }),
    username: input({ class: "ltr", value: m.username, autocomplete: "off" }),
    password: passwordInput({ autocomplete: "new-password", placeholder: m.has_password ? "محفوظة — اتركها فارغة للإبقاء عليها" : "كلمة مرور SMTP" }),
    from_email: input({ class: "ltr", type: "email", value: m.from_email, placeholder: "no-reply@midarschool.com" }),
    from_name: input({ value: m.from_name || "مدار" }),
  };
  const secure = h("input", { type: "checkbox", checked: m.secure });
  const enabled = h("input", { type: "checkbox", checked: m.enabled });
  const hint = h("div");
  const presets = h("div", { class: "row", style: "flex-wrap:wrap;gap:6px" }, PRESETS.map(([name, p, note]) => btn(name, () => {
    f.host.value = p.host; f.port.value = p.port; secure.checked = p.secure; mount(hint, notice(note, ""));
  }, "ghost sm")));
  const msg = h("div");
  const to = input({ class: "ltr", type: "email", placeholder: "بريدك لاستلام رسالة تجريبية" });
  return panel("البريد الإلكتروني (SMTP)", m.enabled ? badge("مفعّل", "green") : badge("متوقف", "gray"),
    sub("منه تصل رموز تأكيد البريد واستعادة كلمة المرور لمديري المدارس. يعمل مع أي مزوّد يدعم SMTP."),
    steps("أنشئ بريد إرسال في مزوّدك (مثل no-reply@دومينك).",
      "خذ من المزوّد بيانات SMTP: الخادم والمنفذ واسم المستخدم وكلمة المرور.",
      "اختر مزوّدك أدناه لتعبئة الخادم والمنفذ، ثم أكمل الحقول واحفظ.",
      "أرسل رسالة تجريبية لبريدك وتأكد أنها وصلت (وتفقد مجلد الرسائل غير المرغوبة)."),
    presets, hint,
    h("div", { class: "row" }, field("الخادم", f.host), field("المنفذ", f.port)),
    h("label", { class: "f pill" }, secure, "اتصال مشفّر من البداية (SSL/TLS — غالبًا للمنفذ 465)"),
    h("div", { class: "row" }, field("اسم المستخدم", f.username), field("كلمة المرور", f.password)),
    h("div", { class: "row" }, field("بريد المرسل", f.from_email), field("اسم المرسل", f.from_name)),
    h("label", { class: "f pill" }, enabled, "تفعيل الإرسال"),
    msg,
    h("div", { class: "row spaced" }, btn("حفظ", async () => {
      mount(msg);
      try {
        await api(`${A}/mail`, { enabled: enabled.checked, host: f.host.value.trim(), port: Number(f.port.value), secure: secure.checked,
          username: f.username.value.trim(), password: f.password.value || undefined, from_email: f.from_email.value.trim(), from_name: f.from_name.value.trim() }, "PUT");
        toast("حُفظت إعدادات البريد"); refresh();
      } catch (e) { mount(msg, notice(e.message, "err")); }
    })),
    h("div", { class: "row", style: "align-items:flex-end" }, field("رسالة تجريبية إلى", to), btn("إرسال", async (e) => {
      const b = e.currentTarget; b.disabled = true; mount(msg);
      try { await api(`${A}/mail/test`, { to: to.value.trim() }); mount(msg, notice("أُرسلت الرسالة. تحقق من بريدك.", "")); }
      catch (err) { mount(msg, notice(err.message, "err")); }
      b.disabled = false;
    }, "soft")),
    m.updated_at ? sub(`آخر تحديث: ${fmtDateTime(m.updated_at)}`) : null);
}

function providerPanel(d, refresh, p, { title, intro, guide, fields }) {
  const cur = d.providers.find((x) => x.provider === p) || {};
  const enabled = h("input", { type: "checkbox", checked: cur.enabled });
  const msg = h("div");
  const inputs = fields(cur);
  return panel(title, cur.enabled ? badge("مفعّل", "green") : badge("متوقف", "gray"),
    sub(intro), guide,
    copyRow("رابط العودة (Redirect / Return URL)", d.callbacks[p], { note: "انسخه كما هو في إعدادات المزوّد" }),
    copyRow("الدومين / النطاق", new URL(d.origin).host),
    inputs.el,
    h("label", { class: "f pill" }, enabled, `إظهار زر «المتابعة باستخدام ${p === "google" ? "Google" : "Apple"}»`),
    msg,
    h("div", { class: "spaced" }, btn("حفظ", async () => {
      mount(msg);
      try { await api(`${A}/providers/${p}`, { enabled: enabled.checked, ...inputs.values() }, "PUT"); toast("حُفظت الإعدادات"); refresh(); }
      catch (e) { mount(msg, notice(e.message, "err")); }
    })),
    cur.updated_at ? sub(`آخر تحديث: ${fmtDateTime(cur.updated_at)}`) : null);
}

function googlePanel(d, refresh) {
  return providerPanel(d, refresh, "google", {
    title: "الدخول عبر Google",
    intro: "مجاني. يدخل المدير بحساب Google المرتبط بحسابه في مدار.",
    guide: steps(h("span", {}, "افتح ", ext("https://console.cloud.google.com/apis/credentials", "Google Cloud Console"), " وأنشئ مشروعًا (أو اختر مشروعك)."),
      "من «OAuth consent screen» اختر External، واكتب اسم التطبيق «مدار» وبريد الدعم، ثم انشره (Publish).",
      "من «Credentials» ← Create credentials ← OAuth client ID ← نوع Web application.",
      "في «Authorized redirect URIs» الصق رابط العودة أدناه، وفي «Authorized JavaScript origins» رابط موقعك.",
      "انسخ Client ID وClient secret إلى الحقول هنا، فعّل الزر واحفظ."),
    fields: (cur) => {
      const id = input({ class: "ltr", value: cur.client_id || "", placeholder: "xxxx.apps.googleusercontent.com" });
      const secret = passwordInput({ autocomplete: "new-password", placeholder: cur.has_secret ? "محفوظ — اتركه فارغًا للإبقاء عليه" : "Client secret" });
      return { el: h("div", { class: "row" }, field("Client ID", id), field("Client secret", secret)),
        values: () => ({ client_id: id.value.trim(), secret: secret.value || undefined }) };
    },
  });
}

function applePanel(d, refresh) {
  return providerPanel(d, refresh, "apple", {
    title: "الدخول عبر Apple",
    intro: "يحتاج اشتراك برنامج مطوري Apple. يبقى الزر مخفيًا حتى تكمل الإعداد.",
    guide: steps(h("span", {}, "من ", ext("https://developer.apple.com/account/resources/identifiers/list", "Apple Developer"), " أنشئ App ID وفعّل فيه Sign in with Apple."),
      "أنشئ Services ID (هو Client ID هنا)، فعّل فيه Sign in with Apple، وأضف الدومين ورابط العودة أدناه.",
      "من Keys أنشئ مفتاحًا بخاصية Sign in with Apple، ونزّل ملف ‎.p8 (يُنزَّل مرة واحدة فقط) واحفظ Key ID.",
      "Team ID يظهر أعلى صفحة حسابك في Apple Developer.",
      "الصق القيم ومحتوى ملف ‎.p8 كاملًا هنا، فعّل الزر واحفظ."),
    fields: (cur) => {
      const id = input({ class: "ltr", value: cur.client_id || "", placeholder: "com.midarschool.web" });
      const team = input({ class: "ltr", value: cur.team_id || "", placeholder: "Team ID" });
      const key = input({ class: "ltr", value: cur.key_id || "", placeholder: "Key ID" });
      const pem = textarea({ class: "ltr", rows: 4, placeholder: cur.has_secret ? "المفتاح محفوظ — اتركه فارغًا للإبقاء عليه" : "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----" });
      return { el: h("div", {}, h("div", { class: "row" }, field("Services ID", id), field("Team ID", team), field("Key ID", key)), field("المفتاح الخاص (.p8)", pem)),
        values: () => ({ client_id: id.value.trim(), team_id: team.value.trim(), key_id: key.value.trim(), secret: pem.value.trim() || undefined }) };
    },
  });
}
