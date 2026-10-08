// حساب ولي الأمر في صفحة المدرسة: زر الحساب أعلى الصفحة، والدخول وإنشاء الحساب بالبريد أو الجوال، ولوحة «أبنائي».
// دخول واحد ← كل الأبناء ← ملف أي ابن، بلا معرّف لكل ابن. الخادم يتحقق من ارتباط كل طالب بالحساب مع كل طلب.
import { h, mount } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { field, input, btn, notice, dialog, sub, badge, toast, passwordInput, empty, toAsciiDigits } from "../shared/js/ui.js";
import { ATTENDANCE, fmtDateTime } from "../shared/js/format.js";
import { icons } from "../shared/js/icons.js";
import { pushInvite } from "../shared/js/inbox.js";
import { setParentSignedIn, parentSignedIn, openChild, rememberedChildren } from "../shared/js/children.js";

const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();
const P = `/api/public/${encodeURIComponent(school)}`;
const studentUrl = (id) => `/${encodeURIComponent(school)}/student?s=${id}`;
const RELATION = { father: "الأب", mother: "الأم", guardian: "ولي الأمر", other: "" };

/* ======================= زر الحساب أعلى الصفحة ======================= */
/** زر ثابت في رأس موقع المدرسة: «أبنائي» إن كان الجهاز مسجّلًا، وإلا «حساب ولي الأمر» */
export function accountButton() {
  const on = parentSignedIn(school);
  return h("a", { class: `ss-acct${on ? " on" : ""}`, href: on ? "#/family" : "#/account" },
    icons.user({ size: 18 }), h("span", {}, on ? "أبنائي" : "حساب ولي الأمر"));
}

/* ======================= الدخول وإنشاء الحساب ======================= */
const fmtKey = (el) => el.addEventListener("input", () => {
  // رابط بطاقة كامل (?k=) يُقبل كما هو، وغيره يُنسَّق XXXX-XXXX
  if (/^https?:/i.test(el.value)) return;
  const v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  el.value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v;
});
const idInput = (props = {}) => input({ type: "text", inputMode: "email", dir: "ltr", autocomplete: "username", autocapitalize: "none", spellcheck: false,
  placeholder: "example@mail.com  /  7XXXXXXXX", maxLength: 120, ...props });
const idValue = (el) => toAsciiDigits(el.value.trim());
const signedIn = (msg) => { setParentSignedIn(school, true); if (msg) sessionStorage.setItem(`midar_parent_welcome_${school}`, msg); location.hash = "#/family"; };

/** صفوف معرّفات الأبناء: صف لكل ابن، «إضافة ابن آخر»، وتعليم المعرّف الخاطئ */
function keyRows(initial = 1) {
  const list = h("div", { class: "ac-keys" });
  const rows = [];
  const add = (focus = true) => {
    if (rows.length >= 20) return;
    const el = input({ class: "ltr ss-key", placeholder: "XXXX-XXXX", maxLength: 400, autocomplete: "off", autocapitalize: "characters",
      spellcheck: false, "aria-label": `معرّف الابن ${rows.length + 1}` });
    fmtKey(el);
    const row = h("div", { class: "ac-key" }, h("span", { class: "n" }, String(rows.length + 1)), el,
      h("button", { type: "button", class: "ac-del", "aria-label": "حذف", onclick: () => {
        if (rows.length === 1) { el.value = ""; return; }
        rows.splice(rows.indexOf(item), 1); row.remove();
        rows.forEach((r, i) => { r.row.firstChild.textContent = String(i + 1); });
      } }, icons.close({ size: 16 })));
    const item = { row, el };
    rows.push(item); list.append(row);
    el.addEventListener("input", () => row.classList.remove("bad"));
    if (focus) el.focus();
  };
  for (let i = 0; i < initial; i++) add(false);
  const more = h("button", { type: "button", class: "ac-more", onclick: () => add() }, icons.plus({ size: 16 }), "إضافة ابن آخر");
  return {
    el: h("div", {}, list, more),
    values: () => rows.map((r) => r.el.value.trim()).filter(Boolean),
    mark(invalid = []) {
      const filled = rows.filter((r) => r.el.value.trim());
      invalid.forEach((i) => filled[i]?.row.classList.add("bad"));
      (filled[invalid[0]] || rows[0])?.el.focus();
    },
    focus: () => rows[0]?.el.focus(),
  };
}

/** صفحة الحساب: تبويبان «تسجيل الدخول» و«إنشاء حساب» */
export function accountPage(shell, mode = "login") {
  if (parentSignedIn(school)) { location.hash = "#/family"; return; }
  document.title = mode === "new" ? "مدار — إنشاء حساب ولي الأمر" : "مدار — دخول ولي الأمر";
  const tab = (id, label) => h("a", { class: `ac-tab${mode === id ? " on" : ""}`, href: id === "new" ? "#/account/new" : "#/account", role: "tab",
    "aria-selected": String(mode === id) }, label);
  shell(h("section", { class: "ac-wrap" },
    h("div", { class: "ac-intro" }, h("span", { class: "ac-badge" }, icons.users({ size: 26 })),
      h("h1", {}, "حساب ولي الأمر"),
      h("p", {}, "حساب واحد لكل أبنائك: الحضور، والدرجات، والواجبات، والرسوم، والإشعارات.")),
    h("div", { class: "ac-card" },
      h("nav", { class: "ac-tabs", role: "tablist" }, tab("login", "تسجيل الدخول"), tab("new", "إنشاء حساب")),
      mode === "new" ? registerForm() : loginForm())), { crumbs: [[mode === "new" ? "إنشاء حساب" : "تسجيل الدخول", location.hash]] });
}

function loginForm() {
  const id = idInput({ autofocus: true }), pass = passwordInput({ autocomplete: "current-password", placeholder: "كلمة المرور" });
  const msg = h("div");
  const go = btn("دخول", async () => {
    mount(msg);
    if (!id.value.trim() || !pass.value) return mount(msg, notice("اكتب البريد أو رقم الجوال وكلمة المرور", "err"));
    try {
      const r = await api(`${P}/parent/login`, { identifier: idValue(id), password: pass.value });
      if (r.must_change_password) sessionStorage.setItem(`midar_parent_pw_${school}`, "1");
      signedIn();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "primary block");
  const form = h("form", { class: "ac-form", onsubmit: (e) => { e.preventDefault(); go.click(); } },
    field("البريد الإلكتروني أو رقم الجوال", id), field("كلمة المرور", pass),
    h("div", { class: "ac-row" }, h("small", { class: "ac-note" }, icons.lock({ size: 14 }), "يبقى دخولك محفوظًا على هذا الجهاز"),
      h("button", { type: "button", class: "link", onclick: () => resetDialog(idValue(id)) }, "نسيت كلمة المرور؟")),
    msg, go, h("button", { type: "submit", hidden: true }),
    h("p", { class: "ac-switch" }, "ليس لديك حساب؟ ", h("a", { href: "#/account/new" }, "أنشئ حسابك الآن")));
  queueMicrotask(() => id.focus());
  return form;
}

function registerForm() {
  const name = input({ placeholder: "الاسم كما تحب أن يظهر", maxLength: 120, autocomplete: "name" });
  const id = idInput(), pass = passwordInput({ autocomplete: "new-password", placeholder: "8 أحرف أو أرقام على الأقل" });
  const keys = keyRows(1);
  const msg = h("div"), body = h("div");
  const steps = h("ol", { class: "ac-steps" }, h("li", { class: "on" }, h("b", {}, "1"), "بياناتك"), h("li", {}, h("b", {}, "2"), "أبناؤك"));
  const step = (n) => {
    mount(msg);
    [...steps.children].forEach((li, i) => li.classList.toggle("on", i <= n - 1));
    mount(body, n === 1 ? stepOne : stepTwo);
    (n === 1 ? next : save).before(msg);   // الرسالة فوق الزر مباشرة (ظاهرة دائمًا)
    (n === 1 ? name : keys).focus();
  };
  const next = btn("التالي", () => {
    mount(msg);
    const v = idValue(id);
    if (name.value.trim().length < 2) return mount(msg, notice("اكتب اسمك", "err"));
    if (!v.includes("@") && !/^\+?[0-9\s-]{6,25}$/.test(v)) return mount(msg, notice("اكتب بريدًا إلكترونيًا صحيحًا أو رقم جوال صحيحًا", "err"));
    if (v.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return mount(msg, notice("البريد الإلكتروني غير صحيح", "err"));
    if (pass.value.length < 8) return mount(msg, notice("كلمة المرور 8 أحرف أو أرقام على الأقل", "err"));
    step(2);
  }, "primary block");
  const save = btn("حفظ وإنشاء الحساب", async () => {
    mount(msg);
    const list = keys.values();
    if (!list.length) { keys.focus(); return mount(msg, notice("أضف معرّف ابن واحد على الأقل", "err")); }
    try {
      const r = await api(`${P}/parent/register`, { name: name.value.trim(), identifier: idValue(id), password: pass.value, keys: list });
      const n = r.linked.length + r.siblings.length + r.already.length;
      signedIn(n ? `مرحبًا بك. أُضيف إلى حسابك ${n === 1 ? "ابن واحد" : `${n} من الأبناء`}.` + (r.requested.length ? ` و${r.requested.length} بانتظار موافقة المدرسة.` : "")
        : "تم إنشاء حسابك. طلبات ربط أبنائك بانتظار موافقة المدرسة.");
    } catch (e) {
      if (e.invalid) keys.mark(e.invalid);
      if (e.code === "exists") {
        step(1);
        return mount(msg, notice(h("span", {}, e.message, " ", h("a", { href: "#/account" }, "تسجيل الدخول")), "err"));
      }
      mount(msg, notice(e.message, "err"));
    }
  }, "primary block");
  const stepOne = h("div", { class: "ac-form" },
    field("الاسم", name), field("البريد الإلكتروني أو رقم الجوال", id, "تستخدمه للدخول لاحقًا"), field("كلمة المرور", pass), next);
  const stepTwo = h("div", { class: "ac-form" },
    h("div", { class: "ac-help" }, icons.key({ size: 18 }),
      h("span", {}, "اكتب معرّف كل ابن من بطاقته التي سلّمتها المدرسة (مثل ABCD-2345)، أو الصق رابط البطاقة.")),
    keys.el, save,
    h("button", { type: "button", class: "link ac-back", onclick: () => step(1) }, "رجوع لتعديل بياناتك"));
  for (const el of [name, id, pass.inputEl]) el.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), next.click()));
  mount(body, stepOne);
  next.before(msg);
  queueMicrotask(() => name.focus());
  return h("div", {}, steps, body,
    h("p", { class: "ac-switch" }, "لديك حساب؟ ", h("a", { href: "#/account" }, "سجّل الدخول")));
}

/** نسيت كلمة المرور: البريد أو الجوال + معرّف أحد الأبناء المرتبطين بالحساب */
function resetDialog(prefill = "") {
  const id = idInput({ value: prefill });
  const key = input({ class: "ltr ss-key", placeholder: "XXXX-XXXX", maxLength: 400, autocomplete: "off" });
  fmtKey(key);
  const pass = passwordInput({ autocomplete: "new-password", placeholder: "8 أحرف أو أرقام على الأقل" });
  const msg = h("div");
  const d = dialog("استعادة كلمة المرور", h("div", { class: "ac-form" },
    sub("للتحقق منك: بريدك أو جوالك المسجل في الحساب، ومعرّف أحد أبنائك من بطاقته."),
    field("البريد الإلكتروني أو رقم الجوال", id), field("معرّف أحد الأبناء", key), field("كلمة المرور الجديدة", pass), msg),
  [btn("حفظ ودخول", async () => {
    mount(msg);
    try {
      await api(`${P}/parent/activate`, { identifier: idValue(id), key: key.value.trim(), password: pass.value });
      d.close();
      sessionStorage.removeItem(`midar_parent_pw_${school}`);
      signedIn("تم تعيين كلمة المرور الجديدة.");
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "primary")]);
  (prefill ? key : id).focus();
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
    if (e.status === 401) { setParentSignedIn(school, false); location.hash = "#/account"; return; }
    throw e;
  }
  sessionStorage.setItem(`midar_family_${school}`, JSON.stringify(d.children.filter((k) => k.active).map((k) => ({ id: k.id, name: k.name, class_name: k.class_name }))));
  document.title = `مدار — أبنائي`;
  const welcome = sessionStorage.getItem(`midar_parent_welcome_${school}`);
  if (welcome) { sessionStorage.removeItem(`midar_parent_welcome_${school}`); queueMicrotask(() => toast(welcome)); }
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
      h("div", {}, h("h1", {}, `أهلًا ${firstName(d.parent.name)}`), h("small", {}, [d.school, d.parent.email || d.parent.phone].filter(Boolean).join(" · "))),
      h("div", { class: "fk-actions" },
        btn([icons.plus({ size: 16 }), "إضافة ابن"], () => addChildDialog(d, () => familyPage(shell)), "primary sm"),
        btn("كلمة المرور", () => passwordDialog(d), "ghost sm"),
        btn("تسجيل الخروج", async () => {
          await api(`${P}/parent/logout`, {}).catch(() => {});
          setParentSignedIn(school, false); sessionStorage.removeItem(`midar_family_${school}`);
          location.hash = "#/";
        }, "ghost sm"))),
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
  const keys = keyRows(1);
  const no = input({ placeholder: "رقم الطالب", maxLength: 30, dir: "ltr" }), nm = input({ placeholder: "اسم الطالب", maxLength: 120 });
  const msg = h("div");
  const dd = dialog("إضافة أبناء إلى حسابي", h("div", { class: "ac-form" },
    h("div", { class: "ac-help" }, icons.key({ size: 18 }),
      h("span", {}, d.can.link_by_key ? "اكتب معرّف كل ابن من بطاقته، ويُضاف فورًا." : "اكتب معرّف كل ابن من بطاقته، ويصل طلبك للمدرسة للموافقة.")),
    keys.el,
    btn("حفظ", async () => {
      mount(msg);
      const list = keys.values();
      if (!list.length) return mount(msg, notice("اكتب معرّف ابن واحد على الأقل", "err"));
      try {
        const r = await api(`${P}/parent/children/add`, { keys: list });
        dd.close();
        toast([r.linked.length ? `أُضيف ${r.linked.join("، ")}` : "", r.requested.length ? `أُرسل طلب ${r.requested.join("، ")} للمدرسة` : "",
          r.already.length && !r.linked.length && !r.requested.length ? "مرتبطون بحسابك من قبل" : ""].filter(Boolean).join(" · "));
        done();
      } catch (e) { if (e.invalid) keys.mark(e.invalid); mount(msg, notice(e.message, "err")); }
    }, "primary block"),
    d.can.requests ? h("details", { class: "ac-alt" }, h("summary", {}, "لا تملك المعرّف؟"),
      sub("أرسل رقم الطالب واسمه، وتراجع المدرسة الطلب قبل ربطه."),
      h("div", { class: "row" }, no, nm), btn("إرسال طلب", async () => {
        try {
          await api(`${P}/parent/children/request`, { student_no: no.value.trim(), student_name: nm.value.trim() });
          dd.close(); toast("أُرسل الطلب. ستراجعه المدرسة.");
        } catch (e) { mount(msg, notice(e.message, "err")); }
      }, "ghost sm")) : null,
    msg));
  keys.focus();
}
