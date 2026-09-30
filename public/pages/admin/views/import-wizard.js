// معالج استيراد موحّد يُفتح كنافذة من داخل أي قسم (الطلاب، المعلمون...) بدل الإعدادات
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, sub, notice, badge, dialog, toast, keyText, line } from "../../shared/js/ui.js";
import { parseCsv } from "../../shared/js/format.js";
import { A } from "./common.js";

/** رابط تنزيل نموذج الاستيراد الجاهز لنوع بيانات معيّن (يُستخدم مباشرة في href) */
export const importTemplateUrl = (kind) => `${A}/import/template/${kind}`;

/**
 * يفتح نافذة استيراد لنوع بيانات ثابت (kind)، بدون قائمة اختيار الأنواع —
 * القسم اللي فتحها هو اللي يحدد النوع (استيراد الطلاب من صفحة الطلاب مثلًا).
 * الخطوات: تحميل ملف → فحص ومعاينة → استيراد → نتيجة.
 */
export async function openImportWizard(kind, { onDone } = {}) {
  const kinds = await api(`${A}/import/kinds`);
  const info = kinds.find((k) => k.key === kind);
  if (!info) return toast("هذا النوع غير مدعوم للاستيراد حاليًا");

  const file = input({ type: "file", accept: ".csv,text/csv" });
  const preview = h("div");
  const msg = h("div");
  let parsed = null;

  file.addEventListener("change", async () => {
    mount(msg); mount(preview);
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return mount(msg, notice("حجم الملف أكبر من 2 ميجابايت", "err"));
    const text = await f.text();
    const data = parseCsv(text);
    if (!data.rows.length) return mount(msg, notice("الملف فارغ أو غير مقروء. استخدم القالب أدناه.", "err"));
    parsed = data.rows;
    const headers = data.headers;
    mount(preview,
      notice(`الملف فيه ${data.rows.length} سطر. راجعها قبل تأكيد الاستيراد.`, ""),
      h("div", { class: "scroll" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, headers.map((x) => h("th", {}, x)))),
        h("tbody", {}, data.rows.slice(0, 10).map((row) => h("tr", {}, headers.map((x) => h("td", {}, row[x] || "—"))))))),
      data.rows.length > 10 ? sub(`تُعرض أول 10 أسطر من ${data.rows.length}.`) : null);
  });

  const body = h("div", {},
    sub("١) نزّل النموذج وعبّئه في Excel، احفظه CSV.   ٢) ارفعه هنا وراجع المعاينة.   ٣) أكّد الاستيراد."),
    h("div", { class: "pill" }, "الأعمدة: ",
      ...info.columns.map((c) => badge(c.header + (c.required ? " (مطلوب)" : ""), c.required ? "" : "gray"))),
    h("div", { class: "row" },
      btn("تنزيل النموذج", () => { location.href = importTemplateUrl(kind); }, "soft"),
      field("اختر الملف", file)),
    preview, msg);

  const d = dialog(`استيراد ${info.name}`, body,
    [btn("تأكيد الاستيراد", async () => {
      mount(msg);
      if (!parsed) return mount(msg, notice("اختر ملفًا أولًا", "err"));
      try {
        const r = await api(`${A}/import/${kind}`, { rows: parsed, dry_run: false });
        mount(preview);
        file.value = ""; parsed = null;
        d.close();
        showResult(kind, r);
        onDone?.();
      } catch (e) {
        const rows = e.errors || [];
        mount(msg, notice(e.message, "err"),
          rows.length ? h("ul", { class: "small" }, rows.slice(0, 20).map((x) => h("li", {},
            x.row ? `السطر ${x.row}: ${x.message}` : x.message))) : null);
      }
    })]);
}

/** نتيجة الاستيراد: عدد الناجح، وبيانات دخول للمعلمين إن وُجدت */
function showResult(kind, r) {
  if (kind === "teachers" && r.rows?.length) return showCredentialsList(r.rows);
  toast(`تم استيراد ${r.created} سطرًا بنجاح`);
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

/** زرين جاهزين لأعلى صفحة أي قسم: [الحصول على ملف الاستيراد] [استيراد ...] */
export function importButtons(kind, label, { onDone } = {}) {
  return h("div", { class: "row", style: "flex:none" },
    h("a", { class: "btn soft", href: importTemplateUrl(kind) }, "الحصول على ملف الاستيراد"),
    btn(`استيراد ${label}`, () => openImportWizard(kind, { onDone }), "soft"));
}
