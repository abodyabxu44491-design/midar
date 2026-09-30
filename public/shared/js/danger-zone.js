// منطقة الحذر: واجهة واحدة للمالك (يختار المدرسة) ولمدير المدرسة (مدرسته فقط، حسب صلاحيته).
// لا زر ينفذ مباشرة: المدرسة ← العملية ← الشرح وما سيتأثر وما لن يتأثر ← النسخة الاحتياطية ← المراجعة والتأكيد
// برمز المدرسة وإعادة التحقق ← التنفيذ ← النتيجة. الخادم يعيد فحص كل شرط، والواجهة تشرح وتوجّه فقط.
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { btn, field, input, select, notice, toast, badge, empty, sub, passwordInput } from "./ui.js";
import { fmtDateTime } from "./format.js";
import { icons } from "./icons.js";

const SEV = { low: ["آمنة", ""], medium: ["حساسة", "amber"], high: ["خطيرة", "red"], critical: ["شديدة الخطورة", "red"] };
const STATUS = { planned: ["بانتظار التنفيذ", "gray"], approved: ["قيد التنفيذ", "amber"], executed: ["نُفذت", ""], failed: ["فشلت — لم يتغير شيء", "red"], cancelled: ["أُلغيت", "gray"] };
const STEPS = ["المدرسة", "العملية", "الأثر", "النسخة الاحتياطية", "المراجعة والتأكيد", "النتيجة"];
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);
const num = (n) => Number(n || 0).toLocaleString("ar-SA-u-nu-latn");

/**
 * @param {{ base: string, scope: "owner"|"admin", me?: object }} opts
 */
export async function dangerZone({ base, scope }) {
  const owner = scope === "owner";
  const cat = await api(`${base}/catalog`);
  const root = h("div", { class: "dz" });
  const tabsEl = h("div", { class: "xb-chips dz-tabs", role: "tablist" });
  const box = h("div");
  let tab = "new";

  const hero = h("div", { class: "sub-banner warn dz-hero", role: "note" },
    icons.alert({ size: 22 }),
    h("div", {}, h("b", {}, "منطقة الحذر"), h("span", {}, owner
      ? "عمليات استثنائية قد تغيّر بيانات المدرسة أو تعيد تهيئتها. لا شيء يُنفذ بضغطة واحدة: كل عملية تمر بالشرح وعرض ما سيتأثر ونسخة احتياطية ومراجعة وتأكيد برمز المدرسة وإعادة التحقق من هويتك، وتُسجَّل كاملة. الاشتراكات والباقات والفواتير ليست هنا."
      : "عمليات حساسة لمدرستك حسب صلاحياتك: إيقاف الجلسات، إعادة ضبط الحسابات، النسخ الاحتياطي، إعادة ضبط الإعدادات، وحذف فئات محددة. كل عملية بمراحل وتأكيد بكلمة مرورك، وتُسجَّل كاملة.")));

  if (!owner && !cat.allowed) {
    return h("div", { class: "dz" }, hero, notice("ليست لديك صلاحية «منطقة الحذر». هذه الصلاحية للمدير الرئيسي للمدرسة، ويمنحها مالك المنصة.", "warn"));
  }

  const paintTabs = () => mount(tabsEl, [["new", "عملية جديدة"], ["history", "سجل العمليات"], ...(owner ? [["backups", "النسخ الاحتياطية"]] : [])]
    .map(([k, l]) => h("button", { type: "button", role: "tab", "aria-selected": String(tab === k), class: `xb-chip${tab === k ? " on" : ""}`,
      onclick: () => { tab = k; paintTabs(); show(); } }, l)));
  const show = async () => {
    mount(box, empty("جارٍ التحميل…"));
    try { mount(box, tab === "new" ? await wizard() : tab === "history" ? await historyView() : await backupsView()); }
    catch (e) { mount(box, notice(e.message, "err")); }
  };

  /* ================= المعالج ================= */
  async function wizard() {
    const st = { step: 0, school: null, summary: null, op: null, params: {}, plan: null, backup: null, result: null };
    const wrap = h("div", { class: "dz-wizard" });
    const stepsEl = h("ol", { class: "dz-steps" });
    const body = h("div", { class: "dz-body" });
    const paintSteps = () => mount(stepsEl, STEPS.map((l, i) => h("li", { class: i === st.step ? "on" : i < st.step ? "done" : "" },
      h("span", {}, i < st.step ? icons.check({ size: 14 }) : i + 1), l)));
    const go = async (i) => {
      st.step = i; paintSteps();
      mount(body, empty("جارٍ التحميل…"));
      try {
        const out = await [stepSchool, stepOp, stepImpact, stepBackup, stepReview, stepResult][i]();
        if (st.step === i) mount(body, out);   // خطوة انتقلت بنفسها لغيرها (المدير يتخطى اختيار المدرسة) لا تمسح التالية
      } catch (e) { if (st.step === i) mount(body, notice(e.message, "err"), btn("رجوع", () => go(Math.max(0, i - 1)), "ghost")); }
      wrap.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    const tenantBody = (extra = {}) => (owner ? { tenant: st.school.id, ...extra } : extra);
    const cancelPlan = async () => {
      if (st.plan && !st.result) { try { await api(`${base}/${st.plan.id}/cancel`, tenantBody({ token: st.plan.token })); } catch { /* انتهت أو نُفذت */ } }
      st.plan = null; st.backup = null;
    };

    // 1) المدرسة
    async function stepSchool() {
      if (!owner) {
        st.summary = await api(`${base}/summary`);
        st.school = st.summary.school;
        return go(1);
      }
      const schools = await api(`${base}/schools`);
      const q = input({ type: "search", placeholder: "ابحث باسم المدرسة أو رمزها" });
      const list = h("div", { class: "dz-schools" });
      const paint = () => {
        const term = q.value.trim().toLowerCase();
        const rows = schools.filter((s) => !term || s.name.toLowerCase().includes(term) || s.id.includes(term));
        mount(list, rows.length ? rows.map((s) => h("button", { type: "button", class: "dz-school", onclick: async () => {
          st.school = s; st.summary = await api(`${base}/schools/${s.id}`); go(1);
        } },
          h("b", {}, s.name), h("small", { class: "ltr" }, s.id),
          h("span", { class: "dz-school-tags" },
            s.status === "active" ? badge("تعمل") : s.status === "archived" ? badge("مؤرشفة", "gray") : badge("موقوفة", "amber"),
            s.emergency_locked_at ? badge("مقفلة طارئًا", "red") : null),
          h("small", {}, `${num(s.students)} طالب · ${num(s.teachers)} معلم`))) : empty("لا توجد مدرسة بهذا الاسم."));
      };
      q.addEventListener("input", paint); paint();
      return [h("h3", { class: "dz-h" }, "اختر المدرسة"), q, list];
    }

    // 2) العملية
    async function stepOp() {
      const s = st.summary;
      st.op = null; st.params = {};
      const extra = h("div", { class: "dz-extra" });
      const next = btn("التالي: عرض الأثر", async () => {
        if (!st.op) return toast("اختر العملية", true);
        if (st.op === "data_purge" && !st.params.categories?.length) return toast("اختر فئة واحدة على الأقل", true);
        if (st.op === "backup_restore" && !st.params.backup_id) return toast("اختر النسخة الاحتياطية", true);
        await cancelPlan();
        try { st.plan = await api(`${base}/plan`, tenantBody({ op: st.op, params: st.params })); go(2); } catch (e) { toast(e.message, true); }
      });
      next.disabled = true;
      const groups = [...new Set(cat.operations.map((o) => o.group))];
      // عمليات لا تناسب حالة المدرسة الآن تظهر معطلة مع السبب
      const sc = s.school;
      const why = {
        archive: sc.status === "archived" && "المدرسة مؤرشفة مسبقًا",
        unarchive: sc.status !== "archived" && "المدرسة ليست مؤرشفة",
        school_delete: sc.status !== "archived" && "أرشف المدرسة أولًا",
        emergency_lock: sc.emergency_locked_at && "مقفلة طارئًا مسبقًا",
        emergency_unlock: !sc.emergency_locked_at && "المدرسة غير مقفلة",
        backup_restore: !(s.backups || []).length && "لا توجد نسخ احتياطية بعد",
      };
      const card = (o) => h("button", { type: "button", class: `dz-op sev-${o.severity}`, "data-op": o.key, disabled: Boolean(why[o.key]), onclick: (e) => {
        for (const x of wrap.querySelectorAll(".dz-op.on")) x.classList.remove("on");
        e.currentTarget.classList.add("on");
        st.op = o.key; st.params = {}; next.disabled = false;
        mount(extra, paramsFor(o.key));
        extra.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } },
        h("span", { class: "dz-op-top" }, h("b", {}, o.label), badge(SEV[o.severity][0], SEV[o.severity][1])),
        h("small", {}, o.description),
        why[o.key] ? h("em", { class: "dz-why" }, why[o.key]) : null);
      const paramsFor = (key) => {
        if (key === "data_purge") {
          return h("div", { class: "dz-param" }, h("b", {}, "اختر ما يُحذف:"), h("div", { class: "dz-cats" }, cat.categories.map((c) => {
            const n = s.categories?.[c.key] ?? 0;
            const cb = h("input", { type: "checkbox", disabled: !n, onchange: () => {
              const set = new Set(st.params.categories || []);
              if (cb.checked) set.add(c.key); else set.delete(c.key);
              st.params.categories = [...set];
            } });
            return h("label", { class: `dz-cat${n ? "" : " off"}` }, cb, h("span", {}, h("b", {}, c.label), c.note ? h("small", {}, c.note) : null),
              h("em", {}, n ? num(n) : "فارغ"));
          })));
        }
        if (key === "backup_restore") {
          const bs = s.backups || [];
          if (!bs.length) return notice("لا توجد نسخ احتياطية لهذه المدرسة. أنشئ نسخة أولًا.", "warn");
          const pick = select([["", "اختر النسخة…"], ...bs.map((b) => [b.id, `#${b.id} — ${fmtDateTime(b.created_at)} — ${b.reason}`])]);
          pick.addEventListener("change", () => { st.params.backup_id = Number(pick.value) || undefined; });
          return h("div", { class: "dz-param" }, field("النسخة التي تُستعاد", pick));
        }
        if (key === "accounts_reset" && owner) {
          const cb = h("input", { type: "checkbox", onchange: () => { st.params.include_admins = cb.checked; } });
          return h("label", { class: "check-line" }, cb, " تشمل حساب المدير أيضًا (تظهر كلمته الجديدة مرة واحدة)");
        }
        if (key === "emergency_lock" || key === "backup_create") {
          const r = input({ maxLength: 200, placeholder: key === "emergency_lock" ? "سبب القفل (يُسجَّل)" : "وصف النسخة (مثل: قبل بداية الفصل الثاني)" });
          r.addEventListener("input", () => { st.params.reason = r.value.trim() || undefined; });
          return h("div", { class: "dz-param" }, field(key === "emergency_lock" ? "السبب" : "وصف النسخة", r));
        }
        return null;
      };
      return [
        schoolBar(),
        groups.map((g) => h("section", { class: "dz-group" }, h("h3", { class: "dz-h" }, g),
          h("div", { class: "dz-ops" }, cat.operations.filter((o) => o.group === g).map(card)))),
        !owner && cat.owner_only?.length ? sub(`عمليات لمالك المنصة فقط: ${cat.owner_only.join("، ")}. تواصل معه عند الحاجة.`) : null,
        extra,
        h("div", { class: "dz-nav" }, owner ? btn("تغيير المدرسة", () => go(0), "ghost") : h("span"), next),
      ];
    }

    const schoolBar = () => {
      const s = st.summary?.school || st.school;
      return h("div", { class: "dz-school-bar" },
        h("div", {}, h("b", {}, s.name), " ", h("small", { class: "ltr" }, s.id)),
        h("div", { class: "dz-school-tags" },
          s.status === "active" ? badge("تعمل") : s.status === "archived" ? badge("مؤرشفة", "gray") : badge("موقوفة", "amber"),
          s.emergency_locked_at ? badge(`مقفلة طارئًا${s.emergency_reason ? `: ${s.emergency_reason}` : ""}`, "red") : null,
          st.summary ? h("small", {}, `${num(st.summary.accounts)} حساب · ${num(st.summary.sessions)} جلسة مفتوحة · ${num(st.summary.backups?.length)} نسخة`) : null));
    };

    // 3) الشرح وما سيتأثر وما لن يتأثر
    async function stepImpact() {
      const p = st.plan;
      const restore = p.op === "backup_restore";
      const total = p.affected.reduce((a, x) => a + x.count, 0);
      return [
        schoolBar(),
        h("div", { class: `dz-card sev-${p.severity}` },
          h("div", { class: "dz-op-top" }, h("h3", {}, p.label), badge(SEV[p.severity][0], SEV[p.severity][1])),
          h("p", {}, p.description),
          p.category_labels?.length ? h("p", {}, h("b", {}, "الفئات المختارة: "), p.category_labels.join("، ")) : null,
          p.restore_from ? h("p", {}, h("b", {}, "من النسخة: "), `#${p.restore_from.id} — ${fmtDateTime(p.restore_from.created_at)} — ${p.restore_from.reason}`) : null),
        h("div", { class: "dz-impact" },
          h("div", { class: "dz-affected" }, h("h4", {}, restore ? "ما سيتغير (الآن ← بعد الاستعادة)" : "ما سيتأثر"),
            p.affected.length ? h("table", { class: "dz-table" }, h("tbody", {}, p.affected.map((x) => h("tr", {},
              h("td", {}, x.label), h("td", { class: "n" }, restore ? `${num(x.count)} ← ${num(x.after)}` : num(x.count))))))
              : h("p", { class: "sub" }, p.op === "backup_create" ? "لا يتغير شيء." : "لا توجد بيانات تتأثر حاليًا."),
            !restore && total ? h("p", { class: "dz-total" }, `المجموع: ${num(total)}`) : null),
          h("div", { class: "dz-unaffected" }, h("h4", {}, "ما لن يتأثر"), h("ul", {}, p.unaffected.map((u) => h("li", {}, u))))),
        h("p", { class: "sub" }, `صلاحية هذه العملية تنتهي ${fmtDateTime(p.expires_at)} (20 دقيقة).`),
        h("div", { class: "dz-nav" },
          btn("إلغاء العملية", async () => { await cancelPlan(); toast("أُلغيت العملية ولم يتغير شيء"); go(1); }, "ghost"),
          btn(p.backup_required ? "التالي: النسخة الاحتياطية" : "التالي: المراجعة والتأكيد", () => go(p.backup_required ? 3 : 4))),
      ];
    }

    // 4) النسخة الاحتياطية (إلزامية للعمليات المدمّرة)
    async function stepBackup() {
      const p = st.plan;
      const out = h("div");
      const make = btn("إنشاء النسخة الاحتياطية الآن", async () => {
        make.disabled = true; mount(out, empty("جارٍ إنشاء النسخة… قد يستغرق ذلك لحظات"));
        try {
          st.backup = await api(`${base}/${p.id}/backup`, tenantBody({ token: p.token }));
          paint();
        } catch (e) { make.disabled = false; mount(out, notice(e.message, "err")); }
      });
      const paint = () => mount(out, st.backup
        ? h("div", { class: "dz-ok" }, h("b", {}, icons.check({ size: 16 }), ` النسخة الاحتياطية #${st.backup.id} جاهزة`),
          h("small", {}, `${fmtDateTime(st.backup.created_at)} · ${kb(st.backup.size_bytes)} · ${num(Object.values(st.backup.tables).reduce((a, n) => a + n, 0))} سجل`),
          sub("محفوظة على الخادم ببصمة تحقق، ويمكن استعادتها من «منطقة الحذر» في أي وقت."))
        : null);
      paint();
      const next = btn("التالي: المراجعة والتأكيد", () => { if (!st.backup) return toast("أنشئ النسخة الاحتياطية أولًا", true); go(4); });
      return [schoolBar(),
        h("div", { class: "dz-card" }, h("h3", {}, "نسخة احتياطية قبل التنفيذ"),
          h("p", {}, "هذه العملية تحذف أو تستبدل بيانات. تُؤخذ لقطة كاملة للمدرسة الآن حتى يمكن التراجع لاحقًا."),
          st.backup ? null : make, out),
        h("div", { class: "dz-nav" }, btn("رجوع", () => go(2), "ghost"), next)];
    }

    // 5) المراجعة والتأكيد وإعادة التحقق
    async function stepReview() {
      const p = st.plan;
      const confirm = input({ class: "ltr", placeholder: p.confirm_text || "", autocomplete: "off", spellcheck: false });
      const pw = passwordInput({ autocomplete: "current-password" });
      const code = cat.totp ? input({ class: "ltr", inputMode: "numeric", maxLength: 6, placeholder: "123456", autocomplete: "one-time-code" }) : null;
      const understand = h("input", { type: "checkbox" });
      const runBtn = btn(p.severity === "low" ? "تنفيذ" : `تنفيذ: ${p.label}`, async () => {
        runBtn.disabled = true; runBtn.textContent = "جارٍ التنفيذ…";
        try {
          st.result = await api(`${base}/${p.id}/execute`, tenantBody({ token: p.token, confirm: confirm.value.trim(), password: pw.value || undefined, code: code?.value.trim() || undefined }));
          go(5);
        } catch (e) {
          toast(e.message, true);
          runBtn.disabled = false; runBtn.textContent = `تنفيذ: ${p.label}`;
          if (e.status === 409) { st.plan = null; go(1); }
        }
      }, p.severity === "low" ? "" : "danger");
      const ready = () => {
        runBtn.disabled = !(understand.checked && (!p.confirm_text || confirm.value.trim() === p.confirm_text) && (!p.reauth || pw.value) && (!code || code.value.trim().length >= 6));
      };
      for (const el of [confirm, pw, understand, code].filter(Boolean)) el.addEventListener("input", ready);
      understand.addEventListener("change", ready);
      ready();
      const total = p.affected.reduce((a, x) => a + x.count, 0);
      return [schoolBar(),
        h("div", { class: `dz-card sev-${p.severity}` }, h("h3", {}, "مراجعة أخيرة"),
          h("ul", { class: "dz-review" },
            h("li", {}, h("b", {}, "العملية: "), p.label),
            h("li", {}, h("b", {}, "المدرسة: "), `${p.school.name} (${p.school.id})`),
            p.category_labels?.length ? h("li", {}, h("b", {}, "الفئات: "), p.category_labels.join("، ")) : null,
            total ? h("li", {}, h("b", {}, "السجلات المتأثرة: "), num(total)) : null,
            h("li", {}, h("b", {}, "النسخة الاحتياطية: "), st.backup ? `#${st.backup.id}` : p.backup_required ? "تُنشأ تلقائيًا قبل التنفيذ" : "غير لازمة"),
            h("li", {}, h("b", {}, "التسجيل: "), "تُسجَّل العملية كاملة في سجل العمليات باسمك ووقتها وعنوانك"))),
        h("div", { class: "dz-card dz-confirm" },
          p.confirm_text ? field(`اكتب رمز المدرسة «${p.confirm_text}» للتأكيد`, confirm) : null,
          p.reauth ? h("div", { class: "form-grid" },
            field(owner ? "كلمة مرور المالك" : "كلمة مرورك", pw),
            code ? field("رمز التحقق من تطبيق المصادقة", code) : null) : null,
          h("label", { class: "check-line" }, understand, " أفهم أثر هذه العملية، وراجعت ما سيتأثر وما لن يتأثر")),
        h("div", { class: "dz-nav" }, btn("إلغاء العملية", async () => { await cancelPlan(); toast("أُلغيت العملية ولم يتغير شيء"); go(1); }, "ghost"), runBtn)];
    }

    // 6) النتيجة
    async function stepResult() {
      const r = st.result;
      const res = r.result || {};
      const deleted = res.deleted ? Object.values(res.deleted).reduce((a, n) => a + n, 0) : 0;
      const creds = res.credentials || [];
      return [
        h("div", { class: "dz-ok big" }, h("b", {}, icons.check({ size: 18 }), ` نُفذت العملية: ${r.label}`),
          h("small", {}, [`رقم العملية #${r.id}`, r.backup_id ? `النسخة الاحتياطية #${r.backup_id}` : null].filter(Boolean).join(" · "))),
        deleted ? h("p", {}, `حُذف ${num(deleted)} سجل.`) : null,
        res.backup_id && !r.backup_id ? h("p", {}, `النسخة الاحتياطية #${res.backup_id} (${kb(res.size_bytes)}) محفوظة، ويمكن استعادتها من منطقة الحذر.`) : null,
        res.restored ? h("p", {}, `استُعيد ${num(Object.values(res.restored).reduce((a, n) => a + n, 0))} سجل من النسخة #${res.from_backup}. سجّل المستخدمون الدخول من جديد.`) : null,
        res.sessions !== undefined ? h("p", {}, `أُنهيت ${num(res.sessions)} جلسة.`) : null,
        res.school_deleted ? notice("حُذفت المدرسة من المنصة. النسخة الاحتياطية الأخيرة باقية في «النسخ الاحتياطية».", "warn") : null,
        creds.length ? h("div", { class: "dz-card" }, h("h3", {}, "كلمات المرور المؤقتة الجديدة"),
          notice("تظهر الآن مرة واحدة فقط ولا تُحفظ في السجل. انسخها أو اطبعها قبل مغادرة الصفحة. كلمات المعلمين تبقى ظاهرة في ملف كل معلم حتى يغيّرها.", "warn"),
          h("table", { class: "dz-table" }, h("thead", {}, h("tr", {}, h("th", {}, "الاسم"), h("th", {}, "اسم المستخدم"), h("th", {}, "كلمة المرور"))),
            h("tbody", {}, creds.map((c) => h("tr", {}, h("td", {}, c.name), h("td", { class: "ltr" }, c.username), h("td", { class: "ltr" }, h("code", {}, c.password)))))),
          h("div", { class: "row", style: "justify-content:flex-start;gap:6px" },
            btn("نسخ الكل", async () => { await navigator.clipboard.writeText(creds.map((c) => `${c.name}\t${c.username}\t${c.password}`).join("\n")); toast("نُسخت"); }, "ghost sm"),
            btn("طباعة", () => window.print(), "ghost sm"))) : null,
        h("div", { class: "dz-nav" }, btn("سجل العمليات", () => { tab = "history"; paintTabs(); show(); }, "ghost"),
          btn("عملية أخرى", async () => { st.plan = null; st.backup = null; st.result = null;
            if (owner && res.school_deleted) return go(0);
            st.summary = owner ? await api(`${base}/schools/${st.school.id}`) : await api(`${base}/summary`); go(1); })),
      ];
    }

    paintSteps();
    mount(wrap, stepsEl, body);
    queueMicrotask(() => go(0));
    return wrap;
  }

  /* ================= السجل ================= */
  async function historyView() {
    const rows = await api(`${base}/history`);
    const opLabel = Object.fromEntries(cat.operations.map((o) => [o.key, o.label]));
    return rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "dz-table dz-history" },
      h("thead", {}, h("tr", {}, [owner ? "المدرسة" : null, "العملية", "الحالة", "بواسطة", "الوقت", "النسخة", "التفاصيل"].filter(Boolean).map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map((r) => h("tr", {},
        owner ? h("td", {}, r.tenant_name, h("small", { class: "ltr" }, ` ${r.tenant_id}`)) : null,
        h("td", {}, opLabel[r.op] || r.op),
        h("td", {}, badge(STATUS[r.status][0], STATUS[r.status][1])),
        h("td", {}, r.requested_by),
        h("td", {}, fmtDateTime(r.executed_at || r.created_at)),
        h("td", {}, r.backup_id ? `#${r.backup_id}` : "—"),
        h("td", { class: "small" }, r.error ? r.error
          : r.result?.deleted ? `حُذف ${num(Object.values(r.result.deleted).reduce((a, n) => a + n, 0))} سجل`
            : r.result?.restored ? `استُعيد من #${r.result.from_backup}` : r.result?.sessions !== undefined ? `${num(r.result.sessions)} جلسة`
              : r.result?.accounts !== undefined ? `${num(r.result.accounts)} حساب` : "—")))))) : empty("لا توجد عمليات بعد.");
  }

  /* ================= النسخ الاحتياطية (المالك) ================= */
  async function backupsView() {
    const rows = await api(`${base}/backups`);
    if (!rows.length) return empty("لا توجد نسخ احتياطية بعد.");
    const table = h("table", { class: "dz-table" },
      h("thead", {}, h("tr", {}, ["#", "المدرسة", "الوصف", "بواسطة", "الوقت", "الحجم", ""].map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map((b) => h("tr", {},
        h("td", {}, b.id), h("td", {}, b.tenant_name, h("small", { class: "ltr" }, ` ${b.tenant_id}`)), h("td", {}, b.reason),
        h("td", {}, b.created_by), h("td", {}, fmtDateTime(b.created_at)), h("td", {}, kb(b.size_bytes)),
        h("td", {}, h("a", { class: "btn ghost sm", href: `${base}/backups/${b.id}/download` }, "تنزيل"))))));
    return [h("div", { class: "table-wrap" }, table),
      sub("التنزيل ملف JSON مضغوط (gzip) بكل بيانات المدرسة، ويُسجَّل في سجل العمليات. احفظه في مكان آمن.")];
  }

  paintTabs();
  mount(root, hero, tabsEl, box);
  show();
  return root;
}
