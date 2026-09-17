// تبويب الطلاب: الإضافة، الاستيراد، القائمة، الرسوم، المعرّفات، الأرشفة
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, textarea, select, btn, empty, badge, line, sub, keyText, toast, dialog,
  showCredentials, confirmAction, notice, brandLogo } from "/shared/js/ui.js";
import { money, csv, fmtDate } from "/shared/js/format.js";
import { A, loadClasses, classOptions, directoryLink } from "./common.js";

export default async function students({ me, refresh }) {
  const [classes, list, archived] = await Promise.all([loadClasses(), api(`${A}/students`), api(`${A}/students?archived=1`)]);

  /* ---- إضافة طالب ---- */
  const f = { name: input(), cls: select(classOptions(classes, "بدون فصل")), gname: input(), gphone: input({ class: "ltr", inputMode: "tel" }),
    fees: input({ type: "checkbox" }) };
  const addPanel = panel("إضافة طالب", null,
    h("div", { class: "row" }, field("اسم الطالب", f.name), field("الفصل", f.cls)),
    h("div", { class: "row" }, field("اسم ولي الأمر", f.gname), field("جوال ولي الأمر", f.gphone)),
    h("label", { class: "f pill" }, f.fees, "تفعيل الرسوم لهذا الطالب"),
    btn("إضافة الطالب", async () => {
      const r = await api(`${A}/students`, { name: f.name.value, class_id: f.cls.value || null, guardian_name: f.gname.value,
        guardian_phone: f.gphone.value, fees_enabled: f.fees.checked });
      showCredentials(`تمت إضافة ${r.name}`, { access_key: r.access_key }, "هذا المعرّف أُنشئ تلقائيًا. سلّمه لولي الأمر ليفتح صفحة ابنه ويدفع الرسوم.");
      refresh();
    }));

  /* ---- استيراد ---- */
  const bulk = textarea({ rows: 4, placeholder: "عبدالرحمن سالم، سالم أحمد، 0550000010\nرغد سالم، سالم أحمد، 0550000010" });
  const bulkCls = select(classOptions(classes, "بدون فصل"));
  const importPanel = panel("استيراد من Excel", null,
    sub("انسخ الأعمدة من Excel بهذا الترتيب: اسم الطالب، اسم ولي الأمر، الجوال. كل طالب في سطر. الاستيراد يتم كاملًا أو لا يتم."),
    field("الفصل", bulkCls), bulk,
    h("div", { class: "spaced" }, btn("استيراد", async () => {
      const rows = bulk.value.split(/\r?\n/).map((l) => l.split(/[,،\t]/).map((x) => x.trim())).filter((p) => p[0]);
      if (!rows.length) return toast("الصق أسماء الطلاب أولًا", true);
      const payload = rows.map(([name, guardian_name, guardian_phone]) => ({ name, guardian_name: guardian_name || null,
        guardian_phone: (guardian_phone || "").replace(/[^\d+ ]/g, "") || null, class_id: bulkCls.value || null }));
      if (!confirmAction(`استيراد ${payload.length} طالب؟`)) return;
      const r = await api(`${A}/students/import`, { students: payload });
      toast(`تم استيراد ${r.length} طالب مع معرّفاتهم`);
      refresh();
    }, "soft")));

  /* ---- القائمة ---- */
  const q = input({ placeholder: "بحث بالاسم أو المعرّف", type: "search" });
  const filter = select(classOptions(classes, "كل الفصول"));
  const box = h("div");
  const draw = () => {
    const term = q.value.trim().toUpperCase();
    const rows = list.filter((s) => (!term || s.name.toUpperCase().includes(term) || s.access_key.includes(term))
      && (!filter.value || String(s.class_id) === filter.value));
    mount(box, rows.length ? rows.map((s) => row(s)) : empty("لا يوجد طلاب."));
  };
  const row = (s) => {
    const feeBadge = !s.fees_enabled ? null
      : s.fees.status === "paid" ? badge("مسدد الرسوم")
      : s.fees.status === "unpaid" ? badge(`لم يسدد — ${money(s.fees.remaining)}`, "red") : badge("لا توجد فواتير", "gray");
    const sw = h("button", { class: "switch", role: "switch", type: "button", "aria-checked": String(s.fees_enabled), "aria-label": `الرسوم للطالب ${s.name}`,
      onclick: async () => {
        try {
          const r = await api(`${A}/students/${s.id}`, { version: s.version, fees_enabled: !s.fees_enabled }, "PATCH");
          s.version = r.version; s.fees_enabled = !s.fees_enabled;
          toast(s.fees_enabled ? "تم تفعيل الرسوم لهذا الطالب" : "تم إيقاف الرسوم لهذا الطالب");
          refresh();
        } catch (e) { toast(e.message, true); if (e.status === 409) refresh(); }
      } });
    return line(
      h("div", {}, h("b", {}, s.name), " ", feeBadge,
        sub(`${s.class_name || "بدون فصل"} — ولي الأمر: ${s.guardian_name || "—"} ${s.guardian_phone || ""}`),
        sub("المعرّف: ", keyText(s.access_key))),
      h("div", { class: "row", style: "flex:none;align-items:center" },
        h("span", { class: "sub", style: "flex:none;min-width:0" }, "الرسوم"), sw,
        btn("بطاقة", () => card(me, s), "ghost sm"),
        btn("تعديل", () => edit(s, classes, refresh), "ghost sm"),
        btn("معرّف جديد", async () => {
          if (!confirmAction(`إنشاء معرّف جديد لـ ${s.name}؟ المعرّف القديم سيتوقف فورًا.`)) return;
          const r = await api(`${A}/students/${s.id}/regenerate-key`, {});
          showCredentials("المعرّف الجديد", { access_key: r.access_key });
          refresh();
        }, "ghost sm")));
  };
  q.addEventListener("input", draw);
  filter.addEventListener("change", draw);
  draw();

  const exportBtn = btn("تصدير المعرّفات", () => csv("معرفات_الطلاب.csv",
    [["الطالب", "الفصل", "ولي الأمر", "الجوال", "المعرّف"], ...list.map((s) => [s.name, s.class_name, s.guardian_name, s.guardian_phone, s.access_key])]), "ghost sm");

  return [
    addPanel, importPanel,
    panel(`الطلاب (${list.length} / ${me.school.max_students})`, exportBtn,
      h("div", { class: "toolbar" }, q, filter),
      sub("زر «الرسوم» يُظهر الفواتير وحالة السداد وزر الدفع في صفحة الطالب. حالة السداد تظهر لصاحب المعرّف فقط."),
      box),
    archived.length ? panel(`الطلاب المؤرشفون (${archived.length})`, null, archived.map((s) => line(
      h("div", { class: "muted-row" }, h("b", {}, s.name), sub(`أُرشف ${fmtDate(s.archived_at)}`)),
      btn("استعادة", async () => { await api(`${A}/students/${s.id}/archive`, { archived: false }); toast("تمت الاستعادة"); refresh(); }, "soft sm")))) : null,
  ];
}

function edit(s, classes, refresh) {
  const f = { name: input({ value: s.name }), cls: select(classOptions(classes, "بدون فصل"), { value: s.class_id ?? "" }),
    gname: input({ value: s.guardian_name || "" }), gphone: input({ class: "ltr", value: s.guardian_phone || "" }) };
  const d = dialog(`تعديل ${s.name}`, h("div", {},
    field("الاسم", f.name), field("الفصل", f.cls), field("ولي الأمر", f.gname), field("الجوال", f.gphone)), [
    btn("حفظ", async () => {
      await api(`${A}/students/${s.id}`, { version: s.version, name: f.name.value, class_id: f.cls.value || null,
        guardian_name: f.gname.value, guardian_phone: f.gphone.value }, "PATCH");
      d.close(); toast("تم الحفظ"); refresh();
    }),
    btn("أرشفة الطالب", async () => {
      if (!confirmAction(`أرشفة ${s.name}؟ يختفي من القوائم وتبقى سجلاته محفوظة ويمكن استعادته.`)) return;
      await api(`${A}/students/${s.id}/archive`, { archived: true });
      d.close(); toast("تمت الأرشفة"); refresh();
    }, "danger"),
  ]);
}

function card(me, s) {
  dialog("بطاقة ولي الأمر", h("div", {},
    h("div", { class: "print-only" }, brandLogo("print-logo", false)),
    h("p", {}, `الطالب: ${s.name}`),
    h("p", {}, `المدرسة: ${me.school.name}`),
    line(h("span", {}, "رابط الصفحة"), keyText(directoryLink(me))),
    line(h("span", {}, "رمز الصفحة"), keyText(me.school.directory_code)),
    line(h("span", {}, "معرّف الطالب"), keyText(s.access_key)),
    notice("افتح الرابط، أدخل رمز الصفحة، اضغط على اسم ابنك ثم أدخل المعرّف. لا تشارك المعرّف مع أحد.", "warn")),
    [btn("طباعة", () => window.print())]);
}
