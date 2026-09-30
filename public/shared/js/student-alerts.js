// تنبيهات الطالب: بطاقة العرض ونافذة الإضافة (تستخدمها الإدارة والمعلم وصفحة ولي الأمر)
import { h } from "./dom.js";
import { field, input, select, textarea, btn, toast, dialog, sub } from "./ui.js";
import { fmtDateTime } from "./format.js";

export const ALERT_KINDS = { note: "ملاحظة", attendance: "الحضور", behavior: "السلوك", academic: "المستوى الدراسي", health: "صحي", praise: "ثناء وتميّز" };
export const ALERT_LEVELS = { info: "عادي", warning: "تنبيه", urgent: "عاجل", positive: "إيجابي" };

/** بطاقة تنبيه. onAck لولي الأمر (تأكيد الاطلاع)، onDelete للإدارة أو كاتب التنبيه */
export function alertCard(a, { onAck = null, onDelete = null, staff = false } = {}) {
  return h("div", { class: `sa-card lv-${a.level}` },
    h("div", { class: "sa-top" },
      h("span", { class: "sa-kind" }, ALERT_KINDS[a.kind] || "ملاحظة"),
      a.level !== "info" ? h("span", { class: "sa-level" }, ALERT_LEVELS[a.level]) : null,
      h("small", {}, fmtDateTime(a.created_at))),
    h("b", { class: "sa-title" }, a.title),
    a.body ? h("p", { class: "sa-body" }, a.body) : null,
    h("div", { class: "sa-foot" },
      staff ? h("small", {}, [a.created_by ? `بواسطة ${a.created_by}` : null, a.for_parent ? "يظهر لولي الأمر" : "داخلي فقط",
        a.for_parent ? (a.acknowledged_at ? "✓ اطّلع ولي الأمر" : "لم يطّلع بعد") : null].filter(Boolean).join(" · ")) : null,
      onAck && !a.acknowledged_at ? btn("تم الاطلاع", async (e) => {
        const el = e.currentTarget;   // يصبح null بعد أول await
        el.disabled = true;
        try { await onAck(a); a.acknowledged_at = new Date().toISOString(); el.replaceWith(h("small", { class: "ok-text" }, "✓ شكرًا، تم تأكيد الاطلاع")); }
        catch (err) { toast(err.message, true); el.disabled = false; }
      }, "soft sm") : null,
      onAck && a.acknowledged_at ? h("small", { class: "ok-text" }, "✓ تم الاطلاع") : null,
      onDelete ? btn("حذف", () => onDelete(a), "ghost sm") : null));
}

/** نافذة إضافة تنبيه لطالب. save(body) ترسل للخادم */
export function alertDialog(studentName, save, preset = {}) {
  const kind = select(Object.entries(ALERT_KINDS), { value: preset.kind || "note" });
  const level = select(Object.entries(ALERT_LEVELS), { value: preset.level || "info" });
  const title = input({ placeholder: "مثال: تكرار التأخر الصباحي", value: preset.title || "" });
  const body = textarea({ rows: 3, placeholder: "تفاصيل تساعد ولي الأمر (اختياري)" });
  if (preset.body) body.value = preset.body;
  const parent = h("input", { type: "checkbox", checked: preset.for_parent ?? true });
  // اختيار «ثناء» يجعل المستوى إيجابيًا تلقائيًا
  kind.addEventListener("change", () => { if (kind.value === "praise") level.value = "positive"; });
  const d = dialog(`تنبيه للطالب: ${studentName}`, h("div", {},
    h("div", { class: "form-grid" }, field("النوع", kind), field("الأهمية", level)),
    field("العنوان *", title), field("التفاصيل", body),
    h("label", { class: "check-line" }, parent, " يظهر لولي الأمر في ملف الطالب"),
    sub("إن لم تحدد إظهاره يبقى ملاحظة داخلية للإدارة والمعلمين.")),
  [btn("حفظ التنبيه", async () => {
    if (title.value.trim().length < 2) return toast("اكتب عنوان التنبيه", true);
    try {
      await save({ kind: kind.value, level: level.value, title: title.value.trim(), body: body.value.trim() || null, for_parent: parent.checked });
      d.close(); toast(parent.checked ? "حُفظ التنبيه وسيظهر لولي الأمر" : "حُفظت الملاحظة الداخلية");
    } catch (e) { toast(e.message, true); }
  })]);
  title.focus();
  return d;
}
