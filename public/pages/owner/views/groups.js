/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, btn, empty, badge, sub, field, input, select, dialog, toast, confirmAction, notice, line, keyText } from "/shared/js/ui.js";
import { fmtDate, money } from "/shared/js/format.js";

const G = "/api/owner/groups";

export default async function groups({ refresh }) {
  const [rows, tenants] = await Promise.all([api(G), api("/api/owner/tenants")]);
  return [
    notice("مجموعة المدارس لباقة «مدار الاحترافية»: إدارة عامة تدخل من رابط /group، تنشئ مدارسها ضمن الحد وتتابع أرقامها، ولكل مدرسة إدارتها الخاصة. تعديل تاريخ الاشتراك مع «تطبيق على المدارس» يجدد اشتراك كل مدارس المجموعة.", ""),
    panel(`مجموعات المدارس (${rows.length})`, btn("+ مجموعة جديدة", () => edit(null, refresh), "sm"),
      rows.length ? h("div", { class: "xb-list" }, rows.map((g) => h("div", { class: "xb-list-row" },
        h("div", {},
          h("b", {}, g.name), " ", h("span", { class: "sub ltr" }, g.id), " ",
          g.status === "active" ? badge("فعالة") : badge("موقوفة", "red"),
          sub(`${g.manager_name}${g.phone ? ` — ${g.phone}` : ""} · المدارس ${g.schools.length} من ${g.max_schools}`
            + `${g.extra_school_price != null ? ` · المدرسة الإضافية ${money(g.extra_school_price, g.currency || "SAR")}` : ""}`
            + `${g.ends_on ? ` · حتى ${fmtDate(g.ends_on)}` : ""}`),
          sub(g.schools.length ? g.schools.map((s) => `${s.name} (${s.id})`).join("، ") : "لا توجد مدارس بعد"),
          sub(g.last_login_at ? `آخر دخول للإدارة العامة: ${fmtDate(g.last_login_at)}` : "لم تدخل الإدارة العامة بعد")),
        h("div", { class: "row", style: "flex:none;gap:6px;flex-wrap:wrap" },
          btn("تعديل", () => edit(g, refresh), "ghost sm"),
          btn("ضم مدرسة", () => attach(g, tenants, refresh), "ghost sm"),
          g.schools.length ? btn("إخراج مدرسة", () => detach(g, refresh), "ghost sm") : null,
          btn("كلمة مرور جديدة", async () => {
            if (!(await confirmAction(`إصدار كلمة مرور مؤقتة جديدة لإدارة ${g.name}؟`))) return;
            try { creds(await api(`${G}/${g.id}/reset-password`, {}), g.name); } catch (e) { toast(e.message, true); }
          }, "ghost sm")))))
        : empty("لا توجد مجموعات بعد.")),
  ];
}

function creds(r, name) {
  const rows = [["المجموعة", name], ["رابط مركز التحكم", r.link], ["رمز المجموعة", r.credentials.group],
    ["اسم المستخدم", r.credentials.username], ["كلمة المرور المؤقتة", r.credentials.password]];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  dialog("بيانات دخول الإدارة العامة", h("div", {},
    notice("انسخها الآن وسلّمها للمدير العام. كلمة المرور لن تظهر مرة أخرى.", "warn"),
    rows.map(([k, v]) => line(h("span", { class: "sub" }, k), keyText(v)))),
  [btn("نسخ", async () => { await navigator.clipboard.writeText(text); toast("تم النسخ"); })]);
}

function edit(g, refresh) {
  const f = {
    id: input({ class: "ltr", value: g?.id || "", disabled: Boolean(g), placeholder: "nokhba" }),
    name: input({ value: g?.name || "" }),
    manager_name: input({ value: g?.manager_name || "" }),
    phone: input({ class: "ltr", value: g?.phone || "" }),
    max_schools: input({ type: "number", min: 1, max: 100, value: g?.max_schools ?? 3 }),
    extra_school_price: input({ type: "number", min: 0, value: g?.extra_school_price ?? "", placeholder: "من الباقة" }),
    ends_on: input({ type: "date", value: g?.ends_on?.slice(0, 10) || "" }),
    status: select([["active", "فعالة"], ["suspended", "موقوفة"]], { value: g?.status || "active" }),
  };
  const apply = h("input", { type: "checkbox" });
  const d = dialog(g ? `تعديل ${g.name}` : "مجموعة مدارس جديدة", h("div", {},
    h("div", { class: "row" }, field("رمز المجموعة", f.id), field("اسم المجموعة", f.name)),
    h("div", { class: "row" }, field("المدير العام", f.manager_name), field("الجوال", f.phone)),
    h("div", { class: "row" }, field("حد المدارس", f.max_schools), field("سعر المدرسة الإضافية", f.extra_school_price)),
    h("div", { class: "row" }, field("الاشتراك حتى", f.ends_on), g ? field("الحالة", f.status) : null),
    g ? h("label", { class: "chk" }, apply, "تطبيق تاريخ الاشتراك على كل مدارس المجموعة الآن") : null), [
    btn("حفظ", async () => {
      const body = { name: f.name.value, manager_name: f.manager_name.value, phone: f.phone.value, max_schools: Number(f.max_schools.value),
        extra_school_price: f.extra_school_price.value, ends_on: f.ends_on.value || null };
      try {
        if (g) {
          const r = await api(`${G}/${g.id}`, { ...body, status: f.status.value, apply_to_schools: apply.checked }, "PATCH");
          toast(r.synced ? `حُفظ وجُدد اشتراك ${r.synced} مدارس` : "حُفظ");
        } else creds(await api(G, { ...body, id: f.id.value }), body.name);
        d.close(); refresh();
      } catch (e) { toast(e.message, true); }
    })]);
}

function attach(g, tenants, refresh) {
  const free = tenants.filter((t) => t.status !== "archived" && !g.schools.some((s) => s.id === t.id));
  const pick = select(free.map((t) => [t.id, `${t.name} (${t.id})`]));
  const sync = h("input", { type: "checkbox", checked: true });
  const d = dialog(`ضم مدرسة إلى ${g.name}`, h("div", {},
    free.length ? field("المدرسة", pick) : empty("لا توجد مدارس متاحة"),
    h("label", { class: "chk" }, sync, "نقل المدرسة إلى اشتراك المجموعة")), [
    btn("ضم", async () => {
      try { await api(`${G}/${g.id}/schools`, { tenant_id: pick.value, apply_subscription: sync.checked }); d.close(); toast("ضُمت المدرسة"); refresh(); }
      catch (e) { toast(e.message, true); }
    })]);
}

function detach(g, refresh) {
  const pick = select(g.schools.map((s) => [s.id, `${s.name} (${s.id})`]));
  const d = dialog(`إخراج مدرسة من ${g.name}`, h("div", {},
    field("المدرسة", pick), sub("تبقى المدرسة وبياناتها واشتراكها كما هي، وتخرج فقط من إدارة المجموعة.")), [
    btn("إخراج", async () => {
      try { await api(`${G}/${g.id}/schools/${pick.value}`, undefined, "DELETE"); d.close(); toast("أُخرجت المدرسة"); refresh(); }
      catch (e) { toast(e.message, true); }
    }, "danger")]);
}
