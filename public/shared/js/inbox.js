// مركز الإشعارات: نفس المكوّن لولي الأمر (داخل ملف الطالب) وللمنسوبين (جرس الشريط العلوي).
//   تصفية بالتصنيف وغير المقروء والبحث، وقراءة إشعار، وتحديد الكل كمقروء، وأرشفة، ورابط مباشر للقسم المرتبط.
//   وبطاقة دعوة لتفعيل الإشعارات (لا نطلب الإذن فجأة عند فتح الصفحة)، وإعدادات أنواع الإشعارات.
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { btn, dialog, empty, notice, sub, toast, input, switchBtn } from "./ui.js";
import { fmtDateTime } from "./format.js";
import { icons } from "./icons.js";
import { pushStatus, enablePush, disablePush, needsInstallFirst, refreshPush } from "./push.js";

const KIND_ICON = { absence: "alert", late: "clock", present: "check", grades: "award", homework: "book", homework_due: "clock", homework_missing: "alert",
  invoice: "wallet", overdue: "wallet", payment: "check", announcement: "megaphone", message: "message", alert: "bell", behavior: "star",
  clinic: "heart", transport: "bus", online_exam: "monitor", exam_result: "award", certificate: "award", survey: "poll", meeting: "calendar",
  calendar: "calendar", library: "book", leave: "briefcase", substitute: "clock", lesson_plan: "clipboard", timetable: "grid",
  grades_review: "clipboard", request: "userPlus", system: "settings" };
const PRIORITY = { 1: ["عاجل", "p1"], 2: ["مهم", "p2"], 3: ["عادي", "p3"] };
// التصنيفات الظاهرة كأزرار تصفية (حسب نوع المستخدم)
const CHIPS = {
  parent: ["attendance", "grades", "homework", "exams", "finance", "announcements", "messages"],
  staff: ["tasks", "requests", "grades", "messages", "announcements", "timetable", "system"],
};

export function inboxList(items, { onOpen, onArchive } = {}) {
  if (!items.length) return empty("لا توجد إشعارات هنا.");
  return h("div", { class: "inbox-list" }, items.map((n) => {
    const [pLabel, pCls] = PRIORITY[n.priority] || PRIORITY[3];
    return h("div", { class: `inbox-row${n.read_at ? "" : " unread"}` },
      h("button", { type: "button", class: `inbox-item ${pCls}`, onclick: () => onOpen?.(n), "aria-label": `${n.read_at ? "" : "جديد: "}${n.title}` },
        h("span", { class: "ic" }, (icons[KIND_ICON[n.kind]] || icons.bell)({ size: 18 })),
        h("span", { class: "tx" },
          h("b", {}, n.title),
          n.body ? h("small", {}, n.body) : null,
          h("small", { class: "muted" }, fmtDateTime(n.updated_at || n.created_at),
            n.priority < 3 ? h("span", { class: `prio ${pCls}` }, pLabel) : null,
            n.repeats > 1 ? h("span", { class: "rep" }, `حُدّث ${n.repeats} مرات`) : null))),
      onArchive ? h("button", { type: "button", class: "inbox-archive", title: "أرشفة", "aria-label": `أرشفة: ${n.title}`, onclick: () => onArchive(n) },
        icons.close({ size: 16 })) : null);
  }));
}

/**
 * مركز الإشعارات الكامل.
 * @param {{ audience: "parent"|"staff", load: (filter: object) => Promise<any>, read: (body: object) => Promise<any>,
 *   archive: (ids: number[]) => Promise<any>, onOpen?: (n: object) => void, onUnread?: (n: number) => void, initial?: any }} o
 */
export function notificationCenter(o) {
  const box = h("div", { class: "ncenter" });
  const state = { category: null, unread: false, q: "", data: o.initial || null, items: o.initial?.items || [] };
  const chipsBox = h("div", { class: "nchips", role: "tablist", "aria-label": "تصفية الإشعارات" });
  const listBox = h("div");
  const moreBox = h("div");
  const search = input({ type: "search", placeholder: "بحث في الإشعارات", "aria-label": "بحث في الإشعارات" });
  let timer;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value.trim(); reload(); }, 350); });

  const filter = (before) => ({ category: state.category || undefined, unread: state.unread || undefined, q: state.q || undefined, before });
  const names = () => Object.fromEntries((state.data?.categories || []).map((c) => [c.key, c.name]));
  const drawChips = () => {
    const by = state.data?.by_category || {};
    const chip = (label, active, onclick, count) => h("button", { type: "button", role: "tab", class: `nchip${active ? " on" : ""}`, "aria-selected": String(active), onclick },
      label, count ? h("span", { class: "n" }, count > 99 ? "99+" : String(count)) : null);
    mount(chipsBox,
      chip("الكل", !state.category && !state.unread, () => { state.category = null; state.unread = false; reload(); }),
      chip("غير المقروء", state.unread, () => { state.unread = !state.unread; reload(); }, state.data?.unread),
      CHIPS[o.audience].map((k) => chip(names()[k] || k, state.category === k, () => { state.category = state.category === k ? null : k; reload(); }, by[k])));
  };
  const drawList = () => {
    mount(listBox, inboxList(state.items, {
      onOpen: async (n) => {
        if (!n.read_at) {
          n.read_at = new Date().toISOString();
          state.data.unread = Math.max(0, (state.data.unread || 0) - 1);
          if (state.data.by_category?.[n.category]) state.data.by_category[n.category]--;
          o.onUnread?.(state.data.unread);
          drawChips(); drawList();
          o.read({ ids: [n.id] }).catch(() => {});
        }
        o.onOpen?.(n);
      },
      onArchive: async (n) => {
        try {
          await o.archive([n.id]);
          state.items = state.items.filter((x) => x.id !== n.id);
          if (!n.read_at) { state.data.unread = Math.max(0, state.data.unread - 1); o.onUnread?.(state.data.unread); }
          drawChips(); drawList(); toast("أُرشف الإشعار");
        } catch (e) { toast(e.message, true); }
      },
    }));
    mount(moreBox, state.data?.more ? btn("عرض إشعارات أقدم", async () => {
      const d = await o.load(filter(state.items[state.items.length - 1]?.id));
      state.items.push(...d.items); state.data.more = d.more; drawList();
    }, "ghost sm") : null);
  };
  const reload = async () => {
    try {
      state.data = await o.load(filter());
      state.items = state.data.items;
      o.onUnread?.(state.data.unread);
    } catch (e) { mount(listBox, notice(e.message, "err")); return; }
    drawChips(); drawList();
  };
  mount(box,
    h("div", { class: "ncenter-head" }, search,
      btn("تحديد الكل كمقروء", async () => {
        await o.read({ all: true });
        state.items.forEach((n) => { n.read_at ||= new Date().toISOString(); });
        state.data.unread = 0; state.data.by_category = {};
        o.onUnread?.(0); drawChips(); drawList();
      }, "ghost sm")),
    chipsBox, listBox, moreBox);
  if (state.data) { drawChips(); drawList(); } else reload();
  return { el: box, reload };
}

/** إعدادات أنواع الإشعارات: ما يُنبَّه على الجوال. الإلزامي من المدرسة يظهر مقفلًا */
export function notificationPrefs({ load, save }) {
  const box = h("div", { class: "nprefs" }, sub("جارٍ التحميل…"));
  (async () => {
    let d;
    try { d = await load(); } catch (e) { return mount(box, notice(e.message, "err")); }
    const muted = new Set(d.muted);
    mount(box,
      sub("اختر ما يصلك تنبيهه على الجوال. كل الإشعارات تبقى أيضًا في مركز الإشعارات هنا."),
      d.devices ? sub(`الإشعارات مفعّلة على ${d.devices === 1 ? "جهاز واحد" : d.devices === 2 ? "جهازين" : `${d.devices} أجهزة`}.`) : null,
      h("div", { class: "nprefs-list" }, Object.entries(d.topics).map(([k, t]) => h("div", { class: "nprefs-row" },
        h("div", {}, h("b", {}, t.name),
          t.mandatory ? h("small", { class: "sub" }, icons.lock({ size: 12 }), " إلزامي من المدرسة")
            : t.partly_mandatory ? h("small", { class: "sub" }, "بعضها إلزامي من المدرسة ويصل دائمًا") : null),
        t.mandatory ? h("span", { class: "switch", role: "switch", "aria-checked": "true", "aria-disabled": "true", "aria-label": `${t.name}: إلزامي` })
          : switchBtn(!muted.has(k), t.name, async (on) => {
            on ? muted.delete(k) : muted.add(k);
            try { await save([...muted]); toast("تم الحفظ"); return true; }
            catch (e) { on ? muted.add(k) : muted.delete(k); toast(e.message, true); return false; }
          })))));
  })();
  return box;
}

const DISMISS = "midar_push_invite_dismissed";
const safe = (fn, fb) => { try { return fn(); } catch { return fb; } };

/**
 * بطاقة دعوة لتفعيل الإشعارات: تشرح الفائدة ثم تطلب الإذن عند الضغط فقط.
 * تتعامل مع: مسموح، مرفوض، لم يُسأل بعد، غير مدعوم، والآيفون قبل تثبيت التطبيق.
 */
export function pushInvite({ key, save, title = "فعّل إشعارات مدار", text, onDone, force = false }) {
  const box = h("div", { class: "push-invite", hidden: true });
  if (!key) return box;
  (async () => {
    const st = await pushStatus();
    if (st === "on") { refreshPush(save).catch(() => {}); return; }   // تجديد الجهاز بصمت (إن تغيّر الرمز)
    if (!force && safe(() => localStorage.getItem(DISMISS), null)) return;
    const close = () => { box.hidden = true; safe(() => localStorage.setItem(DISMISS, "1")); };
    const head = h("div", { class: "pi-head" }, h("span", { class: "pi-ic" }, icons.bell({ size: 22 })), h("b", {}, title));
    let body;
    if (st === "off") {
      body = [sub(text || "لتصلك أخبار الحضور والدرجات والواجبات مباشرة على جوالك، حتى والتطبيق مغلق."),
        h("div", { class: "row" }, btn("تفعيل الإشعارات", async () => {
          try { await enablePush(key, save); toast("تم تفعيل الإشعارات"); box.hidden = true; onDone?.(); }
          catch (e) { toast(e.message, true); }
        }), btn("لاحقًا", close, "ghost sm"))];
    } else if (st === "denied") {
      body = [sub("الإشعارات محظورة لهذا الموقع. افتح إعدادات المتصفح ← إعدادات الموقع ← الإشعارات ← السماح، ثم أعد فتح الصفحة."), btn("حسنًا", close, "ghost sm")];
    } else if (st === "ios-install") {
      body = [sub("على الآيفون: من Safari اضغط زر المشاركة ← «إضافة إلى الشاشة الرئيسية»، ثم افتح مدار من أيقونته وفعّل الإشعارات (iOS 16.4 أو أحدث)."), btn("حسنًا", close, "ghost sm")];
    } else {
      body = [sub("هذا المتصفح لا يدعم الإشعارات على الجهاز. تبقى كل الإشعارات في مركز الإشعارات داخل مدار."), btn("حسنًا", close, "ghost sm")];
    }
    mount(box, head, ...body);
    box.hidden = false;
  })();
  return box;
}

/** مفتاح الإشعارات الفورية لهذا الجهاز (في الإعدادات) */
export function pushToggle({ key, save, remove, label = "الإشعارات على هذا الجهاز" }) {
  const box = h("div", { class: "push-toggle" });
  const draw = async () => {
    const st = await pushStatus();
    const text = { on: "مفعّلة", off: "غير مفعّلة", denied: "محظورة من المتصفح", unsupported: "غير مدعومة في هذا المتصفح", "ios-install": "تحتاج تثبيت التطبيق أولًا" }[st];
    mount(box,
      h("div", {}, h("b", {}, label), sub(text)),
      !key ? sub("غير متاحة حاليًا") : st === "on"
        ? btn("إيقاف", async () => { await disablePush(remove); toast("أُوقفت الإشعارات على هذا الجهاز"); draw(); }, "ghost sm")
        : st === "off" ? btn("تفعيل", async () => { await enablePush(key, save); toast("تم تفعيل الإشعارات"); draw(); }, "sm")
          : st === "ios-install" ? sub("من Safari: زر المشاركة ← «إضافة إلى الشاشة الرئيسية»، ثم افتح التطبيق وفعّلها")
            : st === "denied" ? sub("اسمح بها من إعدادات المتصفح للموقع") : null);
  };
  draw();
  return box;
}

/**
 * جرس الإشعارات للمنسوبين: يعرض عدد غير المقروء، ويفتح مركز الإشعارات وإعداداته.
 * @param {string} base مثل /api/admin
 * @param {(n: object) => void} [go] فتح القسم المرتبط بالإشعار
 */
export function notificationsBell(base, go) {
  const count = h("span", { class: "bell-count", hidden: true });
  const bell = h("button", { type: "button", class: "bell-btn", "aria-label": "الإشعارات", title: "الإشعارات", onclick: () => open() },
    icons.bell({ size: 20 }), count);
  let data = null;
  const setCount = (n) => {
    count.hidden = !n;
    count.textContent = n > 99 ? "99+" : String(n);
    bell.setAttribute("aria-label", n ? `الإشعارات (${n} جديد)` : "الإشعارات");
    if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge?.())?.catch?.(() => {});
  };
  const loadPage = (f = {}) => {
    const qs = new URLSearchParams(Object.entries({ category: f.category, unread: f.unread ? "1" : undefined, q: f.q, before: f.before })
      .filter(([, v]) => v !== undefined && v !== null && v !== ""));
    return api(`${base}/notifications${qs.toString() ? `?${qs}` : ""}`);
  };
  const refresh = async () => {
    try { data = await loadPage(); setCount(data.unread); } catch { /* بدون اتصال */ }
  };
  const save = (s) => api(`${base}/notifications/push`, s);
  const open = async () => {
    await refresh();
    if (!data) return toast("تعذر تحميل الإشعارات", true);
    const view = h("div");
    const showList = () => mount(view, notificationCenter({ audience: "staff", initial: data, load: loadPage,
      read: (b) => api(`${base}/notifications/read`, b), archive: (ids) => api(`${base}/notifications/archive`, { ids }),
      onUnread: setCount, onOpen: (n) => { let ok = false; try { ok = go?.(n); } catch { /* قسم غير متاح */ } if (ok) d.close(); } }).el);
    const showSettings = () => mount(view,
      pushToggle({ key: data.push.key, save, remove: (e) => api(`${base}/notifications/push/remove`, { endpoint: e }) }),
      needsInstallFirst() ? notice("على الآيفون تصل الإشعارات بعد تثبيت التطبيق على الشاشة الرئيسية.", "") : null,
      notificationPrefs({ load: () => api(`${base}/notifications/prefs`), save: (muted) => api(`${base}/notifications/prefs`, { muted }, "PUT") }));
    showList();
    const d = dialog("الإشعارات", h("div", { class: "inbox-dialog" }, pushInvite({ key: data.push.key, save }), view),
      [btn("الإشعارات", showList, "ghost"), btn("الإعدادات", showSettings, "ghost")]);
  };
  refresh();
  // تجديد اشتراك الجهاز بصمت إن كانت الإشعارات مفعّلة (يغطي تغيّر رمز الجهاز)
  setTimeout(() => { if (data?.push?.key) refreshPush(save).catch(() => {}); }, 3000);
  setInterval(() => { if (!document.hidden) refresh(); }, 120_000);
  navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.type === "midar:notification") refresh(); });
  // فتح إشعار من الجوال (?n=) يفتح المركز مباشرة
  if (new URLSearchParams(location.search).get("n")) setTimeout(open, 600);
  return bell;
}

/** إضافة الجرس للشريط العلوي قبل زر الخروج */
export function attachBell(bar, base, go) {
  const row = bar.querySelector(".in");
  if (!row) return;
  row.insertBefore(notificationsBell(base, go), row.lastElementChild);
}
