/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Trust on the public site: customer reviews (published only with recorded consent) and the reports visitors send
// about them, and the company's certifications (published only with a way to verify them).
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, btn, empty, badge, sub, field, input, textarea, select, dialog, toast, confirmAction, notice } from "/shared/js/ui.js";

const T = "/api/owner/testimonials";
const A = "/api/owner/accreditations";
const STATUS = { pending: ["بانتظار الاعتماد", "amber"], approved: ["منشور", ""], hidden: ["مخفي", "gray"] };

export default async function testimonials({ refresh }) {
  const [rows, accr, tenants] = await Promise.all([api(T), api(A), api("/api/owner/tenants")]);
  return [
    notice("أضف آراء المدارس الحقيقية فقط. لا يُنشر رأي إلا بعد تسجيل من وافق على نشره من المدرسة وتاريخ موافقته. اربط الرأي بحساب المدرسة إن كانت مشتركة، فتظهر بجانبه شارة «مدرسة مشتركة في مدار». يستطيع الزوار الإبلاغ عن أي رأي منشور، وتصلك البلاغات هنا.", ""),
    panel(`آراء العملاء (${rows.length})`, btn("+ إضافة رأي", () => edit({}, tenants, refresh), "sm"),
      rows.length ? h("div", { class: "xb-list" }, rows.map((r) => h("div", { class: "xb-list-row" },
        h("div", {},
          h("b", {}, r.school_name), " ", badge(...STATUS[r.status]),
          r.consent ? null : [" ", badge("بلا موافقة نشر", "red")],
          r.status === "approved" && !(r.consent_by && r.consent_at) ? [" ", badge("ينقصه إثبات الموافقة", "red")] : null,
          r.tenant_name ? [" ", badge(`مربوط بـ ${r.tenant_name}`, "")] : null,
          r.open_reports ? [" ", badge(`${r.open_reports} بلاغ مفتوح`, "red")] : null,
          sub([r.author_name, r.author_title, r.rating ? `${r.rating} من 5` : null, r.service_used].filter(Boolean).join(" — ")),
          r.consent_by ? sub(`وافق على النشر: ${r.consent_by}${r.consent_at ? ` بتاريخ ${String(r.consent_at).slice(0, 10)}` : ""}`) : null,
          sub(`«${r.body}»`)),
        h("div", { class: "row", style: "flex:none;gap:6px;flex-wrap:wrap" },
          r.status !== "approved" ? btn("اعتماد ونشر", async () => {
            try { await api(`${T}/${r.id}`, { ...form(r), status: "approved" }, "PUT"); toast("نُشر الرأي"); refresh(); } catch (e) { toast(e.message, true); }
          }, "sm") : btn("إخفاء", async () => {
            try { await api(`${T}/${r.id}`, { ...form(r), status: "hidden" }, "PUT"); toast("أُخفي"); refresh(); } catch (e) { toast(e.message, true); }
          }, "ghost sm"),
          btn(r.open_reports ? "البلاغات" : "سجل البلاغات", () => reports(r, refresh), r.open_reports ? "danger sm" : "ghost sm"),
          btn("تعديل", () => edit(r, tenants, refresh), "ghost sm"),
          btn("حذف", async () => { if (await confirmAction(`حذف رأي ${r.school_name}؟`)) { await api(`${T}/${r.id}`, undefined, "DELETE"); toast("حُذف"); refresh(); } }, "danger sm")))))
        : empty("لا توجد آراء بعد.")),
    notice("لا تضف إلا شهادة أو اعتمادًا حصلت عليه الشركة فعلًا ووثيقته محفوظة لديك. لا يُنشر اعتماد بلا رابط تحقق رسمي أو رقم شهادة، ويختفي من الموقع تلقائيًا بعد تاريخ انتهائه. لا تستخدم شعار جهة دون إذنها.", ""),
    panel(`الشهادات والاعتمادات (${accr.length})`, btn("+ إضافة اعتماد", () => editAccr({}, refresh), "sm"),
      accr.length ? h("div", { class: "xb-list" }, accr.map((a) => h("div", { class: "xb-list-row" },
        h("div", {},
          h("b", {}, a.title), " ", a.status === "published" ? badge("منشور", "") : badge("مسودة", "gray"), a.expired ? [" ", badge("منتهي — لا يظهر", "red")] : null,
          sub([a.issuer, a.number ? `رقم ${a.number}` : null, a.expires_on ? `حتى ${a.expires_on}` : null].filter(Boolean).join(" — ")),
          sub(a.scope)),
        h("div", { class: "row", style: "flex:none;gap:6px" },
          btn("تعديل", () => editAccr(a, refresh), "ghost sm"),
          btn("حذف", async () => { if (await confirmAction(`حذف «${a.title}»؟`)) { await api(`${A}/${a.id}`, undefined, "DELETE"); toast("حُذف"); refresh(); } }, "danger sm")))))
        : empty("لا توجد اعتمادات. قسم الاعتمادات لا يظهر في الموقع حتى تنشر اعتمادًا موثقًا.")),
  ];
}

// The fields the server accepts, from a row as listed.
const form = (r) => ({ school_name: r.school_name, author_name: r.author_name, author_title: r.author_title, body: r.body, rating: r.rating,
  logo: r.logo, consent: r.consent, status: r.status, tenant_id: r.tenant_id, sort: r.sort, service_used: r.service_used,
  consent_by: r.consent_by, consent_at: r.consent_at ? String(r.consent_at).slice(0, 10) : null });

async function shrink(file) {
  const img = await createImageBitmap(file);
  const s = Math.min(1, 160 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

function edit(r, tenants, refresh) {
  const f = {
    school_name: input({ value: r.school_name || "" }), author_name: input({ value: r.author_name || "" }), author_title: input({ value: r.author_title || "", placeholder: "مثل: مدير المدرسة" }),
    body: textarea({ rows: 4, maxLength: 600, value: r.body || "" }),
    rating: select([["", "بدون تقييم"], ["5", "5 من 5"], ["4", "4 من 5"], ["3", "3 من 5"], ["2", "2 من 5"], ["1", "1 من 5"]], { value: r.rating ? String(r.rating) : "" }),
    status: select([["pending", "بانتظار الاعتماد"], ["approved", "منشور"], ["hidden", "مخفي"]], { value: r.status || "pending" }),
    sort: input({ type: "number", value: r.sort ?? 100 }),
    tenant_id: select([["", "غير مربوطة بحساب"], ...tenants.map((x) => [x.id, x.name])], { value: r.tenant_id || "" }),
    service_used: input({ value: r.service_used || "", placeholder: "مثل: الحضور والدرجات والرسوم" }),
    consent_by: input({ value: r.consent_by || "", placeholder: "مثل: أ. محمد — مدير المدرسة" }),
    consent_at: input({ type: "date", value: r.consent_at ? String(r.consent_at).slice(0, 10) : "" }),
  };
  const consent = h("input", { type: "checkbox", checked: Boolean(r.consent) });
  let logo = r.logo || null;
  const prev = h("div", { class: "row", style: "align-items:center;gap:10px" });
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
  const draw = () => mount(prev, logo ? h("img", { src: logo, alt: "", style: "width:48px;height:48px;object-fit:contain;border:1px solid var(--line);border-radius:10px" }) : sub("بدون شعار"),
    btn(logo ? "تغيير الشعار" : "رفع شعار المدرسة", () => file.click(), "ghost sm"), logo ? btn("إزالة", () => { logo = null; draw(); }, "ghost sm") : null);
  file.addEventListener("change", async () => { try { logo = await shrink(file.files[0]); draw(); } catch { toast("تعذر قراءة الصورة", true); } });
  draw();
  const d = dialog(r.id ? "تعديل رأي" : "إضافة رأي مدرسة", h("div", {},
    field("اسم المدرسة", f.school_name),
    field("حساب المدرسة في مدار", f.tenant_id, "إن كانت مشتركة فعلًا. يظهر بجانب رأيها «مدرسة مشتركة في مدار»"),
    h("div", { class: "row" }, field("اسم صاحب الرأي (اختياري)", f.author_name), field("صفته", f.author_title)),
    field("نص الرأي", f.body), field("الخدمة التي تستخدمها المدرسة", f.service_used),
    h("div", { class: "row" }, field("التقييم", f.rating), field("الحالة", f.status), field("الترتيب", f.sort)),
    h("div", { class: "f" }, h("span", {}, "شعار المدرسة (بإذنها)"), prev, file),
    h("label", { class: "chk" }, consent, "حصلنا على موافقة المدرسة على نشر اسمها ورأيها وشعارها"),
    h("div", { class: "row" }, field("من وافق على النشر", f.consent_by), field("تاريخ الموافقة", f.consent_at))), [
    btn("حفظ", async () => {
      const body = { school_name: f.school_name.value, author_name: f.author_name.value, author_title: f.author_title.value, body: f.body.value,
        rating: f.rating.value || null, status: f.status.value, sort: Number(f.sort.value || 100), consent: consent.checked, logo,
        tenant_id: f.tenant_id.value || null, service_used: f.service_used.value, consent_by: f.consent_by.value, consent_at: f.consent_at.value || null };
      try { await api(r.id ? `${T}/${r.id}` : T, body, r.id ? "PUT" : "POST"); d.close(); toast("حُفظ"); refresh(); }
      catch (e) { toast(e.message, true); }
    })]);
}

async function reports(r, refresh) {
  const list = await api(`${T}/${r.id}/reports`);
  const d = dialog(`بلاغات رأي ${r.school_name}`, list.length ? h("div", { class: "xb-list" }, list.map((x) => {
    const note = input({ placeholder: "ما الذي فعلته (اختياري)" });
    return h("div", { class: "xb-list-row" },
      h("div", {}, h("b", {}, x.reason), sub(new Date(x.created_at).toLocaleString("ar")), x.contact ? sub(`للتواصل: ${x.contact}`) : null,
        x.resolved_at ? sub(`أُغلق${x.resolution ? `: ${x.resolution}` : ""}`) : note),
      x.resolved_at ? badge("مغلق", "gray") : btn("إغلاق البلاغ", async () => {
        try { await api(`${T}/reports/${x.id}/resolve`, { resolution: note.value }); toast("أُغلق البلاغ"); d.close(); refresh(); }
        catch (e) { toast(e.message, true); }
      }, "sm"));
  })) : empty("لا بلاغات على هذا الرأي."), []);
}

function editAccr(a, refresh) {
  const f = {
    issuer: input({ value: a.issuer || "", placeholder: "اسم الجهة المانحة الرسمي" }), title: input({ value: a.title || "" }),
    number: input({ value: a.number || "", class: "ltr" }), issued_on: input({ type: "date", value: a.issued_on || "" }),
    expires_on: input({ type: "date", value: a.expires_on || "" }), verify_url: input({ value: a.verify_url || "", class: "ltr", placeholder: "https://…" }),
    scope: textarea({ rows: 3, maxLength: 500, value: a.scope || "", placeholder: "ما الذي يغطيه الاعتماد بالضبط" }),
    status: select([["draft", "مسودة (لا تظهر)"], ["published", "منشور"]], { value: a.status || "draft" }),
    sort: input({ type: "number", value: a.sort ?? 100 }),
  };
  const ev = h("input", { type: "checkbox", checked: Boolean(a.evidence_confirmed) });
  const d = dialog(a.id ? "تعديل اعتماد" : "إضافة اعتماد", h("div", {},
    h("div", { class: "row" }, field("الجهة المانحة", f.issuer), field("اسم الشهادة أو الاعتماد", f.title)),
    h("div", { class: "row" }, field("رقم الشهادة", f.number), field("تاريخ الإصدار", f.issued_on), field("تاريخ الانتهاء", f.expires_on)),
    field("رابط التحقق الرسمي", f.verify_url, "صفحة الجهة المانحة التي يتحقق منها الزائر"), field("نطاق الاعتماد", f.scope),
    h("div", { class: "row" }, field("الحالة", f.status), field("الترتيب", f.sort)),
    h("label", { class: "chk" }, ev, "وثيقة الاعتماد الرسمية محفوظة لدينا، والبيانات أعلاه مطابقة لها")), [
    btn("حفظ", async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      body.sort = Number(body.sort || 100); body.evidence_confirmed = ev.checked;
      try { await api(a.id ? `${A}/${a.id}` : A, body, a.id ? "PUT" : "POST"); d.close(); toast("حُفظ"); refresh(); }
      catch (e) { toast(e.message, true); }
    })]);
}
