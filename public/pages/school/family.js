// حساب ولي الأمر في صفحة المدرسة: الدخول، والتفعيل أول مرة (أو استعادة كلمة المرور)، ولوحة «أبنائي».
// دخول واحد ← كل الأبناء ← ملف أي ابن، بلا معرّف لكل ابن. الخادم يتحقق من ارتباط كل طالب بالحساب مع كل طلب.
import { h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { field, input, btn, notice, dialog, sub, badge, toast, passwordInput, empty } from "../shared/js/ui.js";
import { ATTENDANCE, fmtDateTime } from "../shared/js/format.js";
import { icons } from "../shared/js/icons.js";
import { pushInvite } from "../shared/js/inbox.js";
import { setParentSignedIn, parentSignedIn, openChild, rememberedChildren } from "../shared/js/children.js";

const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();
const P = `/api/public/${encodeURIComponent(school)}`;
const studentUrl = (id) => `/${encodeURIComponent(school)}/student?s=${id}`;
const RELATION = { father: "الأب", mother: "الأم", guardian: "ولي الأمر", other: "" };

/* ======================= بطاقة الدخول في الرئيسية ======================= */
export function parentCard() {
  if (parentSignedIn(school)) {
    return h("section", { class: "ss-card ss-parent" },
      h("h2", {}, icons.users({ size: 20 }), "أبنائي"),
      sub("أنت مسجّل بحساب ولي الأمر. افتح لوحة أبنائك لترى حضورهم ودرجاتهم وإشعاراتهم."),
      btn("فتح لوحة أبنائي", () => { location.hash = "#/family"; }, "primary"));
  }
  const phone = input({ type: "tel", inputMode: "tel", autocomplete: "username", placeholder: "رقم الجوال المسجل لدى المدرسة", dir: "ltr" });
  const pass = passwordInput({ autocomplete: "current-password", placeholder: "كلمة المرور" });
  const msg = h("div");
  const go = btn("دخول", async () => {
    mount(msg);
    try {
      const r = await api(`${P}/parent/login`, { phone: phone.value, password: pass.value });
      setParentSignedIn(school, true);
      if (r.must_change_password) sessionStorage.setItem(`midar_parent_pw_${school}`, "1");
      location.hash = "#/family";
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "primary");
  pass.addEventListener?.("keydown", (e) => e.key === "Enter" && go.click());
  return h("section", { class: "ss-card ss-parent" },
    h("h2", {}, icons.users({ size: 20 }), "حساب ولي الأمر"),
    sub("دخول واحد لكل أبنائك في المدرسة: حضورهم ودرجاتهم وواجباتهم ورسومهم وإشعاراتهم."),
    h("div", { class: "ss-login" }, field("رقم الجوال", phone), field("كلمة المرور", pass), go),
    msg,
    h("div", { class: "ss-login-links" },
      h("button", { type: "button", class: "link", onclick: () => activateDialog() }, "أول مرة؟ فعّل حسابك"),
      h("button", { type: "button", class: "link", onclick: () => activateDialog(true) }, "نسيت كلمة المرور")));
}

/** التفعيل أول مرة أو استعادة كلمة المرور: الجوال المسجل لدى المدرسة + معرّف أحد الأبناء (من بطاقته) */
function activateDialog(reset = false) {
  const phone = input({ type: "tel", inputMode: "tel", placeholder: "رقم جوال ولي الأمر كما سجّلته المدرسة", dir: "ltr" });
  const key = input({ class: "ltr", placeholder: "XXXX-XXXX", maxLength: 9, autocomplete: "off" });
  key.addEventListener("input", () => {
    const v = key.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    key.value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v;
  });
  const name = input({ placeholder: "اسمك (اختياري)", maxLength: 120 });
  const pass = passwordInput({ autocomplete: "new-password", placeholder: "8 أحرف أو أرقام على الأقل" });
  const msg = h("div");
  const d = dialog(reset ? "استعادة كلمة المرور" : "تفعيل حساب ولي الأمر", h("div", {},
    sub("للتحقق منك: رقم جوالك المسجل لدى المدرسة، ومعرّف أحد أبنائك من بطاقته. يُربط بالحساب كل أبنائك المسجلين بنفس الجوال."),
    field("رقم الجوال", phone), field("معرّف أحد الأبناء", key), reset ? null : field("اسمك", name),
    field(reset ? "كلمة المرور الجديدة" : "كلمة المرور", pass), msg),
  [btn(reset ? "حفظ ودخول" : "تفعيل ودخول", async () => {
    mount(msg);
    try {
      const r = await api(`${P}/parent/activate`, { phone: phone.value, key: key.value, password: pass.value, name: name.value.trim() || undefined });
      setParentSignedIn(school, true);
      d.close();
      toast(r.siblings ? `تم. رُبط بالحساب ${r.siblings + 1} من أبنائك` : "تم تفعيل الحساب");
      location.hash = "#/family";
    } catch (e) { mount(msg, notice(e.message, "err")); }
  })]);
  phone.focus();
}

/* ======================= لوحة «أبنائي» ======================= */
const STATUS = {
  present: ["حاضر", ""], late: ["متأخر", "amber"], absent: ["غائب", "red"], excused: ["غياب بعذر", "gray"],
  permitted: ["مستأذن", "gray"], trip: ["رحلة", ""], activity: ["نشاط خارجي", ""],
};
const initials = (n) => String(n || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join(" ");
const firstName = (n) => String(n || "").trim().split(/\s+/)[0];
const timeOf = (iso) => new Date(iso).toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" });

export async function familyPage(shell) {
  let d;
  try { d = await api(`${P}/parent/me`, {}); } catch (e) {
    if (e.status === 401) { setParentSignedIn(school, false); location.hash = "#/"; return; }
    throw e;
  }
  sessionStorage.setItem(`midar_family_${school}`, JSON.stringify(d.children.filter((k) => k.active).map((k) => ({ id: k.id, name: k.name, class_name: k.class_name }))));
  document.title = `مدار — أبنائي`;
  const active = d.children.filter((k) => k.active), old = d.children.filter((k) => !k.active);
  const statusOf = (k) => (k.today_status ? STATUS[k.today_status] || [ATTENDANCE[k.today_status]?.[0] || k.today_status, "gray"] : ["لم يُسجَّل بعد", "gray"]);

  const card = (k) => {
    const photo = h("span", { class: "fk-photo", "aria-hidden": "true" }, initials(k.name));
    if (k.has_photo) api(`${P}/parent/photo`, { student_id: k.id }).then((r) => { if (r.photo) mount(photo, h("img", { src: r.photo, alt: "" })); }).catch(() => {});
    const [st, tone] = statusOf(k);
    return h("a", { class: "fk-card", href: studentUrl(k.id), onclick: () => openChild(school, { id: k.id, key: null }) },
      photo,
      h("div", { class: "fk-main" },
        h("b", { class: "fk-name" }, k.name),
        h("small", {}, [k.class_name, RELATION[k.relation]].filter(Boolean).join(" · ")),
        h("div", { class: "fk-row" }, badge(st, tone),
          k.first_in_at ? h("small", {}, `وصل ${timeOf(k.first_in_at)}${k.minutes_late ? ` (تأخر ${k.minutes_late} د)` : ""}`) : null,
          k.unread ? badge(`${k.unread} جديد`, "amber") : null),
        k.last_notification ? h("small", { class: "fk-last" }, k.last_notification.title) : null),
      h("span", { class: "fk-go" }, icons.chevronLeft({ size: 20 })));
  };

  const summary = active.length ? h("section", { class: "ss-card" }, h("h2", {}, icons.calendar({ size: 20 }), "ملخص اليوم"),
    h("div", { class: "fk-today" }, active.map((k) => {
      const [st, tone] = statusOf(k);
      return h("div", { class: "fk-today-row" }, h("b", {}, firstName(k.name)), badge(st, tone));
    }))) : null;

  const news = h("section", { class: "ss-card" }, h("h2", {}, icons.bell({ size: 20 }), "آخر التنبيهات"),
    d.notifications.length ? h("div", { class: "fk-news" }, d.notifications.slice(0, 15).map((n) => h("a", {
      class: `fk-note${n.read_at ? "" : " unread"}`, href: `${studentUrl(n.student_id)}&n=${n.id}${n.link ? `#${n.link}` : ""}`,
      onclick: () => openChild(school, { id: n.student_id, key: null }) },
    h("span", { class: "fk-who" }, n.category === "announcements" ? "إعلان" : firstName(n.student_name)),
    h("div", {}, h("b", {}, n.title), n.body ? h("small", {}, n.body) : null, h("small", { class: "muted" }, fmtDateTime(n.created_at))))))
      : empty("لا توجد تنبيهات خلال الأسبوعين الماضيين."));

  const pwBanner = d.parent.must_change_password || sessionStorage.getItem(`midar_parent_pw_${school}`)
    ? notice(h("span", {}, "أنت تستخدم كلمة مرور مؤقتة من المدرسة. ", h("button", { type: "button", class: "link", onclick: () => passwordDialog(d) }, "غيّرها الآن")), "warn") : null;

  // الأبناء المحفوظون بمعرّفاتهم على هذا الجهاز (قبل الحساب): ربطهم بالحساب بضغطة
  const known = new Set(d.children.map((k) => k.id));
  const local = rememberedChildren(school).filter((c) => !known.has(c.id));
  const localBox = local.length && d.can.link_by_key ? notice(h("span", {}, `على هذا الجهاز ${local.length} من الأبناء محفوظون بمعرّفاتهم. `,
    h("button", { type: "button", class: "link", onclick: async () => {
      for (const c of local) await api(`${P}/parent/children/add`, { key: c.key }).catch(() => {});
      toast("أُضيفوا إلى حسابك"); familyPage(shell);
    } }, "أضفهم إلى حسابي")), "") : null;

  shell([
    h("section", { class: "fk-head" },
      h("div", {}, h("h1", {}, `أهلًا ${firstName(d.parent.name)}`), h("small", {}, d.school)),
      h("div", { class: "fk-actions" },
        btn("إضافة ابن", () => addChildDialog(d, () => familyPage(shell)), "soft sm"),
        btn("كلمة المرور", () => passwordDialog(d), "ghost sm"),
        btn("خروج", async () => { await api(`${P}/parent/logout`, {}).catch(() => {}); setParentSignedIn(school, false); location.hash = "#/"; }, "ghost sm"))),
    pwBanner, localBox,
    d.pending_requests.length ? notice(`طلب ربط بانتظار موافقة المدرسة: ${d.pending_requests.map((r) => r.name).join("، ")}`, "") : null,
    h("section", { class: "fk-list" }, h("h2", { class: "fk-title" }, `أبنائي (${active.length})`),
      active.length ? active.map(card) : empty("لا يوجد أبناء مرتبطون بحسابك بعد. اضغط «إضافة ابن».")),
    active.length && window.isSecureContext ? pushInvite({ key: d.push_key || null, save: (s) => api(`${P}/parent/push`, { subscription: s }),
      text: "فعّل الإشعارات على هذا الجوال لتصلك أخبار كل أبنائك: الحضور والغياب والدرجات والواجبات." }) : null,
    summary, news,
    old.length ? h("details", { class: "ss-card fk-old" }, h("summary", {}, `أبناء سابقون (${old.length})`),
      old.map((k) => h("div", { class: "fk-old-row" }, h("b", {}, k.name), h("small", {}, "لم يعد مقيدًا في المدرسة — السجل محفوظ لدى المدرسة")))) : null,
  ], { crumbs: [["أبنائي", "#/family"]] });
}

function passwordDialog() {
  const cur = passwordInput({ autocomplete: "current-password" });
  const next = passwordInput({ autocomplete: "new-password", placeholder: "8 أحرف أو أرقام على الأقل" });
  const msg = h("div");
  const d = dialog("تغيير كلمة المرور", h("div", {}, field("كلمة المرور الحالية", cur), field("كلمة المرور الجديدة", next), msg),
    [btn("حفظ", async () => {
      try {
        await api(`${P}/parent/password`, { current: cur.value, next: next.value });
        sessionStorage.removeItem(`midar_parent_pw_${school}`);
        d.close(); toast("تم تغيير كلمة المرور");
      } catch (e) { mount(msg, notice(e.message, "err")); }
    })]);
}

function addChildDialog(d, done) {
  const key = input({ class: "ltr", placeholder: "XXXX-XXXX", maxLength: 9, autocomplete: "off" });
  key.addEventListener("input", () => {
    const v = key.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    key.value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v;
  });
  const no = input({ placeholder: "رقم الطالب", maxLength: 30, dir: "ltr" }), nm = input({ placeholder: "اسم الطالب", maxLength: 120 });
  const msg = h("div");
  const dd = dialog("إضافة ابن إلى حسابي", h("div", {},
    h("b", {}, "بمعرّف الطالب (من بطاقته)"),
    sub(d.can.link_by_key ? "يُضاف مباشرة." : "يصل طلبك للمدرسة للموافقة."),
    h("div", { class: "ss-keyrow" }, key, btn("إضافة", async () => {
      try {
        const r = await api(`${P}/parent/children/add`, { key: key.value });
        dd.close(); toast(r.linked ? (r.already ? "مرتبط بحسابك من قبل" : `أُضيف ${r.student?.name || "الابن"}`) : "أُرسل الطلب للمدرسة");
        done();
      } catch (e) { mount(msg, notice(e.message, "err")); }
    })),
    d.can.requests ? [h("hr"), h("b", {}, "لا تملك المعرّف؟"), sub("أرسل رقم الطالب واسمه، وتراجع المدرسة الطلب قبل ربطه."),
      h("div", { class: "row" }, no, nm), btn("إرسال طلب", async () => {
        try {
          await api(`${P}/parent/children/request`, { student_no: no.value.trim(), student_name: nm.value.trim() });
          dd.close(); toast("أُرسل الطلب. ستراجعه المدرسة.");
        } catch (e) { mount(msg, notice(e.message, "err")); }
      }, "ghost sm")] : null,
    msg));
  key.focus();
}
