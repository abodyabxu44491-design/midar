// الاشتراكات: الإحصاءات، القائمة بالتصفية، وصفحة كل مدرسة (الاشتراك الحالي، العمليات، السجل، التجارب، الأسعار الخاصة)
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, field, input, select, btn, badge, sub, notice, toast, dialog, empty, stats, confirmAction } from "/shared/js/ui.js";
import { fmtDate, fmtDateTime } from "/shared/js/format.js";
import { loadRefs, subForm, SUB_STATUS, KIND, CUR, REQ_KINDS, REQ_STATUS, limitText } from "./sub-form.js";

const FILTERS = [["all", "الكل"], ["active", "فعّالة"], ["trial", "تجارب مجانية"], ["expiring", "تنتهي خلال 7 أيام"], ["expired", "منتهية"],
  ["pending", "بانتظار الدفع"], ["suspended", "موقوفة"]];
const EVENT = {
  migrated: "تحويل من النظام السابق", trial_started: "بدء تجربة مجانية", trial_extended: "تمديد التجربة", trial_ended: "إنهاء التجربة",
  trial_expired: "انتهت التجربة", activated: "تفعيل اشتراك", converted: "تحويل التجربة لاشتراك", renewed: "تجديد", upgraded: "ترقية",
  downgraded: "تخفيض", reactivated: "إعادة تفعيل", extended: "تمديد", expired: "انتهاء الاشتراك", suspended: "إيقاف", resumed: "استئناف",
  canceled: "إلغاء", paid: "تأكيد السداد", addon_added: "إضافة ميزة", addon_removed: "إزالة ميزة", plan_updated: "تحديث مميزات الباقة",
  reminder: "تنبيه قرب انتهاء التجربة",
};
let filter = "all";
const ENDED = new Set(["expired", "trial_expired", "canceled", "ended", "suspended"]);

export default async function subscriptions({ refresh }) {
  const [st, list] = await Promise.all([api("/api/owner/subscriptions/stats"), api(`/api/owner/subscriptions?filter=${filter}`)]);
  const root = h("div");
  const chips = h("div", { class: "xb-chips" }, FILTERS.map(([k, l]) => h("button", { type: "button", class: `xb-chip${filter === k ? " on" : ""}`,
    onclick: () => { filter = k; refresh(); } }, l)));
  mount(root,
    stats([["إجمالي المدارس", st.schools], ["اشتراكات فعّالة", st.active], ["تجارب مجانية", st.trials], ["منتهية", st.expired],
      ["تنتهي خلال 7 أيام", st.expiring_7], ["بانتظار الدفع", st.pending]]),
    st.by_plan.length ? panel("المدارس في كل باقة", null, h("div", { class: "row", style: "flex-wrap:wrap;gap:18px" },
      st.by_plan.map((p) => h("div", {}, sub(p.plan), h("b", {}, p.schools), p.trials ? sub(`منها ${p.trials} تجربة`) : null)))) : null,
    panel("الاشتراكات", btn("فحص الانتهاء الآن", async () => {
      const r = await api("/api/owner/subscriptions/run-expiry", {});
      toast(r.changed.length ? `تغيّرت حالة ${r.changed.length} اشتراك` : "لا توجد اشتراكات منتهية جديدة"); refresh();
    }, "ghost sm"),
    chips,
    list.length ? list.map((x) => h("div", { class: "xb-list-row" },
      h("div", {}, h("b", {}, x.name), " ", badge(...(SUB_STATUS[x.status] || [x.status, "gray"])), x.tenant_status !== "active" ? badge("المدرسة موقوفة", "red") : null,
        sub([x.plan_name, KIND[x.kind], !x.ends_on ? "بلا تاريخ نهاية"
            : ENDED.has(x.status) ? `انتهى ${fmtDate(x.ends_on)}`
            : `حتى ${fmtDate(x.ends_on)} (${x.days_left >= 0 ? `باقي ${x.days_left} يوم` : `انتهى منذ ${-x.days_left} يوم — فترة سماح`})`,
          `${x.students} / ${limitText(x.max_students)} طالب`, x.addons ? `${x.addons} إضافة` : null,
          Number(x.price) ? `${Number(x.price).toLocaleString("ar")} ${CUR[x.currency] || ""}` : null].filter(Boolean).join(" · "))),
      h("div", { class: "acts" }, btn("إدارة", () => detail(x.tenant_id, root, refresh), "sm")))) : notice("لا توجد اشتراكات في هذا التصنيف.", "")));
  return root;
}

/* ---------- صفحة اشتراك مدرسة ---------- */
async function detail(tenantId, root, back) {
  const [d, refs] = await Promise.all([api(`/api/owner/subscriptions/${tenantId}`), loadRefs()]);
  const c = d.current;
  const reload = () => detail(tenantId, root, back);
  const act = (body, ask) => async () => {
    if (ask && !confirmAction(ask)) return;
    await api(`/api/owner/subscriptions/${tenantId}/action`, body);
    toast("تم"); reload();
  };
  const catalog = new Map(refs.catalog.map((f) => [f.key, f.name]));
  const days = c?.ends_on ? Math.round((new Date(c.ends_on) - new Date(new Date().toISOString().slice(0, 10))) / 86400000) : null;

  const extendDlg = () => {
    const n = input({ type: "number", min: 1, value: 7 });
    const until = input({ type: "date" });
    const dd = dialog(c.kind === "trial" ? "تمديد التجربة" : "تمديد الاشتراك", h("div", {}, h("div", { class: "row" }, field("عدد الأيام", n), field("أو حتى تاريخ", until))),
      [btn("تمديد", async () => { await api(`/api/owner/subscriptions/${tenantId}/action`, { action: "extend", days: Number(n.value), until: until.value || undefined }); dd.close(); toast("تم التمديد"); reload(); })]);
  };
  const activateDlg = (defaults, title) => {
    const form = subForm(refs, { ...defaults, tenantPrices: d.prices });
    const dd = dialog(title, form.el, [btn("تفعيل الاشتراك", async () => {
      await api(`/api/owner/subscriptions/${tenantId}/activate`, form.value()); dd.close(); toast("فُعّل الاشتراك"); reload();
    })]);
    dd.classList.add("xb-wide");
  };
  const addonsDlg = () => {
    const have = new Set(c.snapshot.features);
    const state = new Map(c.addons.map((a) => [a.key, { ...a }]));
    const rows = refs.catalog.filter((f) => !have.has(f.key)).map((f) => {
      const cur = state.get(f.key);
      const chk = h("input", { type: "checkbox", checked: !!cur, style: "width:18px;height:18px;flex:none" });
      const pr = input({ type: "number", min: 0, value: cur?.price ?? "", placeholder: "مجانًا", style: "max-width:110px" });
      const until = input({ type: "date", value: cur?.until || "", style: "max-width:160px" });
      const sync = () => { if (chk.checked) state.set(f.key, { key: f.key, price: Number(pr.value || 0), until: until.value || null }); else state.delete(f.key); };
      for (const el of [chk, pr, until]) el.addEventListener("change", sync);
      return h("div", { class: "row", style: "align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--line)" }, chk, h("span", { style: "flex:1" }, f.name), pr, until);
    });
    const dd = dialog("المميزات الإضافية لهذه المدرسة", h("div", {},
      sub("مميزات خارج باقة المدرسة: علّم لإضافتها، مع سعر ومدة اختيارية (فارغ = دائمة)."),
      h("div", { class: "row", style: "gap:8px;font-size:13px;color:var(--muted)" }, h("span", { style: "flex:1" }, "الميزة"), h("span", { style: "width:110px" }, "السعر"), h("span", { style: "width:160px" }, "حتى تاريخ")),
      rows.length ? rows : sub("كل المميزات مشمولة في الباقة.")),
    [btn("حفظ الإضافات", async () => {
      await api(`/api/owner/subscriptions/${tenantId}/action`, { action: "set_addons", addons: [...state.values()] }); dd.close(); toast("حُفظت الإضافات"); reload();
    })]);
    dd.classList.add("xb-wide");
  };
  const priceDlg = () => {
    const plan = select(refs.plans.map((p) => [p.id, p.name]));
    const m = input({ type: "number", min: 0 }); const y = input({ type: "number", min: 0 }); const note = input();
    const dd = dialog("سعر خاص لهذه المدرسة", h("div", {}, sub("لا يغيّر سعر الباقة لباقي المدارس، ويُطبَّق تلقائيًا عند تفعيل اشتراك مدفوع لهذه المدرسة."),
      field("الباقة", plan), h("div", { class: "row" }, field("السعر الشهري", m), field("السعر السنوي", y)), field("ملاحظة", note)),
    [btn("حفظ", async () => {
      await api(`/api/owner/prices/${tenantId}/${plan.value}`, { monthly_price: m.value === "" ? null : Number(m.value), yearly_price: y.value === "" ? null : Number(y.value), note: note.value }, "PUT");
      dd.close(); toast("حُفظ السعر الخاص"); reload();
    })]);
  };

  mount(root,
    h("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:10px" },
      btn("رجوع للقائمة", back, "ghost sm"), h("h2", { style: "margin:0" }, d.tenant.name)),
    panel("الاشتراك الحالي", c ? badge(...(SUB_STATUS[c.status] || [c.status, "gray"])) : null,
      c ? [
        h("div", { class: "row", style: "flex-wrap:wrap;gap:18px" },
          h("div", {}, sub("الباقة"), h("b", {}, c.plan_name)), h("div", {}, sub("النوع"), h("b", {}, KIND[c.kind])),
          h("div", {}, sub("البداية"), h("b", {}, fmtDate(c.starts_on))), h("div", {}, sub("النهاية"), h("b", {}, c.ends_on ? fmtDate(c.ends_on) : "بلا نهاية")),
          days != null && !ENDED.has(c.status) ? h("div", {}, sub("المتبقي"), h("b", {}, days >= 0 ? `${days} يوم` : `انتهى منذ ${-days} يوم`)) : null,
          h("div", {}, sub("السعر"), h("b", {}, `${Number(c.price).toLocaleString("ar")} ${CUR[c.currency] || ""}${Number(c.discount) ? ` (خصم ${c.discount})` : ""}`)),
          h("div", {}, sub("الطلاب"), h("b", {}, `${d.tenant.students} / ${limitText(c.max_students)}`)),
          h("div", {}, sub("المعلمون"), h("b", {}, `${d.tenant.teachers} / ${limitText(c.max_teachers)}`))),
        sub(`المميزات: ${c.snapshot.features.map((k) => catalog.get(k) || k).join("، ")}`),
        c.addons.length ? sub(`مميزات إضافية: ${c.addons.map((a) => `${catalog.get(a.key) || a.key}${a.until ? ` حتى ${a.until}` : ""}${a.price ? ` (${a.price})` : ""}`).join("، ")}`) : null,
        c.snapshot.grandfathered ? notice("اشتراك محوّل من النظام السابق بكل الأقسام الحالية. فعّل باقة محددة متى أردت.", "") : null,
        h("div", { class: "row spaced", style: "flex-wrap:wrap;justify-content:flex-start" },
          btn("تفعيل / تغيير الباقة", () => activateDlg({ kind: "paid", plan_id: c.plan_id }, "تفعيل اشتراك (ترقية أو تخفيض أو تجديد)"), "sm"),
          ["active", "expired"].includes(c.status) && c.kind !== "trial" ? btn("تجديد بنفس الباقة", act({ action: "renew" }, "تجديد الاشتراك بنفس الباقة والسعر لفترة جديدة؟"), "soft sm") : null,
          c.ends_on && !["canceled", "ended"].includes(c.status) ? btn(c.kind === "trial" ? "تمديد التجربة" : "تمديد", extendDlg, "ghost sm") : null,
          c.kind === "trial" && c.status === "trial" ? btn("إنهاء التجربة الآن", act({ action: "end_trial" }, "إنهاء التجربة الآن؟ يتوقف الوصول وتبقى البيانات."), "ghost sm") : null,
          c.kind === "trial" ? btn("تحويل لاشتراك مدفوع", () => activateDlg({ kind: "paid", plan_id: c.plan_id }, "تحويل التجربة لاشتراك"), "soft sm") : null,
          c.status === "pending_payment" ? btn("تأكيد الدفع", act({ action: "mark_paid" }), "soft sm") : null,
          ["trial", "active", "pending_payment"].includes(c.status) ? btn("إيقاف", act({ action: "suspend" }, "إيقاف اشتراك المدرسة؟ يتوقف الوصول وتبقى البيانات."), "danger sm") : null,
          ["suspended", "expired", "trial_expired", "canceled"].includes(c.status) ? btn("إعادة تفعيل", act({ action: "resume" }), "soft sm") : null,
          btn("المميزات الإضافية", addonsDlg, "ghost sm"),
          btn("منح تجربة مجانية", () => activateDlg({ kind: "trial", plan_id: c.plan_id }, "تجربة مجانية"), "ghost sm")),
      ] : [notice("لا يوجد اشتراك لهذه المدرسة.", "warn"), btn("تفعيل اشتراك", () => activateDlg({ kind: "trial" }, "تفعيل اشتراك"), "sm")]),
    panel(`التجارب المجانية (${d.trials.length} من ${d.trials_allowed} مسموحة)`, null,
      d.trials.length ? d.trials.map((t) => h("div", { class: "line" }, h("span", {}, `${t.plan_name}: ${fmtDate(t.starts_on)} ← ${fmtDate(t.ends_on)}`), badge(...(SUB_STATUS[t.status] || [t.status, "gray"]))))
        : sub("لم تُمنح تجربة لهذه المدرسة.")),
    panel("الأسعار الخاصة", btn("+ سعر خاص", priceDlg, "sm"),
      d.prices.length ? d.prices.map((p) => h("div", { class: "line" }, h("span", {}, `${p.plan_name}: شهري ${p.monthly_price ?? "—"} — سنوي ${p.yearly_price ?? "—"}${p.note ? ` — ${p.note}` : ""}`),
        btn("حذف", async () => { await api(`/api/owner/prices/${tenantId}/${p.plan_id}`, undefined, "DELETE"); reload(); }, "danger sm")))
        : sub("لا يوجد سعر خاص. تُطبَّق أسعار الباقات العامة.")),
    panel("سجل الاشتراك", null, d.events.length ? d.events.map((e) => h("div", { class: "line" },
      h("span", {}, h("b", {}, EVENT[e.event] || e.event), " ", sub([e.details?.plan, e.details?.to && `إلى ${e.details.to}`, e.details?.days != null && `باقي ${e.details.days} أيام`,
        e.details?.key && (catalog.get(e.details.key) || e.details.key), e.details?.note].filter(Boolean).join(" — "))),
      h("small", { class: "sub" }, `${fmtDateTime(e.created_at)} — ${e.actor}`))) : empty("لا يوجد سجل.")),
    d.requests.length ? panel("طلبات المدرسة", null, d.requests.map((r) => h("div", { class: "line" },
      h("span", {}, h("b", {}, REQ_KINDS[r.kind]?.[0] || r.kind), r.feature_key ? ` — ${catalog.get(r.feature_key) || r.feature_key}` : "", r.note ? ` — ${r.note}` : ""),
      badge(...(REQ_STATUS[r.status] || [r.status, "gray"]))))) : null);
  window.scrollTo({ top: 0 });
}

export { detail };
