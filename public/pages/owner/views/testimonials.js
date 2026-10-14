/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, btn, empty, badge, sub, field, input, textarea, select, dialog, toast, confirmAction, notice } from "/shared/js/ui.js";

const T = "/api/owner/testimonials";
const STATUS = { pending: ["بانتظار الاعتماد", "amber"], approved: ["منشور", ""], hidden: ["مخفي", "gray"] };

export default async function testimonials({ refresh }) {
  const rows = await api(T);
  return [
    notice("أضف آراء المدارس الحقيقية فقط بعد موافقتها على النشر. يظهر التقييم في الصفحة الرئيسية عندما تعتمده وتعلّم موافقة المدرسة. إذا لم توجد آراء منشورة، يظهر للزوار بدلها دعوة لمشاركة تجربتهم.", ""),
    panel(`آراء العملاء (${rows.length})`, btn("+ إضافة رأي", () => edit({}, refresh), "sm"),
      rows.length ? h("div", { class: "xb-list" }, rows.map((r) => h("div", { class: "xb-list-row" },
        h("div", {},
          h("b", {}, r.school_name), " ", badge(...STATUS[r.status]), r.consent ? null : [" ", badge("بلا موافقة نشر", "red")],
          sub([r.author_name, r.author_title, r.rating ? `${r.rating} من 5` : null].filter(Boolean).join(" — ")),
          sub(`«${r.body}»`)),
        h("div", { class: "row", style: "flex:none;gap:6px" },
          r.status !== "approved" ? btn("اعتماد ونشر", async () => {
            try { await api(`${T}/${r.id}`, { ...r, status: "approved" }, "PUT"); toast("نُشر الرأي"); refresh(); } catch (e) { toast(e.message, true); }
          }, "sm") : btn("إخفاء", async () => { await api(`${T}/${r.id}`, { ...r, status: "hidden" }, "PUT"); toast("أُخفي"); refresh(); }, "ghost sm"),
          btn("تعديل", () => edit(r, refresh), "ghost sm"),
          btn("حذف", async () => { if (await confirmAction(`حذف رأي ${r.school_name}؟`)) { await api(`${T}/${r.id}`, undefined, "DELETE"); toast("حُذف"); refresh(); } }, "danger sm")))))
        : empty("لا توجد آراء بعد.")),
  ];
}

async function shrink(file) {
  const img = await createImageBitmap(file);
  const s = Math.min(1, 160 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

function edit(r, refresh) {
  const f = {
    school_name: input({ value: r.school_name || "" }), author_name: input({ value: r.author_name || "" }), author_title: input({ value: r.author_title || "", placeholder: "مثل: مدير المدرسة" }),
    body: textarea({ rows: 4, maxLength: 600, value: r.body || "" }),
    rating: select([["", "بدون تقييم"], ["5", "5 من 5"], ["4", "4 من 5"], ["3", "3 من 5"], ["2", "2 من 5"], ["1", "1 من 5"]], { value: r.rating ? String(r.rating) : "" }),
    status: select([["pending", "بانتظار الاعتماد"], ["approved", "منشور"], ["hidden", "مخفي"]], { value: r.status || "pending" }),
    sort: input({ type: "number", value: r.sort ?? 100 }),
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
    h("div", { class: "row" }, field("اسم صاحب الرأي (اختياري)", f.author_name), field("صفته", f.author_title)),
    field("نص الرأي", f.body), h("div", { class: "row" }, field("التقييم", f.rating), field("الحالة", f.status), field("الترتيب", f.sort)),
    h("div", { class: "f" }, h("span", {}, "شعار المدرسة (بإذنها)"), prev, file),
    h("label", { class: "chk" }, consent, "حصلنا على موافقة المدرسة على نشر اسمها ورأيها")), [
    btn("حفظ", async () => {
      const body = { school_name: f.school_name.value, author_name: f.author_name.value, author_title: f.author_title.value, body: f.body.value,
        rating: f.rating.value || null, status: f.status.value, sort: Number(f.sort.value || 100), consent: consent.checked, logo };
      try { await api(r.id ? `${T}/${r.id}` : T, body, r.id ? "PUT" : "POST"); d.close(); toast("حُفظ"); refresh(); }
      catch (e) { toast(e.message, true); }
    })]);
}
