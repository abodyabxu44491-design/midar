// تبويب الطلاب: الإضافة، الاستيراد، القائمة، الرسوم، المعرّفات، الأرشفة
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, textarea, select, btn, empty, badge, line, sub, keyText, toast, dialog,
  showCredentials, confirmAction, notice, brandLogo } from "/shared/js/ui.js";
import { money, csv, fmtDate } from "/shared/js/format.js";
import { waButton, messageVars } from "/shared/js/whatsapp.js";
import { A, loadClasses, classOptions, directoryLink, optional } from "./common.js";
import { api as call } from "/shared/js/api.js";

export default async function students({ me, refresh }) {
  const [classes, list, inactive, templates] = await Promise.all([
    loadClasses(), api(`${A}/students`), api(`${A}/students?status=inactive`), optional(api(`${A}/messaging/templates`), null)]);

  /* ---- إضافة طالب ---- */
  const lastClass = localStorage.getItem("midar_last_class") || "";
  const f = { name: input(), cls: select(classOptions(classes, "بدون فصل"), { value: lastClass }),
    gname: input({ placeholder: "يُملأ تلقائيًا من اسم الطالب" }), gphone: input({ class: "ltr", inputMode: "tel" }),
    fees: input({ type: "checkbox" }) };
  const hint = h("div");

  // اسم ولي الأمر من اسم الطالب، ما لم يكتبه المستخدم بنفسه
  let guardianTouched = false;
  f.gname.addEventListener("input", () => { guardianTouched = f.gname.value.trim().length > 0; });
  f.name.addEventListener("input", () => {
    if (guardianTouched) return;
    const parts = f.name.value.trim().split(/\s+/).filter(Boolean);
    f.gname.value = parts.length >= 3 ? parts.slice(1).join(" ") : "";
  });

  // جوال ولي الأمر: توحيد الصيغة + كشف الإخوة المسجلين
  f.gphone.addEventListener("blur", async () => {
    const raw = f.gphone.value.trim();
    if (!raw) return mount(hint);
    try {
      const r = await api(`${A}/students/guardian?phone=${encodeURIComponent(raw)}`);
      if (r.phone) f.gphone.value = r.phone;
      if (r.guardian_name && !guardianTouched) f.gname.value = r.guardian_name;
      mount(hint, r.siblings.length
        ? notice(`ولي الأمر مسجل مسبقًا: ${r.guardian_name || "—"} — إخوة: ${r.siblings.map((x) => x.name).join("، ")}`, "")
        : null);
    } catch { mount(hint); }
  });
  const addPanel = panel("إضافة طالب", null,
    h("div", { class: "row" }, field("اسم الطالب", f.name), field("الفصل", f.cls)),
    h("div", { class: "row" }, field("اسم ولي الأمر", f.gname), field("جوال ولي الأمر", f.gphone)),
    hint,
    h("label", { class: "f pill" }, f.fees, "تفعيل الرسوم لهذا الطالب"),
    btn("إضافة الطالب", async () => {
      const r = await api(`${A}/students`, { name: f.name.value, class_id: f.cls.value || null, guardian_name: f.gname.value,
        guardian_phone: f.gphone.value, fees_enabled: f.fees.checked });
      localStorage.setItem("midar_last_class", f.cls.value || "");   // الفصل يبقى مختارًا للطالب التالي
      showCredentials(`تمت إضافة ${r.name}`, { access_key: r.access_key },
        `ولي الأمر: ${r.guardian_name || "—"} — سلّم المعرّف له.`);
      refresh();
    }));

  /* ---- استيراد ---- */
  const bulk = textarea({ rows: 4, placeholder: "اسم الطالب، اسم ولي الأمر، رقم الجوال\nاسم الطالب، اسم ولي الأمر، رقم الجوال" });
  const bulkCls = select(classOptions(classes, "بدون فصل"));
  const importPanel = panel("استيراد من Excel", null,
    sub("انسخ من Excel: اسم الطالب، اسم ولي الأمر، الجوال — كل طالب في سطر."),
    sub("أو من الإعدادات ← استيراد البيانات: نزّل قالبًا جاهزًا وارفعه كملف."),
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
  const q = input({ placeholder: "بحث بالاسم أو المعرّف أو جوال ولي الأمر", type: "search" });
  const filter = select(classOptions(classes, "كل الفصول"));
  const feeFilter = select([["", "كل الحالات المالية"], ["unpaid", "عليه رسوم متبقية"], ["paid", "مسدد"], ["off", "الرسوم موقوفة"]]);
  const count = h("span", { class: "sub" });
  const box = h("div");
  const selected = new Set();
  const bulkBar = h("div");
  let visible = [];

  // شريط الإجراءات الجماعية: يظهر عند تحديد طالب أو أكثر
  const drawBulk = () => {
    if (!selected.size) return mount(bulkBar);
    const chosen = () => [...selected];
    mount(bulkBar, h("div", { class: "bulk-bar" },
      h("b", {}, `${selected.size} محدد`),
      btn("نقل لشعبة", () => moveDialog(chosen(), classes, refresh), "sm"),
      btn("تفعيل الرسوم", () => runBulk({ ids: chosen(), action: "fees", fees_enabled: true }, refresh), "soft sm"),
      btn("إيقاف الرسوم", () => runBulk({ ids: chosen(), action: "fees", fees_enabled: false }, refresh), "soft sm"),
      btn("تغيير الحالة", () => statusBulkDialog(chosen(), refresh), "danger sm"),
      btn("تصدير المحدد", () => exportStudents(list.filter((x) => selected.has(x.id))), "ghost sm"),
      btn("إلغاء التحديد", () => { selected.clear(); draw(); }, "ghost sm")));
  };

  const selectAll = input({ type: "checkbox", "aria-label": "تحديد كل المعروض" });
  selectAll.addEventListener("change", () => {
    for (const s2 of visible) { if (selectAll.checked) selected.add(s2.id); else selected.delete(s2.id); }
    draw();
  });

  const draw = () => {
    const term = q.value.trim().toUpperCase();
    const rows = list.filter((s) => {
      const matches = !term || s.name.toUpperCase().includes(term) || s.access_key.includes(term)
        || String(s.guardian_phone || "").includes(term) || String(s.guardian_name || "").toUpperCase().includes(term);
      const inClass = !filter.value || String(s.class_id) === filter.value;
      const fee = !feeFilter.value
        || (feeFilter.value === "off" && !s.fees_enabled)
        || (feeFilter.value === "paid" && s.fees_enabled && s.fees?.status === "paid")
        || (feeFilter.value === "unpaid" && s.fees_enabled && s.fees?.status === "unpaid");
      return matches && inClass && fee;
    });
    visible = rows;
    count.textContent = `${rows.length} من ${list.length}`;
    mount(box, rows.length
      ? [h("div", { class: "student-row head" },
          h("div", { class: "s-pick" }, selectAll),
          h("div", { class: "s-name" }, sub("تحديد الكل المعروض"))),
         ...rows.map((s2) => row(s2))]
      : empty("لا يوجد طالب مطابق."));
    drawBulk();
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
    // صف الطالب: أعمدة ثابتة — تحديد، الاسم، الفصل، ولي الأمر، المعرّف، الإجراءات
    const pick = input({ type: "checkbox", "aria-label": `تحديد ${s.name}` });
    pick.checked = selected.has(s.id);
    pick.addEventListener("change", () => {
      if (pick.checked) selected.add(s.id); else selected.delete(s.id);
      drawBulk();
    });
    return h("div", { class: "student-row" },
      h("div", { class: "s-pick" }, pick),
      h("div", { class: "s-name" }, h("b", {}, s.name), " ", feeBadge,
        s.status !== "active" ? statusBadge(s.status) : null),
      h("div", { class: "s-cell" }, h("span", { class: "s-label" }, "الفصل"), h("span", {}, s.class_name || "بدون فصل")),
      h("div", { class: "s-cell" }, h("span", { class: "s-label" }, "ولي الأمر"),
        h("span", {}, s.guardian_name || "—"),
        s.guardian_phone ? h("span", { class: "ltr small muted" }, s.guardian_phone) : null),
      h("div", { class: "s-cell" }, h("span", { class: "s-label" }, "المعرّف"), keyText(s.access_key)),
      h("div", { class: "s-actions" },
        h("span", { class: "s-label" }, "الرسوم"), sw,
        templates && waButton({ phone: s.guardian_phone, template: templates.general, countryCode: templates.country_code,
          vars: messageVars({ student: s, school: me.school.name, fees: s.fees, link: directoryLink(me) }), label: "واتساب" }),
        btn("إدارة", () => manage(s, classes, me, refresh), "ghost sm")));
  };
  q.addEventListener("input", draw);
  feeFilter.addEventListener("change", draw);
  filter.addEventListener("change", draw);
  draw();

  const exportBtn = btn("تصدير المعرّفات", () => csv("معرفات_الطلاب.csv",
    [["الطالب", "الفصل", "ولي الأمر", "الجوال", "المعرّف"], ...list.map((s) => [s.name, s.class_name, s.guardian_name, s.guardian_phone, s.access_key])]), "ghost sm");

  for (const el of [f.name, f.gname, f.gphone]) {
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") addPanel.querySelector("button.btn").click(); });
  }

  return [
    addPanel, importPanel,
    panel(`الطلاب (${list.length} / ${me.school.max_students})`, exportBtn,
      h("div", { class: "row" }, q, filter, feeFilter),
      h("div", { class: "toolbar" }, count),
      bulkBar,
      sub("تفعيل الرسوم يُظهر الفواتير والسداد في ملف الطالب."),
      box),
    inactive.length ? panel(`طلاب خارج القيد (${inactive.length})`, null,
      sub("سجلاتهم محفوظة، ولا يظهرون في القوائم."),
      inactive.map((s) => line(
        h("div", { class: "muted-row" }, h("b", {}, s.name), " ", statusBadge(s.status),
          sub(`${s.class_name || "بدون فصل"}${s.status_changed_at ? ` — منذ ${fmtDate(s.status_changed_at)}` : ""}`),
          s.status_note ? sub(s.status_note) : null),
        btn("إعادة للقيد", async () => {
          await api(`${A}/students/${s.id}/status`, { status: "active", note: null });
          toast("عاد الطالب على رأس القيد"); refresh();
        }, "soft sm")))) : null,
  ];
}

// نافذة واحدة لكل ما يخص الطالب: البيانات، البطاقة، المعرّف، الحالة
function manage(s, classes, me, refresh) {
  const f = { name: input({ value: s.name }), cls: select(classOptions(classes, "بدون فصل"), { value: s.class_id ?? "" }),
    gname: input({ value: s.guardian_name || "" }), gphone: input({ class: "ltr", value: s.guardian_phone || "" }) };
  const d = dialog(s.name, h("div", {},
    field("الاسم", f.name), field("الفصل", f.cls), field("ولي الأمر", f.gname), field("الجوال", f.gphone),
    line(h("span", { class: "sub" }, "معرّف الطالب"), keyText(s.access_key)),
    h("h3", { class: "sec-title" }, "إجراءات"),
    h("div", { class: "row", style: "justify-content:flex-start" },
      btn("بطاقة ولي الأمر", () => { d.close(); card(me, s); }, "ghost sm"),
      btn("معرّف جديد", async () => {
        if (!confirmAction("المعرّف القديم سيتوقف فورًا. متابعة؟")) return;
        const r = await api(`${A}/students/${s.id}/regenerate-key`, {});
        d.close();
        showCredentials("المعرّف الجديد", { access_key: r.access_key });
        refresh();
      }, "ghost sm"),
      btn("تغيير الحالة", () => { d.close(); statusDialog(s, refresh); }, "danger sm"))),
  [btn("حفظ", async () => {
    await api(`${A}/students/${s.id}`, { version: s.version, name: f.name.value, class_id: f.cls.value || null,
      guardian_name: f.gname.value, guardian_phone: f.gphone.value }, "PATCH");
    d.close(); toast("تم الحفظ"); refresh();
  })]);
}

export const STATUS_LABEL = {
  active: "على رأس القيد", graduated: "متخرج", transferred: "منقول لمدرسة أخرى", withdrawn: "منسحب",
};
const STATUS_TONE = { active: "", graduated: "", transferred: "gray", withdrawn: "red" };
export const statusBadge = (status) => badge(STATUS_LABEL[status] || status, STATUS_TONE[status] ?? "gray");

// تغيير حالة الطالب: تخرّج، نقل لمدرسة أخرى، انسحاب، أو إعادة للقيد
function statusDialog(s, refresh) {
  const status = select(Object.entries(STATUS_LABEL), { value: s.status || "active" });
  const note = input({ placeholder: "السبب أو الملاحظة (اختياري)", value: s.status_note || "" });
  const d = dialog(`حالة الطالب: ${s.name}`, h("div", {},
    sub("خارج القيد: لا يظهر في القوائم ولا يُفتح ملفه، وتبقى سجلاته."),
    field("الحالة", status), field("ملاحظة", note)),
  [btn("حفظ الحالة", async () => {
    await api(`${A}/students/${s.id}/status`, { status: status.value, note: note.value || null });
    d.close(); toast("تم تحديث الحالة"); refresh();
  })]);
}

function card(me, s) {
  dialog("بطاقة ولي الأمر", h("div", {},
    h("div", { class: "print-only" }, brandLogo("print-logo", false)),
    h("p", {}, `الطالب: ${s.name}`),
    h("p", {}, `المدرسة: ${me.school.name}`),
    line(h("span", {}, "رابط الصفحة"), keyText(directoryLink(me))),
    line(h("span", {}, "رمز الصفحة"), keyText(me.school.directory_code)),
    line(h("span", {}, "معرّف الطالب"), keyText(s.access_key)),
    notice("افتح الرابط، أدخل رمز الصفحة، ثم اسم ابنك ومعرّفه. لا تشارك المعرّف.", "warn")),
    [btn("طباعة", () => window.print())]);
}


/* ---------- الإجراءات الجماعية ---------- */
async function runBulk(body, refresh) {
  const r = await api(`${A}/students/bulk`, body);
  toast(`تم على ${r.done} طالبًا`);
  refresh();
}

function moveDialog(ids, classes, refresh) {
  const cls = select(classOptions(classes, "بدون شعبة"));
  const d = dialog(`نقل ${ids.length} طالبًا`, h("div", {},
    sub("ينتقل الطلاب المحددون إلى الشعبة المختارة."), field("الشعبة", cls)),
  [btn("نقل", async () => {
    await runBulk({ ids, action: "move_class", class_id: cls.value || null }, refresh);
    d.close();
  })]);
}

function statusBulkDialog(ids, refresh) {
  const status = select(Object.entries(STATUS_LABEL));
  const note = input({ placeholder: "ملاحظة (اختياري)" });
  const d = dialog(`تغيير حالة ${ids.length} طالبًا`, h("div", {},
    sub("الطالب خارج القيد يختفي من القوائم وتبقى سجلاته."),
    field("الحالة", status), field("ملاحظة", note)),
  [btn("حفظ", async () => {
    await runBulk({ ids, action: "status", status: status.value, note: note.value || null }, refresh);
    d.close();
  }, "danger")]);
}

function exportStudents(rows) {
  csv("الطلاب.csv", [
    ["الاسم", "الفصل", "ولي الأمر", "الجوال", "المعرّف", "الرسوم", "الحالة"],
    ...rows.map((s) => [s.name, s.class_name || "", s.guardian_name || "", s.guardian_phone || "",
      s.access_key, s.fees_enabled ? "مفعّلة" : "موقوفة", STATUS_LABEL[s.status] || s.status]),
  ]);
}
