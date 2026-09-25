// تبويب الطلاب: الإضافة، الاستيراد، القائمة، الرسوم، المعرّفات، الأرشفة
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, textarea, select, btn, empty, badge, line, sub, keyText, toast, dialog,
  showCredentials, confirmAction, notice, brandLogo, skeleton } from "../../shared/js/ui.js";
import { money, csv, fmtDate } from "../../shared/js/format.js";
import { waButton, messageVars } from "../../shared/js/whatsapp.js";
import { A, loadClasses, classOptions, directoryLink, optional } from "./common.js";
import { api as call } from "../../shared/js/api.js";

export default async function students({ me, refresh }) {
  // لا تنزيل لقائمة كل الطلاب: أعداد كل شعبة من ملخص صغير، والقائمة صفحة بعد صفحة من الخادم
  const PAGE = 100;
  const [classes, summary, inactiveSummary, templates, setup] = await Promise.all([
    loadClasses(), api(`${A}/students?summary=1`), api(`${A}/students?summary=1&status=inactive`),
    optional(api(`${A}/messaging/templates`), null), api(`${A}/setup`)]);
  const perClass = new Map(summary.map((r) => [Number(r.class_id), r.n]));
  const totalActive = summary.reduce((a, r) => a + r.n, 0);
  const inactiveCount = inactiveSummary.reduce((a, r) => a + r.n, 0);
  let list = [];            // الصفوف المحمّلة حاليًا فقط
  const stages = setup.structure.stages;

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
  // متصفح الصفوف: مرحلة ← صف ← شعبة. يبدأ بالمراحل ولا يعرض كل الطلاب دفعة واحدة.
  const navBox = h("div");
  let scope = { level: stages.length ? "stages" : "all", stage: null, grade: null };

  const countIn = (ids) => ids.reduce((a, id) => a + (perClass.get(Number(id)) || 0), 0);

  const drawNav = () => {
    if (scope.level === "all") {
      return mount(navBox, stages.length
        ? h("div", { class: "spaced" }, btn("تصفح حسب الصفوف", () => { scope = { level: "stages" }; drawNav(); draw(); }, "ghost sm"))
        : null);
    }

    if (scope.level === "stages") {
      mount(navBox,
        stages.length ? h("div", { class: "menu-grid" }, stages.map((st) => {
          const ids = st.grades.flatMap((g) => g.sections.map((c) => Number(c.id)));
          return h("button", { class: "menu-card", type: "button", onclick: () => { scope = { level: "grades", stage: st }; drawNav(); } },
            h("span", { class: "menu-text" },
              h("span", { class: "menu-name" }, st.name),
              h("span", { class: "menu-note" }, `${st.grades.length} صفوف — ${countIn(ids)} طالب`)));
        })) : empty("أضف الصفوف من «الهيكل الأكاديمي»."),
        h("div", { class: "spaced" }, btn("عرض كل الطلاب", () => { scope = { level: "all" }; filter.value = ""; drawNav(); draw(); }, "ghost sm")));
      return;
    }

    if (scope.level === "grades") {
      mount(navBox,
        h("div", { class: "section-head" }, btn("رجوع", () => { scope = { level: "stages" }; drawNav(); }, "ghost sm"),
          h("h2", {}, scope.stage.name)),
        scope.stage.grades.length ? h("div", { class: "menu-grid" }, scope.stage.grades.map((g) => {
          const ids = g.sections.map((c) => Number(c.id));
          return h("button", { class: "menu-card", type: "button", onclick: () => { scope = { ...scope, level: "sections", grade: g }; drawNav(); } },
            h("span", { class: "menu-text" },
              h("span", { class: "menu-name" }, g.name),
              h("span", { class: "menu-note" }, `${g.sections.length} شعب — ${countIn(ids)} طالب`)));
        })) : empty("لا توجد صفوف في هذه المرحلة."));
      return;
    }

    // شعب الصف: اختيار شعبة يعرض طلابها
    mount(navBox,
      h("div", { class: "section-head" },
        btn("رجوع", () => { scope = { level: "grades", stage: scope.stage }; drawNav(); }, "ghost sm"),
        h("h2", {}, `${scope.stage.name} — ${scope.grade.name}`)),
      h("div", { class: "sections" },
        h("button", { class: `section-chip ${!filter.value ? "on" : ""}`, type: "button",
          onclick: () => { filter.value = ""; drawNav(); draw(); } }, "كل الشعب"),
        ...scope.grade.sections.map((c) => h("button", {
          class: `section-chip ${String(filter.value) === String(c.id) ? "on" : ""}`, type: "button",
          onclick: () => { filter.value = String(c.id); drawNav(); draw(); },
        }, c.name, h("span", { class: "small muted" }, ` ${countIn([Number(c.id)])}`)))));
  };
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
      btn("إلغاء التحديد", () => { selected.clear(); redraw(); }, "ghost sm")));
  };

  const selectAll = input({ type: "checkbox", "aria-label": "تحديد كل المعروض" });
  selectAll.addEventListener("change", () => {
    for (const s2 of list) { if (selectAll.checked) selected.add(s2.id); else selected.delete(s2.id); }
    redraw();
  });

  // التحميل من الخادم: البحث والتصفية هناك، و100 طالب في كل صفحة، والمزيد عند الوصول لآخر القائمة
  let total = 0;
  let seq = 0;
  let loadingMore = false;
  const sentinel = h("div", { class: "load-more" });
  const query = (offset) => {
    const term = q.value.trim();
    const scopeIds = scope.level === "sections" ? scope.grade.sections.map((c) => Number(c.id))
      : scope.level === "grades" ? scope.stage.grades.flatMap((g) => g.sections.map((c) => Number(c.id)))
      : null;
    const p = new URLSearchParams({ limit: PAGE, offset });
    if (term) p.set("q", term);
    if (filter.value) p.set("class_id", filter.value);
    else if (scopeIds && !term) p.set("class_ids", scopeIds.join(",") || "0");
    if (feeFilter.value) p.set("fees", feeFilter.value);
    return `${A}/students?${p}`;
  };
  const fetchPage = async (offset) => {
    const res = await fetch(query(offset), { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "تعذر تحميل الطلاب");
    return { rows: await res.json(), total: Number(res.headers.get("X-Total-Count") || 0) };
  };
  const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "400px" });
  const loadMore = async () => {
    if (loadingMore || list.length >= total) return;
    loadingMore = true;
    const my = seq;
    try {
      const r = await fetchPage(list.length);
      if (my !== seq) return;
      list = list.concat(r.rows);
      sentinel.before(...r.rows.map((s2) => row(s2)));
      count.textContent = `${list.length} من ${total}`;
      if (list.length >= total) sentinel.remove();
    } finally { loadingMore = false; }
  };
  const draw = async () => {
    const my = ++seq;
    mount(box, skeleton(6));
    let r;
    try { r = await fetchPage(0); } catch (e) { if (my === seq) mount(box, notice(e.message, "err")); return; }
    if (my !== seq) return;   // نتيجة بحث أقدم وصلت متأخرة
    list = r.rows; total = r.total;
    visible = list;
    count.textContent = `${list.length} من ${total}`;
    mount(box, list.length
      ? [h("div", { class: "student-row head" },
          h("div", { class: "s-pick" }, selectAll),
          h("div", { class: "s-name" }, sub("تحديد الكل المعروض"))),
         ...list.map((s2) => row(s2)), list.length < total ? sentinel : null]
      : empty("لا يوجد طالب مطابق."));
    if (list.length < total) observer.observe(sentinel);
    drawBulk();
  };
  const redraw = () => { for (const el of box.querySelectorAll(".s-pick input")) { const id = Number(el.dataset.id); if (id) el.checked = selected.has(id); } drawBulk(); };
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
    const pick = input({ type: "checkbox", "aria-label": `تحديد ${s.name}`, "data-id": s.id });
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
  drawNav();
  let searchTimer;
  q.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(draw, 300); });
  feeFilter.addEventListener("change", draw);
  filter.addEventListener("change", draw);
  draw();

  // التصدير يطلب القائمة الكاملة عند الضغط فقط
  const exportBtn = btn("تصدير المعرّفات", async () => {
    const all = await api(`${A}/students`);
    csv("معرفات_الطلاب.csv", [["الطالب", "الفصل", "ولي الأمر", "الجوال", "المعرّف"], ...all.map((s) => [s.name, s.class_name, s.guardian_name, s.guardian_phone, s.access_key])]);
  }, "ghost sm");

  for (const el of [f.name, f.gname, f.gphone]) {
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") addPanel.querySelector("button.btn").click(); });
  }

  return [
    addPanel, importPanel,
    panel(`الطلاب (${totalActive} / ${me.school.max_students >= 100000 ? "مفتوح" : me.school.max_students})`, exportBtn,
      navBox,
      h("div", { class: "row" }, q, filter, feeFilter),
      h("div", { class: "toolbar" }, count),
      bulkBar,
      sub("تفعيل الرسوم يُظهر الفواتير والسداد في ملف الطالب."),
      box),
    // خارج القيد: العدد فقط، والقائمة تُحمّل عند فتح القسم
    inactiveCount ? (() => {
      const holder = h("div");
      const d = h("details", { class: "panel" }, h("summary", { style: "cursor:pointer;font-weight:700" }, `طلاب خارج القيد (${inactiveCount})`),
        sub("سجلاتهم محفوظة، ولا يظهرون في القوائم."), holder);
      d.addEventListener("toggle", async () => {
        if (!d.open || holder.dataset.loaded) return;
        holder.dataset.loaded = "1";
        mount(holder, skeleton(3));
        const inactive = await api(`${A}/students?status=inactive&limit=500`);
        mount(holder, inactive.map((s) => line(
          h("div", { class: "muted-row" }, h("b", {}, s.name), " ", statusBadge(s.status),
            sub(`${s.class_name || "بدون فصل"}${s.status_changed_at ? ` — منذ ${fmtDate(s.status_changed_at)}` : ""}`),
            s.status_note ? sub(s.status_note) : null),
          btn("إعادة للقيد", async () => {
            await api(`${A}/students/${s.id}/status`, { status: "active", note: null });
            toast("عاد الطالب على رأس القيد"); refresh();
          }, "soft sm"))));
      });
      return d;
    })() : null,
  ];
}

// نافذة واحدة لكل ما يخص الطالب: البيانات، البطاقة، المعرّف، الحالة
function manage(s, classes, me, refresh) {
  const f = { name: input({ value: s.name }), cls: select(classOptions(classes, "بدون فصل"), { value: s.class_id ?? "" }),
    gname: input({ value: s.guardian_name || "" }), gphone: input({ class: "ltr", value: s.guardian_phone || "" }) };
  const extra = h("div");
  const custom = { fields: [], inputs: new Map() };

  // الحقول المخصصة التي عرّفتها المدرسة
  Promise.all([api(`${A}/custom-fields?entity=student`), api(`${A}/custom-fields/values/student/${s.id}`)])
    .then(([fields, values]) => {
      custom.fields = fields.filter((x) => x.is_active && x.show_admin);
      if (!custom.fields.length) return;
      mount(extra,
        h("h3", { class: "sec-title" }, "حقول المدرسة"),
        custom.fields.map((x) => {
          const el = x.type === "select" ? select([["", "—"], ...x.options.map((o) => [o, o])], { value: values[x.key] ?? "" })
            : x.type === "boolean" ? select([["", "—"], ["نعم", "نعم"], ["لا", "لا"]], { value: values[x.key] ?? "" })
            : input({ type: x.type === "number" ? "number" : x.type === "date" ? "date" : "text", value: values[x.key] ?? "" });
          custom.inputs.set(x.key, el);
          return field(`${x.label}${x.required ? " *" : ""}`, el);
        }));
    });
  const d = dialog(s.name, h("div", {},
    field("الاسم", f.name), field("الفصل", f.cls), field("ولي الأمر", f.gname), field("الجوال", f.gphone),
    line(h("span", { class: "sub" }, "معرّف الطالب"), keyText(s.access_key)),
    extra,
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
    if (custom.fields.length) {
      await api(`${A}/custom-fields/values/student/${s.id}`, {
        values: Object.fromEntries([...custom.inputs.entries()].map(([k, el]) => [k, el.value || null])),
      }, "PUT");
    }
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
