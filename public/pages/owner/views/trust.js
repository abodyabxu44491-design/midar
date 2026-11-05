/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The trust center, owner side. A badge turns on only from a check that passed: automatic ones are run here by the
// platform, recorded ones are procedures you carried out and document with their evidence. A certificate can be issued
// only from a passing check that is still valid, and every check stays on record.
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, btn, empty, badge, sub, field, input, textarea, select, dialog, toast, notice } from "/shared/js/ui.js";

const B = "/api/owner/trust";
const day = (d) => (d ? String(new Date(d).toISOString()).slice(0, 10) : "");
const HINTS = {
  code_ownership: ["مثل: المستودع github.com/… في حساب المالك، والسجل الكامل للتطوير محفوظ", "رابط المستودع أو اسم الحساب المالك"],
  backup_restore: ["مثل: استُعيدت نسخة يوم 2026-11-01 في فرع منفصل، وتطابق عدد السجلات في كل الجداول", "اسم الفرع أو النسخة أو ملف التقرير"],
  support: ["مثل: قنوات الدعم منشورة في صفحة الدعم، وإجراء الاستقبال والمتابعة معتمد", "رابط صفحة الدعم أو المستند الداخلي"],
  quality: ["مثل: 470 اختبارًا ناجحًا، واختبار 144 صفحة لكل الأدوار في المتصفح بلا مشكلات", "رقم النسخة (commit) أو رابط نتيجة الاختبار"],
};

export default async function trust({ refresh }) {
  const t = await api(B);
  const cert = (kind) => t.certificates.find((c) => c.kind === kind && c.valid);
  return [
    notice(`${t.note} لا تُفعَّل شارة إلا بفحص ناجح، ولا تصدر شهادة إلا بعد تنفيذ الإجراء الذي تثبته. لا تسجّل إجراءً لم يُنفَّذ.`, ""),
    panel("الشارات", btn("تشغيل الفحوص الآلية", async () => {
      try { const r = await api(`${B}/run`, {}); toast(`نُفّذ ${r.length} فحوص: نجح ${r.filter((x) => x.passed).length}`); refresh(); } catch (e) { toast(e.message, true); }
    }, "sm"), h("div", { class: "xb-list" }, t.kinds.map((k) => h("div", { class: "xb-list-row" },
      h("div", {},
        h("b", {}, k.title), " ", k.active ? badge("نشطة", "") : badge("غير نشطة", "gray"), " ",
        badge(k.method === "automatic" ? "فحص آلي" : "إجراء موثّق", "gray"),
        sub(k.proves),
        k.check ? sub(`آخر فحص ${day(k.check.checked_at)} (${k.check.passed ? "ناجح" : "لم ينجح"}، صالح حتى ${day(k.check.valid_until)}): ${k.check.summary}`) : sub("لم يُنفَّذ بعد."),
        k.check?.reference ? sub(`المرجع: ${k.check.reference}`) : null,
        cert(k.kind) ? sub(`الشهادة السارية: ${cert(k.kind).ref}`) : null),
      h("div", { class: "row", style: "flex:none;gap:6px;flex-wrap:wrap" },
        k.method === "automatic" ? btn("تشغيل الفحص", async () => {
          try { const r = (await api(`${B}/run`, { kind: k.kind }))[0]; toast(r.passed ? "نجح الفحص" : `لم ينجح: ${r.summary}`, !r.passed); refresh(); } catch (e) { toast(e.message, true); }
        }, "ghost sm") : btn("تسجيل الإجراء", () => record(k, refresh), "ghost sm"),
        btn("السجل", () => history(k), "ghost sm"),
        k.certificate_title ? btn("إصدار شهادة", async () => {
          try { const c = await api(`${B}/certificates`, { kind: k.kind }); toast(`صدرت الشهادة ${c.ref}`); refresh(); } catch (e) { toast(e.message, true); }
        }, k.active ? "sm" : "ghost sm") : null))))),
    domainPanel(t.domain, refresh),
    panel(`الشهادات الصادرة (${t.certificates.length})`, null, t.certificates.length ? h("div", { class: "xb-list" }, t.certificates.map((c) => h("div", { class: "xb-list-row" },
      h("div", {}, h("b", { class: "ltr" }, c.ref), " ", h("span", {}, c.title), " ",
        c.revoked_at ? badge("ملغاة", "red") : c.valid ? badge("سارية", "") : badge("منتهية", "gray"),
        sub(`صدرت ${day(c.issued_at)} — صالحة حتى ${day(c.valid_until)} — الجهة المصدرة: ${c.issuer}`),
        c.revoke_reason ? sub(`سبب الإلغاء: ${c.revoke_reason}`) : null),
      h("div", { class: "row", style: "flex:none;gap:6px" },
        h("a", { class: "btn ghost sm", href: `/trust/verify/${c.ref}`, target: "_blank", rel: "noopener" }, "عرض وطباعة"),
        c.revoked_at ? null : btn("إلغاء", () => revoke(c, refresh), "danger sm")))))
      : empty("لم تصدر شهادات بعد. تصدر الشهادة من شارة نشطة.")),
  ];
}

function domainPanel(d, refresh) {
  const dom = input({ value: d?.domain || "", class: "ltr", placeholder: "midar.school" });
  return panel("توثيق ملكية النطاق", null, h("div", {},
    sub("اكتب نطاق المنصة، ثم أضف سجل TXT الظاهر عند مزوّد النطاق (Cloudflare أو غيره)، ثم شغّل فحص «توثيق ملكية النطاق»."),
    h("div", { class: "row", style: "align-items:flex-end" }, field("النطاق", dom), btn("حفظ وتوليد السجل", async () => {
      try { await api(`${B}/domain`, { domain: dom.value }, "PUT"); toast("حُفظ"); refresh(); } catch (e) { toast(e.message, true); }
    }, "sm")),
    d ? h("div", { style: "margin-top:10px" },
      sub("النوع: ", h("b", { class: "ltr" }, d.record_type)),
      sub("الاسم: ", h("b", { class: "ltr" }, d.record_name)),
      sub("القيمة: ", h("b", { class: "ltr", style: "word-break:break-all" }, d.record_value))) : null));
}

function record(k, refresh) {
  const [ph, refPh] = HINTS[k.kind] || ["", ""];
  const f = {
    passed: select([["true", "نُفّذ ونجح"], ["false", "نُفّذ ولم ينجح"]]),
    summary: textarea({ rows: 3, maxLength: 500, placeholder: ph }),
    reference: input({ placeholder: refPh }),
    details: textarea({ rows: 4, maxLength: 5000, placeholder: "تفاصيل إضافية (اختياري): الخطوات، الأرقام، من نفّذ" }),
  };
  const ok = h("input", { type: "checkbox" });
  const d = dialog(`تسجيل: ${k.title}`, h("div", {},
    sub(k.proves), field("النتيجة", f.passed), field("ما الذي نُفّذ ونتيجته", f.summary), field("مرجع الدليل", f.reference), field("التفاصيل", f.details),
    h("label", { class: "chk" }, ok, "نُفّذ هذا الإجراء فعلًا، والدليل محفوظ لدي")), [
    btn("تسجيل", async () => {
      try {
        await api(`${B}/record`, { kind: k.kind, passed: f.passed.value === "true", summary: f.summary.value, reference: f.reference.value,
          details: f.details.value, confirm: ok.checked || undefined });
        d.close(); toast("سُجّل الإجراء"); refresh();
      } catch (e) { toast(e.message, true); }
    })]);
}

async function history(k) {
  const rows = await api(`${B}/checks/${k.kind}`);
  dialog(`سجل: ${k.title}`, rows.length ? h("div", { class: "xb-list" }, rows.map((c) => h("div", { class: "xb-list-row" },
    h("div", {}, h("b", {}, day(c.checked_at)), " ", c.passed ? badge("ناجح", "") : badge("لم ينجح", "red"), sub(c.summary),
      c.reference ? sub(`المرجع: ${c.reference}`) : null, sub(`بواسطة ${c.checked_by}`)))))
    : empty("لا فحوص بعد."), []);
}

function revoke(c, refresh) {
  const reason = input({ placeholder: "سبب الإلغاء" });
  const d = dialog(`إلغاء الشهادة ${c.ref}`, h("div", {}, sub("تبقى الشهادة قابلة للتحقق وتظهر «ملغاة»."), field("السبب", reason)), [
    btn("إلغاء الشهادة", async () => {
      try { await api(`${B}/certificates/${c.id}/revoke`, { reason: reason.value }); d.close(); toast("أُلغيت"); refresh(); } catch (e) { toast(e.message, true); }
    }, "danger")]);
}
