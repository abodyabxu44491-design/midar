// صندوق الإشعارات: جرس في الشريط العلوي (للمنسوبين) وقائمة إشعارات (لولي الأمر داخل ملف الطالب).
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { btn, dialog, empty, notice, sub, toast } from "./ui.js";
import { fmtDateTime } from "./format.js";
import { icons } from "./icons.js";
import { pushStatus, enablePush, disablePush, needsInstallFirst } from "./push.js";

const KIND_ICON = { absence: "alert", late: "clock", grades: "award", homework: "book", invoice: "wallet", payment: "check",
  announcement: "megaphone", alert: "bell", behavior: "star", clinic: "heart", transport: "bus", online_exam: "monitor",
  certificate: "award", survey: "poll", meeting: "calendar", calendar: "calendar", library: "book", leave: "briefcase",
  substitute: "clock", lesson_plan: "clipboard" };

export function inboxList(items, { onOpen } = {}) {
  if (!items.length) return empty("لا توجد إشعارات بعد.");
  return h("div", { class: "inbox-list" }, items.map((n) => h("button", {
    type: "button", class: `inbox-item${n.read_at ? "" : " unread"}`, onclick: () => onOpen?.(n),
  },
    h("span", { class: "ic" }, (icons[KIND_ICON[n.kind]] || icons.bell)({ size: 18 })),
    h("span", { class: "tx" }, h("b", {}, n.title), n.body ? h("small", {}, n.body) : null, h("small", { class: "muted" }, fmtDateTime(n.created_at))))));
}

/** مفتاح الإشعارات الفورية لهذا الجهاز */
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
          : st === "ios-install" ? sub("من Safari: زر المشاركة ← «إضافة إلى الشاشة الرئيسية»، ثم افتح التطبيق وفعّلها") : null);
  };
  draw();
  return box;
}

/**
 * جرس الإشعارات للمنسوبين: يعرض عدد غير المقروء، ويفتح القائمة ومفتاح الإشعارات الفورية.
 * @param {string} base مثل /api/admin
 * @param {(n: object) => void} [go] فتح القسم المرتبط بالإشعار
 */
export function notificationsBell(base, go) {
  const count = h("span", { class: "bell-count", hidden: true });
  const bell = h("button", { type: "button", class: "bell-btn", "aria-label": "الإشعارات", title: "الإشعارات", onclick: () => open() },
    icons.bell({ size: 20 }), count);
  let data = null;
  const refresh = async () => {
    try {
      data = await api(`${base}/notifications`);
      count.hidden = !data.unread;
      count.textContent = data.unread > 99 ? "99+" : String(data.unread);
      bell.setAttribute("aria-label", data.unread ? `الإشعارات (${data.unread} جديد)` : "الإشعارات");
    } catch { /* بدون اتصال */ }
  };
  const open = async () => {
    await refresh();
    if (!data) return toast("تعذر تحميل الإشعارات", true);
    const list = h("div");
    const draw = () => mount(list, inboxList(data.items, { onOpen: (n) => { d.close(); go?.(n); } }));
    draw();
    const d = dialog("الإشعارات", h("div", { class: "inbox-dialog" },
      pushToggle({ key: data.push.key, save: (s) => api(`${base}/notifications/push`, s), remove: (e) => api(`${base}/notifications/push/remove`, { endpoint: e }) }),
      needsInstallFirst() ? notice("على الآيفون تصل الإشعارات بعد تثبيت التطبيق على الشاشة الرئيسية.", "") : null,
      list),
    [data.unread ? btn("تحديد الكل كمقروء", async () => {
      await api(`${base}/notifications/read`, { all: true });
      data.items.forEach((n) => { n.read_at ||= new Date().toISOString(); });
      data.unread = 0; count.hidden = true; draw();
    }, "ghost") : null]);
    // فتح القائمة يعني الاطلاع: تُعلَّم كمقروءة بعد عرضها
    if (data.unread) api(`${base}/notifications/read`, { all: true }).then(() => { count.hidden = true; }).catch(() => {});
  };
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 120_000);
  navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.type === "midar:notification") refresh(); });
  return bell;
}

/** إضافة الجرس للشريط العلوي قبل زر الخروج */
export function attachBell(bar, base, go) {
  const row = bar.querySelector(".in");
  if (!row) return;
  row.insertBefore(notificationsBell(base, go), row.lastElementChild);
}
